import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpError } from '../server/http.mjs';
import {
  copyEntry,
  createEntry,
  deleteEntry,
  readFileAt,
  renameEntry,
  resolveInside,
  saveFileAt,
  searchIn,
  treeAt,
  writeUpload,
} from '../server/files.mjs';

const temps = [];

async function workspace() {
  // Windows memakai path short-name saat mkdtemp; resolve() membuat perbandingan stabil.
  const root = path.resolve(await fs.mkdtemp(path.join(os.tmpdir(), 'virto-files-')));
  temps.push(root);
  return root;
}

async function write(root, rel, content) {
  const abs = path.join(root, ...rel.split('/'));
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
}

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const status = (error) => (error instanceof HttpError ? error.status : `unexpected: ${error?.message}`);
const rejected = (promise) => promise.then(() => 'resolved').catch(status);

const streamOf = (parts) =>
  (async function* source() {
    for (const part of parts) yield Buffer.from(part, 'utf8');
  })();

const brokenStream = (parts) =>
  (async function* source() {
    for (const part of parts) yield Buffer.from(part, 'utf8');
    throw new Error('putus');
  })();

describe('path guard', () => {
  it('accepts relative paths in both separators', () => {
    const root = path.resolve(os.tmpdir());
    expect(resolveInside(root, 'src/app.ts').rel).toBe('src/app.ts');
    expect(resolveInside(root, 'src\\app.ts').rel).toBe('src/app.ts');
    expect(resolveInside(root, '').rel).toBe('');
  });

  it.each(['../outside', 'src/../../escape', '/etc/passwd', 'C:\\Windows\\system32', 'a//b', 'a/./b'])(
    'refuses %s',
    async (input) => {
      const root = await workspace();
      expect(await rejected(treeAt(root, input))).toBe(400);
    }
  );
});

describe('tree', () => {
  it('lists folders before files, alphabetically, with slash paths', async () => {
    const root = await workspace();
    await write(root, 'zeta.ts', 'export const a = 1;');
    await write(root, 'beta/index.ts', 'export default 0;');
    await write(root, 'Alpha/note.md', '# hi');

    const tree = await treeAt(root, '');
    expect(tree).toMatchObject({ root, path: '', truncated: false });
    expect(tree.entries.map((entry) => entry.path)).toEqual(['Alpha', 'beta', 'zeta.ts']);
    expect(tree.entries[0]).toMatchObject({ name: 'Alpha', dir: true });
    expect(tree.entries[2]).toMatchObject({ dir: false, size: 19 });
  });

  it('reads nested folders and reports missing ones as 404', async () => {
    const root = await workspace();
    await write(root, 'src/deep/file.txt', 'a');
    expect((await treeAt(root, 'src/deep')).entries[0].path).toBe('src/deep/file.txt');
    expect(await rejected(treeAt(root, 'nope'))).toBe(404);
  });
});

describe('file read', () => {
  it('returns text and flags truncation', async () => {
    const root = await workspace();
    await write(root, 'big.txt', 'x'.repeat(500));
    const partial = await readFileAt(root, 'big.txt', 120);
    expect(partial.text).toHaveLength(120);
    expect(partial).toMatchObject({ path: 'big.txt', size: 500, truncated: true, binary: false });
  });

  it('flags binary files and folders without decoding them', async () => {
    const root = await workspace();
    await fs.writeFile(path.join(root, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0x00]));
    expect(await readFileAt(root, 'blob.bin')).toMatchObject({ binary: true, text: '' });
    await write(root, 'src/a.ts', 'a');
    expect(await readFileAt(root, 'src')).toMatchObject({ binary: true, text: '' });
  });

  it('reports missing files as 404', async () => {
    const root = await workspace();
    expect(await rejected(readFileAt(root, 'gone.txt'))).toBe(404);
  });

  it('trims a multibyte character cut by the read window', async () => {
    const root = await workspace();
    // 'aaaé' = 5 byte; jendela 4 byte memotong karakter é di ekor.
    await write(root, 'uni.txt', 'aaaé');
    expect(await readFileAt(root, 'uni.txt', 4)).toMatchObject({
      binary: false,
      text: 'aaa',
      truncated: true,
      size: 5,
    });
  });
});

describe('create, rename, delete', () => {
  it('creates files and folders and rejects duplicates', async () => {
    const root = await workspace();
    expect(await createEntry(root, 'notes/todo.md', 'file', '- [ ] a')).toEqual({ path: 'notes/todo.md' });
    expect(await fs.readFile(path.join(root, 'notes', 'todo.md'), 'utf8')).toBe('- [ ] a');
    await createEntry(root, 'docs', 'folder');
    expect((await treeAt(root, '')).entries.map((entry) => entry.name)).toEqual(['docs', 'notes']);
    expect(await rejected(createEntry(root, 'docs', 'folder'))).toBe(409);
    expect(await rejected(createEntry(root, '', 'file'))).toBe(400);
    expect(await rejected(createEntry(root, 'x.ts', 'symlink'))).toBe(400);
  });

  it('renames across folders and refuses collisions', async () => {
    const root = await workspace();
    await write(root, 'a.txt', '1');
    await write(root, 'b.txt', '2');
    expect(await renameEntry(root, 'a.txt', 'nested/c.txt')).toEqual({ from: 'a.txt', to: 'nested/c.txt' });
    expect(await rejected(renameEntry(root, 'b.txt', 'nested/c.txt'))).toBe(409);
    expect(await rejected(renameEntry(root, 'b.txt', 'b.txt'))).toBe(400);
    expect(await rejected(renameEntry(root, 'missing.txt', 'x'))).toBe(404);
  });

  it('refuses moving a folder into itself', async () => {
    const root = await workspace();
    await write(root, 'src/a.ts', '1');
    expect(await rejected(renameEntry(root, 'src', 'src/inner'))).toBe(400);
  });

  it('deletes folders recursively but never the workspace root', async () => {
    const root = await workspace();
    await write(root, 'src/deep/b.ts', '2');
    expect(await deleteEntry(root, 'src')).toEqual({ path: 'src' });
    expect(await fs.stat(path.join(root, 'src')).catch(() => null)).toBeNull();
    expect(await rejected(deleteEntry(root, 'src'))).toBe(404);
    expect(await rejected(deleteEntry(root, ''))).toBe(400);
  });
});

describe('copy', () => {
  it('copies a file without touching the original', async () => {
    const root = await workspace();
    await write(root, 'a.txt', 'one');
    expect(await copyEntry(root, 'a.txt', 'nested/b.txt')).toEqual({ from: 'a.txt', to: 'nested/b.txt' });
    expect(await fs.readFile(path.join(root, 'nested', 'b.txt'), 'utf8')).toBe('one');
    expect(await fs.readFile(path.join(root, 'a.txt'), 'utf8')).toBe('one');
  });

  it('copies a folder with its tree', async () => {
    const root = await workspace();
    await write(root, 'src/deep/a.ts', '1');
    await write(root, 'src/b.ts', '2');
    expect(await copyEntry(root, 'src', 'backup/src')).toEqual({ from: 'src', to: 'backup/src' });
    expect((await treeAt(root, 'backup/src/deep')).entries[0].path).toBe('backup/src/deep/a.ts');
    expect(await fs.readFile(path.join(root, 'src', 'deep', 'a.ts'), 'utf8')).toBe('1');
  });

  it('refuses duplicates unless unique naming is asked for', async () => {
    const root = await workspace();
    await write(root, 'a.ts', '1');
    expect(await rejected(copyEntry(root, 'a.ts', 'a.ts'))).toBe(409);
    expect(await copyEntry(root, 'a.ts', 'a.ts', true)).toEqual({ from: 'a.ts', to: 'a (2).ts' });
    expect(await copyEntry(root, 'a.ts', 'a.ts', true)).toEqual({ from: 'a.ts', to: 'a (3).ts' });
    await write(root, 'docs/note.md', 'x');
    expect(await copyEntry(root, 'docs/note.md', 'docs/note.md', true)).toEqual({
      from: 'docs/note.md',
      to: 'docs/note (2).md',
    });
    expect(await fs.readdir(path.join(root, 'docs'))).toEqual(['note (2).md', 'note.md']);
  });

  it('keeps dotfile names readable when uniquifying', async () => {
    const root = await workspace();
    await write(root, '.env', 'A=1');
    expect(await copyEntry(root, '.env', '.env', true)).toEqual({ from: '.env', to: '.env (2)' });
  });

  it('refuses copying a folder into itself and reports missing sources', async () => {
    const root = await workspace();
    await write(root, 'src/a.ts', '1');
    expect(await rejected(copyEntry(root, 'src', 'src/inner'))).toBe(400);
    expect(await rejected(copyEntry(root, 'src', 'src'))).toBe(400);
    expect(await rejected(copyEntry(root, 'gone.ts', 'x.ts'))).toBe(404);
    expect(await rejected(copyEntry(root, 'a.txt', '../escape'))).toBe(400);
    expect(await rejected(copyEntry(root, '', 'x'))).toBe(400);
    expect(await rejected(copyEntry(root, 'a.txt', ''))).toBe(400);
  });
});

describe('upload', () => {
  it('streams the body to disk and reports path and size', async () => {
    const root = await workspace();
    const up = await writeUpload(root, 'catatan.md', streamOf(['halo ', 'dunia']));
    expect(up).toEqual({ path: 'catatan.md', size: 10 });
    expect(await fs.readFile(path.join(root, 'catatan.md'), 'utf8')).toBe('halo dunia');
  });

  it('creates the parent folders it needs', async () => {
    const root = await workspace();
    const up = await writeUpload(root, 'docs/in/new.txt', streamOf(['x']));
    expect(up.path).toBe('docs/in/new.txt');
    expect(await fs.readFile(path.join(root, 'docs', 'in', 'new.txt'), 'utf8')).toBe('x');
  });

  it('renames a duplicate instead of overwriting it', async () => {
    const root = await workspace();
    await write(root, 'a.txt', 'lama');
    const up = await writeUpload(root, 'a.txt', streamOf(['baru']));
    expect(up.path).toBe('a (2).txt');
    expect(await fs.readFile(path.join(root, 'a.txt'), 'utf8')).toBe('lama');
    expect(await fs.readFile(path.join(root, 'a (2).txt'), 'utf8')).toBe('baru');
  });

  it('refuses a name that belongs to a folder', async () => {
    const root = await workspace();
    await fs.mkdir(path.join(root, 'assets'));
    expect(await rejected(writeUpload(root, 'assets', streamOf(['x'])))).toBe(409);
    expect(await fs.readdir(root)).toEqual(['assets']);
  });

  it('caps the size and leaves no partial file behind', async () => {
    const root = await workspace();
    expect(await rejected(writeUpload(root, 'big.bin', streamOf(['aaa', 'bbb']), 4))).toBe(413);
    expect(await fs.readdir(root)).toEqual([]);
  });

  it('deletes the file when the stream breaks halfway', async () => {
    const root = await workspace();
    expect(await rejected(writeUpload(root, 'part.txt', brokenStream(['setengah '])))).toBe('unexpected: putus');
    expect(await fs.readdir(root)).toEqual([]);
  });

  it.each(['../outside', 'C:\\Windows\\x.txt', ''])('refuses %s', async (input) => {
    const root = await workspace();
    expect(await rejected(writeUpload(root, input, streamOf(['x'])))).toBe(400);
  });
});

describe('save', () => {
  it('overwrites an existing file and reports the new size and mtime', async () => {
    const root = await workspace();
    await write(root, 'a.ts', 'const a = 1');
    const before = await readFileAt(root, 'a.ts');
    expect(before.mtime).toBeGreaterThan(0);
    const saved = await saveFileAt(root, 'a.ts', 'const a = 2222222');
    expect(saved).toMatchObject({ path: 'a.ts', size: 17 });
    expect(saved.mtime).toBeGreaterThanOrEqual(before.mtime);
    expect((await readFileAt(root, 'a.ts')).text).toBe('const a = 2222222');
  });

  it('keeps the bytes it was handed, including CRLF', async () => {
    const root = await workspace();
    await write(root, 'b.txt', 'x');
    await saveFileAt(root, 'b.txt', 'satu\r\ndua\r\n');
    expect(await fs.readFile(path.join(root, 'b.txt'), 'utf8')).toBe('satu\r\ndua\r\n');
  });

  it('refuses when the file changed on disk since the read', async () => {
    const root = await workspace();
    await write(root, 'c.md', 'lama');
    const seen = await readFileAt(root, 'c.md');
    await fs.writeFile(path.join(root, 'c.md'), 'diubah agent', 'utf8');
    // utimes membuat pergeseran mtime pasti, tidak bergantung resolusi jam filesystem.
    const bumped = new Date(seen.mtime + 5000);
    await fs.utimes(path.join(root, 'c.md'), bumped, bumped);
    expect(await rejected(saveFileAt(root, 'c.md', 'baru', seen.mtime))).toBe(409);
    expect(await fs.readFile(path.join(root, 'c.md'), 'utf8')).toBe('diubah agent');
  });

  it('saves without a baseMtime even when the disk moved', async () => {
    const root = await workspace();
    await write(root, 'd.txt', 'lama');
    expect(await saveFileAt(root, 'd.txt', 'baru')).toMatchObject({ path: 'd.txt', size: 4 });
  });

  it('rejects empty paths, non-text bodies, folders and missing files', async () => {
    const root = await workspace();
    await write(root, 'e.txt', 'x');
    await fs.mkdir(path.join(root, 'f'));
    expect(await rejected(saveFileAt(root, '', 'x'))).toBe(400);
    expect(await rejected(saveFileAt(root, 'e.txt', 42))).toBe(400);
    expect(await rejected(saveFileAt(root, 'f', 'x'))).toBe(400);
    expect(await rejected(saveFileAt(root, 'gone.txt', 'x'))).toBe(404);
    expect(await rejected(saveFileAt(root, '../outside.txt', 'x'))).toBe(400);
  });

  it('caps the payload and leaves no temp file behind', async () => {
    const root = await workspace();
    await write(root, 'g.txt', 'x');
    expect(await rejected(saveFileAt(root, 'g.txt', 'y'.repeat(2_000_001)))).toBe(413);
    expect(await fs.readFile(path.join(root, 'g.txt'), 'utf8')).toBe('x');
    expect((await fs.readdir(root)).filter((name) => name.includes('virto-save'))).toEqual([]);
  });

  it('refuses a path whose folder no longer exists instead of recreating it', async () => {
    const root = await workspace();
    await write(root, 'h/i.txt', 'x');
    await fs.rm(path.join(root, 'h'), { recursive: true, force: true });
    expect(await rejected(saveFileAt(root, 'h/i.txt', 'y'))).toBe(404);
    expect(await fs.readdir(root)).toEqual([]);
  });
});

describe('search', () => {
  it('matches by filename and skips vendored folders', async () => {
    const root = await workspace();
    await write(root, 'src/handler.ts', 'export function handler() {}');
    await write(root, 'node_modules/handler.ts', 'export function handler() {}');
    const result = await searchIn(root, 'HANDLER', 'name');
    expect(result).toMatchObject({ mode: 'name', query: 'HANDLER', matches: [{ path: 'src/handler.ts', dir: false }], stopped: 'done' });
    expect(result.scanned).toBeGreaterThan(0);
  });

  it('matches file content with line number and preview', async () => {
    const root = await workspace();
    await write(root, 'a.ts', 'line one\nconst token = 2\nline three');
    await write(root, 'b.md', 'nothing here');
    expect(await searchIn(root, 'TOKEN', 'content')).toMatchObject({
      matches: [{ path: 'a.ts', line: 2, preview: 'const token = 2' }],
    });
  });

  it('caps results and rejects bad input', async () => {
    const root = await workspace();
    for (let i = 0; i < 6; i += 1) await write(root, `needle${i}.txt`, 'x');
    const capped = await searchIn(root, 'needle', 'name', 3);
    expect(capped.matches).toHaveLength(3);
    expect(capped.stopped).toBe('limit');
    expect(await rejected(searchIn(root, '  ', 'name'))).toBe(400);
    expect(await rejected(searchIn(root, 'x', 'regex'))).toBe(400);
  });
});
