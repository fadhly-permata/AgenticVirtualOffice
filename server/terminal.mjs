import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import nodePty from 'node-pty';
import { HttpError } from './http.mjs';

const MAX_SESSIONS = 6;
const MAX_PENDING_CHARS = 120_000;
const MAX_INPUT_CHARS = 32_000;
// Pindah tab di dalam jendela chat tidak memutus SSE, jadi sesi tanpa subscriber praktis
// hanya terjadi setelah reload/tutup browser. Jangan biarkan shell yatim menunggu sepuluh menit.
const IDLE_CLOSE_MS = 90_000;
const EXIT_TTL_MS = 60_000;

const CANDIDATES = {
  win32: [
    { id: 'cmd', label: 'Command Prompt', file: (env) => env.COMSPEC || 'cmd.exe', args: [] },
    {
      id: 'powershell',
      label: 'PowerShell',
      file: (env) => path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: ['-NoLogo'],
    },
    { id: 'pwsh', label: 'PowerShell 7', file: () => 'pwsh.exe', args: ['-NoLogo'] },
  ],
  posix: [
    { id: 'shell', label: (env) => path.basename(env.SHELL || 'sh'), file: (env) => env.SHELL || '/bin/sh', args: ['-i'] },
    { id: 'bash', label: 'Bash', file: () => '/bin/bash', args: ['-i'] },
    { id: 'zsh', label: 'Zsh', file: () => '/bin/zsh', args: ['-i'] },
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
    });
  }
  return shells;
}

/**
 * Shell harus melihat PATH asli Windows, bukan PATH dari proses yang menyalakan server
 * (Git Bash misalnya, yang menyisipkan coreutils sehingga cmd bisa menjalankan `ls`).
 */
const ENV_KEYS = [
  'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
  'HKCU\\Environment',
];

// Variabel warisan MSYS/Git Bash yang tidak pernah ada di shell Windows asli.
const MSYS_VARS = [
  'MSYSTEM', 'MINGW_PREFIX', 'MINGW_CHOST', 'MSYSCON', 'CHERE_INVOKING', 'EXEEXT',
  'HOSTTYPE', 'MACHTYPE', 'OSTYPE', 'PS1', 'PS2', 'SHLVL', 'OLDPWD', 'PAGER',
  'MANPATH', 'INFOPATH', 'SSH_ASKPASS', 'PLINK_PROTOCOL', '_',
];

function parseRegTable(text) {
  const values = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^\s+(\S+)\s+REG_[A-Z_]+\s+(.*)$/.exec(line);
    if (match) values.set(match[1], match[2].trim());
  }
  return values;
}

function expandRefs(value, lookup) {
  return value.replace(/%([^%]+)%/g, (whole, name) => lookup.get(name.toUpperCase()) ?? whole);
}

function setVar(target, name, value) {
  // Windows menganggap nama variabel case-insensitive; kunci ganda bikin shell bingung.
  for (const key of Object.keys(target)) {
    if (key.toUpperCase() === name.toUpperCase()) delete target[key];
  }
  target[name] = value;
}

function defaultRegistry(key) {
  return new Promise((resolve, reject) => {
    execFile('reg', ['query', key], { windowsHide: true }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function registryEnv(base, machine, user) {
  const env = { ...base };
  for (const name of MSYS_VARS) delete env[name];

  const lookup = new Map();
  for (const [name, value] of Object.entries(env)) lookup.set(name.toUpperCase(), value);
  for (const source of [machine, user]) {
    for (const [name, value] of source) lookup.set(name.toUpperCase(), value);
  }

  const joined = [machine.get('Path'), user.get('Path')]
    .filter(Boolean)
    .flatMap((entry) => expandRefs(entry, lookup).split(';'))
    .map((entry) => entry.trim())
    .filter((entry, index, all) => entry && all.indexOf(entry) === index);
  if (joined.length) setVar(env, 'Path', joined.join(';'));

  for (const source of [machine, user]) {
    for (const [name, value] of source) {
      if (name.toLowerCase() === 'path') continue;
      setVar(env, name, expandRefs(value, lookup));
    }
  }
  return env;
}

function killTree(child, platform) {
  if (!child) return;
  // taskkill /T ikut mematikan anak-anak shell; pty.kill() saja meninggalkan yatim.
  if (platform === 'win32' && child.pid) {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => undefined);
    } catch {
      // taskkill tidak tersedia; fallback di bawah tetap dicoba.
    }
  }
  try {
    child.kill();
  } catch {
    // Proses sudah mati di antara pengecekan dan kill.
  }
}

export class TerminalHub {
  constructor({
    spawner = nodePty.spawn,
    env = process.env,
    platform = process.platform,
    shells = null,
    registry = defaultRegistry,
  } = {}) {
    this.spawner = spawner;
    this.env = env;
    this.platform = platform;
    this.staticShells = shells;
    this.registry = registry;
    this.shellsPromise = null;
    this.envPromise = null;
    this.sessions = new Map();
    this.counter = 0;
  }

  /**
   * Environment shell. Windows: PATH disusun dari registry (Machine + User) supaya tab cmd
   * tidak mewarisi coreutils Git Bash kalau server-nya dijalankan dari Git Bash.
   */
  environment() {
    if (!this.envPromise) {
      this.envPromise = (async () => {
        if (this.platform !== 'win32') return { env: { ...this.env }, source: 'inherited' };
        try {
          const [machineText, userText] = await Promise.all(ENV_KEYS.map((key) => this.registry(key)));
          const machine = parseRegTable(machineText);
          const user = parseRegTable(userText);
          if (!machine.size && !user.size) return { env: { ...this.env }, source: 'inherited' };
          return { env: registryEnv(this.env, machine, user), source: 'registry' };
        } catch {
          return { env: { ...this.env }, source: 'inherited' };
        }
      })();
    }
    return this.envPromise;
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
    const { env, source } = await this.environment();
    const childEnv = this.platform === 'win32' ? env : { ...env, TERM: 'xterm-256color' };
    let child;
    try {
      child = this.spawner(target.file, target.args, {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: directory,
        env: childEnv,
      });
    } catch (error) {
      throw new HttpError(500, `Gagal menjalankan ${target.label}: ${error.message}`);
    }

    const session = {
      id,
      shell: target.id,
      label: target.label,
      cwd: directory,
      pathSource: source,
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

    child.onData((data) => {
      if (data) this.emit(id, { type: 'output', id, data });
    });
    child.onExit(({ exitCode, signal }) => this.finish(session, exitCode, signal));

    return publicSession(session);
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
    session.child.write(data.slice(0, MAX_INPUT_CHARS));
    return { ok: true, alive: !session.exited };
  }

  resize(id, cols, rows) {
    const session = this.get(id);
    if (session.exited) throw new HttpError(409, 'Terminal sudah selesai.');
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 1 || cols > 500 || rows > 300) {
      throw new HttpError(400, 'Ukuran terminal tidak valid.');
    }
    session.child.resize(cols, rows);
    return { ok: true };
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
    cwd: session.cwd,
    nativePath: session.pathSource === 'registry',
    pid: session.child.pid ?? null,
    alive: !session.exited,
    exitCode: session.exitCode,
  };
}
