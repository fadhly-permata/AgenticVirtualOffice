import { readStored, writeStored } from '../core/storage';
import type { Catalog, Locale, Params, Pair } from './types';
import { about } from './ns/about';
import { chat } from './ns/chat';
import { errors } from './ns/errors';
import { files } from './ns/files';
import { folder } from './ns/folder';
import { md } from './ns/md';
import { menu } from './ns/menu';
import { office } from './ns/office';
import { scm } from './ns/scm';
import { select } from './ns/select';
import { settings } from './ns/settings';
import { shell } from './ns/shell';
import { term } from './ns/term';
import { theme } from './ns/theme';
import { tool } from './ns/tool';
import { viewer } from './ns/viewer';

const STORAGE_LOCALE = 'virtoOffice.locale';

export const LOCALES: Locale[] = ['id', 'en'];

const NAMESPACES: Record<string, Catalog> = {
  about,
  chat,
  errors,
  files,
  folder,
  md,
  menu,
  office,
  scm,
  select,
  settings,
  shell,
  term,
  theme,
  tool,
  viewer,
};

const ENTRIES = new Map<string, Pair>();
for (const [namespace, catalog] of Object.entries(NAMESPACES)) {
  for (const [key, pair] of Object.entries(catalog)) ENTRIES.set(`${namespace}.${key}`, pair);
}

type Listener = (locale: Locale) => void;

const listeners = new Set<Listener>();

function stored(): Locale {
  const raw = readStored(STORAGE_LOCALE);
  return raw === 'id' || raw === 'en' ? raw : 'id';
}

/** Bahasa browser baru dipakai selama user belum pernah memilih di halaman Settings. */
export function followBrowserLocale(): void {
  if (readStored(STORAGE_LOCALE)) return;
  const browser = globalThis.navigator?.language?.slice(0, 2).toLowerCase();
  if (browser === 'en') setLocale('en');
}

let current: Locale = stored();

function interpolate(text: string, params: Params): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  );
}

export function locale(): Locale {
  return current;
}

export function t(key: string, params?: Params): string {
  const pair = ENTRIES.get(key);
  const text = pair ? pair[current === 'en' ? 1 : 0] : key;
  return params ? interpolate(text, params) : text;
}

/** Label yang tidak ikut berubah saat bahasa diganti (nama bahasa, nama tema). */
export function nameIn(names: Record<Locale, string>): string {
  return names[current] ?? names.id;
}

export function subscribeLocale(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const ATTR_TEXT = 'data-i18n';
const ATTR_TITLE = 'data-i18n-title';
const ATTR_PLACEHOLDER = 'data-i18n-placeholder';
const ATTR_ARIA = 'data-i18n-aria';

/** Terjemahan untuk markup statis di index.html; dipanggil ulang setiap ganti bahasa. */
export function applyStatic(scope: ParentNode = document): void {
  document.documentElement.lang = current;
  for (const node of Array.from(scope.querySelectorAll<HTMLElement>(`[${ATTR_TEXT}]`))) {
    node.textContent = t(node.getAttribute(ATTR_TEXT) ?? '');
  }
  for (const node of Array.from(scope.querySelectorAll<HTMLElement>(`[${ATTR_TITLE}]`))) {
    const value = t(node.getAttribute(ATTR_TITLE) ?? '');
    node.title = value;
    if (node.matches('button,a')) node.setAttribute('aria-label', value);
  }
  for (const node of Array.from(scope.querySelectorAll<HTMLElement>(`[${ATTR_PLACEHOLDER}]`))) {
    node.setAttribute('placeholder', t(node.getAttribute(ATTR_PLACEHOLDER) ?? ''));
  }
  for (const node of Array.from(scope.querySelectorAll<HTMLElement>(`[${ATTR_ARIA}]`))) {
    node.setAttribute('aria-label', t(node.getAttribute(ATTR_ARIA) ?? ''));
  }
}

export function setLocale(next: Locale): void {
  if (!LOCALES.includes(next)) return;
  const changed = next !== current;
  current = next;
  writeStored(STORAGE_LOCALE, next);
  document.documentElement.lang = next;
  applyStatic();
  if (changed) for (const listener of Array.from(listeners)) listener(next);
}

export function localeNames(): Record<Locale, string> {
  return { id: 'Bahasa Indonesia', en: 'English' };
}
