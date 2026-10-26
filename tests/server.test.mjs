import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildAgentList, buildAgentRoster, buildModelCatalog, buildSessionActivity, buildSessionList, readableError } from '../server/opencode.mjs';
import { WorkspaceStore, browseDirectory, workspaceName } from '../server/workspace.mjs';

const temps = [];

async function tempDir(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('model catalog', () => {
  const providerPayload = {
    connected: ['ollama', 'openai'],
    all: [
      {
        id: 'openai',
        name: 'OpenAI',
        models: {
          'gpt-4': { id: 'gpt-4', name: 'GPT-4', capabilities: { toolcall: true, output: { text: true } } },
          embed: { id: 'embed', name: 'Embed', capabilities: { toolcall: false, output: { text: false } } },
        },
        options: { apiKey: 'must-not-leak' },
      },
      {
        id: 'ollama',
        name: 'Ollama',
        models: {
          'qwen2.5:0.5b': { id: 'qwen2.5:0.5b', name: 'Qwen 2.5 0.5B' },
        },
      },
      {
        id: 'unconnected',
        name: 'Unconnected',
        models: { other: { id: 'other', name: 'Other' } },
      },
    ],
    secrets: { key: 'nope' },
  };

  it('only exposes connected, chat capable models and hides provider secrets', () => {
    const { groups } = buildModelCatalog(providerPayload, {});
    expect(groups.map((group) => group.providerID).sort()).toEqual(['ollama', 'openai']);
    const openai = groups.find((group) => group.providerID === 'openai');
    expect(openai.models.map((model) => model.id)).toEqual(['gpt-4']);
    expect(JSON.stringify(groups)).not.toContain('must-not-leak');
    expect(JSON.stringify(groups)).not.toContain('nope');
  });

  it('honours the configured default model and falls back to the first group', () => {
    const configured = buildModelCatalog(providerPayload, { model: 'ollama/qwen2.5:0.5b' });
    expect(configured.defaultModel).toEqual({ providerID: 'ollama', modelID: 'qwen2.5:0.5b' });
    expect(configured.groups[0].providerID).toBe('ollama');

    const missing = buildModelCatalog(providerPayload, { model: 'missing/model' });
    expect(missing.defaultModel).toEqual({ providerID: 'openai', modelID: 'gpt-4' });
  });
});

describe('agent and session lists', () => {
  it('keeps primary agents and orders build before plan', () => {
    const agents = buildAgentList([
      { name: 'explore', mode: 'primary', description: '  Cari  ' },
      { name: 'build', mode: 'primary', description: '' },
      { name: 'plan', mode: 'primary', description: '' },
      { name: 'compaction', mode: 'primary', description: '' },
      { name: 'sub', mode: 'subagent', description: '' },
    ]);
    expect(agents.map((agent) => agent.name)).toEqual(['build', 'plan', 'explore']);
    expect(agents[2].description).toBe('Cari');
  });

  it('sorts sessions by update time and caps the list', () => {
    const sessions = buildSessionList([
      { id: 'old', title: 'Lama', time: { created: 1, updated: 2 } },
      { id: 'new', title: '', time: { created: 3, updated: 9 } },
      { id: 'broken' },
    ]);
    expect(sessions).toHaveLength(3);
    expect(sessions[0].id).toBe('new');
    expect(sessions[0].title).toBe('Sesi tanpa judul');
    expect(sessions[1].id).toBe('old');
    expect(sessions[2].id).toBe('broken');

    const many = Array.from({ length: 45 }, (_, index) => ({
      id: `s${index}`,
      title: `Sesi ${index}`,
      time: { created: index, updated: index },
    }));
    expect(buildSessionList(many)).toHaveLength(40);
  });

  it('keeps the parent of a listed session so delegation stays visible', () => {
    const parent = { id: 'p', agent: 'build', time: { created: 1, updated: 1 } };
    const children = Array.from({ length: 45 }, (_, index) => ({
      id: `c${index}`,
      agent: 'technical-writer',
      parentID: 'p',
      time: { created: index + 10, updated: index + 10 },
    }));
    const sessions = buildSessionList([parent, ...children]);

    expect(sessions).toHaveLength(41);
    expect(sessions.find((session) => session.id === 'p')?.parentID).toBeNull();
    expect(sessions.find((session) => session.id === 'c44')?.agent).toBe('technical-writer');
    expect(sessions.some((session) => session.id === 'c0')).toBe(false);
  });

  it('lists every visible agent for the office floor, primary first', () => {
    const roster = buildAgentRoster([
      { name: 'explore', mode: 'subagent', description: 'Cari cepat' },
      { name: 'plan', mode: 'primary', description: '' },
      { name: 'build', mode: 'primary', description: '' },
      { name: 'general', mode: 'subagent', hidden: false },
      { name: 'compaction', mode: 'primary', hidden: true },
      { name: 'summary', mode: 'primary' },
      { name: 'title', mode: 'primary' },
      { name: 'qa-engineer', mode: 'subagent' },
    ]);
    expect(roster.map((agent) => agent.name)).toEqual([
      'build',
      'plan',
      'explore',
      'general',
      'qa-engineer',
    ]);
    expect(roster[0].mode).toBe('primary');
    expect(roster[2].mode).toBe('subagent');
    expect(roster[3].description).toBe('');
  });
});

describe('session activity peek', () => {
  const assistant = (...parts) => [{ info: { role: 'assistant' }, parts }];

  it('reports the running tool with a single-line title', () => {
    const activity = buildSessionActivity(
      assistant({ type: 'tool', tool: 'bash', state: { status: 'running', title: 'npm  run\n  test' } })
    );
    expect(activity).toEqual({ phase: 'tool', tool: 'bash', detail: 'npm run test' });
  });

  it('quotes the tail of live reasoning', () => {
    const long = `${'a'.repeat(400)} FINAL THOUGHT`;
    const activity = buildSessionActivity(assistant({ type: 'reasoning', text: long }));
    expect(activity.phase).toBe('think');
    expect(activity.detail.endsWith('FINAL THOUGHT')).toBe(true);
    expect(activity.detail).toHaveLength(161);
    expect(activity.detail.startsWith('…')).toBe(true);
  });

  it('reads only the last assistant message', () => {
    const activity = buildSessionActivity([
      { info: { role: 'assistant' }, parts: [{ type: 'tool', tool: 'read', state: { status: 'running' } }] },
      { info: { role: 'user' }, parts: [] },
      ...assistant({ type: 'text', text: 'Jawaban   selesai.' }),
    ]);
    expect(activity).toEqual({ phase: 'write', tool: null, detail: 'Jawaban selesai.' });
  });

  it('falls back to prepare for an empty reply', () => {
    expect(buildSessionActivity([])).toEqual({ phase: 'prepare', tool: null, detail: '' });
    expect(buildSessionActivity(assistant({ type: 'step-start' }))).toEqual({
      phase: 'prepare',
      tool: null,
      detail: '',
    });
    expect(buildSessionActivity(assistant({ type: 'reasoning', text: '', time: { end: 1 } })).phase).toBe('write');
  });
});

describe('workspace helpers', () => {
  it('derives folder names and readable API errors', () => {
    expect(workspaceName('D:\\Work\\Demo\\')).toBe('Demo');
    expect(workspaceName('/home/user/project/')).toBe('project');
    expect(readableError('{"data":{"message":"Nope"}}')).toBe('Nope');
    expect(readableError('plain text')).toBe('plain text');
    expect(readableError('')).toBe('OpenCode menolak permintaan.');
  });

  it('lists only visible subfolders', async () => {
    const root = await tempDir('virtoffice-browse-');
    await fs.mkdir(path.join(root, 'src'));
    await fs.mkdir(path.join(root, 'node_modules'));
    await fs.mkdir(path.join(root, '.git'));
    await fs.writeFile(path.join(root, 'README.md'), 'x');

    const result = await browseDirectory(root);
    expect(result.path).toBe(root);
    expect(result.root).toBe(false);
    expect(result.entries.map((entry) => entry.name)).toEqual(['src']);
    expect(result.parent).toBe(path.dirname(root));
  });

  it('persists the opened workspace and its recents', async () => {
    const appDir = await tempDir('virtoffice-app-');
    const first = await tempDir('virtoffice-work-a-');
    const second = await tempDir('virtoffice-work-b-');

    const store = new WorkspaceStore(appDir);
    await store.load();
    expect(store.snapshot().workspace).toBeNull();

    await store.open(first);
    await store.open(second);
    const snapshot = store.snapshot();
    expect(snapshot.workspace.path).toBe(second);
    expect(snapshot.recents.map((entry) => entry.path)).toEqual([second, first]);

    const reloaded = new WorkspaceStore(appDir);
    await reloaded.load();
    expect(reloaded.snapshot().workspace.path).toBe(second);
    expect(reloaded.snapshot().recents).toHaveLength(2);
  });
});
