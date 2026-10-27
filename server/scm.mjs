import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { HttpError } from './http.mjs';
import { resolveInside } from './files.mjs';

const GIT_MAX_BUFFER = 8_000_000;
const DIFF_MAX_LINES = 1200;
const UNTRACKED_MAX_BYTES = 400_000;
const COMMIT_MESSAGE_MAX = 8000;
const GIT_ERROR_MAX = 400;

/**
 * Git tidak pernah melempar di sini: yang gagal dicatat lewat kode, bukan exception.
 * GIT_TERMINAL_PROMPT=0 supaya push/pull kehabisan kredensial langsung gagal,
 * bukan menggantung menunggu input di shell yang tidak punya terminal.
 */
function raw(root, args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      ['-C', root, '-c', 'core.quotepath=false', ...args],
      {
        windowsHide: true,
        maxBuffer: GIT_MAX_BUFFER,
        encoding: 'utf8',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', GCM_INTERACTIVE: 'never' },
      },
      (error, stdout, stderr) => {
        if (error?.code === 'ENOENT') {
          reject(new HttpError(500, 'git tidak tersedia di mesin ini.'));
          return;
        }
        resolve({ out: stdout ?? '', err: (stderr ?? '').trim(), ok: !error });
      }
    );
    if (input !== undefined) child.stdin?.end(input);
  });
}

const run = (root, args) => raw(root, args);

/** Kegagalan git berarti perintahnya ditolak repo: pesannya diteruskan apa adanya. */
async function exec(root, args, input) {
  const result = await raw(root, args, input);
  if (!result.ok) throw new HttpError(422, describeGitError(result));
  return result;
}

function describeGitError(result) {
  const text = (result.err || result.out || 'Perintah git gagal.').replace(/\r/g, '');
  const kept = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(' ');
  return kept.length > GIT_ERROR_MAX ? `${kept.slice(0, GIT_ERROR_MAX)}…` : kept;
}

const BRANCH_FORBIDDEN = /[\s~^:?*[\\]|@]|\.\.|^[-./]|\.$/;

function assertBranchName(name) {
  const clean = typeof name === 'string' ? name.trim() : '';
  if (!clean) throw new HttpError(400, 'Nama branch kosong.');
  if (clean.length > 120 || BRANCH_FORBIDDEN.test(clean)) {
    throw new HttpError(400, `Nama branch tidak valid: ${clean}`);
  }
  return clean;
}

/** Semua path client lewat guard File List dulu, jadi git tidak pernah melihat '../'. */
function assertPaths(root, paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  const clean = list.filter((item) => typeof item === 'string' && item.trim());
  if (!clean.length) throw new HttpError(400, 'Tidak ada path yang dipilih.');
  if (clean.length > 500) throw new HttpError(400, 'Terlalu banyak path sekaligus.');
  return clean.map((item) => resolveInside(root, item).rel);
}

const firstLine = (text) => text.replace(/\r/g, '').split('\n')[0]?.trim() ?? '';

function toCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalize(file) {
  return file.replace(/\\/g, '/').replace(/"/g, '');
}

/**
 * `--porcelain -z` memisahkan entri dengan NUL; rename membawa path asal sebagai token
 * berikutnya, jadi pembacaannya berjalan token per token, bukan baris per baris.
 */
function parseStatus(raw) {
  const tokens = raw.replace(/\r/g, '').split('\0').filter((token) => token !== '');
  const files = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const code = token.slice(0, 2);
    let file = token.slice(3);
    let origin = '';
    if ((code[0] === 'R' || code[0] === 'C') && tokens[index + 1]) {
      origin = tokens[index + 1];
      index += 1;
    }
    if (!file) continue;
    files.push({
      path: normalize(file),
      origin: origin ? normalize(origin) : '',
      index: code[0] === ' ' ? '' : code[0],
      worktree: code[1] === ' ' ? '' : code[1],
    });
  }
  return files;
}

/** Numstat memakai format berbeda untuk rename: nama kosong lalu preimage dan postimage. */
function parseNumstat(raw) {
  const tokens = raw.replace(/\r/g, '').split('\0');
  const counts = new Map();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    const [added, deleted, name] = token.split('\t');
    if (name === '') {
      const post = tokens[index + 2];
      if (post) {
        counts.set(normalize(post), { added: toCount(added), deleted: toCount(deleted) });
        index += 2;
      }
      continue;
    }
    if (name === undefined) continue;
    counts.set(normalize(name), { added: toCount(added), deleted: toCount(deleted) });
  }
  return counts;
}

function joinCounts(file, stagedCounts, unstagedCounts) {
  return {
    ...file,
    untracked: file.index === '?' && file.worktree === '?',
    staged: stagedCounts.get(file.path) ?? { added: 0, deleted: 0 },
    unstaged: unstagedCounts.get(file.path) ?? { added: 0, deleted: 0 },
  };
}

function splitGroups(files) {
  const staged = files.filter((file) => file.index && file.index !== '?');
  const unstaged = files.filter((file) => file.worktree && file.worktree !== '?');
  const untracked = files.filter((file) => file.untracked);
  return { staged, unstaged, untracked };
}

export async function repoStatus(root) {
  const probe = await run(root, ['rev-parse', '--is-inside-work-tree']);
  if (!probe.ok || firstLine(probe.out) !== 'true') {
    throw new HttpError(409, 'Folder yang dibuka bukan repo git.');
  }

  const [branch, head, upstream, entries, stagedStat, unstagedStat, commit] = await Promise.all([
    run(root, ['symbolic-ref', '--short', '-q', 'HEAD']),
    run(root, ['rev-parse', '--short', 'HEAD']),
    run(root, ['rev-parse', '--abbrev-ref', '-q', '--symbolic-full-name', '@{u}']),
    run(root, ['status', '--porcelain', '-z', '--untracked-files=all']),
    run(root, ['diff', '--numstat', '--cached', '-z']),
    run(root, ['diff', '--numstat', '-z']),
    run(root, ['log', '-1', '--format=%h|%s|%cr']),
  ]);

  const divergence = upstream.ok
    ? firstLine((await run(root, ['rev-list', '--left-right', '--count', '@{u}...HEAD'])).out).split(/[\t ]+/)
    : [];

  const stagedCounts = parseNumstat(stagedStat.out);
  const unstagedCounts = parseNumstat(unstagedStat.out);
  const files = parseStatus(entries.out).map((file) => joinCounts(file, stagedCounts, unstagedCounts));
  const groups = splitGroups(files);

  return {
    root,
    branch: branch.ok && branch.out.trim() ? branch.out.trim() : '',
    detached: branch.ok && branch.out.trim() ? '' : firstLine(head.out),
    head: firstLine(head.out),
    upstream: upstream.ok ? firstLine(upstream.out) : '',
    behind: divergence.length ? toCount(divergence[0]) : 0,
    ahead: divergence.length ? toCount(divergence[1]) : 0,
    last: commit.ok ? commitFormat(firstLine(commit.out)) : null,
    files: groups.staged.concat(groups.unstaged, groups.untracked),
    counts: {
      staged: groups.staged.length,
      unstaged: groups.unstaged.length,
      untracked: groups.untracked.length,
    },
    clean: files.length === 0,
  };
}

function commitFormat(raw) {
  const [sha = '', subject = '', when = ''] = raw.split('|');
  return sha ? { sha, subject, when } : null;
}

function hunkLines(text) {
  // Baris "index <sha>..<sha>" cuma hash blob, tidak berguna untuk dibaca.
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !line.startsWith('index '));
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const shown = lines.slice(0, DIFF_MAX_LINES);
  return { lines: shown, truncated: lines.length > shown.length, total: lines.length };
}

async function untrackedDiff(root, rel) {
  const { abs } = resolveInside(root, rel);
  let stat;
  try {
    stat = await fs.stat(abs);
  } catch {
    return { lines: [], truncated: false, total: 0 };
  }
  if (stat.size > UNTRACKED_MAX_BYTES) {
    return {
      lines: ['file belum dilacak dan terlalu besar untuk ditampilkan'],
      truncated: true,
      total: 1,
      note: 'too-large',
    };
  }
  const text = (await fs.readFile(abs, 'utf8')).replace(/\r\n/g, '\n');
  const body = text.split('\n');
  if (body.length && body[body.length - 1] === '') body.pop();
  const shown = body.slice(0, DIFF_MAX_LINES).map((line) => `+${line}`);
  return {
    lines: [`@@ -0,0 +1,${body.length} @@`, ...shown],
    truncated: body.length > DIFF_MAX_LINES,
    total: body.length + 1,
  };
}

export async function fileDiff(root, input, staged) {
  const { rel } = resolveInside(root, input);
  if (!rel) throw new HttpError(400, 'Path file harus diisi.');

  const tracked = await run(root, ['ls-files', '--', rel]);
  const untracked = await run(root, ['ls-files', '--others', '--exclude-standard', '--', rel]);

  if (!tracked.out.trim() && untracked.out.trim()) {
    const built = await untrackedDiff(root, rel);
    return { path: rel, staged: false, untracked: true, empty: built.lines.length === 0, ...built };
  }

  const args = ['diff', '--no-color', '--unified=3'];
  if (staged) args.push('--cached');
  args.push('--', rel);
  const result = await run(root, args);
  if (!result.ok && result.err) throw new HttpError(500, result.err);

  const built = hunkLines(result.out);
  return {
    path: rel,
    staged: Boolean(staged),
    untracked: false,
    empty: built.lines.length === 0,
    lines: built.lines,
    truncated: built.truncated,
    total: built.total,
  };
}

const splitZ = (text) =>
  text
    .replace(/\r/g, '')
    .split('\0')
    .map((token) => normalize(token))
    .filter(Boolean);

async function hasHead(root) {
  const probe = await run(root, ['rev-parse', '--verify', '-q', 'HEAD']);
  return probe.ok && Boolean(firstLine(probe.out));
}

/**
 * Membatalkan stage. `restore --staged` butuh HEAD, jadi repo yang belum punya
 * commit sama sekali memakai `rm --cached` yang membuat file kembali untracked.
 */
async function unstagePaths(root, rel) {
  if (await hasHead(root)) {
    await exec(root, ['restore', '--staged', '--', ...rel]);
    return;
  }
  await exec(root, ['rm', '--cached', '-q', '-r', '--', ...rel]);
}

export async function setStaged(root, paths, next) {
  const rel = assertPaths(root, paths);
  if (next) await exec(root, ['add', '--all', '--', ...rel]);
  else await unstagePaths(root, rel);
  return repoStatus(root);
}

export async function setStagedAll(root, next) {
  if (next) await exec(root, ['add', '--all']);
  else await unstagePaths(root, ['.']);
  return repoStatus(root);
}

export async function commitChanges(root, message, amend) {
  const clean = typeof message === 'string' ? message.trim() : '';
  if (clean.length > COMMIT_MESSAGE_MAX) throw new HttpError(400, 'Pesan commit terlalu panjang.');
  if (!clean && !amend) throw new HttpError(400, 'Pesan commit harus diisi.');

  const args = amend ? ['commit', '--amend', '--no-edit'] : ['commit', '-F', '-'];
  await exec(root, args, amend ? undefined : `${clean}\n`);
  return repoStatus(root);
}

/**
 * Rollback per file. File yang ada di HEAD dikembalikan isinya; file baru hasil
 * stage dihapus dari index lalu dari disk. Rename dikirim sepasang (asal +
 * tujuan) oleh client, jadi asal pulih dan tujuan terhapus.
 */
export async function discardChanges(root, paths) {
  const rel = assertPaths(root, paths);
  const [headTree, indexList] = await Promise.all([
    hasHead(root) ? run(root, ['ls-tree', '-r', '-z', '--name-only', 'HEAD', '--', ...rel]) : Promise.resolve({ out: '' }),
    run(root, ['ls-files', '-z', '--', ...rel]),
  ]);
  const inHead = new Set(splitZ(headTree.out));
  const inIndex = new Set(splitZ(indexList.out));

  const reverted = rel.filter((file) => inHead.has(file));
  const dropped = rel.filter((file) => !inHead.has(file));

  if (reverted.length) await exec(root, ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...reverted]);
  const staged = dropped.filter((file) => inIndex.has(file));
  if (staged.length) await exec(root, ['rm', '--cached', '-q', '-r', '--', ...staged]);
  for (const file of dropped) {
    await fs.rm(resolveInside(root, file).abs, { force: true });
  }
  return repoStatus(root);
}

/**
 * Membatalkan commit terakhir. Soft reset menjaga isi file, jadi perubahan
 * kembali berstatus staged; commit pertama dibuat unborn karena tidak ada parent.
 */
export async function undoCommit(root) {
  if (!(await hasHead(root))) throw new HttpError(409, 'Belum ada commit yang bisa dibatalkan.');
  const parent = await run(root, ['rev-parse', '-q', '--verify', 'HEAD^']);
  if (parent.ok) await exec(root, ['reset', '--soft', 'HEAD~1']);
  else await exec(root, ['update-ref', '-d', 'HEAD']);
  return repoStatus(root);
}

/** `%(upstream:track)` berisi string seperti "[ahead 2, behind 1]". */
function parseTrack(text) {
  return {
    ahead: toCount(/ahead (\d+)/.exec(text)?.[1]),
    behind: toCount(/behind (\d+)/.exec(text)?.[1]),
  };
}

export async function branchInfo(root) {
  const [local, remote] = await Promise.all([
    run(root, [
      'for-each-ref',
      '--sort=refname',
      '--format=%(refname:short)%09%(objectname:short)%09%(HEAD)%09%(upstream:short)%09%(upstream:track)%09%(committerdate:relative)',
      'refs/heads',
    ]),
    run(root, ['for-each-ref', '--sort=refname', '--format=%(refname:short)%09%(committerdate:relative)', 'refs/remotes']),
  ]);

  const locals = splitZ(local.out.replace(/\n/g, '\0')).map((token) => {
    const [name = '', sha = '', flag = '', upstream = '', track = '', when = ''] = token.split('\t');
    return { name, sha, current: flag === '*', upstream, ...parseTrack(track), when };
  });
  const remotes = splitZ(remote.out.replace(/\n/g, '\0'))
    .map((token) => {
      const [name = '', when = ''] = token.split('\t');
      return { name, when };
    })
    .filter((branch) => !branch.name.endsWith('/HEAD'));

  return {
    current: locals.find((branch) => branch.current)?.name ?? '',
    local: locals,
    remote: remotes,
  };
}

export async function switchBranch(root, name) {
  const branch = assertBranchName(name);
  await exec(root, ['switch', branch]);
  return branchInfo(root);
}

export async function createBranch(root, name, checkout) {
  const branch = assertBranchName(name);
  if (checkout) await exec(root, ['switch', '-c', branch]);
  else await exec(root, ['branch', branch]);
  return branchInfo(root);
}

export async function deleteBranch(root, name) {
  const branch = assertBranchName(name);
  const current = await run(root, ['symbolic-ref', '--short', '-q', 'HEAD']);
  if (current.out.trim() === branch) throw new HttpError(400, 'Branch yang sedang dipakai tidak bisa dihapus.');
  await exec(root, ['branch', '-d', branch]);
  return branchInfo(root);
}

export async function commitHistory(root, limit) {
  const requested = toCount(limit);
  const count = Math.min(requested > 0 ? requested : 25, 100);
  // `git log` menulis tab sebagai %x09; %09 hanya dikenali for-each-ref.
  const result = await run(root, ['log', `--max-count=${count}`, '--format=%h%x09%an%x09%ar%x09%s']);
  if (!result.ok) return [];
  return result.out
    .replace(/\r/g, '')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      return { sha: parts[0] ?? '', author: parts[1] ?? '', when: parts[2] ?? '', subject: parts.slice(3).join('\t') };
    });
}

/** Output git untuk push/pull ditulis ke stderr; diambil ringkasannya saja. */
const note = (result) => describeGitError({ err: result.err, out: result.out });

export async function pushChanges(root) {
  const branch = await run(root, ['symbolic-ref', '--short', '-q', 'HEAD']);
  if (!branch.out.trim()) throw new HttpError(409, 'Head sedang detached, tidak ada branch untuk di-push.');
  const remote = await run(root, ['remote']);
  if (!firstLine(remote.out)) throw new HttpError(409, 'Repo ini belum punya remote.');

  const upstream = await run(root, ['rev-parse', '--abbrev-ref', '-q', '--symbolic-full-name', '@{u}']);
  const args = upstream.ok ? ['push', '--porcelain'] : ['push', '--porcelain', '--set-upstream', firstLine(remote.out), branch.out.trim()];
  const result = await exec(root, args);
  return { note: note(result) || `Terkirim ke ${branch.out.trim()}.` };
}

export async function pullChanges(root) {
  const upstream = await run(root, ['rev-parse', '--abbrev-ref', '-q', '--symbolic-full-name', '@{u}']);
  if (!upstream.ok) throw new HttpError(409, 'Branch ini belum punya upstream untuk di-pull.');
  const result = await exec(root, ['pull', '--ff-only']);
  return { note: note(result) || 'Sudah paling baru.' };
}
