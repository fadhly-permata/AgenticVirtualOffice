import { describe, expect, it } from 'vitest';
import type { ChatEvent } from '../src/chat/types';
import {
  applyChatEvent,
  bubbleCopy,
  describeError,
  isAbortError,
  prettyToolName,
  rawToLive,
  relativeTime,
  toolFileTarget,
  toolTitle,
  truncate,
  workspaceRelative,
} from '../src/chat/state';
import type { RunActivity } from '../src/chat/types';

const session = 'ses_test';

function event(type: string, properties: Record<string, unknown>): ChatEvent {
  return { type, properties };
}

describe('chat reducer', () => {
  it('inserts messages and merges later updates', () => {
    const created = applyChatEvent(
      [],
      event('message.updated', { info: { id: 'm1', role: 'assistant', sessionID: session, time: { created: 10 } } }),
      session
    );
    expect(created).toHaveLength(1);
    expect(created[0].role).toBe('assistant');

    const completed = applyChatEvent(
      created,
      event('message.updated', {
        info: { id: 'm1', role: 'assistant', sessionID: session, time: { created: 10, completed: 20 } },
      }),
      session
    );
    expect(completed[0].completed).toBe(20);
    expect(created[0].completed).toBeUndefined();
  });

  it('ignores events from other sessions', () => {
    const messages = applyChatEvent(
      [],
      event('message.updated', { info: { id: 'm1', role: 'assistant', sessionID: 'other' } }),
      session
    );
    expect(messages).toEqual([]);

    const current = applyChatEvent(
      messages,
      event('message.updated', { info: { id: 'm2', role: 'assistant', sessionID: session } }),
      session
    );
    const after = applyChatEvent(
      current,
      event('message.part.delta', {
        sessionID: 'other',
        messageID: 'm2',
        partID: 'p1',
        field: 'text',
        delta: 'nope',
      }),
      session
    );
    expect(after).toBe(current);
  });

  it('streams text deltas and replaces them with the final part', () => {
    let messages = applyChatEvent(
      [],
      event('message.updated', { info: { id: 'm1', role: 'assistant', sessionID: session } }),
      session
    );
    messages = applyChatEvent(
      messages,
      event('message.part.updated', {
        sessionID: session,
        part: { id: 'p1', messageID: 'm1', sessionID: session, type: 'text', text: '' },
      }),
      session
    );
    messages = applyChatEvent(
      messages,
      event('message.part.delta', {
        sessionID: session,
        messageID: 'm1',
        partID: 'p1',
        field: 'text',
        delta: 'Halo',
      }),
      session
    );
    expect(messages[0].parts[0].text).toBe('Halo');

    messages = applyChatEvent(
      messages,
      event('message.part.updated', {
        sessionID: session,
        part: { id: 'p1', messageID: 'm1', sessionID: session, type: 'text', text: 'Halo dari OpenCode' },
      }),
      session
    );
    expect(messages[0].parts).toHaveLength(1);
    expect(messages[0].parts[0].text).toBe('Halo dari OpenCode');
  });

  it('creates a placeholder message when a part arrives first', () => {
    const messages = applyChatEvent(
      [],
      event('message.part.updated', {
        sessionID: session,
        part: { id: 'p1', messageID: 'm9', sessionID: session, type: 'text', text: 'Parsial' },
      }),
      session
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('m9');
    expect(messages[0].parts[0].text).toBe('Parsial');
  });

  it('treats unannounced tokens as live reasoning until the part is finalised', () => {
    let messages = applyChatEvent(
      [],
      event('message.updated', { info: { id: 'm1', role: 'assistant', sessionID: session } }),
      session
    );
    // OpenCode mengirim token penalaran sebelum part-nya diumumkan.
    messages = applyChatEvent(
      messages,
      event('message.part.delta', {
        sessionID: session,
        messageID: 'm1',
        partID: 'r1',
        field: 'text',
        delta: 'Aku ',
      }),
      session
    );
    messages = applyChatEvent(
      messages,
      event('message.part.delta', {
        sessionID: session,
        messageID: 'm1',
        partID: 'r1',
        field: 'text',
        delta: 'hitung',
      }),
      session
    );
    expect(messages[0].parts[0].type).toBe('reasoning');
    expect(messages[0].parts[0].text).toBe('Aku hitung');
    expect(messages[0].parts[0].time?.end).toBeUndefined();

    messages = applyChatEvent(
      messages,
      event('message.part.updated', {
        sessionID: session,
        part: {
          id: 'r1',
          messageID: 'm1',
          sessionID: session,
          type: 'reasoning',
          text: 'Aku hitung 1 sampai 5',
          time: { start: 1, end: 2 },
        },
      }),
      session
    );
    expect(messages[0].parts).toHaveLength(1);
    expect(messages[0].parts[0].time?.end).toBe(2);

    // Jawaban tetap masuk ke part text yang diumumkan lebih dulu.
    messages = applyChatEvent(
      messages,
      event('message.part.updated', {
        sessionID: session,
        part: { id: 't1', messageID: 'm1', sessionID: session, type: 'text', text: '' },
      }),
      session
    );
    messages = applyChatEvent(
      messages,
      event('message.part.delta', {
        sessionID: session,
        messageID: 'm1',
        partID: 't1',
        field: 'text',
        delta: '1 2 3',
      }),
      session
    );
    expect(messages[0].parts[1].type).toBe('text');
    expect(messages[0].parts[1].text).toBe('1 2 3');
  });

  it('keeps streaming into a reasoning part after it is announced', () => {
    let messages = applyChatEvent(
      [],
      event('message.updated', { info: { id: 'm1', role: 'assistant', sessionID: session } }),
      session
    );
    messages = applyChatEvent(
      messages,
      event('message.part.updated', {
        sessionID: session,
        part: { id: 'r1', messageID: 'm1', sessionID: session, type: 'reasoning', text: 'Aku' },
      }),
      session
    );
    messages = applyChatEvent(
      messages,
      event('message.part.delta', {
        sessionID: session,
        messageID: 'm1',
        partID: 'r1',
        field: 'text',
        delta: ' pikir',
      }),
      session
    );
    expect(messages[0].parts[0].text).toBe('Aku pikir');

    const other = applyChatEvent(
      messages,
      event('message.part.delta', {
        sessionID: session,
        messageID: 'm1',
        partID: 'r1',
        field: 'reasoning',
        delta: ' lagi',
      }),
      session
    );
    expect(other[0].parts[0].text).toBe('Aku pikir lagi');
    expect(other[0].parts[0].type).toBe('reasoning');
  });

  it('rejects parts without a message id or with a non-text delta', () => {
    const empty = applyChatEvent(
      [],
      event('message.part.updated', { sessionID: session, part: { id: 'p1', type: 'text', text: 'x' } }),
      session
    );
    expect(empty).toEqual([]);

    const tool = applyChatEvent(
      [],
      event('message.updated', { info: { id: 'm1', role: 'assistant', sessionID: session } }),
      session
    );
    const withTool = applyChatEvent(
      tool,
      event('message.part.updated', {
        sessionID: session,
        part: { id: 'p1', messageID: 'm1', type: 'tool', tool: 'bash' },
      }),
      session
    );
    const after = applyChatEvent(
      withTool,
      event('message.part.delta', {
        sessionID: session,
        messageID: 'm1',
        partID: 'p1',
        field: 'text',
        delta: 'leak',
      }),
      session
    );
    expect(after).toBe(withTool);
  });
});

describe('bubble copy', () => {
  function activity(phase: RunActivity['phase'], detail = '', tool: string | null = null): RunActivity {
    return { phase, tool, detail };
  }

  it('quotes the tool with its own title', () => {
    expect(bubbleCopy(activity('tool', 'README.md', 'read'))).toBe('Membaca file: README.md');
    expect(bubbleCopy(activity('tool', '', 'task'))).toBe('Menjalankan subagent');
  });

  it('labels live reasoning and the answer being written', () => {
    expect(bubbleCopy(activity('think', 'coba pakai  glob  dulu'))).toBe('Mikir: coba pakai glob dulu');
    expect(bubbleCopy(activity('think'))).toBe('Menalar…');
    expect(bubbleCopy(activity('write', 'Hasilnya adalah'))).toBe('Nulis: Hasilnya adalah');
    expect(bubbleCopy(activity('write'))).toBe('Menulis jawaban…');
  });

  it('drops the peek marker and says nothing before the model starts', () => {
    expect(bubbleCopy(activity('think', '…sampai di sini'))).toBe('Mikir: sampai di sini');
    expect(bubbleCopy(activity('prepare'))).toBe('');
    expect(bubbleCopy(null)).toBe('');
  });

  it('clips to what fits the bubble', () => {
    const copy = bubbleCopy(activity('write', 'x'.repeat(120)));
    expect(copy).toHaveLength(46);
    expect(copy.endsWith('…')).toBe(true);
  });
});

describe('rawToLive', () => {
  it('sorts user and assistant messages and drops system entries', () => {
    const messages = rawToLive([
      { info: { id: 'b', role: 'assistant', time: { created: 20 } }, parts: [] },
      { info: { id: 'x', role: 'system', time: { created: 5 } }, parts: [] },
      { info: { id: 'a', role: 'user', time: { created: 10 } }, parts: [] },
    ]);
    expect(messages.map((message) => message.id)).toEqual(['a', 'b']);
  });
});

describe('chat helpers', () => {
  it('describes errors from strings, Error objects and OpenCode payloads', () => {
    expect(describeError('boom')).toBe('boom');
    expect(describeError(new Error('rusak'))).toBe('rusak');
    expect(describeError({ data: { message: 'Model tidak tersedia' } })).toBe('Model tidak tersedia');
    expect(describeError({ error: 'Rate limited' })).toBe('Rate limited');
    expect(describeError({})).toBe('OpenCode mengembalikan kesalahan yang tidak dikenal.');
  });

  it('recognises abort errors so they are not shown as failures', () => {
    expect(isAbortError({ name: 'MessageAbortedError', data: { message: 'Aborted' } })).toBe(true);
    expect(isAbortError({ name: 'ProviderError' })).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });

  it('labels tools, titles and relative times', () => {
    expect(prettyToolName('bash')).toBe('Menjalankan perintah');
    expect(prettyToolName('weird_tool')).toBe('weird tool');
    expect(toolTitle({ id: 'p', type: 'tool', state: { status: 'running', title: '  ls -la  ' } })).toBe('ls -la');
    expect(toolTitle({ id: 'p', type: 'tool', tool: 'read' })).toBe('Membaca file');
    expect(relativeTime(Date.now(), Date.now())).toBe('baru saja');
    expect(relativeTime(0)).toBe('');
  });

  it('truncates long output', () => {
    expect(truncate('abc', 10)).toBe('abc');
    const long = 'x'.repeat(20);
    expect(truncate(long, 10)).toContain('10 karakter lagi');
  });
});

describe('lompat ke baris dari kartu tool', () => {
  const root = String.raw`D:\- Repo\proj`;

  it('memangkas path absolut jadi relatif ruang kerja', () => {
    expect(workspaceRelative(root, String.raw`D:\- Repo\proj\src\chat\files.ts`)).toBe('src/chat/files.ts');
    expect(workspaceRelative(root, 'D:/- Repo/proj/README.md')).toBe('README.md');
    expect(workspaceRelative(root, String.raw`D:\- REPO\PROJ\x.ts`)).toBe('x.ts');
    expect(workspaceRelative(root, String.raw`D:\- Repo\lain\x.ts`)).toBe('');
    expect(workspaceRelative('', String.raw`D:\- Repo\proj\x.ts`)).toBe('');
  });

  it('memakai baris dari metadata edit, lalu offset baca sebagai cadangan', () => {
    const edit = {
      id: 'p1',
      type: 'tool',
      tool: 'edit',
      state: {
        status: 'completed',
        input: { filePath: `${root}\\src\\chat\\files.ts` },
        metadata: { locations: [{ path: 'files.ts', line: 812 }] },
      },
    } as const;
    expect(toolFileTarget(root, edit as never)).toEqual({ path: 'src/chat/files.ts', line: 812 });

    const read = {
      id: 'p2',
      type: 'tool',
      tool: 'read',
      state: { status: 'completed', input: { filePath: `${root}\\README.md`, offset: 40 } },
    } as const;
    expect(toolFileTarget(root, read as never)).toEqual({ path: 'README.md', line: 40 });
  });

  it('mengabaikan tool yang tidak menyentuh file ruang kerja', () => {
    const bash = { id: 'p3', type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'ls' } } } as const;
    expect(toolFileTarget(root, bash as never)).toBeNull();

    const luar = {
      id: 'p4',
      type: 'tool',
      tool: 'read',
      state: { status: 'completed', input: { path: String.raw`C:\Windows\win.ini` } },
    } as const;
    expect(toolFileTarget(root, luar as never)).toBeNull();
  });
});
