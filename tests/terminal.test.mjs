import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TerminalHub, detectShells } from '../server/terminal.mjs';

const hubs = [];

function hub(options) {
  const instance = new TerminalHub(options);
  hubs.push(instance);
  return instance;
}

// Process anak mengunci folder cwd-nya di Windows, jadi pakai folder sementara bersama.
const workDir = os.tmpdir();

/** Shell buatan: node menjalankan skrip kecil, jadi tidak butuh cmd. */
function nodeHub(script, extra = {}) {
  return hub({
    shells: [{ id: 'node', label: 'Node', file: process.execPath, args: ['-e', script], ...extra }],
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, ms = 6000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (predicate()) return true;
    await sleep(25);
  }
  throw new Error('Terlambat menunggu kejadian terminal.');
}

function listen(instance, id) {
  const events = [];
  const unsubscribe = instance.subscribe(id, (event) => events.push(event));
  return {
    events,
    unsubscribe,
    text: () => events.filter((event) => event.type === 'output').map((event) => event.data).join(''),
    exited: () => events.some((event) => event.type === 'exit'),
  };
}

const statusOf = (promise) => promise.then(() => 'resolved').catch((error) => error.status);

afterEach(() => {
  for (const instance of hubs.splice(0)) instance.closeAll();
});

describe('shell detection', () => {
  it('hanya mengembalikan shell yang benar-benar ada di mesin ini', async () => {
    const shells = await detectShells();
    expect(Array.isArray(shells)).toBe(true);
    expect(shells.length).toBeGreaterThan(0);
    for (const shell of shells) {
      expect(shell.label).toBeTruthy();
      await expect(fs.stat(shell.file)).resolves.toBeTruthy();
    }
  });

  it('memakai daftar shell yang disuntik tanpa menyentuh PATH', async () => {
    const instance = hub({ shells: [{ id: 'x', label: 'X', file: 'y', args: [] }] });
    await expect(instance.listShells()).resolves.toEqual([{ id: 'x', label: 'X', file: 'y', args: [] }]);
  });
});

describe('terminal sessions', () => {
  it('menjalankan shell dan mengirim isi bahkan ke subscriber yang terlambat', async () => {
    const dir = workDir;
    const instance = nodeHub('console.log("hai dari shell");');
    const session = await instance.start({ shell: 'node', cwd: dir });

    expect(session).toMatchObject({ id: 't1', shell: 'node', label: 'Node', alive: true });
    expect(session.pid).toBeTypeOf('number');

    const sink = listen(instance, session.id);
    await waitFor(sink.exited);
    expect(sink.text()).toContain('hai dari shell');
    expect(sink.events.at(-1)).toEqual({ type: 'exit', id: 't1', code: 0 });
    sink.unsubscribe();
  });

  it('memakai shell pertama ketika id tidak cocok dan menolak folder kerja yang hilang', async () => {
    const dir = workDir;
    const instance = nodeHub('console.log(1)');
    await expect(instance.start({ shell: 'entah', cwd: dir })).resolves.toMatchObject({ shell: 'node' });
    await expect(statusOf(instance.start({ cwd: path.join(dir, 'tidak-ada') }))).resolves.toBe(400);
  });

  it('meneruskan ketikan ke stdin shell', async () => {
    const dir = workDir;
    const instance = nodeHub('process.stdin.on("data", (d) => process.stdout.write("echo:" + d));');
    const session = await instance.start({ shell: 'node', cwd: dir });
    const sink = listen(instance, session.id);

    expect(instance.write(session.id, 'halo\r')).toEqual({ ok: true, alive: true });
    await waitFor(() => sink.text().includes('echo:halo'));
    sink.unsubscribe();
    instance.close(session.id);
  });

  it('menggabungkan stderr ke aliran PTY dan menandai keluar dengan kode bukan nol', async () => {
    const dir = workDir;
    const instance = nodeHub('console.error("gagal"); process.exit(3);');
    const session = await instance.start({ shell: 'node', cwd: dir });
    const sink = listen(instance, session.id);

    await waitFor(sink.exited);
    expect(sink.text()).toContain('gagal');
    expect(sink.events.at(-1).code).toBe(3);
    expect(instance.list()[0]).toMatchObject({ id: 't1', alive: false, exitCode: 3 });
    sink.unsubscribe();
  });

  it('meneruskan ukuran xterm ke PTY dan menolak ukuran tidak sah', async () => {
    const dir = workDir;
    const instance = nodeHub('setInterval(() => {}, 1000)');
    const session = await instance.start({ shell: 'node', cwd: dir });

    expect(instance.resize(session.id, 120, 30)).toEqual({ ok: true });
    expect(await statusOf(Promise.resolve().then(() => instance.resize(session.id, 0, 30)))).toBe(400);
    instance.close(session.id);
  });

  it('menolak tulisan setelah shell selesai dan menutup sesi secara permanen', async () => {
    const dir = workDir;
    const instance = nodeHub('console.log("selesai")');
    const session = await instance.start({ shell: 'node', cwd: dir });
    const sink = listen(instance, session.id);
    await waitFor(sink.exited);
    sink.unsubscribe();

    expect(await statusOf(Promise.resolve().then(() => instance.write(session.id, 'x')))).toBe(409);

    await instance.close(session.id);
    expect(instance.list()).toEqual([]);
    expect(await statusOf(Promise.resolve().then(() => instance.get(session.id)))).toBe(404);
    expect(await statusOf(Promise.resolve().then(() => instance.close(session.id)))).toBe(404);
  });

  it('mematikan proses shell saat sesi ditutup', async () => {
    const dir = workDir;
    const instance = nodeHub('setInterval(() => {}, 1000)');
    const session = await instance.start({ shell: 'node', cwd: dir });
    const child = instance.get(session.id).child;
    let killed = false;
    child.onExit(() => {
      killed = true;
    });

    await instance.close(session.id);
    await waitFor(() => killed);
    expect(instance.list()).toEqual([]);
  });

  it('membatasi jumlah terminal yang hidup sekaligus', async () => {
    const dir = workDir;
    const instance = nodeHub('setTimeout(() => {}, 60000)');
    for (let index = 0; index < 6; index += 1) {
      await instance.start({ shell: 'node', cwd: dir });
    }
    expect(await statusOf(instance.start({ shell: 'node', cwd: dir }))).toBe(409);

    // Sesi yang sudah selesai tidak memakan jatah.
    const finished = nodeHub('console.log("ok")');
    const done = await finished.start({ shell: 'node', cwd: dir });
    const sink = listen(finished, done.id);
    await waitFor(sink.exited);
    sink.unsubscribe();
    await finished.close(done.id);
    expect(finished.list()).toEqual([]);
  });

  it('membuang kepala buffer yang tumbuh tanpa ada subscriber', async () => {
    const dir = workDir;
    const instance = nodeHub('for (let i = 0; i < 4000; i++) console.log("x".repeat(200))');
    const session = await instance.start({ shell: 'node', cwd: dir });
    await waitFor(() => instance.get(session.id).exited);

    // Subscriber pertama hanya boleh mendapat ekor yang masih muat di buffer.
    const sink = listen(instance, session.id);
    expect(sink.text().length).toBeLessThan(140_000);
    expect(sink.text()).toContain('xxxx');
    sink.unsubscribe();
  });
});

describe('environment shell', () => {
  const machineTable = [
    'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
    '    Path    REG_EXPAND_SZ    C:\\Windows\\system32;C:\\Windows',
    '    ComSpec    REG_SZ    C:\\Windows\\system32\\cmd.exe',
    '',
  ].join('\r\n');
  const userTable = [
    'HKEY_CURRENT_USER\\Environment',
    '    Path    REG_EXPAND_SZ    %USERPROFILE%\\App\\Local\\Programs;C:\\Windows\\system32',
    '    PREFERRED_DOMAIN    REG_SZ    example',
    '',
  ].join('\r\n');

  /** Child palsu: yang penting bentuknya seperti IPty, tidak ada proses nyata. */
  function spawnHub(options) {
    const captures = [];
    const instance = hub({
      env: {
        PATH: 'C:\\Program Files\\Git\\usr\\bin;C:\\Windows',
        MSYSTEM: 'MINGW64',
        USERPROFILE: 'C:\\Users\\test',
        SystemRoot: 'C:\\Windows',
      },
      shells: [{ id: 'fake', label: 'Fake Shell', file: 'fake.exe', args: [] }],
      spawner: (file, args, spawnOptions) => {
        captures.push(spawnOptions.env);
        return {
          pid: 4242,
          onData() {},
          onExit() {},
          write() {},
          resize() {},
          kill() {},
        };
      },
      ...options,
    });
    return { instance, captures };
  }

  it('menyusun PATH dari registry supaya cmd tidak mewarisi coreutils Git Bash', async () => {
    const { instance, captures } = spawnHub({
      platform: 'win32',
      registry: (key) => Promise.resolve(key.includes('HKLM') ? machineTable : userTable),
    });
    const session = await instance.start({ cwd: workDir });

    expect(session.nativePath).toBe(true);
    const env = captures[0];
    // Machine dulu, lalu User, duplikat dibuang, %USERPROFILE% sudah dikembangkan.
    expect(env.Path).toBe('C:\\Windows\\system32;C:\\Windows;C:\\Users\\test\\App\\Local\\Programs');
    expect(env.PATH).toBeUndefined();
    expect(env.MSYSTEM).toBeUndefined();
    expect(env.ComSpec).toBe('C:\\Windows\\system32\\cmd.exe');
    expect(env.PREFERRED_DOMAIN).toBe('example');
    expect(env.TERM).toBeUndefined();
  });

  it('mewarisi PATH server kalau registry tidak terbaca', async () => {
    const { instance, captures } = spawnHub({
      platform: 'win32',
      registry: () => Promise.reject(new Error('reg tidak ada')),
    });
    const session = await instance.start({ cwd: workDir });

    expect(session.nativePath).toBe(false);
    expect(captures[0].PATH).toContain('Git\\usr\\bin');
  });

  it('di POSIX tidak menyentuh registry dan TERM tetap dipasang', async () => {
    const calls = [];
    const { instance, captures } = spawnHub({
      platform: 'linux',
      registry: () => {
        calls.push(1);
        return Promise.resolve('');
      },
    });
    const session = await instance.start({ cwd: workDir });

    expect(session.nativePath).toBe(false);
    expect(captures[0].TERM).toBe('xterm-256color');
    expect(calls).toEqual([]);
  });
});
