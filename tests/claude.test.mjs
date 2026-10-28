import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  askUserQuestions,
  assistantParts,
  buildTranscriptMessages,
  claudeAnswers,
  claudeProjectSlug,
  claudeProviderPayload,
  claudeSpawnArgs,
  eventSessionId,
  parseAgentDoc,
  readRoster,
  titleFromPrompt,
  toolTitle,
} from '../server/claude.mjs';
import { buildModelCatalog } from '../server/opencode.mjs';

const ROOT = 'X:\\work';

describe('claudeProjectSlug', () => {
  it('mengubah setiap karakter non-alfanumerik jadi strip seperti Claude Code', () => {
    expect(claudeProjectSlug('D:\\- Research\\AI\\Personal Research\\- AI Tools\\VirtOffice-OpenCode')).toBe(
      'D----Research-AI-Personal-Research---AI-Tools-VirtOffice-OpenCode'
    );
    expect(claudeProjectSlug('D:\\- Research\\AI\\Personal Research\\- AI Tools\\VirtOffice-OpenCode\\.virtoffice\\claude-probe')).toBe(
      'D----Research-AI-Personal-Research---AI-Tools-VirtOffice-OpenCode--virtoffice-claude-probe'
    );
  });
});

describe('toolTitle', () => {
  it('memakai command, path relatif, atau deskripsi sesuai tool', () => {
    expect(toolTitle('Bash', { command: 'npm test' })).toBe('npm test');
    expect(toolTitle('Write', { file_path: `${ROOT}\\src\\app.ts` }, ROOT)).toBe('Write src/app.ts');
    expect(toolTitle('Read', { file_path: 'D:\\lain\\x.txt' }, ROOT)).toBe('Read x.txt');
    expect(toolTitle('Agent', { description: 'Cek repo', subagent_type: 'Explore' })).toBe('Cek repo');
  });
});

describe('assistantParts', () => {
  it('memetakan blok Claude ke part OpenCode yang dirender FE', () => {
    const parts = assistantParts(
      [
        { type: 'text', text: 'Siap.' },
        { type: 'thinking', thinking: 'Pertimbangkan dulu.' },
        { type: 'tool_use', id: 'toolu_1', name: 'Write', input: { file_path: `${ROOT}\\a.txt` } },
      ],
      'msg_1',
      'ses_1',
      1000,
      ROOT
    );

    expect(parts.map((part) => part.type)).toEqual(['text', 'reasoning', 'tool']);
    expect(parts[0]).toMatchObject({ id: 'msg_1:t0', messageID: 'msg_1', text: 'Siap.' });
    expect(parts[1]).toMatchObject({ type: 'reasoning', text: 'Pertimbangkan dulu.' });
    expect(parts[2]).toMatchObject({
      id: 'toolu_1',
      type: 'tool',
      tool: 'write',
      callID: 'toolu_1',
      state: { status: 'running', title: 'Write a.txt' },
    });
  });
});

describe('buildTranscriptMessages', () => {
  const entries = [
    { type: 'queue-operation', operation: 'enqueue', sessionId: 's' },
    {
      type: 'user',
      uuid: 'u1',
      timestamp: '2026-10-27T22:18:50.688Z',
      message: { role: 'user', content: [{ type: 'text', text: 'Buat file a.txt' }] },
    },
    {
      type: 'assistant',
      uuid: 'a1',
      timestamp: '2026-10-27T22:18:52.483Z',
      message: {
        id: 'msg_1',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Saya buat.' },
          { type: 'tool_use', id: 'toolu_1', name: 'Write', input: { file_path: `${ROOT}\\a.txt` } },
        ],
      },
    },
    {
      type: 'user',
      uuid: 'u2',
      timestamp: '2026-10-27T22:18:53.000Z',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] },
    },
    {
      type: 'assistant',
      uuid: 'side',
      isSidechain: true,
      timestamp: '2026-10-27T22:18:53.100Z',
      message: { id: 'msg_side', role: 'assistant', content: [{ type: 'text', text: 'Rahasia subagent' }] },
    },
  ];

  it('menggabungkan tool_result ke part tool dan mengabaikan sidechain', () => {
    const messages = buildTranscriptMessages(entries, 'ses_1', ROOT);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ info: { id: 'u1', role: 'user' } });
    const tool = messages[1].parts.find((part) => part.type === 'tool');
    expect(tool.state).toMatchObject({ status: 'completed', output: 'ok' });
    expect(messages.flatMap((message) => message.parts).some((part) => part.text === 'Rahasia subagent')).toBe(false);
  });

  it('menandai tool yang tidak pernah selesai sebagai error', () => {
    const messages = buildTranscriptMessages([entries[2]], 'ses_2', ROOT);
    expect(messages[0].parts.find((part) => part.type === 'tool').state.status).toBe('error');
  });
});

describe('titleFromPrompt', () => {
  it('meringkas prompt jadi satu baris pendek', () => {
    expect(titleFromPrompt('  Halo   dunia\nbaris dua ')).toBe('Halo dunia baris dua');
    const long = titleFromPrompt('x'.repeat(120));
    expect(long.length).toBe(64);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('roster', () => {
  it('membaca frontmatter agen workspace di samping built-in', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'virt-claude-'));
    try {
      await fs.mkdir(path.join(dir, '.claude', 'agents'), { recursive: true });
      await fs.writeFile(
        path.join(dir, '.claude', 'agents', 'reviewer.md'),
        ['---', 'name: reviewer', 'description: Meninjau kode.', '---', 'Baca diff.'].join('\n'),
        'utf8'
      );
      const roster = await readRoster(dir);
      const names = roster.map((agent) => agent.name);
      expect(names).toContain('claude');
      expect(names).toContain('Explore');
      const reviewer = roster.find((agent) => agent.name === 'reviewer');
      expect(reviewer).toMatchObject({ mode: 'primary', description: 'Meninjau kode.' });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('parseAgentDoc jatuh ke nama file bila frontmatter tidak ada', () => {
    expect(parseAgentDoc('Tanpa frontmatter', 'fallback')).toEqual({
      name: 'fallback',
      mode: 'primary',
      description: '',
    });
  });
});

describe('pertanyaan AskUserQuestion', () => {
  it('memetakan input Claude ke QuestionRequest milik FE', () => {
    const mapped = askUserQuestions({
      questions: [
        {
          question: 'Warna apa yang kamu suka?',
          header: 'Warna',
          multiSelect: true,
          options: [
            { label: 'Merah', description: 'Merah' },
            { label: 'Biru' },
          ],
        },
      ],
    });
    expect(mapped).toEqual([
      {
        question: 'Warna apa yang kamu suka?',
        header: 'Warna',
        options: [
          { label: 'Merah', description: 'Merah' },
          { label: 'Biru', description: '' },
        ],
        multiple: true,
        custom: true,
      },
    ]);
  });

  it('menggabungkan jawaban multi-select dan melewati pertanyaan kosong', () => {
    const questions = askUserQuestions({
      questions: [{ question: 'Warna?' }, { question: 'Ukuran?' }],
    });
    expect(claudeAnswers(questions, [['Merah', 'Biru'], []])).toEqual({
      answers: { 'Warna?': 'Merah, Biru' },
      count: 1,
    });
  });

  it('menerima jawaban kustom teks bebas', () => {
    const questions = askUserQuestions({ questions: [{ question: 'Warna?' }] });
    expect(claudeAnswers(questions, [['  ungu  ']])).toEqual({ answers: { 'Warna?': 'ungu' }, count: 1 });
  });
});

describe('model katalog', () => {
  it('menghasilkan grup provider claude yang dikenali buildModelCatalog', () => {
    const catalog = buildModelCatalog(claudeProviderPayload(), { model: 'claude/haiku' });
    expect(catalog.groups).toHaveLength(1);
    expect(catalog.groups[0].providerID).toBe('claude');
    expect(catalog.groups[0].models.map((model) => model.id).sort()).toEqual(['fable', 'haiku', 'opus', 'sonnet']);
    expect(catalog.defaultModel).toEqual({ providerID: 'claude', modelID: 'haiku' });
  });
});

describe('claudeSpawnArgs', () => {
  const base = { sessionID: 'd1907560-7a6c-4cbd-96cf-0a25593ee819', model: 'opus', agent: 'claude' };

  it('memakai --session-id untuk sesi baru dan --resume untuk transkrip yang sudah ada', () => {
    expect(claudeSpawnArgs({ ...base, exists: false })).toContain('--session-id');
    expect(claudeSpawnArgs({ ...base, exists: false })).not.toContain('--resume');
    expect(claudeSpawnArgs({ ...base, exists: true })).toContain('--resume');
  });

  it('meneruskan model, effort, dan agent non-default', () => {
    const args = claudeSpawnArgs({ ...base, exists: true, agent: 'probe-helper', effort: 'low' });
    expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2)).toEqual(['--model', 'opus']);
    expect(args.slice(args.indexOf('--effort'), args.indexOf('--effort') + 2)).toEqual(['--effort', 'low']);
    expect(args).toContain('--agent');
    expect(args[args.indexOf('--agent') + 1]).toBe('probe-helper');
  });

  it('mengabaikan effort yang tidak dikenal dan agent default', () => {
    const args = claudeSpawnArgs({ ...base, exists: false, effort: 'extreme' });
    expect(args).not.toContain('--effort');
    expect(args).not.toContain('--agent');
  });
});

describe('eventSessionId', () => {
  const parent = { id: 'ses_1', subagents: new Map([['toolu_A', 'sub_tooluA']]) };

  it('menitipkan event sidechain ke sesi subagent, bukan induknya', () => {
    expect(eventSessionId(parent, { type: 'assistant', parent_tool_use_id: 'toolu_A' })).toBe('sub_tooluA');
  });

  it('menjatuhkan sidechain yang subagent-nya sudah tutup', () => {
    expect(eventSessionId(parent, { type: 'assistant', parent_tool_use_id: 'toolu_B' })).toBeNull();
  });

  it('memakai sesi sendiri untuk event tanpa penanda sidechain', () => {
    expect(eventSessionId(parent, { type: 'assistant' })).toBe('ses_1');
    expect(eventSessionId(parent, { type: 'user', parent_tool_use_id: null })).toBe('ses_1');
  });
});
