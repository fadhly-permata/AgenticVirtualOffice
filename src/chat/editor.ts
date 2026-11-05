import { locale } from '../i18n';
import { prefs } from './prefs';

/**
 * Surface suntingan File List.
 *
 * Dua hal sengaja tidak memakai bawaan CodeMirror:
 * - riwayat: stack snapshot milik modul ini, bukan history() editor, supaya tombol
 *   Undo/Redo tetap bekerja saat fokus sedang tidak di dalam editor;
 * - pemisah baris: dihitung dari isi di disk dan dipakai lagi saat menulis, supaya file
 *   CRLF tidak diluruskan diam-diam menjadi LF.
 */

const MERGE_MS = 600;

type Extension = import('@codemirror/state').Extension;
type EditorViewT = import('@codemirror/view').EditorView;
type EditorUpdate = import('@codemirror/view').ViewUpdate;

interface Bundle {
  state: typeof import('@codemirror/state');
  view: typeof import('@codemirror/view');
  commands: typeof import('@codemirror/commands');
  language: typeof import('@codemirror/language');
  search: typeof import('@codemirror/search');
  autocomplete: typeof import('@codemirror/autocomplete');
  highlight: typeof import('@lezer/highlight');
}

let bundlePromise: Promise<Bundle> | null = null;

/** CodeMirror hanya dimuat saat ada file teks yang benar-benar dibuka untuk disunting. */
function loadBundle(): Promise<Bundle> {
  if (!bundlePromise) {
    const pending = Promise.all([
      import('@codemirror/state'),
      import('@codemirror/view'),
      import('@codemirror/commands'),
      import('@codemirror/language'),
      import('@codemirror/search'),
      import('@codemirror/autocomplete'),
      import('@lezer/highlight'),
    ] as const).then(([state, view, commands, language, search, autocomplete, highlight]) => ({
      state,
      view,
      commands,
      language,
      search,
      autocomplete,
      highlight,
    }));
    bundlePromise = pending;
    pending.catch(() => {
      if (bundlePromise === pending) bundlePromise = null;
    });
  }
  return bundlePromise;
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: 'js',
  tsx: 'js',
  mts: 'js',
  cts: 'js',
  js: 'js',
  jsx: 'js',
  mjs: 'js',
  cjs: 'js',
  json: 'json',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  vue: 'html',
  css: 'css',
  scss: 'css',
  less: 'css',
  py: 'python',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
};

function extensionOf(path: string): string {
  return path.slice(path.lastIndexOf('.') + 1).toLowerCase();
}

/** Satu modul bahasa per file; yang tidak dikenal disunting sebagai teks polos. */
async function loadLanguage(path: string): Promise<Extension | null> {
  const kind = LANGUAGE_BY_EXT[extensionOf(path)];
  if (!kind) return null;
  try {
    if (kind === 'js') {
      const mod = await import('@codemirror/lang-javascript');
      const ext = extensionOf(path);
      return mod.javascript({
        typescript: ext.startsWith('t') || ext === 'mts' || ext === 'cts',
        jsx: ext === 'tsx' || ext === 'jsx',
      });
    }
    if (kind === 'json') return (await import('@codemirror/lang-json')).json();
    if (kind === 'html') return (await import('@codemirror/lang-html')).html();
    if (kind === 'css') return (await import('@codemirror/lang-css')).css();
    if (kind === 'python') return (await import('@codemirror/lang-python')).python();
    if (kind === 'markdown') return (await import('@codemirror/lang-markdown')).markdown();
    if (kind === 'yaml') return (await import('@codemirror/lang-yaml')).yaml();
  } catch {
    // Chunk bahasa gagal dimuat (offline) tidak boleh membuat file tidak bisa disunting.
  }
  return null;
}

/** Label panel Cari & Ganti milik CodeMirror; ikut bahasa app supaya tidak Inggris sendiri. */
const SEARCH_PHRASES_ID: Record<string, string> = {
  Find: 'Cari',
  Replace: 'Ganti',
  next: 'berikut',
  previous: 'sebelum',
  all: 'semua',
  'match case': 'beda besar-kecil',
  regexp: 'regexp',
  'by word': 'per kata',
  replace: 'ganti',
  'replace all': 'ganti semua',
};

/**
 * Tag → kelas .tok-* milik tema app. defaultHighlightStyle memakai kelas acak yang tidak
 * bisa dijangkau CSS kami, jadi warnanya tidak ikut tema gelap.
 */
function tokenStyle(bundle: Bundle): import('@codemirror/language').HighlightStyle {
  const t = bundle.highlight.tags;
  return bundle.language.HighlightStyle.define([
    { tag: t.keyword, class: 'tok-keyword' },
    { tag: t.comment, class: 'tok-comment' },
    { tag: t.string, class: 'tok-string' },
    { tag: t.url, class: 'tok-url' },
    { tag: t.link, class: 'tok-url' },
    { tag: t.number, class: 'tok-number' },
    { tag: t.bool, class: 'tok-bool' },
    { tag: t.null, class: 'tok-null' },
    { tag: t.atom, class: 'tok-atom' },
    { tag: t.function(t.variableName), class: 'tok-function' },
    { tag: t.name, class: 'tok-name' },
    { tag: t.typeName, class: 'tok-typeName' },
    { tag: t.className, class: 'tok-className' },
    { tag: t.namespace, class: 'tok-namespace' },
    { tag: t.propertyName, class: 'tok-propertyName' },
    { tag: t.attributeName, class: 'tok-propertyName' },
    { tag: t.variableName, class: 'tok-variableName' },
    { tag: t.definition(t.variableName), class: 'tok-definitionVariable' },
    { tag: t.tagName, class: 'tok-tag' },
    { tag: t.meta, class: 'tok-meta' },
    { tag: t.heading, class: 'tok-heading' },
    { tag: t.strong, class: 'tok-strong' },
    { tag: t.emphasis, class: 'tok-emphasis' },
    { tag: t.invalid, class: 'tok-invalid' },
  ]);
}

/** Pemisah baris dominan: mayoritas baris CRLF berarti file itu memang CRLF. */
export function separatorOf(text: string): string {
  const total = (text.match(/\n/g) ?? []).length;
  const crlf = (text.match(/\r\n/g) ?? []).length;
  return crlf > 0 && crlf * 2 >= total ? '\r\n' : '\n';
}

/**
 * Dokumen editor selalu LF. Pemisah baris asli di disk diingat dan dipasang lagi saat
 * menulis, supaya tempelan teks LF tidak meninggalkan berkas yang campur pemisah baris.
 */
export function toLF(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Berapa baris yang berubah dibanding isi di disk. Multiset baris, bukan diff Myers:
 * angkanya cuma untuk sekilas lihat di toolbar, dan per ketikan harus tetap murah.
 */
export function lineDelta(base: string, draft: string): { added: number; removed: number } {
  const tally = (text: string): Map<string, number> => {
    const map = new Map<string, number>();
    for (const line of text.split('\n')) {
      const key = line.trim();
      if (!key) continue;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  };
  const before = tally(base);
  const after = tally(draft);
  let added = 0;
  let removed = 0;
  for (const [key, count] of after) added += Math.max(0, count - (before.get(key) ?? 0));
  for (const [key, count] of before) removed += Math.max(0, count - (after.get(key) ?? 0));
  return { added, removed };
}

interface Step {
  text: string;
  anchor: number;
  head: number;
}

export interface DraftHooks {
  /** Isi, dirty, atau kursor berubah; toolbar dan indikator perlu digambar ulang. */
  onActivity(): void;
  /** Mod+S — yang tahu cara memanggil endpoint adalah pemilik tab. */
  onSave(): void;
}

export interface DraftInit {
  path: string;
  text: string;
  mtime: number;
  hooks: DraftHooks;
}

/**
 * Satu draft per file yang terbuka. host stabil dan boleh dipindah-pindah dalam DOM setiap
 * viewer digambar ulang; EditorView-nya tidak pernah dibuat ulang saat render.
 */
export class Draft {
  readonly host: HTMLDivElement;
  readonly path: string;

  private hooks: DraftHooks;
  private base: string;
  private separator: string;
  private mtimeMs: number;
  private stack: Step[];
  private index = 0;
  private lastPushAt = 0;
  private applying = false;
  private destroyed = false;
  private view: EditorViewT | null = null;
  private wrapBox: import('@codemirror/state').Compartment | null = null;
  private lookBox: import('@codemirror/state').Compartment | null = null;
  private language: Extension | null = null;
  private bundle: Bundle | null = null;
  private readyPromise: Promise<void>;

  constructor(init: DraftInit) {
    this.path = init.path;
    this.base = toLF(init.text);
    this.separator = separatorOf(init.text);
    this.mtimeMs = init.mtime;
    this.hooks = init.hooks;
    this.stack = [{ text: this.base, anchor: 0, head: 0 }];
    this.host = document.createElement('div');
    this.host.className = 'files__editor';
    this.readyPromise = this.mount(this.base);
  }

  get mtime(): number {
    return this.mtimeMs;
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  /** Teks persis seperti yang akan ditulis ke disk, termasuk pemisah barisnya. */
  text(): string {
    const lf = this.docText();
    return this.separator === '\n' ? lf : lf.replace(/\n/g, '\r\n');
  }

  /** Isi dokumen dalam ruang LF — bahasa yang dipakai seluruh riwayat dan perbandingan. */
  private docText(): string {
    if (!this.view) return this.base;
    return this.view.state.doc.toString();
  }

  dirty(): boolean {
    return this.docText() !== this.base;
  }

  delta(): { added: number; removed: number } {
    return lineDelta(this.base, this.docText());
  }

  caret(): { line: number; column: number; lines: number } {
    if (!this.view) return { line: 1, column: 1, lines: this.base.split('\n').length };
    const doc = this.view.state.doc;
    const head = this.view.state.selection.main.head;
    const at = doc.lineAt(head);
    return { line: at.number, column: head - at.from + 1, lines: doc.lines };
  }

  canUndo(): boolean {
    return this.index > 0;
  }

  canRedo(): boolean {
    return this.index < this.stack.length - 1;
  }

  undo(): void {
    this.jumpTo(this.index - 1);
  }

  redo(): void {
    this.jumpTo(this.index + 1);
  }

  /**
   * Setelah tulis berhasil: draf jadi dasar baru. Riwayat sengaja tidak ditambah langkah —
   * Undo sesudah Save tetap mengembalikan suntingannya, persis seperti editor pada umumnya.
   */
  markSaved(mtime: number): void {
    this.base = this.docText();
    this.mtimeMs = mtime;
    this.hooks.onActivity();
  }

  /** Draf dibuang, isi diganti bacaan disk terbaru — dipakai muat ulang dan konflik. */
  reset(text: string, mtime: number): void {
    this.base = toLF(text);
    this.separator = separatorOf(text);
    this.mtimeMs = mtime;
    this.stack = [{ text: this.base, anchor: 0, head: 0 }];
    this.index = 0;
    this.lastPushAt = 0;
    this.replaceDoc(this.base, 0);
    this.hooks.onActivity();
  }

  setWrap(on: boolean): void {
    const bundle = this.bundle;
    if (!this.view || !this.wrapBox || !bundle) return;
    this.view.dispatch({
      effects: this.wrapBox.reconfigure(on ? [bundle.view.EditorView.lineWrapping] : []),
    });
  }

  /** Nomor baris dan warna sintaks mengikuti preferensi pratinjau. */
  setLook(): void {
    if (!this.view || !this.lookBox) return;
    this.view.dispatch({ effects: this.lookBox.reconfigure(this.lookExtensions()) });
  }

  setFontSize(px: number): void {
    this.host.style.setProperty('--edit-size', `${px.toFixed(2)}px`);
    this.view?.requestMeasure();
  }

  openFind(): void {
    if (!this.view || !this.bundle) return;
    this.bundle.search.openSearchPanel(this.view);
    this.view.focus();
  }

  focus(): void {
    this.view?.focus();
  }

  /** Lompat ke baris — dipakai hasil pencarian dan tautan dari tab lain. */
  gotoLine(line: number): boolean {
    if (!this.view || !this.bundle) return false;
    const doc = this.view.state.doc;
    if (line < 1 || line > doc.lines) return false;
    const target = doc.line(line);
    this.view.dispatch({
      selection: { anchor: target.from },
      effects: this.bundle.view.EditorView.scrollIntoView(target.from, { y: 'center' }),
    });
    this.view.focus();
    return true;
  }

  destroy(): void {
    this.destroyed = true;
    this.view?.destroy();
    this.view = null;
    this.host.textContent = '';
  }

  private lookExtensions(): Extension[] {
    const bundle = this.bundle;
    if (!bundle) return [];
    const settings = prefs();
    const out: Extension[] = [
      bundle.state.EditorState.phrases.of(locale() === 'id' ? SEARCH_PHRASES_ID : {}),
    ];
    if (settings.lineNumbers) out.push(bundle.view.lineNumbers());
    if (settings.syntax && this.language) {
      out.push(
        bundle.language.syntaxHighlighting(tokenStyle(bundle), { fallback: true })
      );
    }
    return out;
  }

  private async mount(text: string): Promise<void> {
    const [bundle, language] = await Promise.all([loadBundle(), loadLanguage(this.path)]);
    if (this.destroyed) return;
    this.bundle = bundle;
    this.language = language;

    const { state, view, commands, language: lang, search, autocomplete } = bundle;
    this.wrapBox = new state.Compartment();
    this.lookBox = new state.Compartment();

    const extensions: Extension[] = [
      this.lookBox.of(this.lookExtensions()),
      this.wrapBox.of(prefs().wrap ? [view.EditorView.lineWrapping] : []),
      view.drawSelection(),
      view.highlightActiveLine(),
      view.highlightActiveLineGutter(),
      view.highlightSpecialChars(),
      lang.foldGutter(),
      lang.indentOnInput(),
      lang.bracketMatching(),
      autocomplete.closeBrackets(),
      search.highlightSelectionMatches(),
      view.EditorView.theme({
        '&': { height: '100%', 'font-size': 'var(--edit-size, 11.5px)' },
        '.cm-scroller': { overflow: 'auto', 'font-family': 'inherit' },
      }),
      view.keymap.of([
        { key: 'Mod-s', preventDefault: true, run: () => (this.hooks.onSave(), true) },
        { key: 'Mod-z', preventDefault: true, run: () => (this.undo(), true) },
        { key: 'Mod-y', preventDefault: true, run: () => (this.redo(), true) },
        { key: 'Mod-Shift-z', preventDefault: true, run: () => (this.redo(), true) },
      ]),
      view.keymap.of(search.searchKeymap),
      view.keymap.of(autocomplete.closeBracketsKeymap),
      view.keymap.of(commands.defaultKeymap),
      view.EditorView.updateListener.of((update) => this.onUpdate(update)),
    ];
    if (language) extensions.push(language);

    this.view = new view.EditorView({ state: state.EditorState.create({ doc: text, extensions }), parent: this.host });
    this.hooks.onActivity();
  }

  private onUpdate(update: EditorUpdate): void {
    if (this.applying) return;
    if (update.docChanged) this.record();
    else if (update.selectionSet) this.rememberSelection();
    this.hooks.onActivity();
  }

  /** Satu langkah = satu ledakan ketik; jeda > MERGE_MS atau Save membuka langkah baru. */
  private record(): void {
    if (!this.view) return;
    const selection = this.view.state.selection.main;
    const step: Step = { text: this.docText(), anchor: selection.anchor, head: selection.head };
    const now = Date.now();
    if (this.index === this.stack.length - 1 && now - this.lastPushAt < MERGE_MS) {
      this.stack[this.index] = step;
    } else {
      this.stack.length = this.index + 1;
      this.stack.push(step);
      this.index = this.stack.length - 1;
    }
    this.lastPushAt = now;
  }

  private rememberSelection(): void {
    const step = this.stack[this.index];
    if (!this.view || !step) return;
    const selection = this.view.state.selection.main;
    this.stack[this.index] = { ...step, anchor: selection.anchor, head: selection.head };
  }

  private jumpTo(index: number): void {
    const step = this.stack[index];
    if (!this.view || !step) return;
    this.index = index;
    this.lastPushAt = 0;
    this.replaceDoc(step.text, step.anchor, step.head);
    this.hooks.onActivity();
  }

  private replaceDoc(text: string, anchor: number, head?: number): void {
    if (!this.view) return;
    const length = this.view.state.doc.length;
    this.applying = true;
    try {
      this.view.dispatch({
        changes: { from: 0, to: length, insert: text },
        selection: { anchor: Math.min(anchor, text.length), head: Math.min(head ?? anchor, text.length) },
      });
    } finally {
      this.applying = false;
    }
  }
}
