import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from './http.mjs';

const MAX_TREE_ENTRIES = 3000;
const DEFAULT_FILE_BYTES = 262_144;
const MAX_FILE_BYTES = 2_000_000;
const BINARY_SNIFF_BYTES = 8000;
const SEARCH_DEFAULT_LIMIT = 80;
const SEARCH_MAX_LIMIT = 300;
const SEARCH_MAX_VISITED = 25_000;
const SEARCH_TIME_BUDGET_MS = 4000;
const SEARCH_CONTENT_MAX_BYTES = 1_000_000;
const CONTENT_SNIFF_BYTES = 4096;
const PREVIEW_MAX_CHARS = 160;

// Daftarnya sama dengan folder picker di workspace.mjs, tetapi tidak diekspor dari sana.
const SKIP_DIRS = new Set([
  '$Recycle.Bin',
  'Config.Msi',
  'Documents and Settings',
  'node_modules',
  'PerfLogs',
  'Recovery',
  'System Volume Information',
  '.git',
  '__pycache__',
  '.venv',
  'dist',
]);

const TEXT_EXTS = new Set([
  '.md', '.txt', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css',
  '.html', '.htm', '.yml', '.yaml', '.toml', '.ini', '.sh', '.ps1', '.bat', '.py',
  '.go', '.rs', '.java', '.c', '.h', '.cpp', '.cs', '.rb', '.php', '.sql', '.xml', '.svg',
]);
const TEXT_NAMES = new Set(['.gitignore', '.env.example']);

// '/' dan '\' sama-sama diperlakukan sebagai pemisah, jadi ':' tetap menandai drive letter.
const INVALID_NAME = /[<>:"/|?*\x00-\x1F]/;

/**
 * Semua path client dinormalisasi ke sini. Segmen '..' ditolak total dan hasil resolve
 * tetap dicek berada di dalam root, jadi symlink pun tidak bisa keluar workspace.
 */
export function resolveInside(root, input) {
  if (typeof input !== 'string') throw new HttpError(400, 'Path harus berupa teks.');
  const trimmed = input.trim().replace(/\\/g, '/');
  const parts = trimmed === '' || trimmed === '.' ? [] : trimmed.split('/');
  for (const part of parts) {
    if (!part || part === '.') throw new HttpError(400, 'Nama path tidak valid.');
    if (part === '..') throw new HttpError(400, 'Path keluar dari workspace.');
    if (INVALID_NAME.test(part)) throw new HttpError(400, 'Nama path tidak valid.');
  }

  const abs = path.resolve(root, ...parts);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(prefix)) throw new HttpError(400, 'Path keluar dari workspace.');
  return { rel: parts.join('/'), abs };
}

function joinRel(rel, name) {
  return rel ? `${rel}/${name}` : name;
}

async function exists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

function compareEntries(a, b) {
  if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

function clampNumber(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.round(parsed), max);
}

export async function treeAt(root, input) {
  const { rel, abs } = resolveInside(root, input);

  let dirents;
  try {
    dirents = await fs.readdir(abs, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') throw new HttpError(404, 'Folder tidak ditemukan.');
    throw new HttpError(403, `Tidak bisa membaca folder: ${error.message}`);
  }

  dirents.sort(compareEntries);
  const entries = [];
  for (const dirent of dirents.slice(0, MAX_TREE_ENTRIES)) {
    try {
      const stat = await fs.stat(path.join(abs, dirent.name));
      entries.push({
        name: dirent.name,
        path: joinRel(rel, dirent.name),
        dir: dirent.isDirectory(),
        size: stat.size,
        mtime: Math.round(stat.mtimeMs),
      });
    } catch {
      // Satu entri yang hilang atau terkunci tidak boleh menggagalkan seluruh level.
    }
  }

  return { root, path: rel, entries, truncated: dirents.length > MAX_TREE_ENTRIES };
}

export async function readFileAt(root, input, maxBytes) {
  const { rel, abs } = resolveInside(root, input);
  const limit = clampNumber(maxBytes, DEFAULT_FILE_BYTES, MAX_FILE_BYTES);

  let stat;
  try {
    stat = await fs.stat(abs);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new HttpError(404, 'File tidak ditemukan.');
    throw new HttpError(403, `Tidak bisa membaca file: ${error.message}`);
  }
  if (stat.isDirectory()) return { path: rel, text: '', size: stat.size, truncated: false, binary: true };

  const length = Math.min(stat.size, limit);
  const buffer = Buffer.alloc(length);
  let handle;
  try {
    handle = await fs.open(abs, 'r');
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return decodeWindow(rel, stat.size, buffer.subarray(0, bytesRead), length < stat.size);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new HttpError(404, 'File tidak ditemukan.');
    throw new HttpError(403, `Tidak bisa membaca file: ${error.message}`);
  } finally {
    await handle?.close();
  }
}

function decodeWindow(rel, size, window, truncated) {
  const base = { path: rel, size, truncated, binary: false, text: '' };
  // Byte 0 di 8 KB pertama menandai file biner; teks murni tidak pernah memuatnya.
  if (window.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return { ...base, binary: true };

  const decoder = new TextDecoder('utf-8', { fatal: true });
  // Jendela baca bisa memotong karakter multibyte di ekor, jadi ekor dicoba dipangkas.
  const maxTrim = truncated ? 4 : 0;
  for (let trim = 0; trim <= maxTrim; trim += 1) {
    try {
      return { ...base, text: decoder.decode(window.subarray(0, Math.max(0, window.length - trim))) };
    } catch {
      // decode gagal lagi, coba pangkas satu byte lagi atau nyatakan biner.
    }
  }
  return { ...base, binary: true };
}

export async function createEntry(root, input, kind, text) {
  if (kind !== 'file' && kind !== 'folder') throw new HttpError(400, "kind harus 'file' atau 'folder'.");
  const { rel, abs } = resolveInside(root, input);
  if (!rel) throw new HttpError(400, 'Nama path tidak boleh kosong.');

  await fs.mkdir(path.dirname(abs), { recursive: true });
  if (kind === 'folder') {
    if (await exists(abs)) throw new HttpError(409, 'Sudah ada.');
    await fs.mkdir(abs);
    return { path: rel };
  }

  try {
    await fs.writeFile(abs, typeof text === 'string' ? text : '', { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (error?.code === 'EEXIST') throw new HttpError(409, 'Sudah ada.');
    throw error;
  }
  return { path: rel };
}

export async function renameEntry(root, fromInput, toInput) {
  const from = resolveInside(root, fromInput);
  const to = resolveInside(root, toInput);
  if (!from.rel) throw new HttpError(400, 'Path asal harus diisi.');
  if (from.abs === to.abs) throw new HttpError(400, 'Path asal dan tujuan sama.');

  const origin = await fs.stat(from.abs).catch(() => null);
  if (!origin) throw new HttpError(404, 'Path asal tidak ditemukan.');
  // Folder yang dipindah ke dalam dirinya sendiri akan menghilangkan seluruh cabangnya.
  if (origin.isDirectory() && to.abs.startsWith(from.abs + path.sep)) {
    throw new HttpError(400, 'Tidak bisa memindahkan folder ke dalam dirinya sendiri.');
  }
  if (await exists(to.abs)) throw new HttpError(409, 'Sudah ada.');

  await fs.mkdir(path.dirname(to.abs), { recursive: true });
  await fs.rename(from.abs, to.abs);
  return { from: from.rel, to: to.rel };
}

export async function deleteEntry(root, input) {
  const { rel, abs } = resolveInside(root, input);
  if (!rel) throw new HttpError(400, 'Workspace root tidak bisa dihapus.');

  let stat;
  try {
    stat = await fs.lstat(abs);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new HttpError(404, 'Path tidak ditemukan.');
    throw new HttpError(403, `Tidak bisa menghapus: ${error.message}`);
  }

  // force sengaja mati supaya path yang baru saja hilang terlihat sebagai error, bukan noop.
  await fs.rm(abs, stat.isDirectory() ? { recursive: true, force: false } : {});
  return { path: rel };
}

function isTextFile(name) {
  const lower = name.toLowerCase();
  return TEXT_NAMES.has(lower) || TEXT_EXTS.has(path.extname(lower));
}

async function firstMatchLine(abs, needle) {
  let buffer;
  try {
    const stat = await fs.stat(abs);
    if (stat.size > SEARCH_CONTENT_MAX_BYTES) return null;
    buffer = await fs.readFile(abs);
  } catch {
    return null;
  }
  if (buffer.subarray(0, CONTENT_SNIFF_BYTES).includes(0)) return null;

  const lines = buffer.toString('utf8').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].toLowerCase().includes(needle)) {
      return { line: index + 1, preview: lines[index].trim().slice(0, PREVIEW_MAX_CHARS) };
    }
  }
  return null;
}

export async function searchIn(root, query, mode, limit) {
  const term = typeof query === 'string' ? query.trim() : '';
  if (!term) throw new HttpError(400, 'Kata kunci pencarian kosong.');
  if (mode !== 'name' && mode !== 'content') throw new HttpError(400, "mode harus 'name' atau 'content'.");

  const max = clampNumber(limit, SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT);
  const needle = term.toLowerCase();
  const started = Date.now();
  const matches = [];
  const stack = [{ dir: root, rel: '' }];
  let scanned = 0;
  let stopped = 'done';

  walk: while (stack.length) {
    const { dir, rel } = stack.pop();
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const dirent of dirents) {
      scanned += 1;
      if (scanned > SEARCH_MAX_VISITED || Date.now() - started > SEARCH_TIME_BUDGET_MS) {
        stopped = 'limit';
        break walk;
      }

      const childPath = joinRel(rel, dirent.name);
      const isDir = dirent.isDirectory();
      if (isDir) {
        if (SKIP_DIRS.has(dirent.name)) continue;
        stack.push({ dir: path.join(dir, dirent.name), rel: childPath });
      }

      if (mode === 'name') {
        if (dirent.name.toLowerCase().includes(needle)) matches.push({ path: childPath, dir: isDir });
      } else if (!isDir && isTextFile(dirent.name)) {
        const hit = await firstMatchLine(path.join(dir, dirent.name), needle);
        if (hit) matches.push({ path: childPath, ...hit });
      }

      if (matches.length >= max) {
        stopped = 'limit';
        break walk;
      }
    }
  }

  matches.sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }));
  return { mode, query: term, matches, scanned, stopped };
}
