import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import { THEMES, subscribeTheme, theme, themeById, withAlpha } from '../theme';
import type { ThemeDef } from '../theme';
import { t } from '../i18n';
import { ICON, el, icon, iconButton } from './dom';
import { highlightBlock } from './highlight';
import { prefs } from './prefs';

const parser = new Marked({ gfm: true, breaks: true });

/** Teks dari model boleh membawa tag HTML, jadi semua keluaran disanitasi lebih dulu. */
const HTML_CONFIG = {
  FORBID_ATTR: ['style', 'srcdoc'],
  FORBID_TAGS: [
    'audio',
    'base',
    'embed',
    'form',
    'iframe',
    'link',
    'meta',
    'object',
    'script',
    'source',
    'style',
    'track',
    'video',
  ],
  USE_PROFILES: { html: true },
};

const SVG_TRASH = new Set([
  'BASE',
  'BUTTON',
  'EMBED',
  'FORM',
  'IFRAME',
  'INPUT',
  'LINK',
  'META',
  'OBJECT',
  'SCRIPT',
  'SELECT',
  'TEXTAREA',
  'TRACK',
]);

const SVG_URL_ATTRS = new Set(['href', 'src', 'xlink:href']);

/** Fence diagram tanpa kata 'mermaid': kepala sintaks disisipkan supaya tetap tergambar. */
const DIAGRAM_HEADER: Record<string, string> = {
  class: 'classDiagram',
  er: 'erDiagram',
  flowchart: 'flowchart TD',
  gantt: 'gantt',
  journey: 'journey',
  mindmap: 'mindmap',
  pie: 'pie',
  quadrant: 'quadrantChart',
  sankey: 'sankey-beta',
  sequence: 'sequenceDiagram',
  state: 'stateDiagram-v2',
  timeline: 'timeline',
  xychart: 'xychart-beta',
  'xychart-beta': 'xychart-beta',
};

const TEXT_CACHE_LIMIT = 120;
const DIAGRAM_CACHE_LIMIT = 40;
/** Mermaid terlalu mahal untuk tiap frame streaming: tunggu teksnya berhenti mengalir. */
const DIAGRAM_SETTLE_MS = 260;

type MermaidApi = typeof import('mermaid').default;
type Diagram = { svg: string } | { error: string };

const textCache = new Map<string, string>();
const diagramCache = new Map<string, Diagram>();
const templateCache = new Map<string, HTMLTemplateElement>();
const pendingDiagrams = new Map<HTMLElement, number>();
const diagramSources = new WeakMap<HTMLElement, string>();

let mermaidLoader: Promise<MermaidApi> | null = null;
let diagramSeq = 0;

export function renderMarkdown(container: HTMLElement, source: string): void {
  container.classList.add('md');
  let html = textCache.get(source);
  if (html === undefined) {
    html = DOMPurify.sanitize(parser.parse(source, { async: false }), HTML_CONFIG);
    remember(textCache, TEXT_CACHE_LIMIT, source, html);
  }
  const holder = document.createElement('div');
  holder.innerHTML = html;
  while (holder.firstChild) container.append(holder.firstChild);
  decorate(container);
}

/** Batalkan render diagram yang masih antre; panggil tepat sebelum isi chat dibuang. */
export function cancelPendingDiagrams(): void {
  for (const timer of pendingDiagrams.values()) window.clearTimeout(timer);
  pendingDiagrams.clear();
}

function decorate(root: HTMLElement): void {
  for (const link of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  for (const table of Array.from(root.querySelectorAll('table'))) {
    const wrap = el('div', 'md-table');
    table.replaceWith(wrap);
    wrap.append(table);
  }
  for (const pre of Array.from(root.querySelectorAll('pre'))) {
    const code = pre.querySelector('code');
    const lang = (/language-([\w-]+)/i.exec(code?.className ?? '')?.[1] ?? '').toLowerCase();
    const text = (code?.textContent ?? pre.textContent ?? '').replace(/\n+$/, '');
    if (lang === 'mermaid' || lang in DIAGRAM_HEADER) {
      pre.replaceWith(buildDiagram(withHeader(lang, text)));
      continue;
    }
    const block = el('div', 'md-code');
    if (lang) block.append(el('span', 'md-code__lang', lang));
    pre.replaceWith(block);
    block.append(pre);
    if (lang && prefs().syntax && text.length) void paintCode(pre, code, text, lang);
  }
}

/** Chat membangun ulang DOM tiap frame streaming, jadi hasil lama dibuang lewat dua cek ini. */
async function paintCode(pre: HTMLElement, code: HTMLElement | null, text: string, lang: string): Promise<void> {
  const html = await highlightBlock(text, lang);
  if (!html || !code || !pre.isConnected) return;
  if ((code.textContent ?? '').replace(/\n+$/, '') !== text) return;
  code.innerHTML = html;
}

function withHeader(lang: string, source: string): string {
  const header = DIAGRAM_HEADER[lang];
  if (!header) return source;
  const first = source.trimStart().split('\n', 1)[0].trim().toLowerCase();
  return first.startsWith(header.split(/[\s-]/)[0].toLowerCase()) ? source : `${header}\n${source}`;
}

function buildDiagram(source: string): HTMLElement {
  const figure = el('figure', 'md-diagram');
  diagramSources.set(figure, source);
  const cached = diagramCache.get(source);
  if (cached) {
    paint(figure, cached);
    return figure;
  }
  paint(figure, null);
  pendingDiagrams.set(
    figure,
    window.setTimeout(() => {
      pendingDiagrams.delete(figure);
      void draw(figure, source);
    }, DIAGRAM_SETTLE_MS)
  );
  return figure;
}

/** Model sering menulis nilai pie sebagai "40%" — lexer mermaid menolak persen di baris angka. */
const PERCENT_VALUE = /^(\s*"[^"]*"\s*:\s*\d+(?:[.,]\d+)?)\s*%\s*$/gm;

async function draw(figure: HTMLElement, source: string): Promise<void> {
  let result: Diagram;
  try {
    const mermaid = await loadMermaid();
    try {
      result = { svg: await renderSvg(mermaid, source) };
    } catch (error) {
      const repaired = source.replace(PERCENT_VALUE, '$1');
      if (repaired === source) throw error;
      result = { svg: await renderSvg(mermaid, repaired) };
    }
  } catch (error) {
    result = { error: briefError(error) };
  }
  remember(diagramCache, DIAGRAM_CACHE_LIMIT, source, result);
  if (figure.isConnected) paint(figure, result);
}

async function renderSvg(mermaid: MermaidApi, source: string): Promise<string> {
  const id = `virtoDiagram${(diagramSeq += 1)}`;
  try {
    const { svg } = await mermaid.render(id, source);
    return cleanSvg(svg);
  } finally {
    // Node sementara ini ditinggali gambar "Syntax error in text" kalau parse gagal,
    // dan tetap menempel visible di body kalau hanya dibersihkan saat sukses.
    document.getElementById(`d${id}`)?.remove();
  }
}

/** Pesan mermaid tiga baris bertele-tele; yang berguna cuma bagian setelah "Parsing failed". */
function briefError(error: unknown): string {
  const text = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim();
  const detail = /Parsing failed:\s*([\s\S]*)$/i.exec(text)?.[1] ?? text.replace(/^Syntax error in text\s+mermaid version \S+\s*/i, '');
  return (detail.trim() || text).slice(0, 220);
}

function paint(figure: HTMLElement, result: Diagram | null): void {
  const status = result === null ? 'loading' : 'svg' in result ? 'ready' : 'error';
  figure.dataset.status = status;

  const view = el('div', 'md-diagram__view');
  if (result === null) {
    view.append(el('span', 'spinner'), el('span', 'md-diagram__hint', t('md.diagramLoading')));
  } else if ('error' in result) {
    view.append(el('p', 'md-diagram__error', t('md.diagramError', { message: result.error })));
  } else {
    view.append(templateFor(result.svg).content.cloneNode(true));
  }

  const source = diagramSources.get(figure) ?? '';
  const bar = el('figcaption', 'md-diagram__bar');
  bar.append(el('span', 'md-diagram__kind', kindOf(result)));
  const actions = el('span', 'md-diagram__actions');
  if (result && 'svg' in result) {
    const svg = result.svg;
    actions.append(iconButton(t('md.expandDiagram'), ICON.expand, () => openViewer(svg, kindOf(result))));
  }
  if (source) {
    const copy: HTMLButtonElement = iconButton(t('md.copyDiagramSource'), ICON.copy, () =>
      copySource(copy, source)
    );
    actions.append(copy);
  }
  bar.append(actions);
  figure.replaceChildren(view, bar);

  if (result && 'error' in result && source) {
    const block = el('div', 'md-code');
    block.append(el('span', 'md-code__lang', 'mermaid'));
    const pre = el('pre');
    pre.append(el('code', undefined, source));
    block.append(pre);
    const details = el('details', 'md-diagram__source');
    details.append(el('summary', undefined, t('md.showSource')), block);
    figure.append(details);
  }
}

function kindOf(result: Diagram | null): string {
  if (!result || 'error' in result) return 'mermaid';
  const type = templateFor(result.svg).content.querySelector('svg')?.getAttribute('aria-roledescription');
  return type ? `mermaid · ${type}` : 'mermaid';
}

/** Mermaid sudah mensterilkan label; lapis kedua ini membuang tag dan handler yang tersisa. */
function cleanSvg(svg: string): string {
  const holder = document.createElement('template');
  holder.innerHTML = svg;
  for (const node of Array.from(holder.content.querySelectorAll('*'))) {
    if (SVG_TRASH.has(node.tagName.toUpperCase())) {
      node.remove();
      continue;
    }
    for (const attribute of Array.from(node.attributes)) {
      const name = attribute.name.toLowerCase();
      const dangerousUrl = SVG_URL_ATTRS.has(name) && /^(javascript|data):/i.test(attribute.value.trim());
      if (name.startsWith('on') || dangerousUrl) node.removeAttribute(attribute.name);
    }
  }
  return holder.innerHTML;
}

/** SVG disimpan sebagai template supaya rebuild chat tiap frame cukup mengklon node. */
function templateFor(svg: string): HTMLTemplateElement {
  let node = templateCache.get(svg);
  if (!node) {
    node = document.createElement('template');
    node.innerHTML = svg;
    remember(templateCache, DIAGRAM_CACHE_LIMIT, svg, node);
  }
  return node;
}

function openViewer(svg: string, kind: string): void {
  const layer = el('div', 'diagram-view');
  const backdrop = el('div', 'diagram-view__backdrop');
  const card = el('div', 'diagram-view__card');
  const head = el('header', 'diagram-view__head');
  const tools = el('span', 'diagram-view__tools');
  const stage = el('div', 'diagram-view__stage');
  const inner = el('div', 'diagram-view__inner');

  inner.append(templateFor(svg).content.cloneNode(true));
  stage.append(inner);

  const setScale = (value: number) => {
    const scale = Math.min(6, Math.max(0.4, value));
    inner.style.transform = `scale(${scale})`;
  };
  const fit: HTMLButtonElement = el('button', 'icon-btn');
  fit.type = 'button';
  fit.title = t('md.zoomReset');
  fit.textContent = '1:1';
  fit.addEventListener('click', () => setScale(1));

  tools.append(
    iconButton(t('md.zoomOut'), ICON.minus, () => setScale(current(inner) - 0.25)),
    fit,
    iconButton(t('md.zoomIn'), ICON.plus, () => setScale(current(inner) + 0.25))
  );
  head.append(el('h2', 'diagram-view__title', kind), tools);
  card.append(head, stage);
  layer.append(backdrop, card);
  document.body.append(layer);

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close();
  };
  function close(): void {
    document.removeEventListener('keydown', onKey);
    layer.remove();
  }
  tools.append(iconButton('Tutup', ICON.close, () => close()));
  backdrop.addEventListener('click', () => close());
  document.addEventListener('keydown', onKey);
}

function current(node: HTMLElement): number {
  const match = /scale\(([\d.]+)\)/.exec(node.style.transform);
  return match ? Number(match[1]) : 1;
}

function copySource(button: HTMLButtonElement, source: string): void {
  if (!navigator.clipboard) return;
  void navigator.clipboard.writeText(source).then(
    () => {
      button.replaceChildren(icon(ICON.check, 15));
      window.setTimeout(() => {
        if (button.isConnected) button.replaceChildren(icon(ICON.copy, 15));
      }, 1_200);
    },
    () => undefined
  );
}

let mermaidInstance: MermaidApi | null = null;

function activeTheme(): ThemeDef {
  return themeById(theme()) ?? THEMES[0];
}

/** Warna diagram mengikuti palet tema aktif supaya tidak menyala di tema terang. */
function mermaidVars(def: ThemeDef) {
  return {
    activationBkgColor: withAlpha(def.ink, 0.08),
    activationBorderColor: withAlpha(def.accent, 0.5),
    actorBkg: withAlpha(def.accent, 0.14),
    actorBorder: withAlpha(def.accent, 0.6),
    actorLineColor: withAlpha(def.ink, 0.35),
    actorTextColor: def.ink,
    background: 'transparent',
    clusterBkg: withAlpha(def.ink, 0.05),
    clusterBorder: withAlpha(def.ink, 0.22),
    critBkgColor: withAlpha(def.del, 0.8),
    doneTaskBkgColor: withAlpha(def.add, 0.7),
    edgeLabelBackground: def.panel,
    fill0: def.accent,
    fill1: def.del,
    fill2: def.type,
    fill3: def.add,
    fill4: def.attr,
    labelBoxBkgColor: withAlpha(def.accent, 0.14),
    labelBoxBorderColor: withAlpha(def.accent, 0.5),
    labelTextColor: def.ink,
    lineColor: withAlpha(def.ink, 0.55),
    noteBkgColor: withAlpha(def.ink, 0.07),
    noteBorderColor: withAlpha(def.accent, 0.45),
    noteTextColor: def.ink,
    pieOpacity: '1',
    pieStrokeColor: withAlpha(def.bg, 0.9),
    primaryColor: withAlpha(def.accent, 0.16),
    primaryBorderColor: withAlpha(def.accent, 0.6),
    primaryTextColor: def.ink,
    secondaryColor: withAlpha(def.del, 0.18),
    sequenceNumberColor: def.bg,
    signalColor: withAlpha(def.ink, 0.6),
    signalTextColor: def.ink,
    tertiaryColor: withAlpha(def.type, 0.16),
    titleColor: def.ink,
    xyChart: {
      backgroundColor: 'transparent',
      plotColorPalette: [def.accent, def.del, def.type, def.add].join(', '),
      titleColor: def.ink,
      xLabelColor: withAlpha(def.ink, 0.7),
      yLabelColor: withAlpha(def.ink, 0.7),
    },
  };
}

function applyMermaidTheme(mermaid: MermaidApi): void {
  mermaid.initialize({
    securityLevel: 'strict',
    startOnLoad: false,
    suppressErrorRendering: true,
    theme: 'base',
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    themeVariables: mermaidVars(activeTheme()),
    flowchart: { htmlLabels: false, useMaxWidth: true },
  });
}

function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidLoader) {
    mermaidLoader = import('mermaid').then((module) => {
      const mermaid = module.default;
      mermaidInstance = mermaid;
      applyMermaidTheme(mermaid);
      return mermaid;
    });
  }
  return mermaidLoader.catch((error: unknown) => {
    mermaidLoader = null;
    throw error;
  });
}

// Diagram lama sudah terbake sebagai SVG dengan warna tema sebelumnya, jadi cache dan
// setiap figure yang masih di DOM harus dihapus ulang saat user pindah tema.
subscribeTheme(() => {
  if (mermaidInstance) applyMermaidTheme(mermaidInstance);
  diagramCache.clear();
  templateCache.clear();
  for (const figure of Array.from(document.querySelectorAll<HTMLElement>('.md-diagram'))) {
    const source = diagramSources.get(figure);
    if (!source) continue;
    const timer = pendingDiagrams.get(figure);
    if (timer) window.clearTimeout(timer);
    pendingDiagrams.delete(figure);
    paint(figure, null);
    void draw(figure, source);
  }
});

function remember<K, V>(cache: Map<K, V>, limit: number, key: K, value: V): void {
  cache.set(key, value);
  if (cache.size > limit) cache.delete(cache.keys().next().value as K);
}
