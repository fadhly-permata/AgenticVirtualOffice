import { readStored, writeStored } from '../core/storage';
import { THEME_IDS, THEMES, themeById } from './themes';
import type { ThemeDef } from './themes';

const STORAGE_THEME = 'virtoOffice.theme';
const STYLE_ID = 'virto-theme';

export { THEMES, THEME_IDS, themeById };
export { rgba as withAlpha };
export type { ThemeDef };

function parseHex(value: string): [number, number, number] {
  const raw = value.replace('#', '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  const num = Number.parseInt(full.slice(0, 6), 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgba(value: string, alpha: number): string {
  const [r, g, b] = parseHex(value);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function mix(from: string, to: string, weight: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  const parts = a.map((channel, index) => Math.round(channel + (b[index] - channel) * weight));
  return `#${parts.map((part) => part.toString(16).padStart(2, '0')).join('')}`;
}

function luminance(value: string): number {
  const [r, g, b] = parseHex(value).map((channel) => channel / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Text colour that stays readable when painted on top of `backdrop`. */
function onTop(backdrop: string): string {
  return luminance(backdrop) > 0.55 ? '#10151b' : '#04070a';
}

function vars(def: ThemeDef): string {
  const ink = def.ink;
  return [
    `color-scheme: ${def.light ? 'light' : 'dark'};`,
    `--sky-top: ${mix(def.bg, ink, def.light ? 0.06 : 0.14)};`,
    `--sky-bottom: ${mix(def.bg, def.accent, def.light ? 0.08 : 0.1)};`,
    `--sky-glow: ${mix(def.bg, def.accent, 0.28)};`,
    `--ink: ${ink};`,
    `--ink-dim: ${rgba(ink, 0.7)};`,
    `--ink-faint: ${rgba(ink, 0.44)};`,
    `--panel: ${rgba(def.panel, def.light ? 0.86 : 0.58)};`,
    `--panel-border: ${rgba(def.line, 0.9)};`,
    `--accent: ${def.accent};`,
    `--accent-soft: ${rgba(def.accent, 0.16)};`,
    `--accent-ink: ${onTop(def.accent)};`,
    `--ok: ${def.add};`,
    `--warn: ${def.number};`,
    `--err: ${def.del};`,
    `--surface: ${rgba(def.panel, def.light ? 0.97 : 0.94)};`,
    `--surface-2: ${mix(def.panel, def.bg, def.light ? -0.25 : 0.2)};`,
    `--surface-3: ${mix(def.panel, ink, 0.08)};`,
    `--sunken: ${def.sunken};`,
    `--border: ${rgba(def.line, 0.85)};`,
    `--border-strong: ${def.line};`,
    `--code-bg: ${def.sunken};`,
    `--code-ink: ${mix(ink, def.bg, 0.1)};`,
    `--gutter: ${rgba(ink, 0.3)};`,
    `--sel: ${rgba(def.accent, 0.22)};`,
    `--shadow: rgba(0, 0, 0, ${def.light ? 0.14 : 0.38});`,
    `--info: ${def.fn};`,
    `--violet: ${def.lit};`,
    `--scroll: ${rgba(ink, 0.2)};`,
    `--glass: ${rgba(ink, 0.06)};`,
    `--glass-strong: ${rgba(ink, 0.12)};`,
    `--scrim: ${rgba(def.bg, def.light ? 0.5 : 0.72)};`,
    `--theme-line: ${def.line};`,
    `--hl-fg: ${mix(ink, def.bg, 0.1)};`,
    `--hl-comment: ${def.comment};`,
    `--hl-keyword: ${def.keyword};`,
    `--hl-string: ${def.string};`,
    `--hl-number: ${def.number};`,
    `--hl-fn: ${def.fn};`,
    `--hl-type: ${def.type};`,
    `--hl-attr: ${def.attr};`,
    `--hl-tag: ${def.tag};`,
    `--hl-var: ${def.varc};`,
    `--hl-literal: ${def.lit};`,
    `--hl-meta: ${def.meta};`,
    `--hl-add: ${def.add};`,
    `--hl-del: ${def.del};`,
  ].join('\n    ');
}

export function themeCss(): string {
  return THEMES.map((def) => `:root[data-theme="${def.id}"] {\n    ${vars(def)}\n  }`).join('\n\n');
}

type Listener = (id: string) => void;
const listeners = new Set<Listener>();

let current = read();

function read(): string {
  const stored = readStored(STORAGE_THEME);
  return stored && THEME_IDS.includes(stored) ? stored : 'virtoffice';
}

function install(): void {
  if (document.getElementById(STYLE_ID)) return;
  const node = document.createElement('style');
  node.id = STYLE_ID;
  node.textContent = themeCss();
  document.head.append(node);
}

export function theme(): string {
  return current;
}

export function subscribeTheme(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setTheme(next: string): void {
  const def = themeById(next);
  if (!def) return;
  const changed = def.id !== current;
  current = def.id;
  writeStored(STORAGE_THEME, def.id);
  install();
  document.documentElement.dataset.theme = def.id;
  if (changed) for (const listener of Array.from(listeners)) listener(def.id);
}

/** Warna yang mewakili palet satu tema, dipakai sebagai strip pratinjau di Pengaturan. */
export function swatch(def: ThemeDef): string[] {
  return [
    def.bg,
    def.panel,
    def.sunken,
    def.line,
    def.accent,
    def.keyword,
    def.string,
    def.number,
    def.fn,
    def.type,
    def.add,
    def.del,
    def.ink,
  ];
}

/** Dipanggil sekali saat boot supaya tema aktif langsung benar sebelum render pertama. */
export function initTheme(): void {
  install();
  document.documentElement.dataset.theme = current;
}
