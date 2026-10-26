import type {
  Bootstrap,
  BrowseResult,
  ModelKey,
  PermissionReply,
  SessionMessages,
  SessionSummary,
  WorkspaceState,
} from './types';

export class ChatApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ChatApiError';
    this.status = status;
  }
}

async function request<T>(pathname: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
  let response: Response;
  try {
    response = await fetch(pathname, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new ChatApiError(0, 'Server tidak merespons. Cek terminal dev server.');
    }
    throw new ChatApiError(0, 'Tidak bisa menghubungi server lokal.');
  }

  const text = await response.text();
  let payload: unknown = null;
  let parsed = false;
  if (text) {
    try {
      payload = JSON.parse(text);
      parsed = true;
    } catch {
      parsed = false;
    }
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : `Permintaan gagal (${response.status}).`;
    throw new ChatApiError(response.status, message);
  }
  if (!parsed) {
    throw new ChatApiError(
      0,
      'Server ini bukan bridge VirtOffice (mengembalikan HTML, bukan JSON). Jalankan npm run dev dan buka alamat yang dicetak di terminal.'
    );
  }
  return payload as T;
}

export const chatApi = {
  workspace: () => request<WorkspaceState>('/api/workspace'),
  browse: (target?: string | null) =>
    request<BrowseResult>(
      target ? `/api/workspace/browse?path=${encodeURIComponent(target)}` : '/api/workspace/browse'
    ),
  openWorkspace: (target: string) =>
    request<WorkspaceState>('/api/workspace', { method: 'POST', body: JSON.stringify({ path: target }) }),
  bootstrap: () => request<Bootstrap>('/api/chat/bootstrap', {}, 120_000),
  createSession: () =>
    request<SessionSummary>('/api/chat/sessions', { method: 'POST', body: JSON.stringify({}) }),
  session: (id: string) => request<SessionMessages>(`/api/chat/sessions/${encodeURIComponent(id)}`),
  send: (id: string, text: string, model: ModelKey | null, agent: string) =>
    request<{ ok: true }>(`/api/chat/sessions/${encodeURIComponent(id)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text, model, agent }),
    }),
  abort: (id: string) =>
    request<{ ok: true }>(`/api/chat/sessions/${encodeURIComponent(id)}/abort`, { method: 'POST' }),
  replyPermission: (id: string, reply: PermissionReply['reply']) =>
    request<{ ok: true }>(`/api/chat/permissions/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: JSON.stringify({ reply }),
    }),
  replyQuestion: (id: string, answers: string[][]) =>
    request<{ ok: true }>(`/api/chat/questions/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: JSON.stringify({ answers }),
    }),
};
