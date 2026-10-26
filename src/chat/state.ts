import type { ChatEvent, LiveMessage, MessageInfo, Part, RawMessage, RunActivity } from './types';

function messageFromInfo(info: MessageInfo, parts: Part[] = []): LiveMessage {
  return {
    id: info.id,
    role: info.role === 'user' ? 'user' : 'assistant',
    created: info.time?.created ?? Date.now(),
    completed: info.time?.completed,
    error: info.error,
    parts,
  };
}

function mergeInfo(message: LiveMessage, info: MessageInfo): LiveMessage {
  return {
    ...message,
    role: info.role === 'user' ? 'user' : 'assistant',
    created: info.time?.created ?? message.created,
    completed: info.time?.completed ?? message.completed,
    error: info.error !== undefined ? info.error : message.error,
  };
}

export function rawToLive(raw: RawMessage[]): LiveMessage[] {
  return raw
    .filter((entry) => entry?.info && (entry.info.role === 'user' || entry.info.role === 'assistant'))
    .map((entry) => messageFromInfo(entry.info, Array.isArray(entry.parts) ? entry.parts : []))
    .sort((a, b) => a.created - b.created);
}

function upsertMessage(messages: LiveMessage[], info: MessageInfo): LiveMessage[] {
  const index = messages.findIndex((message) => message.id === info.id);
  if (index < 0) return [...messages, messageFromInfo(info)];
  const next = [...messages];
  next[index] = mergeInfo(next[index], info);
  return next;
}

function attachPart(messages: LiveMessage[], messageID: string, partial: Partial<Part> & { id: string }): LiveMessage[] {
  const index = messages.findIndex((message) => message.id === messageID);
  if (index < 0) {
    const created = messageFromInfo(
      { id: messageID, role: 'assistant', time: { created: Date.now() } },
      [partial as Part]
    );
    return [...messages, created];
  }

  const message = messages[index];
  const partIndex = message.parts.findIndex((part) => part.id === partial.id);
  const parts = [...message.parts];
  if (partIndex < 0) {
    parts.push(partial as Part);
  } else {
    parts[partIndex] = { ...parts[partIndex], ...partial } as Part;
  }
  const next = [...messages];
  next[index] = { ...message, parts };
  return next;
}

function appendDelta(
  messages: LiveMessage[],
  messageID: string,
  partID: string,
  delta: string,
  field: 'text' | 'reasoning'
): LiveMessage[] {
  const message = messages.find((entry) => entry.id === messageID);
  const existing = message?.parts.find((part) => part.id === partID);
  if (existing && existing.type !== 'text' && existing.type !== 'reasoning') return messages;
  if (!existing) {
    // Part jawaban selalu diumumkan lebih dulu lewat message.part.updated, jadi token
    // yang datang tanpa pengumuman adalah penalaran yang belum difinalkan.
    return attachPart(messages, messageID, { id: partID, type: 'reasoning', text: delta });
  }
  const type = field === 'reasoning' ? 'reasoning' : existing.type;
  return attachPart(messages, messageID, { id: partID, type, text: `${existing.text ?? ''}${delta}` });
}

export function applyChatEvent(messages: LiveMessage[], event: ChatEvent, sessionID: string): LiveMessage[] {
  const props = event.properties ?? {};

  switch (event.type) {
    case 'message.updated': {
      const info = props.info as MessageInfo | undefined;
      if (!info?.id || info.sessionID !== sessionID) return messages;
      return upsertMessage(messages, info);
    }
    case 'message.part.updated': {
      const part = props.part as Part | undefined;
      if (!part?.id || !part.messageID) return messages;
      if (part.sessionID && part.sessionID !== sessionID) return messages;
      if (typeof props.sessionID === 'string' && props.sessionID !== sessionID) return messages;
      return attachPart(messages, part.messageID, part);
    }
    case 'message.part.delta': {
      if (props.sessionID !== sessionID) return messages;
      const field = props.field === 'reasoning' ? 'reasoning' : props.field === 'text' ? 'text' : null;
      if (!field) return messages;
      const messageID = typeof props.messageID === 'string' ? props.messageID : '';
      const partID = typeof props.partID === 'string' ? props.partID : '';
      const delta = typeof props.delta === 'string' ? props.delta : '';
      if (!messageID || !partID || !delta) return messages;
      return appendDelta(messages, messageID, partID, delta, field);
    }
    default:
      return messages;
  }
}

export function describeError(error: unknown): string {
  if (error === null || error === undefined) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error !== 'object') return String(error);

  const record = error as Record<string, unknown>;
  const data = (typeof record.data === 'object' && record.data !== null ? record.data : {}) as Record<
    string,
    unknown
  >;
  for (const candidate of [data.message, data.error, record.message, record.error, record.title]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  if (typeof record.data === 'string' && record.data.trim()) return record.data.trim();
  return 'OpenCode mengembalikan kesalahan yang tidak dikenal.';
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  return record.name === 'MessageAbortedError' || record.name === 'AbortError';
}

const TOOL_LABEL: Record<string, string> = {
  bash: 'Menjalankan perintah',
  edit: 'Mengubah file',
  glob: 'Mencari file',
  grep: 'Mencari teks',
  list: 'Melihat folder',
  question: 'Bertanya',
  read: 'Membaca file',
  task: 'Menjalankan subagent',
  todoread: 'Membaca rencana',
  todowrite: 'Menyusun rencana',
  webfetch: 'Mengambil halaman',
  websearch: 'Mencari di web',
  write: 'Menulis file',
};

export function prettyToolName(tool: string | undefined): string {
  if (!tool) return 'Tool';
  return TOOL_LABEL[tool] ?? tool.replace(/[-_]/g, ' ');
}

export function toolTitle(part: Part): string {
  const title = part.state?.title;
  return typeof title === 'string' && title.trim() ? title.trim() : prettyToolName(part.tool);
}

const BUBBLE_LIMIT = 46;

function clampBubble(text: string): string {
  return text.length <= BUBBLE_LIMIT ? text : `${text.slice(0, BUBBLE_LIMIT - 1).trimEnd()}…`;
}

/**
 * One or two short lines over an employee's head. Everything here comes from the
 * session's own stream, so an empty activity means "say nothing" rather than a
 * made-up status.
 */
export function bubbleCopy(activity: RunActivity | null | undefined): string {
  if (!activity) return '';
  const detail = activity.detail.replace(/\s+/g, ' ').replace(/^…/, '').trim();

  if (activity.phase === 'tool') {
    const name = prettyToolName(activity.tool ?? undefined);
    return clampBubble(detail ? `${name}: ${detail}` : name);
  }
  if (activity.phase === 'think') return detail ? clampBubble(`Mikir: ${detail}`) : 'Menalar…';
  if (activity.phase === 'write') return detail ? clampBubble(`Nulis: ${detail}`) : 'Menulis jawaban…';
  return '';
}

export function relativeTime(timestamp: number, now = Date.now()): string {
  if (!timestamp) return '';
  const diff = Math.max(0, now - timestamp);
  if (diff < 60_000) return 'baru saja';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} mnt lalu`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} jam lalu`;
  const date = new Date(timestamp);
  return `${date.getDate()}/${date.getMonth() + 1}`;
}

export function truncate(value: string, limit = 6_000): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n… ${value.length - limit} karakter lagi`;
}
