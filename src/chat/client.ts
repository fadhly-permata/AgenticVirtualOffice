import type {
  Bootstrap,
  BrowseResult,
  FileContent,
  FileKind,
  ModelKey,
  PermissionReply,
  RuleState,
  RunActivity,
  ScmBranches,
  ScmDiff,
  ScmLogEntry,
  ScmStatus,
  SearchMode,
  SearchResult,
  SessionMessages,
  SessionSummary,
  ShellInfo,
  TerminalSession,
  TreeResult,
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
  bootstrap: (delayMs: number) =>
    request<Bootstrap>(`/api/chat/bootstrap?delay=${Math.max(0, Math.round(delayMs))}`, {}, 120_000),
  setRules: (delayMs: number) =>
    request<RuleState>('/api/chat/rules', { method: 'POST', body: JSON.stringify({ delayMs }) }),
  status: () => request<{ statuses: Record<string, { type?: string }> }>('/api/chat/status'),
  activity: (ids: string[]) =>
    request<{ activities: Record<string, RunActivity> }>(
      `/api/chat/activity?ids=${encodeURIComponent(ids.join(','))}`
    ),
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
  tree: (path: string) =>
    request<TreeResult>(`/api/chat/tree?path=${encodeURIComponent(path)}`, {}, 20_000),
  file: (path: string) =>
    request<FileContent>(`/api/chat/file?path=${encodeURIComponent(path)}`, {}, 20_000),
  search: (query: string, mode: SearchMode) =>
    request<SearchResult>(
      `/api/chat/search?q=${encodeURIComponent(query)}&mode=${mode}`,
      {},
      20_000
    ),
  createFile: (path: string, kind: FileKind, text = '') =>
    request<{ path: string }>('/api/chat/files', {
      method: 'POST',
      body: JSON.stringify({ path, kind, text }),
    }),
  renameFile: (from: string, to: string) =>
    request<{ from: string; to: string }>('/api/chat/files/rename', {
      method: 'POST',
      body: JSON.stringify({ from, to }),
    }),
  deleteFile: (path: string) =>
    request<{ path: string }>('/api/chat/files/delete', { method: 'POST', body: JSON.stringify({ path }) }),
  scmStatus: () => request<ScmStatus>('/api/chat/scm/status', {}, 20_000),
  scmDiff: (path: string, staged: boolean) =>
    request<ScmDiff>(
      `/api/chat/scm/diff?path=${encodeURIComponent(path)}${staged ? '&staged=1' : ''}`,
      {},
      20_000
    ),
  scmStage: (paths: string[], staged: boolean) =>
    request<ScmStatus>('/api/chat/scm/stage', { method: 'POST', body: JSON.stringify({ paths, staged }) }, 60_000),
  scmStageAll: (staged: boolean) =>
    request<ScmStatus>('/api/chat/scm/stage/all', { method: 'POST', body: JSON.stringify({ staged }) }, 60_000),
  scmCommit: (message: string, amend: boolean) =>
    request<ScmStatus>('/api/chat/scm/commit', { method: 'POST', body: JSON.stringify({ message, amend }) }, 60_000),
  scmCommitUndo: () => request<ScmStatus>('/api/chat/scm/commit/undo', { method: 'POST' }, 60_000),
  scmDiscard: (paths: string[]) =>
    request<ScmStatus>('/api/chat/scm/discard', { method: 'POST', body: JSON.stringify({ paths }) }, 60_000),
  scmBranches: () => request<ScmBranches>('/api/chat/scm/branches', {}, 20_000),
  scmBranchSwitch: (name: string) =>
    request<ScmBranches>('/api/chat/scm/branch/switch', { method: 'POST', body: JSON.stringify({ name }) }, 60_000),
  scmBranchCreate: (name: string, checkout: boolean) =>
    request<ScmBranches>('/api/chat/scm/branch/create', { method: 'POST', body: JSON.stringify({ name, checkout }) }, 60_000),
  scmBranchDelete: (name: string) =>
    request<ScmBranches>('/api/chat/scm/branch/delete', { method: 'POST', body: JSON.stringify({ name }) }, 60_000),
  scmHistory: (limit: number) =>
    request<{ entries: ScmLogEntry[] }>(`/api/chat/scm/history?limit=${limit}`, {}, 20_000),
  scmPush: () => request<{ note: string }>('/api/chat/scm/push', { method: 'POST' }, 180_000),
  scmPull: () => request<{ note: string }>('/api/chat/scm/pull', { method: 'POST' }, 180_000),
  terminalShells: () => request<{ shells: ShellInfo[] }>('/api/chat/terminal/shells', {}, 20_000),
  createTerminal: (shell: string | null) =>
    request<TerminalSession>('/api/chat/terminal', { method: 'POST', body: JSON.stringify({ shell }) }, 20_000),
  terminalInput: (id: string, data: string) =>
    request<{ ok: boolean; alive: boolean }>('/api/chat/terminal/input', {
      method: 'POST',
      body: JSON.stringify({ id, data }),
    }),
  closeTerminal: (id: string) =>
    request<{ id: string; closed: boolean }>('/api/chat/terminal/close', {
      method: 'POST',
      body: JSON.stringify({ id }),
    }),
};

export function terminalEventsUrl(id: string): string {
  return `/api/chat/terminal/events?id=${encodeURIComponent(id)}`;
}
