import type { VirtOfficeApi } from '../api';
import {
  type Presence,
  type RosterAgent,
  buildPresence,
  crewFromRoster,
  sessionActivities,
  slugify,
} from '../office/presence';
import { chatApi } from './client';
import { el, ICON, icon } from './dom';
import { FolderPicker } from './folder';
import { cancelPendingDiagrams, renderMarkdown } from './markdown';
import { SearchSelect } from './select';
import {
  applyChatEvent,
  bubbleCopy,
  describeError,
  isAbortError,
  prettyToolName,
  rawToLive,
  truncate,
} from './state';
import type {
  AgentChoice,
  Bootstrap,
  ChatEvent,
  LiveMessage,
  ModelGroup,
  ModelKey,
  Part,
  PermissionRequest,
  QuestionRequest,
  SessionSummary,
  WorkspaceInfo,
} from './types';

const STORAGE_MODEL = 'virtoOffice.chatModel';
const STORAGE_AGENT = 'virtoOffice.chatAgent';
const STORAGE_DELAY = 'virtoOffice.ruleDelay';
const STORAGE_BOX = 'virtoOffice.chatBox';
const EDGE = 8;

/** Jeda sebelum & sesudah kerja delegasi, ditulis ke aturan workspace. */
const DEFAULT_RULE_DELAY = 2000;
const MAX_RULE_DELAY = 10_000;

function clampRuleDelay(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_RULE_DELAY;
  return Math.min(Math.max(Math.round(ms), 0), MAX_RULE_DELAY);
}

function storedRuleDelay(): number {
  const raw = localStorage.getItem(STORAGE_DELAY);
  if (raw === null) return DEFAULT_RULE_DELAY;
  return clampRuleDelay(Number(raw));
}

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Elemen #${id} tidak ditemukan.`);
  return node as T;
}

const launcher = byId<HTMLButtonElement>('chat-launcher');
const launcherEyebrow = byId<HTMLElement>('launcher-eyebrow');
const launcherLabel = byId<HTMLElement>('launcher-label');
const launcherStatus = byId<HTMLElement>('launcher-status');

const chatWindow = byId<HTMLElement>('chat-window');
const chatFolder = byId<HTMLElement>('chat-folder');
const chatChangeFolder = byId<HTMLButtonElement>('chat-change-folder');
const chatNew = byId<HTMLButtonElement>('chat-new');
const chatMaximize = byId<HTMLButtonElement>('chat-maximize');
const chatHead = byId<HTMLElement>('chat-head');
const chatClose = byId<HTMLButtonElement>('chat-close');
const sessionSelect = byId<HTMLSelectElement>('chat-session');
const modelSelect = byId<HTMLSelectElement>('chat-model');
const agentSelect = byId<HTMLSelectElement>('chat-agent');
const delayInput = byId<HTMLInputElement>('chat-delay');
const noticeEl = byId<HTMLElement>('chat-notice');
const messagesEl = byId<HTMLElement>('chat-messages');
const promptsEl = byId<HTMLElement>('chat-prompts');
const agentChip = byId<HTMLElement>('chat-agent-chip');
const statusEl = byId<HTMLElement>('chat-status');
const form = byId<HTMLFormElement>('chat-form');
const input = byId<HTMLTextAreaElement>('chat-input');
const sendButton = byId<HTMLButtonElement>('chat-send');

type NoticeKind = 'info' | 'error' | 'retry' | 'disconnect';

let office: VirtOfficeApi | null = null;
let folderPicker: FolderPicker | null = null;

let workspace: WorkspaceInfo | null = null;
let bootstrap: Bootstrap | null = null;
let bootLoading = false;
let bootError = false;
let workspaceGeneration = 0;

let models: ModelGroup[] = [];
let agents: AgentChoice[] = [];
let sessions: SessionSummary[] = [];
let currentSession: SessionSummary | null = null;
let messages: LiveMessage[] = [];
let selectedModel: ModelKey | null = null;
let selectedAgent = 'build';

const runningSessions = new Set<string>();
const permissions = new Map<string, PermissionRequest>();
const questions = new Map<string, QuestionRequest>();
const fatalAborts = new Set<string>();

const FATAL_PROVIDER_RE =
  /free usage exceeded|model is unavailable|personal access tokens are not supported|insufficient credit/i;

let stream: EventSource | null = null;
let streamReady = false;
let streamErrorShown = false;
let streamAttempts = 0;
let streamRetryTimer = 0;
let streamNoticeTimer = 0;
const streamWaiters = new Set<() => void>();
let fallbackTimer = 0;
let reading = false;
let sending = false;
let sendPhase = '';

let noticeKind: NoticeKind | '' = '';
let renderQueued = false;
let historyReloadTimer = 0;

const reasoningToggled = new Map<string, boolean>();
const clockHosts: { el: HTMLElement; since: number }[] = [];
let workClockTimer = 0;

let officeChipLabel = '';
let officeRoster: RosterAgent[] = [];
let presenceTimer = 0;
let presenceFailures = 0;
let ruleDelay = storedRuleDelay();

export function installChat(officeApi: VirtOfficeApi): void {
  office = officeApi;
  new SearchSelect(sessionSelect, { searchable: true, searchPlaceholder: 'Cari sesi…' });
  new SearchSelect(modelSelect, { searchable: true, searchPlaceholder: 'Cari model…' });
  new SearchSelect(agentSelect);
  folderPicker = new FolderPicker((selected) => {
    applyWorkspace(selected);
    openChat();
  });

  launcher.addEventListener('click', () => {
    if (!workspace) {
      folderPicker?.show(null);
      return;
    }
    openChat();
  });
  chatClose.addEventListener('click', () => {
    closeChat();
    launcher.focus();
  });
  chatMaximize.addEventListener('click', () => {
    const next = !maximized;
    // Perbesar selalu mulai dari tepi layar, bukan dari posisi hasil seretan.
    if (next) setBox(null);
    setMaximized(next);
    if (window.innerWidth > 760) input.focus();
  });
  chatHead.addEventListener('pointerdown', dragChat);
  chatHead.addEventListener('dblclick', () => setBox(null));
  chatHead.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 64 : 16;
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = deltas[event.key];
    if (delta) {
      const at = box ?? chatWindow.getBoundingClientRect();
      setBox({ left: at.left + delta[0], top: at.top + delta[1], width: at.width, height: at.height });
      event.preventDefault();
      return;
    }
    if (event.key === 'Home') {
      setBox(null);
      event.preventDefault();
    }
  });
  window.addEventListener('resize', keepBoxOnScreen);
  setBox(readStoredBox());
  // Klik atau pindah fokus ke luar popup berarti user sudah meninggalkan chat-nya.
  const dismiss = (event: Event): void => {
    if (chatWindow.hidden || folderPicker?.isOpen) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (chatWindow.contains(target) || launcher.contains(target)) return;
    closeChat();
  };
  document.addEventListener('pointerdown', dismiss);
  document.addEventListener('focusin', dismiss);
  chatNew.addEventListener('click', () => startNewChat(true));
  chatChangeFolder.addEventListener('click', () => {
    if (isAnyRunning()) {
      setNotice('error', 'Hentikan respons yang sedang berjalan sebelum mengganti workspace.');
      return;
    }
    folderPicker?.show(workspace?.path ?? null);
  });

  sessionSelect.addEventListener('change', () => {
    const value = sessionSelect.value;
    if (value === 'new') {
      startNewChat(false);
      return;
    }
    const target = sessions.find((session) => session.id === value);
    if (target && target.id !== currentSession?.id) void selectSession(target);
  });
  modelSelect.addEventListener('change', () => {
    const next = modelFromKey(modelSelect.value);
    if (!next) return;
    selectedModel = next;
    localStorage.setItem(STORAGE_MODEL, modelSelect.value);
    updateComposer();
  });
  agentSelect.addEventListener('change', () => {
    selectedAgent = agentSelect.value;
    localStorage.setItem(STORAGE_AGENT, selectedAgent);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void sendMessage();
  });
  input.addEventListener('input', () => {
    resizeInput();
    updateComposer();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  delayInput.value = String(ruleDelay / 1000);
  delayInput.addEventListener('change', () => {
    ruleDelay = clampRuleDelay(Number(delayInput.value) * 1000);
    delayInput.value = String(ruleDelay / 1000);
    localStorage.setItem(STORAGE_DELAY, String(ruleDelay));
    void applyRuleDelay();
  });
  // Satu tombol untuk dua keadaan: kirim saat idle, hentikan saat OpenCode bekerja.
  sendButton.addEventListener('click', () => {
    if (isCurrentRunning()) void stopResponse();
    else void sendMessage();
  });

  updateLauncher();
  updateChatFolder();
  renderMessages({ forceBottom: true });
  updateComposer();

  void syncWorkspace();
}

async function syncWorkspace(): Promise<void> {
  try {
    const state = await chatApi.workspace();
    applyWorkspace(state.workspace);
  } catch (error) {
    launcherStatus.dataset.state = 'error';
    launcher.title = describeError(error) || 'Server lokal tidak tersedia. Jalankan npm run dev.';
  }
}

function applyWorkspace(next: WorkspaceInfo | null): void {
  workspaceGeneration += 1;
  releaseOfficeAgent();
  window.clearTimeout(presenceTimer);
  presenceTimer = 0;
  presenceFailures = 0;
  officeRoster = [];
  disconnectStream();

  workspace = next;
  // Tanpa workspace lantai kembali jadi panggung demo; dengan workspace,
  // bangku kerja hanya boleh diisi sesi yang benar-benar berjalan.
  office?.setFloorMode(next ? 'live' : 'demo');
  bootstrap = null;
  bootLoading = false;
  bootError = false;
  models = [];
  agents = [];
  sessions = [];
  currentSession = null;
  messages = [];
  selectedModel = null;
  selectedAgent = 'build';
  runningSessions.clear();
  permissions.clear();
  questions.clear();
  reading = false;
  sending = false;
  sendPhase = '';
  setNotice(null);

  updateChatFolder();
  updateLauncher();
  renderSessionSelect();
  renderModelSelect();
  renderAgentSelect();
  renderPrompts();
  renderMessages({ forceBottom: true });
  updateComposer();

  // Muat bahkan saat panel tertutup: daftar karyawan di lantai kantor
  // harus mengikuti agent OpenCode begitu aplikasi terbuka.
  if (workspace) void loadBootstrap();
}

function updateChatFolder(): void {
  chatFolder.textContent = workspace?.name ?? '—';
  chatFolder.title = workspace?.path ?? '';
  input.placeholder = workspace
    ? `Minta OpenCode mengerjakan sesuatu di ${workspace.name}…`
    : 'Buka workspace untuk mulai…';
}

function updateLauncher(): void {
  launcherEyebrow.textContent = workspace ? 'OpenCode chat' : 'OpenCode';
  launcherLabel.textContent = workspace?.name ?? 'Buka workspace';
  launcher.title = workspace ? `Chat OpenCode di ${workspace.path}` : 'Pilih folder workspace untuk OpenCode';
  launcherStatus.dataset.state = bootLoading
    ? 'loading'
    : isAnyRunning()
      ? 'busy'
      : workspace
        ? 'ready'
        : 'idle';
}

interface ChatBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

let maximized = false;
let box: ChatBox | null = null;

function readStoredBox(): ChatBox | null {
  const raw = localStorage.getItem(STORAGE_BOX);
  if (!raw) return null;
  let parsed: Partial<ChatBox>;
  try {
    parsed = JSON.parse(raw) as Partial<ChatBox>;
  } catch {
    return null;
  }
  if (
    typeof parsed.left !== 'number' ||
    typeof parsed.top !== 'number' ||
    typeof parsed.width !== 'number' ||
    typeof parsed.height !== 'number' ||
    !Number.isFinite(parsed.left) ||
    !Number.isFinite(parsed.top) ||
    parsed.width < 80 ||
    parsed.height < 80
  ) {
    return null;
  }
  return { left: parsed.left, top: parsed.top, width: parsed.width, height: parsed.height };
}

function insideViewport(next: ChatBox): ChatBox {
  const width = Math.min(next.width, window.innerWidth - EDGE * 2);
  const height = Math.min(next.height, window.innerHeight - EDGE * 2);
  return {
    width,
    height,
    left: Math.min(Math.max(next.left, EDGE), Math.max(EDGE, window.innerWidth - width - EDGE)),
    top: Math.min(Math.max(next.top, EDGE), Math.max(EDGE, window.innerHeight - height - EDGE)),
  };
}

/** Posisi hasil seret mengalahkan dock CSS, jadi setiap sisinya ditulis inline. */
function setBox(next: ChatBox | null): void {
  box = next ? insideViewport(next) : null;
  for (const side of ['left', 'top', 'width', 'height', 'right', 'bottom'] as const) {
    chatWindow.style[side] = '';
  }

  if (!box) {
    chatWindow.classList.remove('chat--moved');
    localStorage.removeItem(STORAGE_BOX);
    return;
  }

  chatWindow.style.left = `${box.left}px`;
  chatWindow.style.top = `${box.top}px`;
  chatWindow.style.width = `${box.width}px`;
  chatWindow.style.height = `${box.height}px`;
  chatWindow.style.right = 'auto';
  chatWindow.style.bottom = 'auto';
  chatWindow.classList.add('chat--moved');
  localStorage.setItem(STORAGE_BOX, JSON.stringify(box));
}

/** Perbesar mengisi lebar layar penuh; seret bebas mengembalikan kendali ke user. */
function setMaximized(next: boolean): void {
  maximized = next;
  chatWindow.classList.toggle('chat--max', next);
  chatMaximize.setAttribute('aria-pressed', String(next));
  const label = next ? 'Perkecil chat' : 'Perbesar chat';
  chatMaximize.title = label;
  chatMaximize.setAttribute('aria-label', label);
}

function dragChat(event: PointerEvent): void {
  if (event.button !== 0) return;
  if (event.target instanceof Element && event.target.closest('button')) return;

  const start = chatWindow.getBoundingClientRect();
  const grab = { x: event.clientX - start.left, y: event.clientY - start.top };
  let moved = false;

  const onMove = (move: PointerEvent): void => {
    if (!moved) {
      moved = true;
      setMaximized(false);
      chatWindow.classList.add('chat--dragging');
    }
    setBox({ left: move.clientX - grab.x, top: move.clientY - grab.y, width: start.width, height: start.height });
  };

  const onUp = (): void => {
    chatWindow.classList.remove('chat--dragging');
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  event.preventDefault();
}

/** Jendela yang sedang mengambang jangan sampai tertinggal di luar layar. */
function keepBoxOnScreen(): void {
  if (box) setBox(box);
}

/** Setiap perubahan jeda langsung ditulis ulang ke aturan tool di workspace. */
async function applyRuleDelay(): Promise<void> {
  if (!workspace) return;
  try {
    const state = await chatApi.setRules(ruleDelay);
    if (!state.ok) setNotice('error', 'Aturan jeda delegasi tidak bisa ditulis ke workspace ini.');
  } catch (error) {
    setNotice('error', describeError(error) || 'Aturan jeda delegasi gagal ditulis.');
  }
}

function openChat(): void {
  if (!workspace) {
    folderPicker?.show(null);
    return;
  }
  chatWindow.hidden = false;
  document.body.classList.add('chat-open');
  updateLauncher();
  updateComposer();
  if (!bootstrap && !bootLoading) {
    void loadBootstrap();
  } else {
    ensureStream();
    renderMessages({ forceBottom: true });
  }
  if (window.innerWidth > 760) {
    window.setTimeout(() => input.focus(), 80);
  }
}

function closeChat(): void {
  chatWindow.hidden = true;
  document.body.classList.remove('chat-open');
  updateLauncher();
}

async function loadBootstrap(): Promise<void> {
  if (!workspace) return;
  const generation = workspaceGeneration;
  bootLoading = true;
  bootError = false;
  setNotice('info', 'Menyiapkan OpenCode…');
  renderMessages();
  updateLauncher();
  updateComposer();

  try {
    const data = await chatApi.bootstrap(ruleDelay);
    if (generation !== workspaceGeneration) return;

    bootstrap = data;
    workspace = data.workspace;
    models = data.models;
    agents = data.agents;
    sessions = data.sessions;
    officeRoster = data.roster ?? [];
    office?.setCrew(crewFromRoster(officeRoster));
    office?.setFloorMode('live');
    void refreshPresence();
    updateChatFolder();
    updateLauncher();

    renderModelSelect();
    renderAgentSelect();
    renderSessionSelect();

    setNotice(null);
    if (data.rules && !data.rules.ok) {
      setNotice('error', 'Aturan jeda delegasi tidak bisa ditulis ke workspace ini.');
    }
    const latest = sessions[0];
    if (latest) {
      await selectSession(latest, { initial: true });
    } else {
      startNewChat(false);
    }
    ensureStream();
  } catch (error) {
    if (generation !== workspaceGeneration) return;
    bootError = true;
    setNotice('error', describeError(error), { label: 'Coba lagi', run: () => void loadBootstrap() });
    renderMessages();
  } finally {
    if (generation === workspaceGeneration) {
      bootLoading = false;
      updateLauncher();
      updateComposer();
      renderMessages();
    }
  }
}

function renderModelSelect(): void {
  modelSelect.replaceChildren();
  selectedModel = null;

  for (const group of models) {
    if (!group.models.length) continue;
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.name;
    for (const model of group.models) {
      const option = document.createElement('option');
      option.value = `${model.providerID}/${model.id}`;
      option.textContent = model.name;
      option.title = model.id;
      optgroup.append(option);
    }
    modelSelect.append(optgroup);
  }

  if (!modelSelect.options.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Tidak ada model';
    option.disabled = true;
    modelSelect.append(option);
    modelSelect.disabled = true;
    return;
  }
  modelSelect.disabled = false;

  const stored = localStorage.getItem(STORAGE_MODEL);
  const defaultKey = bootstrap?.defaultModel
    ? `${bootstrap.defaultModel.providerID}/${bootstrap.defaultModel.modelID}`
    : '';
  const candidates = [stored, defaultKey].filter((value): value is string => Boolean(value));
  const match = candidates.find((key) => Array.from(modelSelect.options).some((option) => option.value === key));
  modelSelect.value = match ?? modelSelect.options[0].value;
  selectedModel = modelFromKey(modelSelect.value);
}

function renderAgentSelect(): void {
  agentSelect.replaceChildren();
  for (const agent of agents) {
    const option = document.createElement('option');
    option.value = agent.name;
    option.textContent = agent.name;
    option.title = agent.description;
    agentSelect.append(option);
  }
  if (!agentSelect.options.length) {
    const option = document.createElement('option');
    option.value = 'build';
    option.textContent = 'build';
    agentSelect.append(option);
  }
  const stored = localStorage.getItem(STORAGE_AGENT);
  const match = [stored, 'build'].find((value) =>
    agentSelect.options ? Array.from(agentSelect.options).some((option) => option.value === value) : false
  );
  agentSelect.value = match ?? agentSelect.options[0].value;
  selectedAgent = agentSelect.value || 'build';
}

function renderSessionSelect(): void {
  sessionSelect.replaceChildren();
  const fresh = document.createElement('option');
  fresh.value = 'new';
  fresh.textContent = '＋ Chat baru';
  sessionSelect.append(fresh);

  for (const session of sessions) {
    const option = document.createElement('option');
    option.value = session.id;
    option.textContent = session.title;
    option.title = session.title;
    sessionSelect.append(option);
  }
  sessionSelect.value = currentSession?.id ?? 'new';
}

function upsertSession(info: Record<string, unknown>): void {
  if (typeof info.id !== 'string') return;
  const previous = sessions.find((entry) => entry.id === info.id);
  const summary: SessionSummary = {
    id: info.id,
    title: typeof info.title === 'string' && info.title.trim() ? info.title : 'Sesi tanpa judul',
    created: typeof (info.time as { created?: number } | undefined)?.created === 'number'
      ? (info.time as { created: number }).created
      : Date.now(),
    updated: typeof (info.time as { updated?: number } | undefined)?.updated === 'number'
      ? (info.time as { updated: number }).updated
      : Date.now(),
    // Event sesi tidak selalu membawa lineage, jadi jangan hapus yang sudah diketahui.
    agent: typeof info.agent === 'string' ? info.agent : previous?.agent ?? null,
    parentID:
      typeof info.parentID === 'string' && info.parentID ? info.parentID : previous?.parentID ?? null,
  };

  const index = sessions.findIndex((session) => session.id === summary.id);
  if (index >= 0) {
    sessions[index] = summary;
    const option = Array.from(sessionSelect.options).find((entry) => entry.value === summary.id);
    if (option && option.textContent !== summary.title) option.textContent = summary.title;
    if (currentSession?.id === summary.id) currentSession = summary;
    return;
  }

  sessions.unshift(summary);
  renderSessionSelect();
}

function modelFromKey(key: string): ModelKey | null {
  for (const group of models) {
    for (const model of group.models) {
      if (`${model.providerID}/${model.id}` === key) {
        return { providerID: model.providerID, modelID: model.id };
      }
    }
  }
  return null;
}

async function selectSession(session: SessionSummary, options: { initial?: boolean } = {}): Promise<void> {
  const generation = workspaceGeneration;
  currentSession = session;
  messages = [];
  permissions.clear();
  questions.clear();
  reading = true;
  setNotice(null);
  renderSessionSelect();
  renderMessages({ forceBottom: true });
  renderPrompts();
  updateComposer();

  try {
    const data = await chatApi.session(session.id);
    if (generation !== workspaceGeneration || currentSession?.id !== session.id) return;

    messages = rawToLive(data.messages);
    if (data.status.type === 'idle') runningSessions.delete(session.id);
    else runningSessions.add(session.id);
    for (const request of data.permissions) permissions.set(request.id, request);
    for (const request of data.questions) questions.set(request.id, request);

    if (data.status.type === 'retry') {
      setNotice('retry', typeof data.status.message === 'string' ? data.status.message : 'OpenCode mencoba ulang…');
    }
    if (runningSessions.has(session.id)) schedulePresence(0);
    scheduleFallbackPoll();
  } catch (error) {
    if (generation !== workspaceGeneration) return;
    setNotice('error', describeError(error), { label: 'Muat ulang', run: () => void selectSession(session) });
  } finally {
    if (generation === workspaceGeneration && currentSession?.id === session.id) {
      reading = false;
      renderMessages({ forceBottom: options.initial ?? true });
      renderPrompts();
      updateComposer();
    }
  }
}

function startNewChat(focus: boolean): void {
  currentSession = null;
  messages = [];
  permissions.clear();
  questions.clear();
  reading = false;
  setNotice(null);
  renderSessionSelect();
  renderPrompts();
  renderMessages({ forceBottom: true });
  updateComposer();
  if (focus) input.focus();
}

async function sendMessage(): Promise<void> {
  const text = input.value.trim();
  if (!text || !workspace || sending || isCurrentRunning() || bootLoading || reading) return;
  if (!selectedModel) {
    setNotice('error', 'Pilih model OpenCode terlebih dahulu.');
    return;
  }

  const generation = workspaceGeneration;
  const model = selectedModel;
  const agent = selectedAgent;
  const connected = ensureStream();
  sending = true;
  sendPhase = currentSession ? 'Mengirim permintaan…' : 'Membuat sesi…';
  setNotice(null);
  updateComposer();

  try {
    let session = currentSession;
    if (!session) {
      const created = await chatApi.createSession();
      if (generation !== workspaceGeneration) return;
      session = created;
      currentSession = created;
      sessions = [created, ...sessions.filter((entry) => entry.id !== created.id)];
      messages = [];
      renderSessionSelect();
      renderMessages({ forceBottom: true });
      sendPhase = 'Mengirim permintaan…';
      updateComposer();
    }

    await connected;
    fatalAborts.delete(session.id);
    await chatApi.send(session.id, text, model, agent);
    if (generation !== workspaceGeneration || currentSession?.id !== session.id) return;

    input.value = '';
    resizeInput();
    sending = false;
    sendPhase = '';
    runningSessions.add(session.id);
    schedulePresence(0);
    scheduleFallbackPoll();
    setNotice(null);
  } catch (error) {
    if (generation !== workspaceGeneration) return;
    sending = false;
    sendPhase = '';
    setNotice('error', describeError(error), { label: 'Coba lagi', run: () => form.requestSubmit() });
  } finally {
    if (generation === workspaceGeneration) {
      sending = false;
      sendPhase = '';
      updateComposer();
    }
  }
}

async function stopResponse(): Promise<void> {
  const session = currentSession;
  if (!session || !runningSessions.has(session.id)) return;
  sendButton.disabled = true;
  try {
    await chatApi.abort(session.id);
  } catch (error) {
    setNotice('error', describeError(error), { label: 'Muat ulang', run: () => void refreshCurrentSession() });
  } finally {
    updateComposer();
  }
}

function ensureStream(): Promise<void> {
  if (!workspace) return Promise.resolve();
  if (!stream) connectStream();
  return waitForStream();
}

function connectStream(): void {
  if (!workspace || stream) return;
  window.clearTimeout(streamRetryTimer);
  streamRetryTimer = 0;

  const source = new EventSource('/api/chat/events');
  stream = source;

  source.onopen = () => {
    if (stream !== source) return;
    streamReady = true;
    streamAttempts = 0;
    window.clearTimeout(streamRetryTimer);
    streamRetryTimer = 0;
    window.clearTimeout(streamNoticeTimer);
    streamNoticeTimer = 0;
    stopFallbackPoll();
    for (const resolve of streamWaiters) resolve();
    streamWaiters.clear();

    if (streamErrorShown) {
      streamErrorShown = false;
      if (noticeKind === 'disconnect') setNotice(null);
      if (currentSession) void refreshCurrentSession();
    }
  };

  source.onerror = () => {
    if (stream !== source) return;
    // Chrome menutup EventSource permanen saat handshake gagal (mis. 502),
    // jadi reconnect harus dibuat ulang manual.
    streamReady = false;
    streamErrorShown = true;
    source.close();
    stream = null;
    scheduleFallbackPoll();

    if (!streamNoticeTimer) {
      streamNoticeTimer = window.setTimeout(() => {
        streamNoticeTimer = 0;
        if (!streamReady && !chatWindow.hidden) {
          setNotice('disconnect', 'Koneksi event terputus. Mencoba menyambung ulang…');
        }
      }, 4_000);
    }

    const delay = Math.min(500 * 2 ** streamAttempts, 8_000);
    streamAttempts += 1;
    streamRetryTimer = window.setTimeout(() => {
      streamRetryTimer = 0;
      connectStream();
    }, delay);
  };

  source.onmessage = (raw) => {
    if (!raw.data) return;
    let event: ChatEvent;
    try {
      event = JSON.parse(raw.data) as ChatEvent;
    } catch {
      return;
    }
    handleEvent(event);
  };
}

function waitForStream(timeoutMs = 3_000): Promise<void> {
  if (streamReady) return Promise.resolve();
  return new Promise((resolve) => {
    let timer = 0;
    const done = () => {
      window.clearTimeout(timer);
      streamWaiters.delete(done);
      resolve();
    };
    streamWaiters.add(done);
    timer = window.setTimeout(done, timeoutMs);
  });
}

function scheduleFallbackPoll(): void {
  window.clearTimeout(fallbackTimer);
  fallbackTimer = 0;
  if (streamReady || !currentSession || !isCurrentRunning()) return;

  fallbackTimer = window.setTimeout(async () => {
    fallbackTimer = 0;
    if (streamReady || !currentSession || !isCurrentRunning()) return;
    await refreshCurrentSession();
    scheduleFallbackPoll();
  }, 1_500);
}

function stopFallbackPoll(): void {
  window.clearTimeout(fallbackTimer);
  fallbackTimer = 0;
}

function disconnectStream(): void {
  window.clearTimeout(streamRetryTimer);
  window.clearTimeout(streamNoticeTimer);
  streamRetryTimer = 0;
  streamNoticeTimer = 0;
  streamAttempts = 0;
  const source = stream;
  stream = null;
  source?.close();
  streamReady = false;
  streamErrorShown = false;
  stopFallbackPoll();
  for (const resolve of streamWaiters) resolve();
  streamWaiters.clear();
}

function handleEvent(event: ChatEvent): void {
  const props = event.properties ?? {};
  const sessionID = typeof props.sessionID === 'string' ? props.sessionID : '';

  switch (event.type) {
    case 'bridge.error':
      setNotice(
        'disconnect',
        typeof props.message === 'string' ? props.message : 'Koneksi ke server terputus.'
      );
      return;

    case 'session.created':
    case 'session.updated': {
      const info = props.info as Record<string, unknown> | undefined;
      if (info) upsertSession(info);
      schedulePresence();
      return;
    }

    case 'session.deleted': {
      const info = props.info as Record<string, unknown> | undefined;
      const id = typeof info?.id === 'string' ? info.id : sessionID;
      sessions = sessions.filter((session) => session.id !== id);
      if (currentSession?.id === id) {
        startNewChat(false);
        setNotice('info', 'Sesi dihapus.');
      } else {
        renderSessionSelect();
      }
      schedulePresence();
      return;
    }

    case 'session.status': {
      const status = props.status as Record<string, unknown> | undefined;
      if (!sessionID || !status) return;
      const type = typeof status.type === 'string' ? status.type : 'idle';
      if (type === 'idle') {
        markSessionIdle(sessionID);
      } else {
        runningSessions.add(sessionID);
        // Sesi anak (subagent) juga sibuk: kursi di lantai kantor ikut berubah.
        schedulePresence(0);
        if (sessionID === currentSession?.id) {
          if (type === 'retry') {
            const message =
              typeof status.message === 'string' ? status.message : 'Provider sedang bermasalah, mencoba ulang…';
            setNotice('retry', message);
            if (FATAL_PROVIDER_RE.test(message)) abortFatalSession(sessionID, message);
          } else if (noticeKind === 'retry') {
            setNotice(null);
          }
          updateComposer();
          scheduleFallbackPoll();
        }
      }
      return;
    }

    case 'session.idle':
      if (sessionID) markSessionIdle(sessionID);
      return;

    case 'session.error': {
      if (sessionID === currentSession?.id) {
        const message = describeError(props.error);
        setNotice('error', message);
        if (sessionID && FATAL_PROVIDER_RE.test(message)) abortFatalSession(sessionID, message);
      }
      return;
    }

    case 'message.updated':
    case 'message.part.updated':
    case 'message.part.delta': {
      if (!sessionID || sessionID !== currentSession?.id) return;
      const next = applyChatEvent(messages, event, sessionID);
      if (next !== messages) {
        messages = next;
        scheduleRender();
      }
      return;
    }

    case 'message.removed': {
      const messageID = typeof props.messageID === 'string' ? props.messageID : '';
      if (!messageID || sessionID !== currentSession?.id) return;
      messages = messages.filter((message) => message.id !== messageID);
      scheduleRender();
      return;
    }

    case 'permission.asked':
    case 'permission.v2.asked': {
      const request = normalizePermission(props);
      if (!request) return;
      permissions.set(request.id, request);
      if (request.sessionID === currentSession?.id) renderPrompts();
      return;
    }

    case 'permission.replied':
    case 'permission.v2.replied': {
      const requestID = typeof props.requestID === 'string' ? props.requestID : '';
      if (!requestID) return;
      permissions.delete(requestID);
      if (sessionID === currentSession?.id) renderPrompts();
      return;
    }

    case 'question.asked':
    case 'question.v2.asked': {
      const request = normalizeQuestion(props);
      if (!request) return;
      questions.set(request.id, request);
      if (request.sessionID === currentSession?.id) renderPrompts();
      return;
    }

    case 'question.replied':
    case 'question.v2.replied':
    case 'question.rejected':
    case 'question.v2.rejected': {
      const requestID = typeof props.requestID === 'string' ? props.requestID : '';
      if (!requestID) return;
      questions.delete(requestID);
      if (sessionID === currentSession?.id) renderPrompts();
      return;
    }

    default:
      return;
  }
}

function markSessionIdle(sessionID: string): void {
  runningSessions.delete(sessionID);
  if (sessionID === currentSession?.id) stopFallbackPoll();
  schedulePresence(0);
  if (sessionID !== currentSession?.id) {
    if (!runningSessions.size) releaseOfficeAgent();
    updateLauncher();
    return;
  }
  if (!runningSessions.size) releaseOfficeAgent();
  if (noticeKind === 'retry') setNotice(null);
  updateComposer();
  updateLauncher();
  window.clearTimeout(historyReloadTimer);
  historyReloadTimer = window.setTimeout(() => {
    if (currentSession?.id === sessionID) void refreshCurrentSession();
  }, 220);
}

function abortFatalSession(sessionID: string, message: string): void {
  if (fatalAborts.has(sessionID)) return;
  fatalAborts.add(sessionID);
  void chatApi
    .abort(sessionID)
    .catch(() => undefined)
    .then(() => {
      if (sessionID !== currentSession?.id) return;
      setNotice('error', `${message} — ganti model lewat dropdown Model untuk melanjutkan.`);
    });
}

async function refreshCurrentSession(): Promise<void> {
  const session = currentSession;
  if (!session) return;
  const generation = workspaceGeneration;
  try {
    const data = await chatApi.session(session.id);
    if (generation !== workspaceGeneration || currentSession?.id !== session.id) return;
    messages = rawToLive(data.messages);
    if (data.status.type === 'idle') {
      runningSessions.delete(session.id);
      stopFallbackPoll();
      if (!runningSessions.size) releaseOfficeAgent();
    } else {
      runningSessions.add(session.id);
      schedulePresence(0);
    }
    permissions.clear();
    for (const request of data.permissions) permissions.set(request.id, request);
    questions.clear();
    for (const request of data.questions) questions.set(request.id, request);
    renderMessages();
    renderPrompts();
    updateComposer();
    updateLauncher();
  } catch {
    // The live stream may still recover; a manual reload is available via notice actions.
  }
}

function normalizePermission(props: Record<string, unknown>): PermissionRequest | null {
  const id = typeof props.id === 'string' ? props.id : '';
  const sessionID = typeof props.sessionID === 'string' ? props.sessionID : '';
  if (!id || !sessionID) return null;
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
  return {
    id,
    sessionID,
    permission: typeof props.permission === 'string' ? props.permission : typeof props.action === 'string' ? props.action : 'tool',
    patterns: strings(props.patterns ?? props.resources),
    always: strings(props.always ?? props.save),
    metadata: typeof props.metadata === 'object' && props.metadata !== null ? (props.metadata as Record<string, unknown>) : undefined,
  };
}

function normalizeQuestion(props: Record<string, unknown>): QuestionRequest | null {
  const id = typeof props.id === 'string' ? props.id : '';
  const sessionID = typeof props.sessionID === 'string' ? props.sessionID : '';
  const asked = Array.isArray(props.questions) ? props.questions : [];
  if (!id || !sessionID || !asked.length) return null;
  const normalized = asked
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const question = entry as Record<string, unknown>;
      const options = Array.isArray(question.options)
        ? question.options
            .map((option) => {
              if (!option || typeof option !== 'object') return null;
              const record = option as Record<string, unknown>;
              const label = typeof record.label === 'string' ? record.label : '';
              if (!label) return null;
              return { label, description: typeof record.description === 'string' ? record.description : '' };
            })
            .filter((option): option is { label: string; description: string } => option !== null)
        : [];
      return {
        question: typeof question.question === 'string' ? question.question : '',
        header: typeof question.header === 'string' ? question.header : 'Pertanyaan',
        options,
        multiple: question.multiple === true,
        custom: question.custom !== false,
      };
    })
    .filter((question): question is NonNullable<typeof question> => question !== null);
  if (!normalized.length) return null;
  return { id, sessionID, questions: normalized };
}

function scheduleRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  window.requestAnimationFrame(() => {
    renderQueued = false;
    renderMessages();
    updateComposer();
  });
}

function renderMessages(options: { forceBottom?: boolean } = {}): void {
  const nearBottom =
    messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 96;
  cancelPendingDiagrams();
  messagesEl.replaceChildren();
  clockHosts.length = 0;

  if (!workspace) {
    messagesEl.append(renderEmptyState('Buka workspace', 'Pilih folder proyek untuk mulai menggunakan OpenCode.'));
  } else if (bootLoading) {
    messagesEl.append(renderLoading('Menyiapkan OpenCode…', 'Menghubungkan CLI dan membaca konfigurasi workspace.'));
  } else if (reading) {
    messagesEl.append(renderLoading('Memuat sesi…', 'Mengambil riwayat percakapan.'));
  } else if (!messages.length) {
    const title = bootError ? 'OpenCode belum siap' : 'Mulai percakapan';
    const body = bootError
      ? 'Periksa pesan error di atas, lalu coba lagi.'
      : `OpenCode akan bekerja langsung di folder ${workspace.name}. Ia bisa membaca, menulis, dan menjalankan perintah — setiap aksi sensitif meminta izin.`;
    messagesEl.append(renderEmptyState(title, body));
    if (!bootError) messagesEl.append(renderSuggestions());
  } else {
    const running = isCurrentRunning();
    messages.forEach((message, index) => {
      const node = renderMessage(message, running && index === messages.length - 1);
      if (node) messagesEl.append(node);
    });
    // Balasan assistant belum terlihat sama sekali: tetap tunjankan gelembung kerja.
    if (running && messages[messages.length - 1]?.role !== 'assistant') {
      const content = el('div', 'msg__content');
      const since = messages[messages.length - 1]?.created ?? Date.now();
      content.append(renderWorkBar(RUN_LABEL.prepare, since));
      messagesEl.append(wrapAssistant(content));
    }
    if (nearBottom || options.forceBottom) {
      for (const node of Array.from(
        messagesEl.querySelectorAll<HTMLElement>('.reasoning--live .reasoning__text')
      )) {
        node.scrollTop = node.scrollHeight;
      }
    }
  }

  syncOffice(currentRun());
  if (!clockHosts.length) stopWorkClock();

  if (options.forceBottom || nearBottom) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function renderEmptyState(title: string, body: string): HTMLElement {
  const wrap = el('div', 'chat__empty');
  const mark = el('span', 'chat__empty-mark');
  mark.append(icon(ICON.terminal, 22));
  wrap.append(mark, el('h3', 'chat__empty-title', title), el('p', 'chat__empty-text', body));
  if (workspace) {
    const path = el('p', 'chat__empty-path', workspace.path);
    path.title = workspace.path;
    wrap.append(path);
  }
  return wrap;
}

function renderLoading(title: string, body: string): HTMLElement {
  const wrap = el('div', 'chat__loading');
  const spinner = el('span', 'spinner');
  const text = el('div');
  text.append(el('p', 'chat__loading-title', title), el('p', 'chat__loading-text', body));
  wrap.append(spinner, text);
  return wrap;
}

function renderSuggestions(): HTMLElement {
  const wrap = el('div', 'chat__suggestions');
  const prompts = [
    'Jelaskan struktur proyek ini',
    'Cari bug atau masalah yang perlu diperbaiki',
    'Ringkas apa yang bisa ditingkatkan',
    'Buat contoh jawaban lengkap: markdown, tabel, diagram alur mermaid, dan chart xychart',
  ];
  for (const prompt of prompts) {
    const button = el('button', 'chat__suggestion', prompt);
    button.type = 'button';
    button.addEventListener('click', () => {
      input.value = prompt;
      resizeInput();
      input.focus();
      updateComposer();
    });
    wrap.append(button);
  }
  return wrap;
}

function renderMessage(message: LiveMessage, runningLast: boolean): HTMLElement | null {
  if (message.role === 'user') {
    const article = el('article', 'msg msg--user');
    const bubble = el('div', 'msg__bubble');
    const text = message.parts
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text as string)
      .join('\n')
      .trim();
    if (text) renderMarkdown(bubble, text);
    if (!bubble.childElementCount) return null;
    article.append(bubble);
    return article;
  }

  const content = el('div', 'msg__content');
  let hasContent = false;
  let lastTextBlock: HTMLElement | null = null;
  const phase = runningLast ? runState(message) : null;
  if (phase) content.append(renderWorkBar(phase.label, phase.since));

  for (const part of message.parts) {
    if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
      const block = el('div', 'msg__text');
      renderMarkdown(block, part.text);
      if (block.childElementCount) {
        content.append(block);
        lastTextBlock = block;
        hasContent = true;
      }
    } else if (part.type === 'tool') {
      content.append(renderTool(part));
      hasContent = true;
    } else if (
      part.type === 'reasoning' &&
      (typeof part.text === 'string' ? part.text.trim() : true)
    ) {
      content.append(renderReasoning(part, runningLast && !isReasoningSettled(part)));
      hasContent = true;
    } else if (part.type === 'file' && typeof part.filename === 'string') {
      const chip = el('span', 'msg__file', part.filename);
      content.append(chip);
      hasContent = true;
    }
  }

  if (message.error && !isAbortError(message.error)) {
    const error = el('div', 'msg__error');
    error.append(el('p', 'msg__error-title', 'OpenCode error'), el('p', 'msg__error-text', describeError(message.error)));
    content.append(error);
    hasContent = true;
  }

  if (!hasContent && !phase) return null;
  if (runningLast && lastTextBlock) {
    const caret = el('span', 'stream-caret');
    caret.setAttribute('aria-hidden', 'true');
    lastTextBlock.append(caret);
  }

  return wrapAssistant(content);
}

function wrapAssistant(content: HTMLElement): HTMLElement {
  const article = el('article', 'msg msg--assistant');
  const head = el('header', 'msg__head');
  const avatar = el('span', 'msg__avatar', 'OC');
  const name = el('span', 'msg__name', 'OpenCode');
  head.append(avatar, name);
  article.append(head, content);
  return article;
}

type RunPhase = 'prepare' | 'think' | 'tool' | 'write';

interface RunState {
  phase: RunPhase;
  label: string;
  since: number;
}

const RUN_LABEL: Record<RunPhase, string> = {
  prepare: 'Menyiapkan…',
  think: 'Menalar…',
  tool: 'Menjalankan alat…',
  write: 'Menulis jawaban…',
};

function isReasoningSettled(part: Part): boolean {
  return typeof part.time?.end === 'number';
}

function runState(message: LiveMessage): RunState {
  let tool = '';
  let thinking = false;
  let settled = false;
  let talking = false;

  for (const part of message.parts) {
    if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) talking = true;
    if (part.type === 'tool') {
      const status = part.state?.status;
      if (status === 'running' || status === 'pending') tool = prettyToolName(part.tool);
    }
    if (part.type === 'reasoning') {
      if (isReasoningSettled(part)) settled = true;
      else thinking = true;
    }
  }

  const since = message.created;
  // Alat yang sedang jalan selalu menang: token bisa saja masih mengalir saat tool dijalankan.
  // Label tool sudah diawali kata kerja, jadi tidak perlu ditambahi "Menjalankan" lagi.
  if (tool) return { phase: 'tool', label: `${tool}…`, since };
  if (thinking) return { phase: 'think', label: RUN_LABEL.think, since };
  if (talking || settled) return { phase: 'write', label: RUN_LABEL.write, since };
  return { phase: 'prepare', label: RUN_LABEL.prepare, since };
}

/** The phase the currently open session is in, or null when nothing is running. */
function currentRun(): RunState | null {
  // Samakan dengan guard renderMessages: selama panel belum menampilkan pesan,
  // `messages` masih berisi sesi lama dan fasenya tidak boleh dilaporkan.
  if (!workspace || bootLoading || reading || !messages.length || !isCurrentRunning()) return null;
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant') {
    return { phase: 'prepare', label: RUN_LABEL.prepare, since: last?.created ?? Date.now() };
  }
  return runState(last);
}

function renderWorkBar(label: string, since: number): HTMLElement {
  const bar = el('div', 'workbar');
  const dots = el('span', 'typing');
  dots.append(el('span'), el('span'), el('span'));
  const clock = el('span', 'workbar__clock');
  bar.append(dots, el('span', 'workbar__label', label), clock);
  showWorkClock(clock, since);
  return bar;
}

function showWorkClock(host: HTMLElement, since: number): void {
  clockHosts.push({ el: host, since });
  host.textContent = elapsedLabel(since);
  if (workClockTimer) return;
  workClockTimer = window.setInterval(() => {
    for (const entry of clockHosts) entry.el.textContent = elapsedLabel(entry.since);
  }, 1_000);
}

function stopWorkClock(): void {
  window.clearInterval(workClockTimer);
  workClockTimer = 0;
}

function elapsedLabel(since: number): string {
  if (!since) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - since) / 1000));
  if (seconds < 60) return `${seconds} dtk`;
  return `${Math.floor(seconds / 60)} mnt ${seconds % 60} dtk`;
}

function renderTool(part: Part): HTMLElement {
  const state = part.state;
  const status = state?.status ?? 'pending';
  const details = el('details', 'tool');
  details.dataset.status = status;
  if (status === 'error') details.open = true;

  const summary = el('summary', 'tool__summary');
  const mark = el('span', 'tool__mark');
  if (status === 'completed') mark.append(icon(ICON.check, 12));
  else if (status === 'error') mark.append(icon(ICON.close, 12));
  const name = el('span', 'tool__name', prettyToolName(part.tool));
  const title = el('span', 'tool__title', typeof state?.title === 'string' ? state.title : '');
  const badge = el('span', 'tool__badge', toolStatusLabel(status));
  summary.append(mark, name, title, badge);
  details.append(summary);

  const body = el('div', 'tool__body');
  const inputData = state?.input;
  if (inputData && Object.keys(inputData).length) {
    body.append(el('p', 'tool__label', 'Input'));
    const pre = el('pre', 'tool__pre');
    pre.textContent = truncate(JSON.stringify(inputData, null, 2), 4_000);
    body.append(pre);
  }
  if (typeof state?.output === 'string' && state.output.trim()) {
    body.append(el('p', 'tool__label', 'Output'));
    const pre = el('pre', 'tool__pre');
    pre.textContent = truncate(state.output.trim(), 8_000);
    body.append(pre);
  }
  if (typeof state?.error === 'string' && state.error.trim()) {
    body.append(el('p', 'tool__label', 'Error'));
    const pre = el('pre', 'tool__pre tool__pre--error');
    pre.textContent = state.error;
    body.append(pre);
  }
  if (body.childElementCount) details.append(body);
  return details;
}

function toolStatusLabel(status: string): string {
  if (status === 'running') return 'Berjalan';
  if (status === 'completed') return 'Selesai';
  if (status === 'error') return 'Gagal';
  return 'Menunggu';
}

function renderReasoning(part: Part, live: boolean): HTMLElement {
  const raw = typeof part.text === 'string' ? part.text : '';
  const details = el('details', 'reasoning');
  if (live) details.classList.add('reasoning--live');
  const summary = el('summary', undefined, live ? 'Penalaran…' : 'Penalaran');
  const pre = el('pre', 'reasoning__text');
  // Saat masih menalar, yang paling penting adalah token terbaru, jadi potong dari depan.
  pre.textContent = live && raw.length > 4_000 ? `…${raw.slice(-4_000)}` : truncate(raw, 6_000);
  if (live) pre.append(el('span', 'stream-caret'));
  summary.addEventListener('click', () => {
    reasoningToggled.set(part.id, !details.open);
  });
  details.open = reasoningToggled.get(part.id) ?? live;
  details.append(summary, pre);
  return details;
}

function renderPrompts(): void {
  promptsEl.replaceChildren();
  const sessionID = currentSession?.id;
  if (!sessionID) {
    promptsEl.hidden = true;
    return;
  }

  const activePermissions = [...permissions.values()].filter((request) => request.sessionID === sessionID);
  const activeQuestions = [...questions.values()].filter((request) => request.sessionID === sessionID);

  for (const request of activePermissions) promptsEl.append(renderPermissionPrompt(request));
  for (const request of activeQuestions) promptsEl.append(renderQuestionPrompt(request));
  promptsEl.hidden = promptsEl.childElementCount === 0;
}

function renderPermissionPrompt(request: PermissionRequest): HTMLElement {
  const card = el('article', 'prompt');
  const head = el('header', 'prompt__head');
  head.append(el('span', 'prompt__kind', 'Izin diperlukan'), el('span', 'prompt__tool', prettyToolName(request.permission)));
  card.append(head);

  card.append(el('p', 'prompt__text', 'OpenCode ingin menggunakan tool ini di workspace.'));

  const targets = request.patterns?.length ? request.patterns : [];
  if (targets.length) {
    const list = el('ul', 'prompt__targets');
    for (const target of targets.slice(0, 8)) {
      const item = el('li');
      item.append(el('code', undefined, target));
      list.append(item);
    }
    if (targets.length > 8) list.append(el('li', 'prompt__more', `+${targets.length - 8} lainnya`));
    card.append(list);
  }

  const actions = el('div', 'prompt__actions');
  const error = el('p', 'prompt__error');
  error.hidden = true;

  const reply = async (kind: 'once' | 'always' | 'reject') => {
    const buttons = actions.querySelectorAll('button');
    buttons.forEach((button) => ((button as HTMLButtonElement).disabled = true));
    try {
      await chatApi.replyPermission(request.id, kind);
      permissions.delete(request.id);
      renderPrompts();
    } catch (caught) {
      error.textContent = describeError(caught);
      error.hidden = false;
      buttons.forEach((button) => ((button as HTMLButtonElement).disabled = false));
    }
  };

  const reject = el('button', 'button button--ghost', 'Tolak');
  reject.type = 'button';
  reject.addEventListener('click', () => void reply('reject'));
  const once = el('button', 'button', 'Izinkan');
  once.type = 'button';
  once.addEventListener('click', () => void reply('once'));
  actions.append(reject, once);

  if (request.always?.length) {
    const always = el('button', 'button button--soft', 'Selalu izinkan');
    always.type = 'button';
    always.addEventListener('click', () => void reply('always'));
    actions.append(always);
  }

  card.append(actions, error);
  return card;
}

function renderQuestionPrompt(request: QuestionRequest): HTMLElement {
  const card = el('article', 'prompt');
  const head = el('header', 'prompt__head');
  head.append(el('span', 'prompt__kind', 'OpenCode bertanya'));
  card.append(head);

  const answers: string[][] = request.questions.map(() => []);
  const customInputs: HTMLInputElement[] = [];
  const error = el('p', 'prompt__error');
  error.hidden = true;

  request.questions.forEach((question, index) => {
    const block = el('div', 'question');
    block.append(el('p', 'question__header', question.header), el('p', 'question__text', question.question));

    const options = el('div', 'question__options');
    for (const option of question.options) {
      const button = el('button', 'question__option');
      button.type = 'button';
      button.title = option.description;
      button.append(el('span', 'question__option-label', option.label));
      if (option.description) button.append(el('span', 'question__option-desc', option.description));
      button.addEventListener('click', () => {
        if (question.multiple) {
          const selected = answers[index].includes(option.label);
          answers[index] = selected
            ? answers[index].filter((value) => value !== option.label)
            : [...answers[index], option.label];
        } else {
          answers[index] = [option.label];
        }
        options.querySelectorAll('button').forEach((entry) => {
          const label = entry.querySelector('.question__option-label')?.textContent ?? '';
          entry.classList.toggle('is-selected', answers[index].includes(label));
        });
      });
      options.append(button);
    }
    if (options.childElementCount) block.append(options);

    if (question.custom) {
      const custom = document.createElement('input');
      custom.type = 'text';
      custom.className = 'question__input';
      custom.placeholder = 'Jawaban lain…';
      custom.setAttribute('aria-label', `Jawaban lain untuk ${question.header}`);
      customInputs[index] = custom;
      block.append(custom);
    }

    card.append(block);
  });

  const actions = el('div', 'prompt__actions');
  const submit = el('button', 'button', 'Kirim jawaban');
  submit.type = 'button';
  submit.addEventListener('click', async () => {
    error.hidden = true;
    const payload = request.questions.map((_, index) => {
      const custom = customInputs[index]?.value.trim() ?? '';
      const values = [...answers[index]];
      if (custom) values.push(custom);
      return values;
    });
    if (payload.some((values) => values.length === 0)) {
      error.textContent = 'Pilih minimal satu jawaban untuk setiap pertanyaan.';
      error.hidden = false;
      return;
    }
    submit.disabled = true;
    try {
      await chatApi.replyQuestion(request.id, payload);
      questions.delete(request.id);
      renderPrompts();
    } catch (caught) {
      error.textContent = describeError(caught);
      error.hidden = false;
      submit.disabled = false;
    }
  });
  actions.append(submit);
  card.append(actions, error);
  return card;
}

function setNotice(kind: NoticeKind | null, message = '', action?: { label: string; run: () => void }): void {
  noticeKind = kind ?? '';
  if (!kind || !message) {
    noticeEl.hidden = true;
    noticeEl.replaceChildren();
    return;
  }
  noticeEl.hidden = false;
  noticeEl.dataset.kind = kind;
  const text = el('span', 'chat__notice-text', message);
  noticeEl.replaceChildren(text);
  if (action) {
    const button = el('button', 'chat__notice-action', action.label);
    button.type = 'button';
    button.addEventListener('click', action.run);
    noticeEl.append(button);
  }
}

function isCurrentRunning(): boolean {
  return Boolean(currentSession && runningSessions.has(currentSession.id));
}

function isAnyRunning(): boolean {
  return runningSessions.size > 0;
}

function updateComposer(): void {
  const running = isCurrentRunning();
  const unavailable = !workspace || bootLoading || reading;
  const label = running ? 'Hentikan' : 'Kirim';
  sendButton.dataset.mode = running ? 'stop' : 'send';
  sendButton.title = label;
  sendButton.setAttribute('aria-label', running ? 'Hentikan respons OpenCode' : 'Kirim pesan');
  sendButton.disabled = running ? false : unavailable || sending || !selectedModel || !input.value.trim();
  input.disabled = !workspace || bootLoading;

  if (!workspace) statusEl.textContent = 'Pilih workspace';
  else if (bootLoading) statusEl.textContent = 'Menyiapkan OpenCode…';
  else if (reading) statusEl.textContent = 'Memuat sesi…';
  else if (sending) statusEl.textContent = sendPhase || 'Mengirim…';
  else if (running) statusEl.textContent = noticeKind === 'retry' ? 'Menunggu percobaan ulang…' : 'OpenCode sedang bekerja…';
  else statusEl.textContent = 'Siap';

  statusEl.dataset.state = running ? 'busy' : unavailable ? 'loading' : 'idle';
  updateLauncher();
}

function resizeInput(): void {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 132)}px`;
}

/** Nothing runs any more: drop the chip and let every employee go back to idle. */
function releaseOfficeAgent(): void {
  officeChipLabel = '';
  agentChip.hidden = true;
  agentChip.replaceChildren();
  schedulePresence(0);
}

function schedulePresence(delay = 400): void {
  window.clearTimeout(presenceTimer);
  presenceTimer = window.setTimeout(() => void refreshPresence(), delay);
}

/**
 * Ask the tool which sessions are running and seat the matching employees:
 * a plain run takes a desk, a delegation puts both sides at the meeting table.
 */
async function refreshPresence(): Promise<void> {
  if (!office || !workspace) return;
  let presence: Presence[] = [];
  try {
    const { statuses } = await chatApi.status();
    presence = buildPresence(officeRoster, sessionActivities(sessions, statuses));
    // Kursi dulu, teks belakangan: potongan pikiran bisa lambat tanpa memindahkan orang.
    office.applyPresence(presence);
    office.applyPresence(presence, await activityCopy(presence));
    presenceFailures = 0;
  } catch {
    // OpenCode belum sempat merespons; satu-dua percobaan gagal tidak mengubah
    // kursi. Bridge yang mati betulan tidak boleh membekukan status sibuk.
    presenceFailures += 1;
    if (presenceFailures >= 3) office.applyPresence(buildPresence(officeRoster, []));
  }

  syncOffice(currentRun());
  if (isAnyRunning()) schedulePresence(3_000);
}

/** Short bubble copy per busy session, quoted from what that session is really doing. */
async function activityCopy(presence: Presence[]): Promise<Record<string, string>> {
  const busy = presence.filter((entry) => entry.role !== 'idle' && entry.sessionID).slice(0, 6);
  if (!busy.length) return {};
  const { activities } = await chatApi.activity(busy.map((entry) => entry.sessionID as string));
  const copy: Record<string, string> = {};
  for (const entry of busy) {
    const text = bubbleCopy(activities[entry.sessionID as string]);
    if (text) copy[entry.sessionID as string] = text;
  }
  return copy;
}

/** The employee the header chip follows: the agent that owns the open session. */
function watchedEmployee(): string {
  if (!office) return 'OpenCode';
  const id = slugify(currentSession?.agent ?? selectedAgent);
  for (const agent of office.agents()) {
    if (agent.id === id) return agent.name;
  }
  return 'OpenCode';
}

/** Header chip: the phase of the session being watched, plus its elapsed clock. */
function syncOffice(run: RunState | null): void {
  if (!run) {
    officeChipLabel = '';
    agentChip.hidden = true;
    agentChip.replaceChildren();
    return;
  }

  const label = `${watchedEmployee()} · ${run.label}`;
  agentChip.hidden = false;
  if (label !== officeChipLabel) {
    officeChipLabel = label;
    agentChip.replaceChildren(el('span', undefined, label), el('span', 'workbar__clock'));
  }
  const clock = agentChip.querySelector<HTMLElement>('.workbar__clock');
  if (clock) showWorkClock(clock, run.since);
}
