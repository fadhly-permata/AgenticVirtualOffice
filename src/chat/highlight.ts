import DOMPurify from 'dompurify';
import type { LanguageFn } from 'highlight.js';

type Hljs = typeof import('highlight.js/lib/core').default;
type LangLoader = () => Promise<{ default: LanguageFn }>;

const LANGUAGES: Record<string, LangLoader> = {
  javascript: () => import('highlight.js/lib/languages/javascript'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  json: () => import('highlight.js/lib/languages/json'),
  xml: () => import('highlight.js/lib/languages/xml'),
  css: () => import('highlight.js/lib/languages/css'),
  python: () => import('highlight.js/lib/languages/python'),
  bash: () => import('highlight.js/lib/languages/bash'),
  shell: () => import('highlight.js/lib/languages/shell'),
  powershell: () => import('highlight.js/lib/languages/powershell'),
  go: () => import('highlight.js/lib/languages/go'),
  rust: () => import('highlight.js/lib/languages/rust'),
  c: () => import('highlight.js/lib/languages/c'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  java: () => import('highlight.js/lib/languages/java'),
  csharp: () => import('highlight.js/lib/languages/csharp'),
  php: () => import('highlight.js/lib/languages/php'),
  ruby: () => import('highlight.js/lib/languages/ruby'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
  ini: () => import('highlight.js/lib/languages/ini'),
  dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  diff: () => import('highlight.js/lib/languages/diff'),
  sql: () => import('highlight.js/lib/languages/sql'),
  makefile: () => import('highlight.js/lib/languages/makefile'),
};

/** Ekstensi → bahasa highlight.js. Nama file khusus ditangani lebih dulu. */
const EXTENSIONS: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  html: 'xml',
  htm: 'xml',
  xhtml: 'xml',
  vue: 'xml',
  svelte: 'xml',
  xml: 'xml',
  svg: 'xml',
  css: 'css',
  scss: 'css',
  less: 'css',
  py: 'python',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  psm1: 'powershell',
  go: 'go',
  rs: 'rust',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  java: 'java',
  kt: 'java',
  cs: 'csharp',
  php: 'php',
  rb: 'ruby',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  cfg: 'ini',
  properties: 'ini',
  md: 'markdown',
  markdown: 'markdown',
  diff: 'diff',
  patch: 'diff',
  sql: 'sql',
  mk: 'makefile',
};

const SPECIAL: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  '.gitignore': 'ini',
  '.env': 'ini',
  '.editorconfig': 'ini',
};

/** Fence markdown memakai singkatan; dipetakan ke kunci LANGUAGES yang muat modulnya. */
const ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  cjs: 'javascript',
  mjs: 'javascript',
  node: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  py: 'python',
  python3: 'python',
  sh: 'bash',
  zsh: 'shell',
  console: 'shell',
  'shell-session': 'shell',
  ps: 'powershell',
  ps1: 'powershell',
  pwsh: 'powershell',
  html: 'xml',
  htm: 'xml',
  vue: 'xml',
  svelte: 'xml',
  svg: 'xml',
  yml: 'yaml',
  toml: 'ini',
  cfg: 'ini',
  env: 'ini',
  properties: 'ini',
  cs: 'csharp',
  'c++': 'cpp',
  cplusplus: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  golang: 'go',
  rs: 'rust',
  rb: 'ruby',
  kt: 'java',
  kotlin: 'java',
  docker: 'dockerfile',
  make: 'makefile',
  mk: 'makefile',
  md: 'markdown',
  patch: 'diff',
  jsonc: 'json',
  json5: 'json',
};

let api: Promise<Hljs | null> | null = null;
const registered = new Set<string>();

async function engine(): Promise<Hljs | null> {
  if (!api) {
    api = import('highlight.js/lib/core')
      .then((module) => module.default)
      .catch(() => null);
  }
  return api;
}

/** Bahasa dimuat satu per satu saat pertama dipakai supaya boot tidak ikut membengkak. */
async function useLanguage(hljs: Hljs, language: string): Promise<boolean> {
  if (registered.has(language)) return true;
  const load = LANGUAGES[language];
  if (!load) return false;
  try {
    const module = await load();
    hljs.registerLanguage(language, module.default);
    registered.add(language);
    return true;
  } catch {
    return false;
  }
}

export function languageForPath(path: string): string {
  const base = path.split('/').pop()?.toLowerCase() ?? '';
  if (SPECIAL[base]) return SPECIAL[base];
  const dot = base.lastIndexOf('.');
  if (dot < 0) return '';
  return EXTENSIONS[base.slice(dot + 1)] ?? '';
}

export function normalizeLanguage(name: string): string {
  const lower = name.trim().toLowerCase();
  return ALIASES[lower] ?? lower;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const SAFE_CLASS = /^[A-Za-z0-9_\s-]+$/;

const LINE_RULES = {
  ALLOWED_TAGS: ['span'],
  ALLOWED_ATTR: ['class'],
  ALLOW_DATA_ATTR: false,
};

/**
 * Keluaran highlight.js dipecah per baris sambil membawa kelas tokennya, supaya
 * pratinjau bisa memberi nomor baris dan wrap kata tanpa merusak token multi-baris.
 */
function toLines(html: string): string[] {
  const holder = document.createElement('div');
  holder.innerHTML = DOMPurify.sanitize(html, LINE_RULES);
  const lines: string[] = [''];
  const stack: string[] = [];

  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const parts = (node.nodeValue ?? '').split('\n');
      parts.forEach((part, index) => {
        if (index > 0) lines.push('');
        if (!part) return;
        const className = stack[stack.length - 1];
        const text = escapeHtml(part);
        lines[lines.length - 1] += className ? `<span class="${className}">${text}</span>` : text;
      });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    const className = (element.getAttribute('class') ?? '').trim();
    const push = className && SAFE_CLASS.test(className);
    if (push) stack.push(className);
    for (const child of Array.from(element.childNodes)) walk(child);
    if (push) stack.pop();
  };

  for (const child of Array.from(holder.childNodes)) walk(child);
  return lines;
}

/** Buang entri tertua supaya cache tidak tumbuh mengikuti jumlah file yang dibuka. */
function remember<V>(cache: Map<string, V>, limit: number, key: string, value: V): void {
  cache.set(key, value);
  if (cache.size > limit) cache.delete(cache.keys().next().value as string);
}

function plainLines(text: string): string[] {
  return text.split('\n').map((line) => escapeHtml(line));
}

const HIGHLIGHT_LIMIT = 120_000;
const cache = new Map<string, string[]>();
const CACHE_LIMIT = 12;

/** Baris HTML yang siap disisipkan ke pratinjau; jatuh ke teks polos kalau gagal. */
export async function highlightLines(text: string, rawLanguage: string): Promise<string[]> {
  const language = normalizeLanguage(rawLanguage);
  const cacheKey = `${language}\u0000${text}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  let lines: string[] = plainLines(text);
  const hljs = language ? await engine() : null;
  if (hljs && text.length <= HIGHLIGHT_LIMIT) {
    try {
      if (await useLanguage(hljs, language)) {
        const result = hljs.highlight(text, { language, ignoreIllegals: true });
        lines = toLines(result.value);
      }
    } catch {
      lines = plainLines(text);
    }
  }

  remember(cache, CACHE_LIMIT, cacheKey, lines);
  return lines;
}

const BLOCK_CACHE_LIMIT = 40;
const blockCache = new Map<string, string | null>();

/** Untuk blok kode di chat, yang cuma butuh satu fragmen HTML utuh. */
export async function highlightBlock(text: string, rawLanguage: string): Promise<string | null> {
  const language = normalizeLanguage(rawLanguage);
  const cacheKey = `${language}\u0000${text}`;
  const cached = blockCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const hljs = language ? await engine() : null;
  let html: string | null = null;
  if (hljs && text.length <= HIGHLIGHT_LIMIT) {
    try {
      if (await useLanguage(hljs, language)) {
        const result = hljs.highlight(text, { language, ignoreIllegals: true });
        html = DOMPurify.sanitize(result.value, LINE_RULES);
      }
    } catch {
      html = null;
    }
  }

  remember(blockCache, BLOCK_CACHE_LIMIT, cacheKey, html);
  return html;
}
