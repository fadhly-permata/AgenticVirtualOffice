import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HttpError } from './http.mjs';

const SKIP_DIRS = new Set([
  '$Recycle.Bin',
  'Config.Msi',
  'Documents and Settings',
  'node_modules',
  'PerfLogs',
  'Recovery',
  'System Volume Information',
]);

export function workspaceName(target) {
  const trimmed = target.replace(/[\\/]+$/, '');
  return path.basename(trimmed) || trimmed;
}

export async function isDirectory(target) {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

function expandHome(input) {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

export async function validateWorkspace(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new HttpError(400, 'Path folder kosong.');
  }
  const target = path.resolve(expandHome(input.trim()));
  if (!(await isDirectory(target))) {
    throw new HttpError(404, `Folder tidak ditemukan: ${target}`);
  }
  return target;
}

async function listRoots() {
  if (process.platform !== 'win32') {
    return [{ name: '/', path: '/', kind: 'drive' }];
  }

  const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZAB'.split('');
  const found = await Promise.all(
    letters.map(async (letter) => {
      const target = `${letter}:\\`;
      return (await isDirectory(target)) ? { name: `${letter}:`, path: target, kind: 'drive' } : null;
    })
  );
  return found.filter((entry) => entry !== null);
}

export async function browseDirectory(input) {
  if (!input) {
    return { path: null, parent: null, entries: await listRoots(), root: true };
  }

  const target = await validateWorkspace(input);
  let dirents;
  try {
    dirents = await fs.readdir(target, { withFileTypes: true });
  } catch (error) {
    throw new HttpError(403, `Tidak bisa membaca folder: ${error.message}`);
  }

  const entries = [];
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    if (dirent.name.startsWith('.')) continue;
    if (SKIP_DIRS.has(dirent.name)) continue;
    entries.push({ name: dirent.name, path: path.join(target, dirent.name), kind: 'directory' });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const parent = path.dirname(target);
  return {
    path: target,
    parent: parent === target ? null : parent,
    entries,
    root: false,
  };
}

export class WorkspaceStore {
  #file;
  #state = { workspace: null, recents: [] };
  #saving = Promise.resolve();

  constructor(appDir) {
    this.#file = path.join(appDir, '.virtoffice', 'workspace.json');
  }

  async load() {
    try {
      const raw = JSON.parse(await fs.readFile(this.#file, 'utf8'));
      const recents = Array.isArray(raw.recents) ? raw.recents : [];
      const checked = await Promise.all(
        recents
          .filter((entry) => entry && typeof entry.path === 'string')
          .slice(0, 8)
          .map(async (entry) => {
            const target = path.resolve(entry.path);
            return (await isDirectory(target)) ? { path: target, openedAt: entry.openedAt ?? 0 } : null;
          })
      );
      this.#state.recents = checked.filter((entry) => entry !== null);
      if (raw.workspace && typeof raw.workspace.path === 'string') {
        const target = path.resolve(raw.workspace.path);
        this.#state.workspace = (await isDirectory(target)) ? target : null;
      }
    } catch {
      this.#state = { workspace: null, recents: [] };
    }
    return this.snapshot();
  }

  async open(input) {
    const target = await validateWorkspace(input);
    this.#state.workspace = target;

    const now = Date.now();
    const recents = this.#state.recents.filter((entry) => entry.path !== target);
    recents.unshift({ path: target, openedAt: now });
    this.#state.recents = recents.slice(0, 8);

    this.#saving = this.#saving.then(() => this.#write()).catch(() => undefined);
    await this.#saving;
    return this.snapshot();
  }

  async #write() {
    const payload = {
      workspace: this.#state.workspace ? { path: this.#state.workspace } : null,
      recents: this.#state.recents,
    };
    await fs.mkdir(path.dirname(this.#file), { recursive: true });
    await fs.writeFile(this.#file, JSON.stringify(payload, null, 2), 'utf8');
  }

  snapshot() {
    const describe = (target) => ({ path: target, name: workspaceName(target) });
    return {
      workspace: this.#state.workspace ? describe(this.#state.workspace) : null,
      recents: this.#state.recents.map((entry) => ({
        ...describe(entry.path),
        openedAt: entry.openedAt,
      })),
    };
  }
}
