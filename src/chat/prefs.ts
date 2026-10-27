/** Preferensi user yang dipakai Settings dan pratinjau file. Semua di localStorage. */
import { readStored, writeStored } from '../core/storage';

export type FileView = 'raw' | 'preview';
export type SplitMode = 'horizontal' | 'vertical';

export interface Prefs {
  wrap: boolean;
  lineNumbers: boolean;
  syntax: boolean;
  defaultView: FileView;
  scriptedPreview: boolean;
  /** 'horizontal' = daftar di atas pratinjau; 'vertical' = berdampingan saat jendela diperbesar. */
  previewSplit: SplitMode;
  /** Porsi pratinjau terhadap pane (0.2–0.8), diatur dengan menyeret pembatas. */
  previewRatio: number;
}

const STORAGE_PREFS = 'virtoOffice.previewPrefs';

const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;

export const DEFAULT_PREFS: Prefs = {
  wrap: true,
  lineNumbers: true,
  syntax: true,
  defaultView: 'raw',
  scriptedPreview: false,
  previewSplit: 'horizontal',
  previewRatio: 0.56,
};

/** Jaga porsi pratinjau tetap masuk akal, termasuk dari nilai localStorage yang rusak. */
export function clampRatio(value: unknown): number {
  const ratio =
    typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_PREFS.previewRatio;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

type Listener = (prefs: Prefs) => void;

const listeners = new Set<Listener>();

let current = read();

function read(): Prefs {
  const raw = readStored(STORAGE_PREFS);
  if (!raw) return { ...DEFAULT_PREFS };
  try {
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      wrap: typeof parsed.wrap === 'boolean' ? parsed.wrap : DEFAULT_PREFS.wrap,
      lineNumbers:
        typeof parsed.lineNumbers === 'boolean' ? parsed.lineNumbers : DEFAULT_PREFS.lineNumbers,
      syntax: typeof parsed.syntax === 'boolean' ? parsed.syntax : DEFAULT_PREFS.syntax,
      defaultView: parsed.defaultView === 'preview' ? 'preview' : 'raw',
      scriptedPreview:
        typeof parsed.scriptedPreview === 'boolean'
          ? parsed.scriptedPreview
          : DEFAULT_PREFS.scriptedPreview,
      previewSplit: parsed.previewSplit === 'vertical' ? 'vertical' : 'horizontal',
      previewRatio: clampRatio(parsed.previewRatio),
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function prefs(): Prefs {
  return current;
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  current = { ...current, [key]: value };
  writeStored(STORAGE_PREFS, JSON.stringify(current));
  for (const listener of Array.from(listeners)) listener(current);
}

export function resetPrefs(): Prefs {
  current = { ...DEFAULT_PREFS };
  writeStored(STORAGE_PREFS, JSON.stringify(current));
  for (const listener of Array.from(listeners)) listener(current);
  return current;
}

/** True kalau perubahan prefs hanya berasal dari geseran pembatas split. */
export function onlyRatioChanged(before: Prefs, after: Prefs): boolean {
  return (
    before.previewRatio !== after.previewRatio &&
    before.wrap === after.wrap &&
    before.lineNumbers === after.lineNumbers &&
    before.syntax === after.syntax &&
    before.defaultView === after.defaultView &&
    before.scriptedPreview === after.scriptedPreview &&
    before.previewSplit === after.previewSplit
  );
}

export function subscribePrefs(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
