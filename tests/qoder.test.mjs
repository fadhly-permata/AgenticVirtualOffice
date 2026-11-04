import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  askUserQuestions,
  assistantParts,
  buildTranscriptMessages,
  eventSessionId,
  parseAgentDoc,
  qoderAnswers,
  qoderProjectSlug,
  qoderProviderPayload,
  qoderSpawnArgs,
  QODER_CONFIG,
  readRoster,
  titleFromPrompt,
  toolTitle,
  turnErrorMessage,
} from '../server/qoder.mjs';
import { buildModelCatalog } from '../server/opencode.mjs';

const ROOT = 'X:\\work';

describe('qoderProjectSlug', () => {
  it('mengubah setiap karakter non-alfanumerik jadi strip seperti folder proyek Qoder', () => {
    expect(qoderProjectSlug('D:\\- Research\\AI\\Personal Research\\- AI Tools\\VirtOffice-OpenCode')).toBe(
      'D----Research-AI-Personal-Research---AI-Tools-VirtOffice-OpenCode'
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
  it('memetakan blok Qoder ke part OpenCode yang dirender FE', () => {
    const parts = assistantParts(
      [
        { type: 'text', text: 'Siap.' },
        { type: 'thinking', thinking: 'Pertimbangkan dulu.' },
        { type: 'tool_use', id: 'call_1', name: 'Write', input: { file_path: `${ROOT}\\a.txt` } },
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
      id: 'call_1',
      type: 'tool',
      tool: 'write',
      callID: 'call_1',
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
      timestamp: '2026-10-28T03:49:10.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'Buat file a.txt' }] },
    },
    {
      type: 'assistant',
      uuid: 'a1',
      timestamp: '2026-10-28T03:49:12.000Z',
      message: {
        id: 'msg_1',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Saya buat.' },
          { type: 'tool_use', id: 'call_1', name: 'Write', input: { file_path: `${ROOT}\\a.txt` } },
        ],
      },
    },
    {
      type: 'user',
      uuid: 'u2',
      timestamp: '2026-10-28T03:49:13.000Z',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'ok' }] },
    },
    {
      type: 'assistant',
      uuid: 'side',
      isSidechain: true,
      timestamp: '2026-10-28T03:49:13.100Z',
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
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'virt-qoder-'));
    try {
      await fs.mkdir(path.join(dir, '.qoder', 'agents'), { recursive: true });
      await fs.writeFile(
        path.join(dir, '.qoder', 'agents', 'reviewer.md'),
        ['---', 'name: reviewer', 'description: Meninjau kode.', '---', 'Baca diff.'].join('\n'),
        'utf8'
      );
      const roster = await readRoster(dir);
      const names = roster.map((agent) => agent.name);
      expect(names).toContain('qoder');
      expect(names).toContain('Explore');
      expect(names).toContain('qoder-guide');
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
  it('memetakan input Qoder ke QuestionRequest milik FE', () => {
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
    expect(qoderAnswers(questions, [['Merah', 'Biru'], []])).toEqual({
      answers: { 'Warna?': 'Merah, Biru' },
      count: 1,
    });
  });

  it('menerima jawaban kustom teks bebas', () => {
    const questions = askUserQuestions({ questions: [{ question: 'Warna?' }] });
    expect(qoderAnswers(questions, [['  ungu  ']])).toEqual({ answers: { 'Warna?': 'ungu' }, count: 1 });
  });
});

describe('model katalog', () => {
  it('menghasilkan grup provider qoder yang dikenali buildModelCatalog', () => {
    const catalog = buildModelCatalog(qoderProviderPayload(), QODER_CONFIG);
    expect(catalog.groups).toHaveLength(1);
    expect(catalog.groups[0].providerID).toBe('qoder');
    expect(catalog.groups[0].models.map((model) => model.id)).toContain('DeepSeek-Flash');
    expect(catalog.defaultModel).toEqual({ providerID: 'qoder', modelID: 'Auto' });
  });
});

describe('qoderSpawnArgs', () => {
  const base = { sessionID: 'd1907560-7a6c-4cbd-96cf-0a25593ee819', model: 'DeepSeek-Flash', agent: 'qoder' };

  it('memakai protokol stream-json dan jalur izin stdio', () => {
    const args = qoderSpawnArgs({ ...base, exists: false });
    expect(args).toContain('-p');
    expect(args.slice(args.indexOf('--input-format'), args.indexOf('--input-format') + 2)).toEqual(['--input-format', 'stream-json']);
    expect(args.slice(args.indexOf('--output-format'), args.indexOf('--output-format') + 2)).toEqual(['--output-format', 'stream-json']);
    expect(args.slice(args.indexOf('--permission-mode'), args.indexOf('--permission-mode') + 2)).toEqual(['--permission-mode', 'default']);
    expect(args.slice(args.indexOf('--permission-prompt-tool'), args.indexOf('--permission-prompt-tool') + 2)).toEqual(['--permission-prompt-tool', 'stdio']);
  });

  it('memakai --session-id untuk sesi baru dan --resume untuk transkrip yang sudah ada', () => {
    expect(qoderSpawnArgs({ ...base, exists: false })).toContain('--session-id');
    expect(qoderSpawnArgs({ ...base, exists: false })).not.toContain('--resume');
    expect(qoderSpawnArgs({ ...base, exists: true })).toContain('--resume');
  });

  it('meneruskan model, reasoning effort, dan agent non-default', () => {
    const args = qoderSpawnArgs({ ...base, exists: true, agent: 'probe-helper', effort: 'low' });
    expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2)).toEqual(['--model', 'DeepSeek-Flash']);
    expect(args.slice(args.indexOf('--reasoning-effort'), args.indexOf('--reasoning-effort') + 2)).toEqual(['--reasoning-effort', 'low']);
    expect(args).toContain('--agent');
    expect(args[args.indexOf('--agent') + 1]).toBe('probe-helper');
  });

  it('mengabaikan effort yang tidak dikenal dan agent default', () => {
    const args = qoderSpawnArgs({ ...base, exists: false, effort: 'extreme' });
    expect(args).not.toContain('--reasoning-effort');
    expect(args).not.toContain('--agent');
  });
});

describe('eventSessionId', () => {
  const parent = { id: 'ses_1', subagents: new Map([['call_A', 'sub_callA']]) };

  it('menitipkan event sidechain ke sesi subagent, bukan induknya', () => {
    expect(eventSessionId(parent, { type: 'assistant', parent_tool_use_id: 'call_A' })).toBe('sub_callA');
  });

  it('menjatuhkan sidechain yang subagent-nya sudah tutup', () => {
    expect(eventSessionId(parent, { type: 'assistant', parent_tool_use_id: 'call_B' })).toBeNull();
  });

  it('memakai sesi sendiri untuk event tanpa penanda sidechain', () => {
    expect(eventSessionId(parent, { type: 'assistant' })).toBe('ses_1');
    expect(eventSessionId(parent, { type: 'user', parent_tool_use_id: null })).toBe('ses_1');
  });
});

describe('turnErrorMessage', () => {
  it('memakai errors[] dari result event dan menambah petunjuk katalog model', () => {
    const message = turnErrorMessage({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      errors: ['The selected Qoder model definition changed'],
    });
    expect(message).toContain('The selected Qoder model definition changed');
    expect(message).toContain('kirim ulang pesan');
  });

  it('menjelaskan slash command yang tidak didukung mode headless', () => {
    const message = turnErrorMessage({
      type: 'result',
      is_error: true,
      result: 'ID [FatalInputError]: Exiting due to command result that is not supported in non-interactive mode.',
    });
    expect(message).toContain('not supported in non-interactive mode');
    expect(message).toContain('dropdown panel chat');
  });

  it('jatuh ke stderr lalu ke subtype bila tidak ada detail lain', () => {
    expect(turnErrorMessage({ is_error: true }, 'boom dari stderr')).toBe('boom dari stderr');
    expect(turnErrorMessage({ is_error: true, subtype: 'error_during_execution' })).toBe(
      'Qoder CLI mengakhiri giliran dengan error (error_during_execution).'
    );
  });
});
