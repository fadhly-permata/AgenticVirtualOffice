import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError, readJson, sendError, sendJson } from './http.mjs';
import {
  buildAgentList,
  buildModelCatalog,
  buildSessionList,
  OpenCodeBridge,
} from './opencode.mjs';
import { browseDirectory, WorkspaceStore } from './workspace.mjs';

const APP_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST_DIR = path.join(APP_DIR, 'dist');
const argv = process.argv.slice(2);
const isDev = argv.includes('--dev');
const portFlag = argv.indexOf('--port');
// Jauh dari 5173/4173 supaya Vite yang lupa dimatikan tidak bisa menyamar jadi bridge ini.
const PORT = Number(process.env.PORT ?? (portFlag >= 0 ? argv[portFlag + 1] : isDev ? 5199 : 4180));
const HOST = process.env.HOST ?? '127.0.0.1';

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const store = new WorkspaceStore(APP_DIR);
const bridge = new OpenCodeBridge({ cwd: APP_DIR });

function workspaceOrThrow() {
  const { workspace } = store.snapshot();
  if (!workspace) throw new HttpError(400, 'Belum ada workspace yang dibuka.');
  return workspace.path;
}

function sessionId(value) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new HttpError(400, 'ID sesi tidak valid.');
  return value;
}

function requestId(value) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new HttpError(400, 'ID permintaan tidak valid.');
  return value;
}

const catalogCache = new Map();

async function loadModelCatalog(directory) {
  const cached = catalogCache.get(directory);
  if (cached?.data && Date.now() - cached.at < 5 * 60_000) return cached.data;
  if (cached?.promise) return cached.promise;

  const promise = Promise.all([
    bridge.request('/provider', { query: { directory } }),
    bridge.request('/config', { query: { directory } }),
  ])
    .then(([providers, config]) => {
      const data = buildModelCatalog(providers, config);
      catalogCache.set(directory, { at: Date.now(), data, promise: null });
      return data;
    })
    .catch((error) => {
      catalogCache.delete(directory);
      throw error;
    });

  catalogCache.set(directory, { at: 0, data: null, promise });
  return promise;
}

function warmChat() {
  const { workspace } = store.snapshot();
  if (!workspace) return;
  loadModelCatalog(workspace.path).catch(() => undefined);
}

async function streamEvents(req, res) {
  const directory = workspaceOrThrow();
  const upstream = await bridge.openEventStream(directory);

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.flushHeaders?.();

  const reader = upstream.stream.getReader();
  let closed = false;
  const heartbeat = setInterval(() => {
    if (!closed) res.write(': keep-alive\n\n');
  }, 15_000);

  const stop = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    upstream.abort();
    reader.cancel().catch(() => undefined);
  };

  res.on('close', stop);
  req.on('error', stop);

  try {
    while (!closed) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } catch (error) {
    if (!closed && !res.writableEnded) {
      const payload = JSON.stringify({
        type: 'bridge.error',
        properties: { message: `Koneksi event terputus: ${error.message}` },
      });
      res.write(`data: ${payload}\n\n`);
    }
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
}

async function handleApi(req, res, url) {
  const { pathname, searchParams } = url;
  const method = req.method ?? 'GET';

  if (pathname === '/api/health' && method === 'GET') {
    return sendJson(res, 200, { ok: true, opencode: bridge.running ? 'running' : 'stopped', dev: isDev });
  }

  if (pathname === '/api/workspace' && method === 'GET') {
    warmChat();
    return sendJson(res, 200, store.snapshot());
  }

  if (pathname === '/api/workspace' && method === 'POST') {
    const body = await readJson(req);
    const snapshot = await store.open(body.path);
    warmChat();
    return sendJson(res, 200, snapshot);
  }

  if (pathname === '/api/workspace/browse' && method === 'GET') {
    return sendJson(res, 200, await browseDirectory(searchParams.get('path')));
  }

  if (pathname === '/api/chat/bootstrap' && method === 'GET') {
    const directory = workspaceOrThrow();
    const query = { directory };
    const [catalog, agents, sessions] = await Promise.all([
      loadModelCatalog(directory),
      bridge.request('/agent', { query }),
      bridge.request('/session', { query }).catch(() => []),
    ]);
    return sendJson(res, 200, {
      workspace: store.snapshot().workspace,
      models: catalog.groups,
      defaultModel: catalog.defaultModel,
      agents: buildAgentList(agents),
      sessions: buildSessionList(sessions),
    });
  }

  if (pathname === '/api/chat/sessions' && method === 'POST') {
    const directory = workspaceOrThrow();
    const body = await readJson(req);
    const payload = typeof body.title === 'string' && body.title.trim() ? { title: body.title.trim() } : {};
    const created = await bridge.request('/session', { method: 'POST', query: { directory }, body: payload });
    return sendJson(res, 201, buildSessionList([created])[0]);
  }

  const sessionMatch = pathname.match(/^\/api\/chat\/sessions\/([^/]+)(\/messages|\/abort)?$/);
  if (sessionMatch) {
    const id = sessionId(sessionMatch[1]);
    const action = sessionMatch[2] ?? '';
    const directory = workspaceOrThrow();

    if (!action && method === 'GET') {
      const query = { directory };
      const [messages, statuses, permissions, questions] = await Promise.all([
        bridge.request(`/session/${id}/message`, { query }),
        bridge.request('/session/status', { query }).catch(() => ({})),
        bridge.request('/permission', { query }).catch(() => []),
        bridge.request('/question', { query }).catch(() => []),
      ]);
      const relevant = (items) =>
        Array.isArray(items) ? items.filter((item) => item && item.sessionID === id) : [];
      return sendJson(res, 200, {
        messages: Array.isArray(messages) ? messages : [],
        status: statuses?.[id] ?? { type: 'idle' },
        permissions: relevant(permissions),
        questions: relevant(questions),
      });
    }

    if (action === '/messages' && method === 'POST') {
      const body = await readJson(req);
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text) throw new HttpError(400, 'Pesan tidak boleh kosong.');
      if (text.length > 20_000) throw new HttpError(400, 'Pesan terlalu panjang (maks 20.000 karakter).');

      const payload = { parts: [{ type: 'text', text }] };
      if (body.model && typeof body.model.providerID === 'string' && typeof body.model.modelID === 'string') {
        payload.model = { providerID: body.model.providerID, modelID: body.model.modelID };
      }
      if (typeof body.agent === 'string' && body.agent.trim()) payload.agent = body.agent.trim();

      await bridge.request(`/session/${id}/prompt_async`, {
        method: 'POST',
        query: { directory },
        body: payload,
      });
      return sendJson(res, 202, { ok: true });
    }

    if (action === '/abort' && method === 'POST') {
      await bridge.request(`/session/${id}/abort`, { method: 'POST', query: { directory } });
      return sendJson(res, 200, { ok: true });
    }
  }

  if (pathname === '/api/chat/events' && method === 'GET') {
    return streamEvents(req, res);
  }

  const permissionMatch = pathname.match(/^\/api\/chat\/permissions\/([^/]+)$/);
  if (permissionMatch && method === 'POST') {
    const id = requestId(permissionMatch[1]);
    const directory = workspaceOrThrow();
    const body = await readJson(req);
    if (!['once', 'always', 'reject'].includes(body.reply)) {
      throw new HttpError(400, 'Jawaban izin harus once, always, atau reject.');
    }
    await bridge.request(`/permission/${id}/reply`, {
      method: 'POST',
      query: { directory },
      body: { reply: body.reply, ...(typeof body.message === 'string' ? { message: body.message } : {}) },
    });
    return sendJson(res, 200, { ok: true });
  }

  const questionMatch = pathname.match(/^\/api\/chat\/questions\/([^/]+)$/);
  if (questionMatch && method === 'POST') {
    const id = requestId(questionMatch[1]);
    const directory = workspaceOrThrow();
    const body = await readJson(req);
    if (
      !Array.isArray(body.answers) ||
      !body.answers.every((answer) => Array.isArray(answer) && answer.every((value) => typeof value === 'string'))
    ) {
      throw new HttpError(400, 'Format jawaban tidak valid.');
    }
    await bridge.request(`/question/${id}/reply`, {
      method: 'POST',
      query: { directory },
      body: { answers: body.answers },
    });
    return sendJson(res, 200, { ok: true });
  }

  throw new HttpError(404, 'Endpoint tidak ditemukan.');
}

async function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }

  let file = path.resolve(DIST_DIR, `.${decoded === '/' ? '/index.html' : decoded}`);
  if (!file.toLowerCase().startsWith(DIST_DIR.toLowerCase())) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const stat = await fs.stat(file);
    if (stat.isDirectory()) file = path.join(file, 'index.html');
  } catch {
    file = path.join(DIST_DIR, 'index.html');
  }

  try {
    const data = await fs.stat(file);
    if (!data.isFile()) throw new Error('not a file');
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Build belum tersedia. Jalankan npm run build terlebih dahulu.');
    return;
  }

  res.writeHead(200, {
    'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': (await fs.stat(file)).size,
  });
  createReadStream(file).pipe(res);
}

async function main() {
  await store.load();

  let vite = null;
  if (isDev) {
    const { createServer: createViteServer } = await import('vite');
    const serverRef = http.createServer();
    vite = await createViteServer({
      server: { middlewareMode: true, hmr: { server: serverRef } },
      appType: 'spa',
    });
    serverRef.removeAllListeners('request');
    serverRef.on('request', (req, res) => route(req, res, vite));
    serveLoopback(serverRef);
    wireShutdown(serverRef);
    return;
  }

  const server = http.createServer((req, res) => route(req, res, null));
  serveLoopback(server);
  wireShutdown(server);
}

// Windows bisa memecah localhost menjadi ::1 sementara server ini hanya memegang
// 127.0.0.1, sehingga browser habisnya ke Vite lama yang tidak punya /api/*.
function serveLoopback(server) {
  server.on('error', (error) => {
    console.error(
      error?.code === 'EADDRINUSE'
        ? `Port ${PORT} sudah dipakai proses lain. Hentikan server lama atau jalankan ulang dengan --port ${PORT + 1}.`
        : `Server gagal berjalan: ${error instanceof Error ? error.message : String(error)}`
    );
    bridge.stop();
    process.exit(1);
  });

  server.listen(PORT, HOST, () => {
    logReady();
    void warnForeignLoopback();
  });
}

async function warnForeignLoopback() {
  if (HOST !== '127.0.0.1') return;
  try {
    const response = await fetch(`http://[::1]:${PORT}/api/workspace`, { signal: AbortSignal.timeout(1_500) });
    const body = (await response.text()).trim();
    if (body.startsWith('{')) return;
  } catch {
    return;
  }
  console.warn(
    `Proses lain (kemungkinan Vite yang belum mati) sudah menjawab http://[::1]:${PORT}, ` +
      `jadi http://localhost:${PORT} bisa salah server. Cari dengan: netstat -ano | findstr :${PORT}`
  );
}

function route(req, res, vite) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((error) => {
      if (res.headersSent) {
        if (!res.writableEnded) res.end();
        return;
      }
      sendError(res, error);
    });
    return;
  }

  if (vite) {
    vite.middlewares(req, res, () => {
      if (!res.writableEnded) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Not found');
      }
    });
    return;
  }

  serveStatic(req, res, url.pathname).catch((error) => {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    if (!res.writableEnded) res.end(error instanceof Error ? error.message : String(error));
  });
}

let readyLogged = false;
function logReady() {
  if (readyLogged) return;
  readyLogged = true;
  const mode = isDev ? 'dev' : 'production';
  console.log(`VirtOffice ${mode} server berjalan di http://${HOST}:${PORT}`);
  console.log(`Buka di browser: http://localhost:${PORT} (sama saja dengan http://${HOST}:${PORT}).`);
  if (!isDev) console.log('Menyajikan hasil build dari dist/. Jalankan npm run build jika baru diubah.');
}

function wireShutdown(server) {
  const shutdown = () => {
    bridge.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1_500).unref();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.once('exit', () => bridge.stop());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  bridge.stop();
  process.exit(1);
});
