import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from './http.mjs';

const MAX_SESSIONS = 6;
const MAX_PENDING_CHARS = 120_000;
const MAX_INPUT_CHARS = 32_000;
// Pindah tab di dalam jendela chat tidak memutus SSE, jadi sesi tanpa subscriber praktis
// hanya terjadi setelah reload/tutup browser. Jangan biarkan shell yatim menunggu sepuluh menit.
const IDLE_CLOSE_MS = 90_000;
const EXIT_TTL_MS = 60_000;

/**
 * 'local': shell tidak mengulang baris yang dikirim, jadi klien yang menampilkan
 *          ketikan dan menangani backspace.
 * 'shell': shell mengulang sendiri (PowerShell), jadi klien meneruskan tombol apa adanya.
 */
const CANDIDATES = {
  win32: [
    { id: 'cmd', label: 'Command Prompt', file: (env) => env.COMSPEC || 'cmd.exe', args: ['/Q'], echo: 'local' },
    {
      id: 'powershell',
      label: 'PowerShell',
      file: (env) => path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: ['-NoLogo'],
      echo: 'shell',
    },
    { id: 'pwsh', label: 'PowerShell 7', file: () => 'pwsh.exe', args: ['-NoLogo'], echo: 'shell' },
  ],
  posix: [
    { id: 'shell', label: (env) => path.basename(env.SHELL || 'sh'), file: (env) => env.SHELL || '/bin/sh', args: ['-i'], echo: 'shell' },
    { id: 'bash', label: 'Bash', file: () => '/bin/bash', args: ['-i'], echo: 'shell' },
    { id: 'zsh', label: 'Zsh', file: () => '/bin/zsh', args: ['-i'], echo: 'shell' },
  ],
};

async function isFile(candidate) {
  if (!candidate) return false;
  try {
    return (await fs.stat(candidate)).isFile();
  } catch {
    return false;
  }
}

/** Nama telanjang dicari di PATH; Windows butuh ekstensi, jadi 'pwsh' bisa jadi 'pwsh.exe'. */
async function locate(name, env, platform) {
  if (name.includes('/') || name.includes('\\') || path.isAbsolute(name)) {
    return (await isFile(name)) ? name : null;
  }
  const dirs = String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const extensions = platform === 'win32' ? ['.exe', '.bat', '.cmd', ''] : [''];
  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = path.join(dir, name + extension);
      if (await isFile(candidate)) return candidate;
    }
  }
  return null;
}

export async function detectShells(env = process.env, platform = process.platform) {
  const specs = CANDIDATES[platform] ?? CANDIDATES.posix;
  const shells = [];
  for (const spec of specs) {
    const file = await locate(spec.file(env) ?? '', env, platform);
    if (!file) continue;
    shells.push({
      id: spec.id,
      label: typeof spec.label === 'function' ? spec.label(env) : spec.label,
      file,
      args: spec.args,
      echo: spec.echo,
    });
  }
  return shells;
}

function killTree(child, platform) {
  if (child.exitCode !== null || child.signalCode) return;
  // taskkill /T ikut mematikan anak-anak shell; child.kill() saja meninggalkan yatim.
  if (platform === 'win32' && child.pid) {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => undefined);
    } catch {
      // taskkill tidak tersedia; fallback di bawah tetap dicoba.
    }
  }
  try {
    child.kill(platform === 'win32' ? undefined : 'SIGTERM');
  } catch {
    // Proses sudah mati di antara pengecekan dan kill.
  }
}

export class TerminalHub {
  constructor({ spawner = spawn, env = process.env, platform = process.platform, shells = null } = {}) {
    this.spawner = spawner;
    this.env = env;
    this.platform = platform;
    this.staticShells = shells;
    this.shellsPromise = null;
    this.sessions = new Map();
    this.counter = 0;
  }

  listShells() {
    if (this.staticShells) return Promise.resolve(this.staticShells);
    if (!this.shellsPromise) this.shellsPromise = detectShells(this.env, this.platform).catch(() => []);
    return this.shellsPromise;
  }

  list() {
    return [...this.sessions.values()].map(publicSession);
  }

  get(id) {
    const session = this.sessions.get(id);
    if (!session) throw new HttpError(404, 'Terminal tidak ditemukan.');
    return session;
  }

  async start({ shell = null, cwd = null } = {}) {
    const alive = [...this.sessions.values()].filter((session) => !session.exited).length;
    if (alive >= MAX_SESSIONS) throw new HttpError(409, `Maksimal ${MAX_SESSIONS} terminal aktif.`);

    const shells = await this.listShells();
    if (!shells.length) throw new HttpError(400, 'Tidak ada shell yang bisa dijalankan di mesin ini.');
    const target = shells.find((entry) => entry.id === shell) ?? shells[0];

    const directory = cwd || process.cwd();
    try {
      if (!(await fs.stat(directory)).isDirectory()) throw new Error('bukan folder');
    } catch {
      throw new HttpError(400, 'Folder kerja terminal tidak tersedia.');
    }

    const id = `t${++this.counter}`;
    let child;
    try {
      child = this.spawner(target.file, target.args, {
        cwd: directory,
        env: { ...this.env, TERM: 'xterm-256color' },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      throw new HttpError(500, `Gagal menjalankan ${target.label}: ${error.message}`);
    }

    const session = {
      id,
      shell: target.id,
      label: target.label,
      echo: target.echo,
      cwd: directory,
      child,
      listeners: new Set(),
      pending: [],
      pendingChars: 0,
      exited: false,
      exitCode: null,
      idleTimer: null,
      exitTimer: null,
    };
    this.sessions.set(id, session);

    this.tap(id, child.stdout, false);
    this.tap(id, child.stderr, true);
    child.on('error', (error) => this.emit(id, { type: 'output', id, data: `Shell error: ${error.message}\n`, error: true }));
    child.on('close', (code, signal) => this.finish(session, code, signal));

    return publicSession(session);
  }

  tap(id, stream, isError) {
    if (!stream) return;
    const decoder = new TextDecoder('utf-8');
    stream.on('data', (chunk) => {
      const data = decoder.decode(chunk, { stream: true });
      if (data) this.emit(id, { type: 'output', id, data, error: isError });
    });
  }

  emit(id, event) {
    const session = this.sessions.get(id);
    if (!session) return;

    if (session.pending) {
      session.pending.push(event);
      session.pendingChars += event.data ? event.data.length : 0;
      // Buang kepala buffer kalau kepanjangan; subscriber baru tetap dapat ekor yang relevan.
      while (session.pendingChars > MAX_PENDING_CHARS && session.pending.length > 1) {
        const [dropped, ...rest] = session.pending;
        session.pending = rest;
        session.pendingChars -= dropped.data ? dropped.data.length : 0;
      }
      return;
    }
    for (const listener of [...session.listeners]) listener(event);
  }

  /** Subscriber pertama menerima isi yang terjadi sebelum ia sempat terhubung. */
  subscribe(id, listener) {
    const session = this.get(id);
    if (session.pending) {
      const buffered = session.pending;
      session.pending = null;
      session.pendingChars = 0;
      for (const event of buffered) listener(event);
    }
    if (session.exited) {
      queueMicrotask(() => listener({ type: 'exit', id, code: session.exitCode }));
    }
    if (session.idleTimer) clearTimeout(session.idleTimer);

    session.listeners.add(listener);
    return () => {
      session.listeners.delete(listener);
      if (!session.listeners.size && !session.exited) {
        session.idleTimer = setTimeout(() => this.destroy(session), IDLE_CLOSE_MS);
        session.idleTimer.unref?.();
      }
    };
  }

  write(id, data) {
    const session = this.get(id);
    if (session.exited) throw new HttpError(409, 'Terminal sudah selesai.');
    if (typeof data !== 'string' || !data) return { ok: true, alive: true };
    session.child.stdin?.write(data.slice(0, MAX_INPUT_CHARS));
    return { ok: true, alive: !session.exited };
  }

  async close(id) {
    const session = this.get(id);
    this.destroy(session);
    return { id, closed: true };
  }

  closeAll() {
    for (const session of [...this.sessions.values()]) this.destroy(session);
  }

  destroy(session) {
    this.sessions.delete(session.id);
    if (session.idleTimer) clearTimeout(session.idleTimer);
    if (session.exitTimer) clearTimeout(session.exitTimer);
    for (const listener of [...session.listeners]) listener({ type: 'exit', id: session.id, code: session.exitCode ?? 0 });
    session.listeners.clear();
    try {
      session.child.stdin?.end();
    } catch {
      // Pipe sudah tertutup.
    }
    killTree(session.child, this.platform);
  }

  finish(session, code, signal) {
    if (session.exited) return;
    session.exited = true;
    session.exitCode = typeof code === 'number' ? code : signal ? 1 : 0;
    this.emit(session.id, { type: 'exit', id: session.id, code: session.exitCode });
    // Beri waktu satu koneksi terakhir untuk membaca penyebab keluar, lalu bersihkan.
    session.exitTimer = setTimeout(() => this.destroy(session), EXIT_TTL_MS);
    session.exitTimer.unref?.();
  }
}

function publicSession(session) {
  return {
    id: session.id,
    shell: session.shell,
    label: session.label,
    echo: session.echo,
    cwd: session.cwd,
    pid: session.child.pid ?? null,
    alive: !session.exited,
    exitCode: session.exitCode,
  };
}
