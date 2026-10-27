import { spawn } from 'node:child_process';
import { HttpError } from './http.mjs';

const START_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 60_000;
const EVENT_TIMEOUT_MS = 40_000;
const ATTACH_PROBE_TIMEOUT_MS = 1_500;
const HIDDEN_AGENTS = new Set(['compaction', 'summary', 'title']);

export function readableError(text) {
  if (!text) return 'OpenCode menolak permintaan.';
  try {
    const payload = JSON.parse(text);
    return (
      payload?.data?.message ||
      payload?.data?.error ||
      payload?.message ||
      payload?.error ||
      payload?.title ||
      text.slice(0, 600)
    );
  } catch {
    return text.slice(0, 600);
  }
}

function supportsChat(model) {
  const caps = model?.capabilities;
  if (!caps) return true;
  if (caps.toolcall === false) return false;
  if (caps.output?.text === false) return false;
  return true;
}

export function buildModelCatalog(providerPayload, config = {}) {
  const all = Array.isArray(providerPayload?.all) ? providerPayload.all : [];
  const connected = new Set(Array.isArray(providerPayload?.connected) ? providerPayload.connected : []);

  const groups = [];
  for (const provider of all) {
    if (!connected.has(provider?.id)) continue;
    const models = Object.values(provider.models ?? {})
      .filter((model) => model && typeof model.id === 'string' && supportsChat(model))
      .map((model) => ({
        id: model.id,
        name: model.name || model.id,
        providerID: provider.id,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    if (!models.length) continue;
    groups.push({
      providerID: provider.id,
      name: provider.name || provider.id,
      models,
    });
  }

  let defaultModel = null;
  if (typeof config.model === 'string' && config.model.includes('/')) {
    const split = config.model.indexOf('/');
    const providerID = config.model.slice(0, split);
    const modelID = config.model.slice(split + 1);
    defaultModel = groups.some(
      (group) => group.providerID === providerID && group.models.some((model) => model.id === modelID)
    )
      ? { providerID, modelID }
      : null;
  }
  if (!defaultModel) {
    const first = groups.find((group) => group.models.length);
    if (first) defaultModel = { providerID: first.providerID, modelID: first.models[0].id };
  }

  groups.sort((a, b) => {
    if (defaultModel) {
      if (a.providerID === defaultModel.providerID) return -1;
      if (b.providerID === defaultModel.providerID) return 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  return { groups, defaultModel };
}

export function buildAgentList(agents) {
  if (!Array.isArray(agents)) return [];
  return agents
    .filter((agent) => agent?.mode === 'primary' && !HIDDEN_AGENTS.has(agent.name))
    .map((agent) => ({
      name: agent.name,
      description: typeof agent.description === 'string' ? agent.description.trim() : '',
    }))
    .sort((a, b) => {
      const rank = (name) => (name === 'build' ? 0 : name === 'plan' ? 1 : 2);
      return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name);
    });
}

/**
 * Every agent the workspace declares, primary and subagent alike — the office
 * floor puts one employee per entry here. `hidden` flags OpenCode's own
 * housekeeping agents, which have no business being people.
 */
export function buildAgentRoster(agents) {
  if (!Array.isArray(agents)) return [];
  return agents
    .filter((agent) => typeof agent?.name === 'string' && !agent.hidden && !HIDDEN_AGENTS.has(agent.name))
    .map((agent) => ({
      name: agent.name,
      mode: agent.mode === 'subagent' ? 'subagent' : 'primary',
      description: typeof agent.description === 'string' ? agent.description.trim() : '',
    }))
    .sort((a, b) => {
      if (a.mode !== b.mode) return a.mode === 'primary' ? -1 : 1;
      const rank = (name) => (name === 'build' ? 0 : name === 'plan' ? 1 : 2);
      return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name);
    });
}

export function buildSessionList(sessions) {
  if (!Array.isArray(sessions)) return [];
  const mapped = sessions
    .filter((session) => session && typeof session.id === 'string')
    .map((session) => ({
      id: session.id,
      title: typeof session.title === 'string' && session.title.trim() ? session.title : 'Sesi tanpa judul',
      created: session.time?.created ?? 0,
      updated: session.time?.updated ?? session.time?.created ?? 0,
      agent: typeof session.agent === 'string' ? session.agent : null,
      parentID: typeof session.parentID === 'string' && session.parentID ? session.parentID : null,
    }))
    .sort((a, b) => b.updated - a.updated);

  const kept = mapped.slice(0, 40);
  // Sesi induk sering tidak di-update selama subagent bekerja, jadi jangan sampai
  // ia terpotong: presence butuh relasi induk-anak untuk tahu siapa mendelegasi.
  const seen = new Set(kept.map((session) => session.id));
  const parents = new Set(kept.map((session) => session.parentID).filter(Boolean));
  for (const session of mapped) {
    if (parents.delete(session.id) && !seen.has(session.id)) {
      seen.add(session.id);
      kept.push(session);
    }
  }
  return kept.sort((a, b) => b.updated - a.updated);
}

const ACTIVITY_DETAIL = 160;

function oneLine(text) {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
}

/** Keep the end of a stream: that is what the model is saying right now. */
function tail(text, limit = ACTIVITY_DETAIL) {
  const line = oneLine(text);
  if (line.length <= limit) return line;
  return `…${line.slice(-limit)}`;
}

/**
 * The shortest honest answer to "what is this session doing": the running tool,
 * the tail of live reasoning, or the tail of the answer being written. Only the
 * last assistant message is read and every string is clipped, so the office can
 * poll this for several sessions without shipping whole histories.
 */
export function buildSessionActivity(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const last = [...list].reverse().find((entry) => entry?.info?.role === 'assistant');
  const parts = Array.isArray(last?.parts) ? last.parts : [];

  const running = parts.find(
    (part) => part?.type === 'tool' && (part.state?.status === 'running' || part.state?.status === 'pending')
  );
  if (running) {
    return {
      phase: 'tool',
      tool: typeof running.tool === 'string' ? running.tool : null,
      detail: oneLine(running.state?.title).slice(0, ACTIVITY_DETAIL),
    };
  }

  const thinking = parts.filter((part) => part?.type === 'reasoning' && typeof part.time?.end !== 'number');
  if (thinking.length) return { phase: 'think', tool: null, detail: tail(thinking[thinking.length - 1].text) };

  const answered = parts.filter((part) => part?.type === 'text' && oneLine(part.text));
  if (answered.length) return { phase: 'write', tool: null, detail: tail(answered[answered.length - 1].text) };

  if (parts.some((part) => part?.type === 'reasoning')) return { phase: 'write', tool: null, detail: '' };
  return { phase: 'prepare', tool: null, detail: '' };
}

export class OpenCodeBridge {
  #cwd;
  #child = null;
  #baseUrl = null;
  #starting = null;

  constructor({ cwd }) {
    this.#cwd = cwd;
  }

  get running() {
    return Boolean(this.#baseUrl);
  }

  get url() {
    return this.#baseUrl;
  }

  async ensure() {
    if (this.#baseUrl) return this.#baseUrl;
    if (this.#starting) return this.#starting;
    this.#starting = this.#start().catch((error) => {
      this.#starting = null;
      throw error;
    });
    return this.#starting;
  }

  /**
   * OpenCode keeps one shared session store, so a second `opencode serve` on the
   * same project aborts the runs of the first. Attach to a server that is already
   * up before spawning our own.
   */
  async #attachExisting() {
    const candidates = [
      process.env.VIRTOFFICE_OPENCODE_URL,
      process.env.OPENCODE_BASE_URL,
      'http://127.0.0.1:4096',
    ].filter((url) => typeof url === 'string' && url.trim());

    for (const candidate of candidates) {
      const base = candidate.replace(/\/+$/, '');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ATTACH_PROBE_TIMEOUT_MS);
      try {
        const response = await fetch(`${base}/global/health`, { signal: controller.signal });
        if (!response.ok) continue;
        const body = await response.json().catch(() => null);
        if (body && body.healthy === true) {
          this.#baseUrl = base;
          return base;
        }
      } catch {
        // Nothing listening there; fall through to the next candidate.
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  }

  async #start() {
    const attached = await this.#attachExisting();
    if (attached) return attached;
    return new Promise((resolve, reject) => {
      const useShell = process.platform === 'win32';
      const command = 'opencode serve --port 0 --hostname 127.0.0.1';
      const child = useShell
        ? spawn(command, { cwd: this.#cwd, shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
        : spawn('opencode', ['serve', '--port', '0', '--hostname', '127.0.0.1'], {
            cwd: this.#cwd,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: process.env,
          });

      this.#child = child;
      let output = '';
      let ready = false;

      const cleanup = () => {
        clearTimeout(timer);
        child.stdout?.off('data', onData);
        child.stderr?.off('data', onData);
      };

      const fail = (message) => {
        if (ready) return;
        cleanup();
        this.#child = null;
        this.#baseUrl = null;
        reject(new HttpError(502, message));
      };

      const onData = (chunk) => {
        output = (output + chunk.toString()).slice(-20_000);
        const match = output.match(/listening on\s+(http:\/\/[^\s]+)/i);
        if (!match) return;
        ready = true;
        this.#baseUrl = match[1].replace(/\/+$/, '');
        cleanup();
        resolve(this.#baseUrl);
      };

      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);

      const timer = setTimeout(() => {
        fail('OpenCode tidak merespons dalam 30 detik. Cek terminal untuk detail.');
        if (process.platform === 'win32' && child.pid) {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        } else {
          child.kill('SIGTERM');
        }
      }, START_TIMEOUT_MS);

      child.once('error', (error) => {
        fail(
          error.code === 'ENOENT'
            ? 'OpenCode CLI tidak ditemukan. Install dengan: npm i -g opencode-ai'
            : `Gagal menjalankan OpenCode: ${error.message}`
        );
      });

      child.once('exit', (code) => {
        const wasReady = ready;
        this.#child = null;
        this.#baseUrl = null;
        if (!wasReady) {
          const hint = /not recognized|not found|ENOENT/i.test(output)
            ? 'OpenCode CLI tidak ditemukan. Install dengan: npm i -g opencode-ai'
            : `OpenCode berhenti sebelum siap (exit ${code}). ${output.slice(-400)}`.trim();
          fail(hint);
        } else {
          this.#starting = null;
        }
      });
    });
  }

  async request(pathname, { method = 'GET', body, query } = {}) {
    const base = await this.ensure();
    const url = new URL(base + pathname);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new HttpError(
        502,
        error.name === 'AbortError'
          ? 'Permintaan ke OpenCode timeout.'
          : `Tidak dapat menghubungi OpenCode: ${error.message}`
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    if (!response.ok) {
      throw new HttpError(response.status >= 500 ? 502 : response.status, readableError(text));
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(502, 'OpenCode mengembalikan respons yang tidak valid.');
    }
  }

  async openEventStream(directory) {
    const base = await this.ensure();
    const url = new URL('/event', base);
    url.searchParams.set('directory', directory);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EVENT_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(url, {
        headers: { accept: 'text/event-stream' },
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      throw new HttpError(502, `Stream event OpenCode gagal: ${error.message}`);
    }
    clearTimeout(timer);

    if (!response.ok || !response.body) {
      controller.abort();
      throw new HttpError(502, 'Stream event OpenCode tidak tersedia.');
    }
    return {
      stream: response.body,
      abort: () => controller.abort(),
    };
  }

  stop() {
    const child = this.#child;
    this.#child = null;
    this.#baseUrl = null;
    this.#starting = null;
    if (!child?.pid) return;
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  }
}
