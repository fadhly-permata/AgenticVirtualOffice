import { t } from '../i18n';
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
  return t('errors.unknown');
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  return record.name === 'MessageAbortedError' || record.name === 'AbortError';
}

// Kunci label aktivitas per tool; diselesaikan lewat t() saat render agar ikut bahasa aktif.
const TOOL_LABEL: Record<string, string> = {
  bash: 'tool.bash',
  edit: 'tool.edit',
  glob: 'tool.glob',
  grep: 'tool.grep',
  list: 'tool.list',
  question: 'tool.question',
  read: 'tool.read',
  task: 'tool.task',
  todoread: 'tool.todoread',
  todowrite: 'tool.todowrite',
  webfetch: 'tool.webfetch',
  websearch: 'tool.websearch',
  write: 'tool.write',
};

export function prettyToolName(tool: string | undefined): string {
  if (!tool) return t('tool.default');
  const key = TOOL_LABEL[tool];
  return key ? t(key) : tool.replace(/[-_]/g, ' ');
}

export function toolTitle(part: Part): string {
  const title = part.state?.title;
  return typeof title === 'string' && title.trim() ? title.trim() : prettyToolName(part.tool);
}

/** Path absolut OpenCode dipangkas jadi path relatif ruang kerja; kosong kalau di luarnya. */
export function workspaceRelative(root: string, absolute: string): string {
  if (!root || !absolute) return '';
  const flat = absolute.replace(/\\/g, '/');
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const lowerFlat = flat.toLowerCase();
  const lowerBase = base.toLowerCase();
  if (lowerFlat !== lowerBase && !lowerFlat.startsWith(`${lowerBase}/`)) return '';
  return flat.slice(base.length).replace(/^\/+/, '');
}

/** Berkas yang disentuh sebuah tool plus baris tujuannya, untuk tautan ke viewer Files. */
export function toolFileTarget(root: string, part: Part): { path: string; line: number } | null {
  const input = (part.state?.input ?? {}) as Record<string, unknown>;
  const meta = (part.state?.metadata ?? {}) as Record<string, unknown>;
  const rawPath = [input.filePath, input.path, meta.filePath, meta.filepath].find(
    (value) => typeof value === 'string' && value.length > 0
  ) as string | undefined;
  if (!rawPath) return null;
  const path = workspaceRelative(root, rawPath);
  if (!path) return null;

  const locations = meta.locations;
  const firstLine = Number(Array.isArray(locations) ? (locations[0] as Record<string, unknown>)?.line : 0);
  const offset = Number(input.offset);
  const line =
    Number.isInteger(firstLine) && firstLine > 0
      ? firstLine
      : Number.isInteger(offset) && offset > 0
        ? offset
        : 0;
  return { path, line };
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
  if (activity.phase === 'think')
    return detail ? clampBubble(t('tool.bubbleThink', { detail })) : t('tool.runThink');
  if (activity.phase === 'write')
    return detail ? clampBubble(t('tool.bubbleWrite', { detail })) : t('tool.runWrite');
  return '';
}

export function relativeTime(timestamp: number, now = Date.now()): string {
  if (!timestamp) return '';
  const diff = Math.max(0, now - timestamp);
  if (diff < 60_000) return t('chat.justNow');
  if (diff < 3_600_000) return t('chat.minutesAgo', { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t('chat.hoursAgo', { n: Math.floor(diff / 3_600_000) });
  const date = new Date(timestamp);
  return `${date.getDate()}/${date.getMonth() + 1}`;
}

export function truncate(value: string, limit = 6_000): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}${t('chat.charsMore', { count: value.length - limit })}`;
}
