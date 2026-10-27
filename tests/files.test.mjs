import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpError } from '../server/http.mjs';
import {
  createEntry,
  deleteEntry,
  readFileAt,
  renameEntry,
  resolveInside,
  searchIn,
  treeAt,
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
