import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const SCRATCH = path.join(ROOT, '.virtoffice', 'claude-probe');
const LOGS = path.join(SCRATCH, 'logs');
const CLI = process.env.PROBE_CLI || 'claude';
const MODEL = process.env.PROBE_MODEL || 'haiku';

const clip = (value, limit = 320) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
};

function countEvents(events) {
  const map = {};
  for (const event of events) {
    const type = event?.type === 'stream_event' ? `stream_event:${event.event?.type}` : String(event?.type);
    map[type] = (map[type] ?? 0) + 1;
  }
  return map;
}

function start(args, { timeoutMs = 180_000, onEvent } = {}) {
  const child = spawn(CLI, args, {
    cwd: SCRATCH,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });

  const events = [];
  const raw = [];
  const waiters = new Set();
  let stderr = '';
  let code = null;
  let timedOut = false;
  let buffer = '';

  let session = null;

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      raw.push(line);
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      events.push(event);
      for (const waiter of [...waiters]) waiter(event);
      onEvent?.(event, session);
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const exited = new Promise((resolve) => {
    child.on('exit', (value) => {
      code = value;
      resolve();
    });
    child.on('error', (error) => {
      stderr += `\nspawn error: ${error.message}`;
      code = -1;
      resolve();
    });
  });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeoutMs);
  exited.then(() => clearTimeout(timer));

  const waitResult = (ms = 120_000) =>
    new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        waiters.delete(check);
        clearTimeout(guard);
        resolve(value);
      };
      const check = (event) => {
        if (event?.type === 'result') finish(event);
      };
      const guard = setTimeout(() => finish(null), ms);
      waiters.add(check);
      exited.then(() => finish(null));
    });

  session = {
    child,
    events,
    raw,
    waitResult,
    sendText: (text) => child.stdin.end(text),
    sendUser: (text) =>
      child.stdin.write(
        `${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } })}\n`
      ),
    sendControl: (payload) => child.stdin.write(`${JSON.stringify(payload)}\n`),
    close: () => child.stdin.end(),
    exited,
    get code() {
      return code;
    },
    get timedOut() {
      return timedOut;
    },
    get stderr() {
      return stderr;
    },
  };
  return session;
}

function execText(args, timeoutMs = 20_000) {
  return new Promise((resolve) => {
    const child = spawn(CLI, args, { cwd: SCRATCH, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

const initOf = (session) => session.events.find((event) => event?.type === 'system' && event?.subtype === 'init');

const textOf = (result) => (typeof result?.result === 'string' ? result.result.trim() : null);

async function saveLog(name, session) {
  await fs.writeFile(path.join(LOGS, `${name}.ndjson`), `${session.raw.join('\n')}\n`, 'utf8');
}

async function findTranscript(sessionId) {
  const root = path.join(os.homedir(), '.claude', 'projects');
  const dirs = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const file = path.join(root, dir.name, `${sessionId}.jsonl`);
    const stat = await fs.stat(file).catch(() => null);
    if (stat) return { file, size: stat.size };
  }
  return null;
}

async function readTranscriptShape(file) {
  const text = await fs.readFile(file, 'utf8').catch(() => '');
  const types = {};
  let sidechain = 0;
  let parentLinked = 0;
  let subagentTypes = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    types[entry.type] = (types[entry.type] ?? 0) + 1;
    if (entry.isSidechain) sidechain += 1;
    if (entry.parent_tool_use_id) parentLinked += 1;
    const blocks = entry.message?.content;
    if (Array.isArray(blocks)) {
      for (const block of blocks) {
        if (block?.type === 'tool_use' && typeof block.input?.subagent_type === 'string') {
          subagentTypes.push(block.input.subagent_type);
        }
      }
    }
  }
  return { types, sidechain, parentLinked, subagentTypes };
}

async function main() {
  await fs.rm(SCRATCH, { recursive: true, force: true });
  await fs.mkdir(LOGS, { recursive: true });
  await fs.mkdir(path.join(SCRATCH, '.claude', 'agents'), { recursive: true });
  await fs.writeFile(
    path.join(SCRATCH, '.claude', 'agents', 'probe-helper.md'),
    ['---', 'name: probe-helper', 'description: Menjawab aritmetika singkat untuk probe VirtOffice.', '---', 'Jawab satu kalimat singkat.'].join('\n'),
    'utf8'
  );

  const report = { model: MODEL, generatedAt: new Date().toISOString(), probes: {} };
  const version = await execText(['--version']);
  report.version = version.stdout.trim();

  // 1. One-shot print mode, prompt via stdin.
  const sid = crypto.randomUUID();
  const oneShot = start(['-p', '--output-format', 'stream-json', '--verbose', '--model', MODEL, '--session-id', sid], {
    timeoutMs: 90_000,
  });
  oneShot.sendText('Ingat angka 41 untuk pertanyaan berikutnya. Balas satu kata: ok');
  const oneResult = await oneShot.waitResult(90_000);
  oneShot.close();
  await oneShot.exited;
  await saveLog('01-oneshot', oneShot);
  const init = initOf(oneShot);
  report.probes.oneShot = {
    code: oneShot.code,
    timedOut: oneShot.timedOut,
    seconds: null,
    events: countEvents(oneShot.events),
    initKeys: init ? Object.keys(init) : [],
    init: init
      ? {
          session_id: init.session_id,
          model: init.model,
          toolCount: Array.isArray(init.tools) ? init.tools.length : null,
          toolSample: Array.isArray(init.tools) ? init.tools.slice(0, 8) : null,
          agentKeys: init.agents ? Object.keys(init.agents) : null,
        }
      : null,
    result: textOf(oneResult),
    stderr: clip(oneShot.stderr),
  };

  // 2. Resume the same session in a fresh process.
  const resume = start(['-p', '--output-format', 'stream-json', '--verbose', '--model', MODEL, '--resume', sid], {
    timeoutMs: 90_000,
  });
  resume.sendText('Angka tadi ditambah 1 sama dengan berapa? Balas angkanya saja.');
  const resumeResult = await resume.waitResult(90_000);
  resume.close();
  await resume.exited;
  await saveLog('02-resume', resume);
  const resumeInit = initOf(resume);
  report.probes.resume = {
    code: resume.code,
    timedOut: resume.timedOut,
    session_id: resumeInit?.session_id ?? null,
    sameSession: resumeInit?.session_id === sid,
    result: textOf(resumeResult),
    events: countEvents(resume.events),
    stderr: clip(resume.stderr),
  };

  // 3. Long-lived process, multi-turn over stdin stream-json.
  const liveSid = crypto.randomUUID();
  const live = start(
    [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--model',
      MODEL,
      '--session-id',
      liveSid,
    ],
    { timeoutMs: 240_000 }
  );
  live.sendUser('Ingat angka 41 untuk pertanyaan berikutnya. Balas satu kata: ok');
  const turnOne = await live.waitResult(120_000);
  const aliveAfterTurnOne = live.code === null;
  live.sendUser('Angka tadi ditambah 1 sama dengan berapa? Balas angkanya saja.');
  const turnTwo = await live.waitResult(120_000);
  live.close();
  await live.exited;
  await saveLog('03-multiturn', live);
  const liveInit = initOf(live);
  report.probes.multiturn = {
    code: live.code,
    timedOut: live.timedOut,
    session_id: liveInit?.session_id ?? null,
    sameSession: liveInit?.session_id === liveSid,
    turnOne: textOf(turnOne),
    turnTwo: textOf(turnTwo),
    aliveAfterTurnOne,
    events: countEvents(live.events),
    stderr: clip(live.stderr),
  };

  // 4a. Permission request path: manual mode, host answers, we auto-approve.
  const permissionEvents = [];
  const manual = start(
    [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--model',
      MODEL,
      '--permission-mode',
      'manual',
      '--permission-prompts',
      'host',
    ],
    {
      timeoutMs: 90_000,
      onEvent: (event, session) => {
        if (event?.type !== 'control_request') return;
        permissionEvents.push(event);
        const request = event.request ?? {};
        const response =
          request.subtype === 'can_use_tool'
            ? { behavior: 'allow', updatedInput: request.input ?? {} }
            : { behavior: 'allow' };
        session.sendControl({
          type: 'control_response',
          response: { subtype: 'success', request_id: event.request_id, response },
        });
      },
    }
  );
  manual.sendText('Buat file probe-manual.txt berisi "ok" di folder kerja ini, lalu balas selesai.');
  const manualResult = await manual.waitResult(90_000);
  manual.close();
  await manual.exited;
  await saveLog('04a-permission-manual', manual);
  const manualFile = await fs.readFile(path.join(SCRATCH, 'probe-manual.txt'), 'utf8').catch(() => null);
  report.probes.permissionManual = {
    code: manual.code,
    timedOut: manual.timedOut,
    controlRequests: permissionEvents.map((event) => ({
      request_id: event.request_id,
      subtype: event.request?.subtype ?? null,
      tool: event.request?.tool_name ?? null,
      keys: Object.keys(event.request ?? {}),
    })),
    fileCreated: manualFile !== null,
    file: manualFile,
    result: textOf(manualResult),
    events: countEvents(manual.events),
    stderr: clip(manual.stderr),
  };

  // 4b. acceptEdits path: no host interaction needed for file writes.
  const accept = start(
    [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--model',
      MODEL,
      '--permission-mode',
      'acceptEdits',
      '--allowedTools',
      'Write',
    ],
    { timeoutMs: 90_000 }
  );
  accept.sendText('Buat file probe-accept.txt berisi "ok" di folder kerja ini, lalu balas selesai.');
  const acceptResult = await accept.waitResult(90_000);
  accept.close();
  await accept.exited;
  await saveLog('04b-permission-accept', accept);
  const acceptFile = await fs.readFile(path.join(SCRATCH, 'probe-accept.txt'), 'utf8').catch(() => null);
  report.probes.permissionAccept = {
    code: accept.code,
    timedOut: accept.timedOut,
    fileCreated: acceptFile !== null,
    file: acceptFile,
    result: textOf(acceptResult),
    events: countEvents(accept.events),
    stderr: clip(accept.stderr),
  };

  // 5. Subagent: inline definition + Task tool + forwarded subagent text.
  const agentsFile = path.join(SCRATCH, 'agents.json');
  await fs.writeFile(
    agentsFile,
    JSON.stringify({
      'probe-helper': {
        description: 'Menjawab aritmetika singkat untuk probe VirtOffice.',
        prompt: 'Hitung dengan benar dan jawab satu kalimat singkat.',
      },
    }),
    'utf8'
  );
  const subSid = crypto.randomUUID();
  const sub = start(
    [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--model',
      MODEL,
      '--forward-subagent-text',
      '--agents',
      agentsFile,
      '--allowedTools',
      'Task,Read,Glob,Grep',
      '--session-id',
      subSid,
    ],
    { timeoutMs: 180_000 }
  );
  sub.sendText(
    'Gunakan tool Task dengan subagent_type "probe-helper" untuk menghitung 6*7. Setelah hasilnya kembali, balas "hasil=<angka>".'
  );
  const subResult = await sub.waitResult(150_000);
  sub.close();
  await sub.exited;
  await saveLog('05-subagent', sub);
  const subInit = initOf(sub);
  const taskUses = [];
  for (const event of sub.events) {
    const blocks = event?.message?.content;
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (block?.type === 'tool_use' && typeof block.name === 'string') {
        taskUses.push({ name: block.name, subagent_type: block.input?.subagent_type ?? null });
      }
    }
  }
  report.probes.subagent = {
    code: sub.code,
    timedOut: sub.timedOut,
    result: textOf(subResult),
    initAgents: subInit?.agents ? Object.keys(subInit.agents) : null,
    toolUses: taskUses,
    parentLinkedEvents: sub.events.filter((event) => event?.parent_tool_use_id).length,
    events: countEvents(sub.events),
    stderr: clip(sub.stderr),
  };

  // 6. Transcripts and background agents listing.
  for (const [name, id] of [
    ['oneShot', sid],
    ['multiturn', liveSid],
    ['subagent', subSid],
  ]) {
    const found = await findTranscript(id);
    report.probes[name].transcript = found
      ? { file: found.file, size: found.size, shape: await readTranscriptShape(found.file) }
      : null;
  }
  const agentsList = await execText(['agents']);
  report.probes.backgroundAgents = { code: agentsList.code, stdout: clip(agentsList.stdout, 600), stderr: clip(agentsList.stderr) };

  await fs.writeFile(path.join(LOGS, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');

  const print = (label, value) => console.log(`${label}: ${clip(value, 500)}`);
  print('version', report.version);
  print('oneshot', report.probes.oneShot);
  print('resume', report.probes.resume);
  print('multiturn', report.probes.multiturn);
  print('permissionManual', report.probes.permissionManual);
  print('permissionAccept', report.probes.permissionAccept);
  print('subagent', report.probes.subagent);
  print('backgroundAgents', report.probes.backgroundAgents);
  console.log(`logs: ${LOGS}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
