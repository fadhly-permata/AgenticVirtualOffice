import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HttpError } from './http.mjs';

const CLI = process.env.VIRTOFFICE_CLAUDE_BIN || 'claude';
const TITLE_LIMIT = 64;
const VERSION_TIMEOUT_MS = 10_000;
const ABORT_TIMEOUT_MS = 6_000;
const SUBAGENT_LINGER_MS = 8_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CLAUDE_MODELS = [
  { id: 'sonnet', name: 'Sonnet' },
  { id: 'opus', name: 'Opus' },
  { id: 'haiku', name: 'Haiku' },
  { id: 'fable', name: 'Fable' },
];

const BUILTIN_AGENTS = [
  { name: 'claude', mode: 'primary', description: 'Agen utama Claude Code.' },
  { name: 'Explore', mode: 'subagent', description: 'Penjelajah kode read-only.' },
  { name: 'general-purpose', mode: 'subagent', description: 'Subagent serba guna.' },
  { name: 'Plan', mode: 'subagent', description: 'Perancang implementasi.' },
];

const TOOL_NAMES = {
  Bash: 'bash',
  PowerShell: 'bash',
  Read: 'read',
  Write: 'write',
  Edit: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Glob: 'glob',
  Grep: 'grep',
  WebFetch: 'webfetch',
  WebSearch: 'websearch',
  Agent: 'task',
  Task: 'task',
  TodoWrite: 'todowrite',
  TodoRead: 'todoread',
};

/** Nama proyek di ~/.claude/projects: setiap karakter non-alfanumerik jadi '-'. */
export function claudeProjectSlug(directory) {
  return String(directory).replace(/[^a-zA-Z0-9]/g, '-');
}

function projectsRoot() {
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
}

export function projectDirectory(directory) {
  return path.join(projectsRoot(), claudeProjectSlug(directory));
}

export function normalizeTool(name) {
  return TOOL_NAMES[name] ?? String(name ?? '').toLowerCase();
}

export function toolTitle(name, input, root = '') {
  if (!input || typeof input !== 'object') return name ?? '';
  const pick = (value) => (typeof value === 'string' && value.trim() ? value.trim() : '');
  if (name === 'Bash' || name === 'PowerShell') return pick(input.command) || name;
  if (name === 'Read' || name === 'Write' || name === 'Edit' || name === 'MultiEdit' || name === 'NotebookEdit') {
    const file = pick(input.file_path) || pick(input.path) || pick(input.notebook_path);
    if (!file) return name;
    const flat = file.replace(/\\/g, '/');
    const base = String(root).replace(/\\/g, '/').replace(/\/+$/, '');
    const rel = base && flat.toLowerCase().startsWith(`${base.toLowerCase()}/`) ? flat.slice(base.length + 1) : '';
    return `${name} ${rel || path.basename(flat)}`;
  }
  if (name === 'Glob' || name === 'Grep') return pick(input.pattern) || name;
  if (name === 'WebFetch') return pick(input.url) || name;
  if (name === 'Agent' || name === 'Task') return pick(input.description) || pick(input.subagent_type) || name;
  return pick(input.description) || name;
}

function flattenResult(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

/** Satu blok tool_use Claude jadi part tool OpenCode yang dirender FE. */
export function toolPart(block, messageID, sessionID, at, root = '') {
  return {
    id: block.id,
    messageID,
    sessionID,
    type: 'tool',
    tool: normalizeTool(block.name),
    callID: block.id,
    state: {
      status: 'running',
      title: toolTitle(block.name, block.input, root),
      input: block.input ?? {},
      time: { start: at },
    },
  };
}

export function assistantParts(content, messageID, sessionID, at, root = '') {
  const parts = [];
  (Array.isArray(content) ? content : []).forEach((block, index) => {
    if (block?.type === 'text' && typeof block.text === 'string' && block.text) {
      parts.push({ id: `${messageID}:t${index}`, messageID, sessionID, type: 'text', text: block.text });
    } else if (block?.type === 'thinking' && typeof block.thinking === 'string' && block.thinking) {
      parts.push({
        id: `${messageID}:r${index}`,
        messageID,
        sessionID,
        type: 'reasoning',
        text: block.thinking,
        time: { start: at, end: at },
      });
    } else if (block?.type === 'tool_use') {
      parts.push(toolPart(block, messageID, sessionID, at, root));
    }
  });
  return parts;
}

/**
 * Transkrip JSONL Claude jadi message+parts OpenCode. Baris tool_result
 * ditempelkan ke part tool pasangannya, bukan jadi pesan user kosong.
 */
export function buildTranscriptMessages(entries, sessionID, root = '') {
  const messages = [];
  const byTool = new Map();
  for (const entry of entries) {
    if (!entry || entry.isSidechain) continue;
    if (entry.type !== 'user' && entry.type !== 'assistant') continue;
    const content = entry.message?.content;
    const at = Date.parse(entry.timestamp ?? '') || 0;
    const messageID = typeof entry.uuid === 'string' ? entry.uuid : `msg_${at}`;

    if (entry.type === 'assistant') {
      const parts = assistantParts(content, messageID, sessionID, at, root);
      if (!parts.length) continue;
      messages.push({
        info: { id: messageID, sessionID, role: 'assistant', time: { created: at, completed: at } },
        parts,
      });
      for (const part of parts) if (part.type === 'tool') byTool.set(part.callID, part);
      continue;
    }

    const blocks = Array.isArray(content) ? content : [];
    for (const block of blocks) {
      if (block?.type !== 'tool_result') continue;
      const part = byTool.get(block.tool_use_id);
      if (!part) continue;
      part.state = {
        ...part.state,
        status: block.is_error ? 'error' : 'completed',
        output: flattenResult(block.content),
        time: { ...part.state?.time, end: at },
      };
    }

    const texts = blocks.filter((block) => block?.type === 'text' && typeof block.text === 'string' && block.text.trim());
    if (!texts.length) continue;
    messages.push({
      info: { id: messageID, sessionID, role: 'user', time: { created: at, completed: at } },
      parts: texts.map((block, index) => ({
        id: `${messageID}:p${index}`,
        messageID,
        sessionID,
        type: 'text',
        text: block.text,
      })),
    });
  }

  for (const part of byTool.values()) {
    if (part.state?.status !== 'running') continue;
    part.state = { ...part.state, status: 'error', error: 'Tidak selesai.', time: { ...part.state?.time, end: Date.now() } };
  }

  return messages.sort((a, b) => a.info.time.created - b.info.time.created);
}

export function titleFromPrompt(text) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim();
  return line.length > TITLE_LIMIT ? `${line.slice(0, TITLE_LIMIT - 1)}…` : line;
}

export function parseAgentDoc(text, fallback) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text));
  const meta = {};
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
      if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
    }
  }
  return { name: meta.name || fallback, mode: 'primary', description: meta.description || '' };
}

/** Agen yang dideklarasikan workspace, ditambah built-in Claude Code. */
export async function readRoster(directory) {
  const agents = new Map(BUILTIN_AGENTS.map((agent) => [agent.name, { ...agent }]));
  const root = path.join(directory, '.claude', 'agents');
  const names = await fs.readdir(root).catch(() => []);
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    const text = await fs.readFile(path.join(root, name), 'utf8').catch(() => null);
    if (!text) continue;
    const entry = parseAgentDoc(text, name.slice(0, -3));
    if (entry.name && !agents.has(entry.name)) agents.set(entry.name, entry);
  }
  return [...agents.values()];
}

export function claudeProviderPayload() {
  return {
    all: [
      {
        id: 'claude',
        name: 'Claude Code',
        models: Object.fromEntries(
          CLAUDE_MODELS.map((model) => [model.id, { id: model.id, name: model.name, capabilities: { toolcall: true } }])
        ),
      },
    ],
    connected: ['claude'],
  };
}

export const CLAUDE_CONFIG = { model: 'claude/sonnet' };

function publicSession(session) {
  return {
    id: session.id,
    title: session.title,
    time: { created: session.created, updated: session.updated },
    agent: session.agent ?? null,
    parentID: session.parentID ?? null,
  };
}

function publicPermission(pending) {
  return {
    id: pending.id,
    sessionID: pending.sessionID,
    permission: pending.permission,
    action: pending.permission,
    patterns: pending.patterns,
    always: [],
    metadata: pending.metadata,
  };
}

async function readHead(file, limit) {
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(limit);
    const { bytesRead } = await handle.read(buffer, 0, limit, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

function summaryFromHead(text) {
  let created = 0;
  let title = '';
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!created && typeof entry.timestamp === 'string') created = Date.parse(entry.timestamp) || 0;
    if (!title && entry.type === 'user' && !entry.isSidechain) {
      const content = entry.message?.content;
      const block = (Array.isArray(content) ? content : []).find(
        (item) => item?.type === 'text' && typeof item.text === 'string' && item.text.trim()
      );
      if (block) title = titleFromPrompt(block.text);
    }
    if (created && title) break;
  }
  return { created, title };
}

function cliEnv() {
  const env = { ...process.env };
  // Kunci API yang basi menang atas login claude.ai dan membuat CLI menolak semua run.
  delete env.ANTHROPIC_API_KEY;
  return env;
}

function parseLines(chunk, onLine) {
  let buffer = '';
  return {
    push(text) {
      buffer += text;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) onLine(line);
      }
    },
    flush() {
      if (buffer.trim()) onLine(buffer.trim());
      buffer = '';
    },
  };
}

function parseJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export class ClaudeBridge {
  #cwd;
  #sessions = new Map();
  #subscribers = new Set();
  #transcripts = new Map();
  #roster = new Map();
  #version = null;
  #versionPromise = null;

  constructor({ cwd }) {
    this.#cwd = cwd;
  }

  get running() {
    return Boolean(this.#version);
  }

  get url() {
    return null;
  }

  get tool() {
    return 'claude';
  }

  async ensure() {
    if (this.#version) return;
    this.#versionPromise ??= new Promise((resolve, reject) => {
      const child = spawn(CLI, ['--version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: cliEnv() });
      let output = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new HttpError(502, 'Claude Code tidak merespons. Cek instalasinya.'));
      }, VERSION_TIMEOUT_MS);
      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(
          new HttpError(
            502,
            error.code === 'ENOENT'
              ? 'Claude Code CLI tidak ditemukan. Install dengan: npm i -g @anthropic-ai/claude-code'
              : `Gagal menjalankan Claude Code: ${error.message}`
          )
        );
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new HttpError(502, `Claude Code menolak dijalankan (exit ${code}).`));
          return;
        }
        this.#version = output.trim();
        resolve();
      });
    }).catch((error) => {
      this.#versionPromise = null;
      throw error;
    });
    return this.#versionPromise;
  }

  async request(pathname, { method = 'GET', body, query } = {}) {
    const directory = typeof query?.directory === 'string' && query.directory ? query.directory : this.#cwd;

    if (pathname === '/provider' && method === 'GET') return claudeProviderPayload();
    if (pathname === '/config' && method === 'GET') return CLAUDE_CONFIG;
    if (pathname === '/agent' && method === 'GET') return this.#rosterFor(directory);
    if (pathname === '/question' && method === 'GET') return [];

    const permissionMatch = /^\/permission\/([^/]+)\/reply$/.exec(pathname);
    if (permissionMatch && method === 'POST') {
      return this.#replyPermission(permissionMatch[1], body?.reply);
    }
    if (pathname === '/permission' && method === 'GET') return this.#pendingPermissions();
    if (pathname === '/session/status' && method === 'GET') return this.#statuses();

    if (pathname === '/session' && method === 'GET') return this.#listSessions(directory);
    if (pathname === '/session' && method === 'POST') return this.#createSession(directory, body?.title);

    const match = /^\/session\/([^/]+)(\/message|\/prompt_async|\/abort)?$/.exec(pathname);
    if (match) {
      const id = match[1];
      const action = match[2] ?? '';
      if ((!action || action === '/message') && method === 'GET') return this.#messages(id, directory);
      if (action === '/prompt_async' && method === 'POST') {
        await this.#prompt(id, directory, body ?? {});
        return null;
      }
      if (action === '/abort' && method === 'POST') {
        this.#abort(id);
        return null;
      }
    }

    throw new HttpError(404, 'Endpoint tidak ditemukan.');
  }

  async openEventStream(directory) {
    const encoder = new TextEncoder();
    let detach = () => {};
    const stream = new ReadableStream({
      start: (controller) => {
        const send = (data) => {
          try {
            controller.enqueue(encoder.encode(data));
          } catch {
            this.#subscribers.delete(send);
          }
        };
        this.#subscribers.add(send);
        detach = () => {
          this.#subscribers.delete(send);
          try {
            controller.close();
          } catch {
            // Sudah ditutup konsumen.
          }
        };
        send(': connected\n\n');
      },
      cancel: () => detach(),
    });
    return { stream, abort: () => detach() };
  }

  #emit(event) {
    if (!this.#subscribers.size) return;
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const send of this.#subscribers) send(payload);
  }

  async #rosterFor(directory) {
    let roster = this.#roster.get(directory);
    if (!roster) {
      roster = await readRoster(directory);
      this.#roster.set(directory, roster);
    }
    return roster.map((agent) => ({ ...agent }));
  }

  #mergeRoster(directory, names) {
    if (!Array.isArray(names) || !names.length) return;
    let roster = this.#roster.get(directory);
    if (!roster) {
      roster = BUILTIN_AGENTS.map((agent) => ({ ...agent }));
      this.#roster.set(directory, roster);
    }
    const known = new Set(roster.map((agent) => agent.name));
    for (const name of names) {
      if (typeof name !== 'string' || !name || known.has(name)) continue;
      roster.push({ name, mode: name === 'claude' ? 'primary' : 'subagent', description: '' });
      known.add(name);
    }
  }

  #createSession(directory, title) {
    const now = Date.now();
    const session = this.#makeSession({
      id: crypto.randomUUID(),
      directory,
      title: typeof title === 'string' ? title.trim() : '',
      created: now,
      updated: now,
    });
    return publicSession(session);
  }

  #makeSession({ id, directory, title = '', created = Date.now(), updated = created, agent = null, parentID = null, synthetic = false }) {
    const session = {
      id,
      directory,
      title,
      created,
      updated,
      agent,
      parentID,
      synthetic,
      busy: false,
      aborting: false,
      child: null,
      model: 'sonnet',
      messages: [],
      parts: new Map(),
      permissions: new Map(),
      subagents: new Map(),
      stderr: '',
      abortTimer: null,
      lingerTimer: null,
    };
    this.#sessions.set(id, session);
    return session;
  }

  async #hydrate(id, directory) {
    const existing = this.#sessions.get(id);
    if (existing) {
      existing.directory = directory;
      return existing;
    }
    const file = path.join(projectDirectory(directory), `${id}.jsonl`);
    const stat = await fs.stat(file).catch(() => null);
    const head = stat ? summaryFromHead(await readHead(file, 48_000)) : { created: 0, title: '' };
    return this.#makeSession({
      id,
      directory,
      title: head.title,
      created: head.created || stat?.birthtimeMs || Date.now(),
      updated: stat?.mtimeMs || Date.now(),
    });
  }

  async #listSessions(directory) {
    const sessions = new Map();
    for (const session of this.#sessions.values()) {
      if (session.directory !== directory) continue;
      sessions.set(session.id, publicSession(session));
    }

    const dir = projectDirectory(directory);
    const names = await fs.readdir(dir).catch(() => []);
    await Promise.all(
      names
        .filter((name) => name.endsWith('.jsonl') && UUID_RE.test(name.slice(0, -6)))
        .map(async (name) => {
          const id = name.slice(0, -6);
          if (sessions.has(id)) return;
          const file = path.join(dir, name);
          const stat = await fs.stat(file).catch(() => null);
          if (!stat || !stat.size) return;
          const cached = this.#transcripts.get(file);
          let meta = cached && cached.mtimeMs === stat.mtimeMs ? cached : null;
          if (!meta) {
            meta = { mtimeMs: stat.mtimeMs, ...summaryFromHead(await readHead(file, 48_000)) };
            this.#transcripts.set(file, meta);
          }
          sessions.set(id, {
            id,
            title: meta.title,
            time: { created: meta.created || stat.birthtimeMs || stat.mtimeMs, updated: stat.mtimeMs },
            agent: null,
            parentID: null,
          });
        })
    );

    return [...sessions.values()].sort((a, b) => b.time.updated - a.time.updated).slice(0, 60);
  }

  async #messages(id, directory) {
    const session = await this.#hydrate(id, directory);
    if (session.synthetic) return [];
    if (session.messages.length) return session.messages;

    const file = path.join(projectDirectory(directory), `${id}.jsonl`);
    const text = await fs.readFile(file, 'utf8').catch(() => null);
    if (!text) return [];
    const entries = text
      .split('\n')
      .filter((line) => line.trim())
      .map(parseJson)
      .filter(Boolean);
    session.messages = buildTranscriptMessages(entries, id, directory);
    for (const message of session.messages) {
      for (const part of message.parts ?? []) {
        if (part.type === 'tool' && part.callID) session.parts.set(part.callID, part);
      }
    }
    return session.messages;
  }

  #statuses() {
    const statuses = {};
    for (const session of this.#sessions.values()) {
      if (session.busy) statuses[session.id] = { type: 'busy' };
    }
    return statuses;
  }

  #pendingPermissions() {
    const pending = [];
    for (const session of this.#sessions.values()) {
      if (!session.permissions.size) continue;
      for (const request of session.permissions.values()) pending.push(publicPermission(request));
    }
    return pending;
  }

  async #prompt(id, directory, body) {
    const text = Array.isArray(body?.parts)
      ? body.parts.find((part) => part?.type === 'text' && typeof part.text === 'string')?.text?.trim()
      : '';
    if (!text) throw new HttpError(400, 'Pesan tidak boleh kosong.');

    await this.ensure();
    const session = await this.#hydrate(id, directory);
    if (session.busy) throw new HttpError(409, 'Sesi masih sibuk. Tunggu atau hentikan dulu.');
    if (!session.messages.length) await this.#messages(id, directory);

    const modelID = body?.model?.modelID;
    if (typeof modelID === 'string' && CLAUDE_MODELS.some((model) => model.id === modelID)) session.model = modelID;
    if (typeof body?.agent === 'string' && body.agent.trim()) session.agent = body.agent.trim();

    if (!session.title) {
      session.title = titleFromPrompt(text);
      this.#emit({ type: 'session.updated', properties: { info: publicSession(session) } });
    }

    const now = Date.now();
    const messageID = `usr_${crypto.randomUUID()}`;
    const message = {
      info: { id: messageID, sessionID: session.id, role: 'user', time: { created: now, completed: now } },
      parts: [{ id: `${messageID}:p0`, messageID, sessionID: session.id, type: 'text', text }],
    };

    if (
      session.child &&
      (session.model !== session.liveModel || (session.agent ?? null) !== (session.liveAgent ?? null))
    ) {
      session.child.kill();
      session.child = null;
    }

    session.busy = true;
    session.aborting = false;
    session.updated = now;
    session.messages.push(message);
    this.#emit({ type: 'message.updated', properties: { sessionID: session.id, info: message.info } });
    this.#emit({ type: 'message.part.updated', properties: { sessionID: session.id, part: message.parts[0] } });
    this.#emit({ type: 'session.status', properties: { sessionID: session.id, status: { type: 'busy' } } });

    try {
      if (!session.child) await this.#spawn(session);
      session.child.stdin.write(
        `${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } })}\n`
      );
    } catch (error) {
      this.#fail(session, error instanceof Error ? error.message : String(error));
      throw error instanceof HttpError ? error : new HttpError(502, `Gagal mengirim ke Claude: ${error.message}`);
    }
  }

  async #spawn(session) {
    const file = path.join(projectDirectory(session.directory), `${session.id}.jsonl`);
    const exists = await fs.stat(file).then(() => true).catch(() => false);
    const args = [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'manual',
      '--permission-prompt-tool',
      'stdio',
      exists ? '--resume' : '--session-id',
      session.id,
      '--model',
      session.model,
    ];
    if (session.agent && session.agent !== 'claude') args.push('--agent', session.agent);

    const child = spawn(CLI, args, {
      cwd: session.directory,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cliEnv(),
    });
    session.child = child;
    session.liveModel = session.model;
    session.liveAgent = session.agent ?? null;
    session.stderr = '';
    session.parts.clear();

    const parser = parseLines('', (line) => {
      const event = parseJson(line);
      if (event) this.#onEvent(session, event);
    });
    child.stdout.on('data', (chunk) => parser.push(chunk.toString()));
    child.stdout.on('end', () => parser.flush());
    child.stderr.on('data', (chunk) => {
      session.stderr = `${session.stderr}${chunk.toString()}`.slice(-8_000);
    });
    child.stdin.on('error', () => undefined);
    child.on('error', (error) => {
      this.#fail(
        session,
        error.code === 'ENOENT'
          ? 'Claude Code CLI tidak ditemukan. Install dengan: npm i -g @anthropic-ai/claude-code'
          : `Gagal menjalankan Claude Code: ${error.message}`
      );
    });
    child.on('exit', (code) => {
      if (session.child !== child) return;
      session.child = null;
      if (session.busy) {
        const detail = session.stderr.trim().slice(-400);
        this.#fail(session, `Claude Code berhenti (exit ${code}). ${detail}`.trim());
      }
    });
  }

  #onEvent(session, event) {
    switch (event?.type) {
      case 'system': {
        if (event.subtype === 'init') this.#mergeRoster(session.directory, event.agents);
        return;
      }
      case 'assistant': {
        this.#onAssistant(session, event);
        return;
      }
      case 'user': {
        this.#onToolResults(session, event);
        return;
      }
      case 'result': {
        this.#finishRun(session, event);
        return;
      }
      case 'control_request': {
        this.#onControlRequest(session, event);
        return;
      }
      default:
        return;
    }
  }

  #onAssistant(session, event) {
    const info = event.message;
    if (!info || typeof info !== 'object') return;
    const messageID = typeof info.id === 'string' && info.id ? info.id : `msg_${crypto.randomUUID()}`;
    const at = Date.parse(event.timestamp ?? '') || Date.now();
    const parts = assistantParts(info.content, messageID, session.id, at, session.directory);
    if (!parts.length) return;

    let message = session.messages.find((entry) => entry.info.id === messageID);
    if (!message) {
      message = { info: { id: messageID, sessionID: session.id, role: 'assistant', time: { created: at, completed: at } }, parts: [] };
      session.messages.push(message);
      this.#emit({ type: 'message.updated', properties: { sessionID: session.id, info: message.info } });
    }

    for (const part of parts) {
      if (message.parts.some((entry) => entry.id === part.id)) continue;
      message.parts.push(part);
      if (part.type === 'tool') {
        session.parts.set(part.callID, part);
        const block = (info.content ?? []).find((item) => item?.type === 'tool_use' && item.id === part.id);
        if ((block?.name === 'Agent' || block?.name === 'Task') && block.input?.subagent_type) {
          this.#subagentStart(session, block.id, block.input.subagent_type);
        }
      }
      this.#emit({ type: 'message.part.updated', properties: { sessionID: session.id, part } });
    }
    session.updated = Date.now();
  }

  #onToolResults(session, event) {
    const content = event.message?.content;
    if (!Array.isArray(content)) return;
    const at = Date.parse(event.timestamp ?? '') || Date.now();
    for (const block of content) {
      if (block?.type !== 'tool_result') continue;
      const part = session.parts.get(block.tool_use_id);
      if (!part) continue;
      part.state = {
        ...part.state,
        status: block.is_error ? 'error' : 'completed',
        output: flattenResult(block.content),
        time: { ...part.state?.time, end: at },
      };
      this.#emit({ type: 'message.part.updated', properties: { sessionID: session.id, part } });
      this.#subagentEnd(session, block.tool_use_id);
    }
  }

  #finishRun(session, event) {
    if (session.abortTimer) {
      clearTimeout(session.abortTimer);
      session.abortTimer = null;
    }
    const aborted = session.aborting;
    session.aborting = false;
    session.busy = false;
    session.updated = Date.now();

    for (const pending of session.permissions.values()) {
      this.#emit({ type: 'permission.replied', properties: { sessionID: session.id, requestID: pending.id } });
    }
    session.permissions.clear();
    for (const toolUseId of [...session.subagents.keys()]) this.#subagentEnd(session, toolUseId);

    if (!aborted && event.is_error) {
      const message =
        (typeof event.result === 'string' && event.result.trim()) ||
        (typeof event.api_error_status === 'string' ? event.api_error_status : '') ||
        'Claude Code mengakhiri giliran dengan error.';
      this.#emit({ type: 'session.error', properties: { sessionID: session.id, error: { message } } });
    }

    this.#emit({ type: 'session.status', properties: { sessionID: session.id, status: { type: 'idle' } } });
    this.#emit({ type: 'session.idle', properties: { sessionID: session.id } });
  }

  #onControlRequest(session, event) {
    const request = event.request ?? {};
    if (request.subtype !== 'can_use_tool') return;
    const pending = {
      id: String(event.request_id),
      sessionID: session.id,
      permission: typeof request.tool_name === 'string' ? request.tool_name : 'tool',
      patterns: [toolTitle(request.tool_name, request.input, session.directory)],
      metadata: {
        tool: request.tool_name,
        description: typeof request.description === 'string' ? request.description : '',
        input: request.input ?? {},
      },
      input: request.input ?? {},
      raw: event,
    };
    session.permissions.set(pending.id, pending);
    this.#emit({
      type: 'permission.asked',
      properties: {
        id: pending.id,
        sessionID: session.id,
        permission: pending.permission,
        patterns: pending.patterns,
        always: [],
        metadata: pending.metadata,
      },
    });
  }

  #subagentStart(session, toolUseId, name) {
    const id = `sub_${String(toolUseId).replace(/[^A-Za-z0-9]/g, '')}`;
    if (this.#sessions.has(id)) return;
    const child = this.#makeSession({
      id,
      directory: session.directory,
      title: `↳ ${name}`,
      agent: name,
      parentID: session.id,
      synthetic: true,
    });
    child.busy = true;
    session.subagents.set(toolUseId, id);
    this.#emit({ type: 'session.created', properties: { info: publicSession(child) } });
    this.#emit({ type: 'session.status', properties: { sessionID: id, status: { type: 'busy' } } });
  }

  #subagentEnd(session, toolUseId) {
    const id = session.subagents.get(toolUseId);
    if (!id) return;
    session.subagents.delete(toolUseId);
    const child = this.#sessions.get(id);
    if (!child) return;
    child.busy = false;
    this.#emit({ type: 'session.status', properties: { sessionID: id, status: { type: 'idle' } } });
    child.lingerTimer = setTimeout(() => {
      if (this.#sessions.get(id) !== child) return;
      this.#sessions.delete(id);
      this.#emit({ type: 'session.deleted', properties: { info: { id } } });
    }, SUBAGENT_LINGER_MS);
    child.lingerTimer.unref?.();
  }

  #abort(id) {
    const session = this.#sessions.get(id);
    if (!session?.busy) return;
    session.aborting = true;
    if (session.child) {
      try {
        session.child.stdin.write(
          `${JSON.stringify({ type: 'control_request', request_id: crypto.randomUUID(), request: { subtype: 'interrupt' } })}\n`
        );
      } catch {
        // Pipe sudah tertutup; kill di bawah yang menangani.
      }
      session.abortTimer = setTimeout(() => {
        if (!session.busy) return;
        this.#fail(session, 'Sesi dihentikan paksa.');
      }, ABORT_TIMEOUT_MS);
    } else {
      this.#fail(session, 'Sesi dihentikan.');
    }
  }

  #replyPermission(id, reply) {
    if (!['once', 'always', 'reject'].includes(reply)) {
      throw new HttpError(400, 'Jawaban izin harus once, always, atau reject.');
    }
    for (const session of this.#sessions.values()) {
      const pending = session.permissions.get(id);
      if (!pending) continue;
      const response =
        reply === 'reject'
          ? { behavior: 'deny', message: 'Ditolak dari VirtOffice.' }
          : { behavior: 'allow', updatedInput: pending.input };
      try {
        session.child?.stdin.write(
          `${JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: id, response } })}\n`
        );
      } catch {
        // Proses sudah mati; kartu izin tetap dibersihkan.
      }
      session.permissions.delete(id);
      this.#emit({ type: 'permission.replied', properties: { sessionID: session.id, requestID: id } });
      return null;
    }
    throw new HttpError(404, 'Permintaan izin tidak ditemukan.');
  }

  #fail(session, message) {
    if (session.abortTimer) {
      clearTimeout(session.abortTimer);
      session.abortTimer = null;
    }
    session.aborting = false;
    session.busy = false;
    session.updated = Date.now();
    const child = session.child;
    session.child = null;
    if (child) child.kill();
    for (const pending of session.permissions.values()) {
      this.#emit({ type: 'permission.replied', properties: { sessionID: session.id, requestID: pending.id } });
    }
    session.permissions.clear();
    this.#emit({ type: 'session.error', properties: { sessionID: session.id, error: { message } } });
    this.#emit({ type: 'session.status', properties: { sessionID: session.id, status: { type: 'idle' } } });
    this.#emit({ type: 'session.idle', properties: { sessionID: session.id } });
  }

  stop() {
    for (const session of this.#sessions.values()) {
      if (session.abortTimer) clearTimeout(session.abortTimer);
      if (session.lingerTimer) clearTimeout(session.lingerTimer);
      session.child?.kill();
      session.child = null;
    }
    this.#subscribers.clear();
  }
}
