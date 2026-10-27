/** Preferensi user yang dipakai Settings dan pratinjau file. Semua di localStorage. */
import { readStored, writeStored } from '../core/storage';

export type FileView = 'raw' | 'preview';

export interface Prefs {
  wrap: boolean;
  lineNumbers: boolean;
  syntax: boolean;
  defaultView: FileView;
  scriptedPreview: boolean;
}

const STORAGE_PREFS = 'virtoOffice.previewPrefs';

export const DEFAULT_PREFS: Prefs = {
  wrap: true,
  lineNumbers: true,
  syntax: true,
  defaultView: 'raw',
  scriptedPreview: false,
};

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

export function subscribePrefs(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
