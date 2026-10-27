import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpError } from '../server/http.mjs';
import { fileDiff, repoStatus } from '../server/scm.mjs';

const temps = [];

function git(root, args) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', root, '-c', 'core.autocrlf=false', '-c', 'user.email=vito@test', '-c', 'user.name=Vito', ...args],
      { windowsHide: true, encoding: 'utf8' },
      (error, stdout, stderr) => (error ? reject(new Error(`${args[0]}: ${stderr || error.message}`)) : resolve(stdout))
    );
  });
}

async function write(root, rel, content) {
  const abs = path.join(root, ...rel.split('/'));
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
}

/** Repo kotor yang sengaja: satu perubahan per kelas (staged, unstaged, untracked, rename). */
async function dirtyRepo() {
  // Windows memakai path short-name saat mkdtemp; resolve() membuat perbandingan stabil.
  const root = path.resolve(await fs.mkdtemp(path.join(os.tmpdir(), 'virto-scm-')));
  temps.push(root);
  await git(root, ['init', '--initial-branch=master']);
  await write(root, 'keep.txt', 'first\nsecond\nthird\n');
  await write(root, 'move.txt', 'pindahkan aku\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'pesan awal']);
  await write(root, 'keep.txt', 'first\nchanged\nthird\n');
  await write(root, 'staged.ts', 'export const a = 1;\n');
  await git(root, ['add', 'staged.ts']);
  await git(root, ['mv', 'move.txt', 'moved.txt']);
  await write(root, 'loose.md', '# belum dilacak\n');
  return root;
}

const status = (error) => (error instanceof HttpError ? error.status : `unexpected: ${error?.message}`);
const rejected = (promise) => promise.then(() => 'resolved').catch(status);

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('repo status', () => {
  it('membedakan staged, unstaged, untracked dan rename', async () => {
    const state = await repoStatus(await dirtyRepo());
    expect(state.branch).toBe('master');
    expect(state.head).toHaveLength(7);
    expect(state.upstream).toBe('');
    expect(state.last.subject).toBe('pesan awal');
    expect(state.counts).toEqual({ staged: 2, unstaged: 1, untracked: 1 });

    const byPath = new Map(state.files.map((file) => [file.path, file]));
    expect(byPath.get('keep.txt')).toMatchObject({ index: '', worktree: 'M', untracked: false });
    expect(byPath.get('keep.txt').unstaged).toEqual({ added: 1, deleted: 1 });
    expect(byPath.get('staged.ts')).toMatchObject({ index: 'A', worktree: '' });
    expect(byPath.get('staged.ts').staged.added).toBe(1);
    expect(byPath.get('moved.txt')).toMatchObject({ index: 'R', origin: 'move.txt' });
    expect(byPath.get('loose.md')).toMatchObject({ worktree: '?', untracked: true });
  });

  it('melaporkan folder tanpa git sebagai 409 dan bersih saat tidak ada perubahan', async () => {
    const plain = path.resolve(await fs.mkdtemp(path.join(os.tmpdir(), 'virto-plain-')));
    temps.push(plain);
    expect(await rejected(repoStatus(plain))).toBe(409);

    const root = await dirtyRepo();
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'semua masuk']);
    const clean = await repoStatus(root);
    expect(clean).toMatchObject({ clean: true, counts: { staged: 0, unstaged: 0, untracked: 0 } });
    expect(clean.last.subject).toBe('semua masuk');
  });
});

describe('file diff', () => {
  it('menghasilkan baris tambah dan buang untuk perubahan kerja', async () => {
    const root = await dirtyRepo();
    const diff = await fileDiff(root, 'keep.txt', false);
    expect(diff).toMatchObject({ path: 'keep.txt', staged: false, untracked: false, empty: false });
    expect(diff.lines.some((line) => line.startsWith('-second'))).toBe(true);
    expect(diff.lines.some((line) => line.startsWith('+changed'))).toBe(true);
    expect(diff.lines.filter((line) => line.startsWith('@@'))).toHaveLength(1);
    expect(diff.lines.slice(0, 2)).toEqual(['diff --git a/keep.txt b/keep.txt', '--- a/keep.txt']);
  });

  it('memakai versi index saat staged dan jadi kosong setelah di-commit', async () => {
    const root = await dirtyRepo();
    const staged = await fileDiff(root, 'staged.ts', true);
    expect(staged.lines.some((line) => line === '+export const a = 1;')).toBe(true);

    await git(root, ['commit', '-m', 'tambah staged']);
    const after = await fileDiff(root, 'staged.ts', false);
    expect(after).toMatchObject({ empty: true, lines: [] });
  });

  it('membuat diff seluruhnya tambah untuk file yang belum dilacak', async () => {
    const root = await dirtyRepo();
    const diff = await fileDiff(root, 'loose.md', false);
    expect(diff).toMatchObject({ untracked: true, empty: false, staged: false });
    expect(diff.lines[0]).toBe('@@ -0,0 +1,1 @@');
    expect(diff.lines[1]).toBe('+# belum dilacak');
  });

  it('menolak path kosong dan path yang keluar workspace', async () => {
    const root = await dirtyRepo();
    expect(await rejected(fileDiff(root, '', false))).toBe(400);
    expect(await rejected(fileDiff(root, '../secret.txt', false))).toBe(400);
    expect(await rejected(fileDiff(root, 'C:\\Windows\\win.ini', false))).toBe(400);
  });
});
