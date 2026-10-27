import { ChatApiError, chatApi, terminalEventsUrl } from './client';
import { ICON, el, iconButton } from './dom';
import type { ShellInfo, TerminalEvent, TerminalSession, WorkspaceInfo } from './types';

const MONO = "ui-monospace, 'SF Mono', 'Cascadia Mono', monospace";
const HISTORY_MAX = 50;
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

export interface TerminalPanel {
  setWorkspace(next: WorkspaceInfo | null): void;
  refresh(): void;
}

type Xterm = import('@xterm/xterm').Terminal;
type Fit = import('@xterm/addon-fit').FitAddon;

interface Bundle {
  Terminal: typeof import('@xterm/xterm').Terminal;
  FitAddon: typeof import('@xterm/addon-fit').FitAddon;
}

let bundlePromise: Promise<Bundle> | null = null;

/** xterm.js hanya dimuat ketika tab terminal benar-benar dibuka. */
function loadBundle(): Promise<Bundle> {
  if (!bundlePromise) {
    const pending = Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
      import('@xterm/xterm/css/xterm.css'),
    ]).then(([term, fit]) => ({ Terminal: term.Terminal, FitAddon: fit.FitAddon }));
    bundlePromise = pending;
    pending.catch(() => {
      if (bundlePromise === pending) bundlePromise = null;
    });
  }
  return bundlePromise;
}

interface View {
  session: TerminalSession;
  stage: HTMLElement;
  group: HTMLElement;
  tab: HTMLButtonElement;
  term: Xterm | null;
  fit: Fit | null;
  stream: EventSource | null;
  line: string;
  history: string[];
  historyAt: number;
  queue: Promise<void>;
  dead: boolean;
  note: string;
  gone: boolean;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shortName(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? cwd;
}

export function mountTerminal(container: HTMLElement): TerminalPanel {
  let workspace: WorkspaceInfo | null = null;
  let shells: ShellInfo[] = [];
  let active: View | null = null;
  let message = '';
  let loading = false;
  const views: View[] = [];

  const root = el('div', 'term');

  const tabs = el('div', 'term__tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Terminal yang terbuka');

  const picker = el('select', 'term__picker');
  picker.setAttribute('aria-label', 'Shell untuk terminal baru');

  const addButton = iconButton('Terminal baru', ICON.plus, () => void create());
  const closeButton = iconButton('Tutup terminal ini', ICON.trash, () => {
    if (active) void destroy(active);
  });

  const bar = el('div', 'term__bar');
  bar.append(tabs, picker, addButton, closeButton);

  const messageEl = el('p', 'term__message');
  messageEl.setAttribute('role', 'status');

  const stages = el('div', 'term__stages');

  const empty = el('div', 'term__empty');
  empty.append(
    el('p', 'term__empty-title', 'Belum ada terminal'),
    el('p', 'term__empty-body', 'Buka shell di folder workspace aktif. Beberapa tab bisa berjalan bersamaan.')
  );

  const hint = el('p', 'term__hint');
  hint.textContent = 'Terminal ini memakai pipe, bukan PTY: baris dikirim setelah Enter, Ctrl+C dan aplikasi layar penuh tidak tersedia.';

  root.append(bar, messageEl, stages, empty, hint);
  container.append(root);

  function render(): void {
    messageEl.textContent = message;
    messageEl.hidden = !message;
    empty.hidden = views.length > 0;
    stages.hidden = views.length === 0;
    closeButton.disabled = !active;
    picker.disabled = shells.length === 0;
    for (const view of views) {
      const on = view === active;
      view.stage.hidden = !on;
      view.tab.setAttribute('aria-selected', String(on));
      view.group.classList.toggle('term__tab-group--dead', view.dead);
    }
  }

  function fillPicker(): void {
    picker.replaceChildren(
      ...shells.map((shell) => {
        const option = el('option', undefined, shell.label);
        option.value = shell.id;
        return option;
      })
    );
  }

  async function ensureShells(): Promise<void> {
    if (shells.length) return;
    const state = await chatApi.terminalShells();
    shells = state.shells;
    fillPicker();
  }

  function buildView(session: TerminalSession): View {
    const stage = el('div', 'term__stage');
    stage.setAttribute('role', 'tabpanel');

    const group = el('div', 'term__tab-group');

    const tab = el('button', 'term__tab');
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.textContent = `${session.label} · ${shortName(session.cwd)}`;
    tab.title = `${session.label} (${session.cwd})`;
    tab.addEventListener('click', () => activate(view));

    const close = iconButton(`Tutup ${session.label}`, ICON.close, () => void destroy(view));
    close.className = 'icon-btn term__tab-close';

    // Tombol di dalam tombol tidak valid, jadi label dan X bersebelahan dalam satu grup.
    group.append(tab, close);
    stages.append(stage);
    tabs.append(group);

    const view: View = {
      session,
      stage,
      group,
      tab,
      term: null,
      fit: null,
      stream: null,
      line: '',
      history: [],
      historyAt: 0,
      queue: Promise.resolve(),
      dead: false,
      note: '',
      gone: false,
    };
    return view;
  }

  function activate(view: View): void {
    active = view;
    render();
    if (view.term && !view.dead) {
      try {
        view.fit?.fit();
      } catch {
        // Stage masih tersembunyi saat chat ditutup; ukuran akan benar begitu terlihat.
      }
      view.term.focus();
    }
  }

  function send(view: View, data: string): void {
    view.queue = view.queue
      .then(() => chatApi.terminalInput(view.session.id, data))
      .then(() => undefined)
      .catch((error: unknown) => {
        const status = error instanceof ChatApiError ? error.status : 0;
        message = describeError(error);
        // 404/409 berarti shell-nya memang sudah tidak ada, bukan server yang rewel.
        if (status === 404 || status === 409) markDead(view, 'shell sudah selesai');
        render();
      });
  }

  function markDead(view: View, why: string): void {
    if (view.dead) return;
    view.dead = true;
    view.note = why;
    view.session.alive = false;
    view.stream?.close();
    view.stream = null;
    view.term?.write(`\r\n\u001b[2m[ ${why} ]\u001b[0m\r\n`);
  }

  /** xterm sudah siap: pasang stream SSE dan mulai meneruskan tombol. */
  async function attach(view: View): Promise<void> {
    const bundle = await loadBundle();
    if (view.gone || view.term) return;

    const term = new bundle.Terminal({
      cursorBlink: true,
      fontFamily: MONO,
      fontSize: 12,
      lineHeight: 1.32,
      scrollback: 4000,
      theme: {
        background: '#0d141b',
        foreground: '#f4efe6',
        cursor: '#e2b44a',
        selectionBackground: 'rgba(226, 180, 74, 0.3)',
      },
    });
    const fit = new bundle.FitAddon();
    term.loadAddon(fit);
    term.open(view.stage);
    fit.fit();
    term.onData((data) => onKeys(view, data));

    view.term = term;
    view.fit = fit;
    if (view.dead) {
      if (view.note) term.write(`\u001b[2m[ ${view.note} ]\u001b[0m\r\n`);
      render();
      return;
    }

    const stream = new EventSource(terminalEventsUrl(view.session.id));
    view.stream = stream;
    stream.onmessage = (event) => {
      let payload: TerminalEvent | null = null;
      try {
        payload = JSON.parse(String(event.data)) as TerminalEvent;
      } catch {
        payload = null;
      }
      if (!payload) return;
      if (payload.type === 'output') {
        if (payload.data) term.write(payload.data);
        return;
      }
      markDead(view, `shell selesai, kode ${payload.code ?? 0}`);
      render();
    };
    stream.onerror = () => {
      if (view.dead) return;
      message = 'Koneksi terminal terputus; browser mencoba menyambung lagi.';
      render();
    };
    term.focus();
  }

  function onKeys(view: View, raw: string): void {
    if (view.dead || !view.term) return;

    // PowerShell dan bash mengulang sendiri, jadi tombol diteruskan apa adanya.
    if (view.session.echo === 'shell') {
      send(view, raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
      return;
    }

    if (raw === '\r' || raw === '\n') return submit(view);
    if (raw === '\u007f' || raw === '\u0008') return backspace(view);
    if (raw === '\u0003') {
      view.term.write('^C\r\n');
      view.line = '';
      return send(view, '\n');
    }
    if (raw === '\u001b[A' || raw === '\u001b[B') return recall(view, raw === '\u001b[A' ? -1 : 1);
    if (raw.startsWith('\u001b')) return;

    const chunks = raw.replace(/\r\n/g, '\n').split('\n');
    chunks.forEach((chunk, index) => {
      if (index > 0) submit(view);
      const text = chunk.replace(CONTROL_CHARS, '');
      if (!text) return;
      view.line += text;
      view.term?.write(text);
    });
  }

  function submit(view: View): void {
    const line = view.line;
    view.line = '';
    view.term?.write('\r\n');
    if (line.trim()) {
      view.history.push(line);
      if (view.history.length > HISTORY_MAX) view.history.shift();
    }
    view.historyAt = view.history.length;
    send(view, `${line}\n`);
  }

  function backspace(view: View): void {
    if (!view.line) return;
    view.line = view.line.slice(0, -1);
    view.term?.write('\b \b');
  }

  function recall(view: View, step: number): void {
    if (!view.history.length) return;
    view.historyAt = Math.min(Math.max(view.historyAt + step, 0), view.history.length);
    view.line = view.history[view.historyAt] ?? '';
    view.term?.write(`\r\u001b[K${view.line}`);
  }

  async function create(): Promise<void> {
    if (!workspace) {
      message = 'Buka workspace lebih dulu sebelum menjalankan terminal.';
      render();
      return;
    }
    if (loading) return;
    loading = true;
    try {
      await ensureShells();
      const session = await chatApi.createTerminal(picker.value || shells[0]?.id || null);
      const view = buildView(session);
      views.push(view);
      activate(view);
      await attach(view);
      message = '';
      render();
    } catch (error) {
      message = describeError(error);
      render();
    } finally {
      loading = false;
    }
  }

  async function destroy(view: View): Promise<void> {
    const index = views.indexOf(view);
    if (index < 0) return;
    views.splice(index, 1);
    view.gone = true;
    view.stream?.close();
    view.stream = null;
    view.term?.dispose();
    view.term = null;
    view.group.remove();
    view.stage.remove();
    active = views[index] ?? views[index - 1] ?? null;
    render();
    if (active) activate(active);
    await chatApi.closeTerminal(view.session.id).catch(() => undefined);
  }

  function closeAll(): void {
    for (const view of [...views]) {
      view.gone = true;
      view.stream?.close();
      view.term?.dispose();
      view.group.remove();
      view.stage.remove();
      void chatApi.closeTerminal(view.session.id).catch(() => undefined);
    }
    views.length = 0;
    active = null;
    render();
  }

  const observer = new ResizeObserver(() => {
    if (active?.term && !active.dead) {
      try {
        active.fit?.fit();
      } catch {
        // Container sedang nol tinggi; percobaan berikutnya berhasil.
      }
    }
  });
  observer.observe(stages);

  return {
    setWorkspace(next) {
      const changed = (next?.path ?? '') !== (workspace?.path ?? '');
      workspace = next;
      if (changed) closeAll();
      render();
    },
    refresh() {
      if (!views.length && workspace && !loading) void create();
      else render();
    },
  };
}
