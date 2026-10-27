import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpError } from '../server/http.mjs';
import {
  branchInfo,
  commitChanges,
  commitHistory,
  createBranch,
  deleteBranch,
  discardChanges,
  fileDiff,
  pullChanges,
  pushChanges,
  repoStatus,
  setStaged,
  setStagedAll,
  switchBranch,
  undoCommit,
} from '../server/scm.mjs';

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

const read = (root, rel) =>
  fs.readFile(path.join(root, ...rel.split('/')), 'utf8').then((text) => text.replace(/\r\n/g, '\n'));

/** Repo kotor yang sengaja: satu perubahan per kelas (staged, unstaged, untracked, rename). */
async function dirtyRepo() {
  // Windows memakai path short-name saat mkdtemp; resolve() membuat perbandingan stabil.
  const root = path.resolve(await fs.mkdtemp(path.join(os.tmpdir(), 'virto-scm-')));
  temps.push(root);
  await git(root, ['init', '--initial-branch=master']);
  // Identitas ditulis ke config repo supaya `scm.commitChanges()` berhasil di mesin mana pun.
  await git(root, ['config', 'user.email', 'vito@test']);
  await git(root, ['config', 'user.name', 'Vito']);
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

async function freshRepo() {
  const root = path.resolve(await fs.mkdtemp(path.join(os.tmpdir(), 'virto-empty-')));
  temps.push(root);
  await git(root, ['init', '--initial-branch=master']);
  await git(root, ['config', 'user.email', 'vito@test']);
  await git(root, ['config', 'user.name', 'Vito']);
  await write(root, 'benih.txt', 'belum pernah di-commit\n');
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

async function exists(root, rel) {
  return fs
    .access(path.join(root, ...rel.split('/')))
    .then(() => true)
    .catch(() => false);
}

const paths = (state) => state.files.map((file) => `${file.path}:${file.index || file.worktree}`);

describe('stage dan commit', () => {
  it('menaikkan stage satu file lalu menurunkannya lagi', async () => {
    const root = await dirtyRepo();
    const staged = await setStaged(root, ['loose.md'], true);
    expect(staged.counts).toEqual({ staged: 3, unstaged: 1, untracked: 0 });
    expect(paths(staged)).toContain('loose.md:A');

    const back = await setStaged(root, ['loose.md'], false);
    expect(back.counts).toEqual({ staged: 2, unstaged: 1, untracked: 1 });
    expect(back.files.find((file) => file.path === 'loose.md').untracked).toBe(true);
  });

  it('stage semua lalu unstage semua', async () => {
    const root = await dirtyRepo();
    const all = await setStagedAll(root, true);
    expect(all.counts).toMatchObject({ unstaged: 0, untracked: 0 });
    expect(all.files.some((file) => file.path === 'keep.txt' && file.index === 'M')).toBe(true);

    const none = await setStagedAll(root, false);
    // Unstage rename mengembalikan move.txt ke index padahal file-nya sudah pindah,
    // jadi ia tercatat sebagai deletion — sama seperti yang ditunjukkan git sendiri.
    expect(none.counts).toEqual({ staged: 0, unstaged: 2, untracked: 3 });
  });

  it('menulis pesan commit multi-baris lewat stdin', async () => {
    const root = await dirtyRepo();
    await setStagedAll(root, true);
    const state = await commitChanges(root, 'pesan kedua\n\ndetailnya di sini');
    expect(state.clean).toBe(true);
    expect(state.counts).toEqual({ staged: 0, unstaged: 0, untracked: 0 });
    expect(state.last.subject).toBe('pesan kedua');
    expect(await git(root, ['log', '-1', '--format=%B'])).toContain('detailnya di sini');
  });

  it('menolak pesan kosong dan commit tanpa apa pun yang di-stage', async () => {
    const root = await dirtyRepo();
    expect(await rejected(commitChanges(root, '   ', false))).toBe(400);
    expect(await rejected(commitChanges(root, '', false))).toBe(400);

    await setStagedAll(root, true);
    await commitChanges(root, 'sudah bersih');
    expect(await rejected(commitChanges(root, 'kosong lagi', false))).toBe(422);
  });

  it('amend menambahkan perubahan ke commit terakhir', async () => {
    const root = await dirtyRepo();
    await setStagedAll(root, true);
    const first = await commitChanges(root, 'pesan kedua');
    await write(root, 'keep.txt', 'first\nchanged lagi\nthird\n');
    await setStaged(root, ['keep.txt'], true);
    const amended = await commitChanges(root, '', true);

    expect(amended.head).not.toBe(first.head);
    expect(amended.last.subject).toBe('pesan kedua');
    expect(amended.clean).toBe(true);
    expect(await commitHistory(root, 5)).toHaveLength(2);
  });

  it('bisa bolak-balik stage di repo yang belum punya commit', async () => {
    const root = await freshRepo();
    const staged = await setStagedAll(root, true);
    expect(staged.files).toEqual([expect.objectContaining({ path: 'benih.txt', index: 'A' })]);

    const none = await setStagedAll(root, false);
    expect(none.counts).toEqual({ staged: 0, unstaged: 0, untracked: 1 });

    await setStagedAll(root, true);
    const first = await commitChanges(root, 'commit pertama');
    expect(first.last.subject).toBe('commit pertama');
    expect(first.clean).toBe(true);
  });

  it('menolak path yang keluar workspace dan daftar kosong', async () => {
    const root = await dirtyRepo();
    expect(await rejected(setStaged(root, ['../luar-repo'], true))).toBe(400);
    expect(await rejected(setStaged(root, [], true))).toBe(400);
    expect(await rejected(discardChanges(root, ['C:\\Windows\\win.ini']))).toBe(400);
  });
});

describe('rollback per file', () => {
  it('mengembalikan file yang dilacak ke versi HEAD', async () => {
    const root = await dirtyRepo();
    const state = await discardChanges(root, ['keep.txt']);
    expect(await read(root, 'keep.txt')).toBe('first\nsecond\nthird\n');
    expect(state.files.some((file) => file.path === 'keep.txt')).toBe(false);
  });

  it('menghapus file untracked dari disk', async () => {
    const root = await dirtyRepo();
    const state = await discardChanges(root, ['loose.md']);
    expect(await exists(root, 'loose.md')).toBe(false);
    expect(state.counts.untracked).toBe(0);
  });

  it('membatalkan file baru yang sudah di-stage sekaligus menghapusnya', async () => {
    const root = await dirtyRepo();
    const state = await discardChanges(root, ['staged.ts']);
    expect(await exists(root, 'staged.ts')).toBe(false);
    expect(state.counts).toMatchObject({ staged: 1, unstaged: 1, untracked: 1 });
  });

  it('membatalkan rename sepasang supaya file asal kembali', async () => {
    const root = await dirtyRepo();
    const state = await discardChanges(root, ['moved.txt', 'move.txt']);
    expect(await read(root, 'move.txt')).toBe('pindahkan aku\n');
    expect(await exists(root, 'moved.txt')).toBe(false);
    expect(state.counts).toEqual({ staged: 1, unstaged: 1, untracked: 1 });
  });
});

describe('branch', () => {
  it('membuat, memindahkan, mendaftarkan, lalu menghapus branch', async () => {
    const root = await dirtyRepo();
    const created = await createBranch(root, 'fitur-hangat', true);
    expect(created.current).toBe('fitur-hangat');

    const state = await repoStatus(root);
    expect(state.branch).toBe('fitur-hangat');

    const switched = await switchBranch(root, 'master');
    expect(switched.current).toBe('master');
    expect(switched.local.map((branch) => branch.name)).toEqual(['fitur-hangat', 'master']);
    expect(switched.local.find((branch) => branch.name === 'master').current).toBe(true);

    const deleted = await deleteBranch(root, 'fitur-hangat');
    expect(deleted.local.map((branch) => branch.name)).toEqual(['master']);
    expect(await rejected(deleteBranch(root, 'master'))).toBe(400);
  });

  it('menolak nama branch yang tidak sah', async () => {
    const root = await dirtyRepo();
    expect(await rejected(createBranch(root, 'ada spasi', true))).toBe(400);
    expect(await rejected(createBranch(root, 'a..b', true))).toBe(400);
    expect(await rejected(createBranch(root, '-awalan', true))).toBe(400);
    expect(await rejected(createBranch(root, '', true))).toBe(400);
    expect(await rejected(switchBranch(root, 'ref~1'))).toBe(400);
  });

  it('memakai remote untuk ahead/behind, push, dan pull', async () => {
    const root = await dirtyRepo();
    const bare = path.resolve(await fs.mkdtemp(path.join(os.tmpdir(), 'virto-remote-')));
    temps.push(bare);
    await git(bare, ['init', '--bare', '--initial-branch=master']);
    await git(root, ['remote', 'add', 'origin', bare]);
    await git(root, ['push', '-u', 'origin', 'master']);

    const pushed = await branchInfo(root);
    expect(pushed.current).toBe('master');
    expect(pushed.local[0]).toMatchObject({ upstream: 'origin/master', ahead: 0, behind: 0 });
    expect(pushed.remote.map((branch) => branch.name)).toEqual(['origin/master']);

    await setStagedAll(root, true);
    await commitChanges(root, 'pesan kedua');
    expect((await branchInfo(root)).local[0].ahead).toBe(1);

    await pushChanges(root);
    expect((await branchInfo(root)).local[0].ahead).toBe(0);
    expect(typeof (await pullChanges(root)).note).toBe('string');
  });

  it('menolak push dan pull saat remote belum ada', async () => {
    const root = await dirtyRepo();
    expect(await rejected(pushChanges(root))).toBe(409);
    expect(await rejected(pullChanges(root))).toBe(409);
  });
});

describe('riwayat commit', () => {
  it('mencatat sha, penulis, dan subject', async () => {
    const root = await dirtyRepo();
    await setStagedAll(root, true);
    await commitChanges(root, 'pesan kedua');
    const entries = await commitHistory(root, 10);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ subject: 'pesan kedua', author: 'Vito' });
    expect(entries[0].sha).toHaveLength(7);
    expect(entries[1].subject).toBe('pesan awal');
  });

  it('kosong di repo yang belum punya commit dan membatasi jumlah', async () => {
    expect(await commitHistory(await freshRepo(), 10)).toEqual([]);

    const root = await dirtyRepo();
    for (let index = 0; index < 3; index += 1) {
      await write(root, `catatan-${index}.md`, `isi ${index}\n`);
      await git(root, ['add', `catatan-${index}.md`]);
      await git(root, ['commit', '-m', `catatan ${index}`]);
    }
    expect(await commitHistory(root, 2)).toHaveLength(2);
    expect(await commitHistory(root, '')).toHaveLength(4);
    expect(await commitHistory(root, 9999)).toHaveLength(4);
  });
});

describe('urungkan commit terakhir', () => {
  it('mengembalikan isi commit ke staged tanpa menghapus file', async () => {
    const root = await dirtyRepo();
    await setStagedAll(root, true);
    const done = await commitChanges(root, 'pesan kedua');
    expect(done.clean).toBe(true);

    const back = await undoCommit(root);
    expect(back.last.subject).toBe('pesan awal');
    expect(back.counts).toEqual({ staged: 4, unstaged: 0, untracked: 0 });
    expect(paths(back).sort()).toEqual([
      'keep.txt:M',
      'loose.md:A',
      'moved.txt:R',
      'staged.ts:A',
    ]);
    expect(await read(root, 'keep.txt')).toBe('first\nchanged\nthird\n');
    expect(await exists(root, 'loose.md')).toBe(true);
  });

  it('membuat repo kembali unborn saat commit pertama diurutkan', async () => {
    const root = await freshRepo();
    await setStagedAll(root, true);
    await commitChanges(root, 'benih masuk');

    const back = await undoCommit(root);
    expect(back).toMatchObject({ branch: 'master', head: '', last: null, clean: false });
    expect(back.files).toHaveLength(1);
    expect(back.files[0]).toMatchObject({ path: 'benih.txt', index: 'A' });
    expect(await exists(root, 'benih.txt')).toBe(true);
  });

  it('menolak saat belum ada commit', async () => {
    expect(await rejected(undoCommit(await freshRepo()))).toBe(409);
  });
});
