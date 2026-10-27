import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { HttpError } from './http.mjs';
import { resolveInside } from './files.mjs';

const GIT_MAX_BUFFER = 8_000_000;
const DIFF_MAX_LINES = 1200;
const UNTRACKED_MAX_BYTES = 400_000;

/** Git tidak pernah melempar di sini: yang gagal dicatat lewat kode, bukan exception. */
function run(root, args) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', root, '-c', 'core.quotepath=false', ...args],
      { windowsHide: true, maxBuffer: GIT_MAX_BUFFER, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error?.code === 'ENOENT') {
          reject(new HttpError(500, 'git tidak tersedia di mesin ini.'));
          return;
        }
        resolve({ out: stdout ?? '', err: (stderr ?? '').trim(), ok: !error });
      }
    );
  });
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
