import { t } from '../i18n';
import { chatApi } from './client';
import { el } from './dom';
import type { AgenticToolChoice, AgenticToolState } from './types';

/** Warna & monogram tiap adapter; nama dan ketersediaan datang dari server. */
const MARKS: Record<string, { mark: string; color: string }> = {
  opencode: { mark: 'OC', color: '#e2b44a' },
  claude: { mark: 'CL', color: '#d97757' },
  kilo: { mark: 'K', color: '#7aa2f7' },
  phi: { mark: 'P', color: '#9b7bd4' },
  openclaw: { mark: 'OA', color: '#5fb49c' },
};

const FALLBACK_MARK = { mark: 'AI', color: '#8aa0ad' };

type View = 'list' | 'confirm' | 'switching';
type ToastKind = 'success' | 'error';

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Elemen #${id} tidak ditemukan.`);
  return node as T;
}

const pill = byId<HTMLButtonElement>('tool-pill');
const pillDot = byId<HTMLElement>('tool-pill-dot');
const pillLabel = byId<HTMLElement>('tool-pill-label');
const menu = byId<HTMLElement>('tool-menu');
const menuList = byId<HTMLElement>('tool-menu-list');
const menuRows = byId<HTMLElement>('tool-menu-rows');
const menuCount = byId<HTMLElement>('tool-menu-count');
const confirmView = byId<HTMLElement>('tool-confirm');
const confirmTitle = byId<HTMLElement>('tool-confirm-title');
const confirmMark = byId<HTMLElement>('tool-confirm-mark');
const confirmName = byId<HTMLElement>('tool-confirm-name');
const confirmChips = byId<HTMLElement>('tool-confirm-chips');
const confirmCaveats = byId<HTMLElement>('tool-confirm-caveats');
const confirmWarn = byId<HTMLElement>('tool-confirm-warn');
const confirmBack = byId<HTMLButtonElement>('tool-confirm-back');
const confirmCancel = byId<HTMLButtonElement>('tool-confirm-cancel');
const confirmGo = byId<HTMLButtonElement>('tool-confirm-go');
const switchingView = byId<HTMLElement>('tool-switching');
const switchingTitle = byId<HTMLElement>('tool-switching-title');
const overlay = byId<HTMLElement>('tool-switching-overlay');
const overlayTitle = byId<HTMLElement>('tool-overlay-title');
const chatWindow = byId<HTMLElement>('chat-window');
const toast = byId<HTMLElement>('tool-toast');
const toastIcon = byId<HTMLElement>('tool-toast-icon');
const toastTitle = byId<HTMLElement>('tool-toast-title');
const toastDetail = byId<HTMLElement>('tool-toast-detail');
const toastUndo = byId<HTMLButtonElement>('tool-toast-undo');

export interface ToolSwitcher {
  /** Sinkronkan pill dengan tool yang dilaporkan bootstrap. */
  setActive(tool: string, name: string): void;
  /** Ganti tool dari tab/perangkat lain lewat event SSE. */
  applyRemote(tool: string, name: string): void;
  /** Bahasa berganti: tulis ulang label dinamis yang sedang tampil. */
  refreshLabels(): void;
  dismiss(): void;
}

interface Options {
  onChanged: () => void;
}

function markFor(tool: string): { mark: string; color: string } {
  return MARKS[tool] ?? FALLBACK_MARK;
}

function metaFor(tool: AgenticToolChoice): string {
  if (tool.id === 'opencode') return 'opencode CLI';
  if (tool.id === 'claude') return 'Claude Code CLI';
  return t('shell.toolNoAdapter');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function mountToolSwitch(options: Options): ToolSwitcher {
  let catalog: AgenticToolState | null = null;
  let active = { id: 'opencode', name: 'OpenCode' };
  let view: View = 'list';
  let pending: string | null = null;
  let switching = false;
  let loading: Promise<void> | null = null;
  let undo: { id: string; name: string } | null = null;
  let toastTimer = 0;

  function showView(next: View): void {
    view = next;
    menuList.hidden = next !== 'list';
    confirmView.hidden = next !== 'confirm';
    switchingView.hidden = next !== 'switching';
  }

  function paintMark(node: HTMLElement, tool: string): void {
    const mark = markFor(tool);
    node.textContent = mark.mark;
    node.style.setProperty('--tool-color', mark.color);
  }

  function setActive(tool: string, name: string): void {
    active = { id: tool, name };
    const mark = markFor(tool);
    pillLabel.textContent = name;
    pillDot.dataset.tool = tool;
    pillDot.style.background = mark.color;
    pillDot.style.boxShadow = `0 0 0 3px ${mark.color}29`;
    pill.setAttribute('aria-label', t('shell.toolPillAria', { tool: name }));
    if (catalog) {
      catalog = { ...catalog, tool, toolName: name, tools: catalog.tools.map((entry) => ({ ...entry, active: entry.id === tool })) };
      if (!menu.hidden) renderList();
    }
  }

  function renderList(): void {
    const focused = menuRows.contains(document.activeElement)
      ? ((document.activeElement as HTMLElement).dataset.tool ?? null)
      : null;
    menuRows.replaceChildren();
    if (!catalog) {
      menuRows.append(el('p', 'tool-menu__loading', t('shell.toolLoading')));
      menuCount.textContent = '';
      return;
    }
    menuCount.textContent = t('shell.toolAdapters', {
      n: catalog.tools.filter((entry) => entry.available).length,
    });
    for (const tool of catalog.tools) {
      const button = el('button', 'tool-menu__row');
      button.type = 'button';
      button.dataset.tool = tool.id;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(tool.active));
      if (!tool.available) {
        button.disabled = true;
        button.setAttribute('aria-disabled', 'true');
      }

      const mark = el('span', 'tool-mark');
      paintMark(mark, tool.id);

      const text = el('span', 'tool-menu__text');
      text.append(el('span', 'tool-menu__name', tool.name), el('span', 'tool-menu__meta', metaFor(tool)));

      const badge = el(
        'span',
        `tool-menu__badge${tool.active ? ' is-active' : tool.available ? '' : ' is-soon'}`,
        tool.active ? t('shell.toolActive') : tool.available ? t('shell.toolReady') : t('shell.toolSoon')
      );

      button.append(mark, text, badge);
      menuRows.append(button);
    }
    focusRow(focused);
  }

  function renderConfirm(): void {
    const tool = catalog?.tools.find((entry) => entry.id === pending);
    if (!tool) return;
    const busy = catalog?.busy.length ?? 0;
    const previousName = active.name;

    confirmTitle.textContent = t('shell.toolConfirmTitle', { tool: tool.name });
    confirmName.textContent = tool.name;
    paintMark(confirmMark, tool.id);
    confirmChips.replaceChildren(el('span', 'tool-chip', metaFor(tool)));

    const caveat = (text: string) => el('li', undefined, text);
    confirmCaveats.replaceChildren(
      caveat(t('shell.toolCaveatSessions', { tool: tool.name })),
      caveat(t('shell.toolCaveatHistory', { tool: previousName })),
      caveat(t('shell.toolCaveatRules', { file: tool.id === 'claude' ? 'CLAUDE.md' : 'AGENTS.md' }))
    );

    confirmWarn.hidden = busy === 0;
    confirmWarn.textContent = busy > 0 ? t('shell.toolBusyWarn', { n: busy }) : '';
    confirmGo.textContent = busy > 0 ? t('shell.toolGoBusy') : t('shell.toolGo');
    confirmGo.classList.toggle('button--danger', busy > 0);
    confirmGo.disabled = false;
  }

  function renderSwitching(tool: string, force: boolean): void {
    switchingTitle.textContent = t(force ? 'shell.toolStopping' : 'shell.toolConnecting', { tool });
    overlayTitle.textContent = t('shell.toolOverlayTitle', { tool });
    overlay.hidden = chatWindow.hidden;
  }

  function showToast(
    kind: ToastKind,
    title: string,
    detail: string,
    undoTool: { id: string; name: string } | null = null
  ): void {
    window.clearTimeout(toastTimer);
    undo = undoTool;
    toastTitle.textContent = title;
    toastDetail.textContent = detail;
    toastIcon.textContent = kind === 'error' ? '!' : '✓';
    toast.classList.toggle('is-error', kind === 'error');
    toastUndo.hidden = !undo;
    toast.hidden = false;
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
      undo = null;
    }, 6_000);
  }

  function hideToast(): void {
    window.clearTimeout(toastTimer);
    toast.hidden = true;
    undo = null;
  }

  function focusRow(tool: string | null): void {
    if (!tool) return;
    const row = menuRows.querySelector<HTMLButtonElement>(`.tool-menu__row[data-tool="${tool}"]`);
    row?.focus({ preventScroll: true });
  }

  function openMenu(): void {
    if (!menu.hidden) return;
    showView('list');
    pending = null;
    renderList();
    menu.hidden = false;
    pill.setAttribute('aria-expanded', 'true');
    void loadCatalog();
    const selected =
      menuRows.querySelector<HTMLButtonElement>('.tool-menu__row[aria-selected="true"]:not(:disabled)') ??
      menuRows.querySelector<HTMLButtonElement>('.tool-menu__row:not(:disabled)');
    selected?.focus({ preventScroll: true });
  }

  function closeMenu(refocus = true): void {
    if (menu.hidden) return;
    menu.hidden = true;
    pill.setAttribute('aria-expanded', 'false');
    showView('list');
    pending = null;
    if (refocus) pill.focus({ preventScroll: true });
  }

  async function loadCatalog(): Promise<void> {
    if (loading) return loading;
    loading = chatApi
      .tool()
      .then((data) => {
        const changed = data.tool !== active.id;
        catalog = data;
        setActive(data.tool, data.toolName);
        if (view === 'confirm') renderConfirm();
        if (changed && !switching) options.onChanged();
      })
      .catch((error) => {
        if (!menu.hidden && view === 'list') {
          menuRows.replaceChildren(el('p', 'tool-menu__loading', messageOf(error)));
        }
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  }

  /** Baca ulang katalog tanpa memunculkan galat; dipakai setelah gagal ganti. */
  async function resyncCatalog(): Promise<void> {
    try {
      const data = await chatApi.tool();
      catalog = data;
      if (data.tool !== active.id) {
        setActive(data.tool, data.toolName);
        options.onChanged();
      }
    } catch {
      // Biarkan katalog lama; pengguna bisa membuka menu lagi.
    }
  }

  function selectTool(tool: string): void {
    const entry = catalog?.tools.find((item) => item.id === tool);
    if (!entry) return;
    if (entry.active) {
      closeMenu();
      return;
    }
    pending = tool;
    renderConfirm();
    showView('confirm');
    confirmGo.focus({ preventScroll: true });
  }

  function setSwitching(on: boolean): void {
    switching = on;
    pill.classList.toggle('is-loading', on);
    menu.toggleAttribute('aria-busy', on);
    if (!on) {
      overlay.hidden = true;
      pillLabel.textContent = active.name;
    }
  }

  async function beginSwitch(): Promise<void> {
    if (switching) return;
    const target = catalog?.tools.find((entry) => entry.id === pending);
    if (!target) return;
    const force = (catalog?.busy.length ?? 0) > 0;
    const previousName = active.name;

    setSwitching(true);
    showView('switching');
    renderSwitching(target.name, force);
    pillLabel.textContent = t('shell.toolConnecting', { tool: target.name });

    try {
      const result = await chatApi.switchTool(target.id, force);
      catalog = null;
      setActive(result.tool, result.toolName);
      closeMenu(false);
      showToast(
        'success',
        t('shell.toolSwitched', { tool: result.toolName }),
        t('shell.toolSwitchedDetail', { previous: previousName }),
        { id: result.previous, name: previousName }
      );
      options.onChanged();
    } catch (error) {
      catalog = null;
      await resyncCatalog();
      if ((error as { status?: number }).status === 409) {
        pending = target.id;
        renderConfirm();
        showView('confirm');
        showToast('error', t('shell.toolFailed'), t('shell.toolBusyRetry'));
      } else {
        closeMenu(false);
        showToast('error', t('shell.toolFailed'), messageOf(error));
        // Timeout bisa berarti server sudah berganti; muat ulang supaya UI tidak berbohong.
        if ((error as { status?: number }).status === 0) options.onChanged();
      }
    } finally {
      setSwitching(false);
    }
  }

  async function undoTool(): Promise<void> {
    if (!undo || switching) return;
    const target = undo;
    hideToast();
    setSwitching(true);
    pillLabel.textContent = t('shell.toolUndoing', { tool: target.name });
    overlayTitle.textContent = t('shell.toolOverlayTitle', { tool: target.name });
    overlay.hidden = chatWindow.hidden;
    const mark = markFor(target.id);
    pillDot.style.background = mark.color;
    pillDot.style.boxShadow = `0 0 0 3px ${mark.color}29`;

    try {
      const result = await chatApi.switchTool(target.id, false);
      catalog = null;
      setActive(result.tool, result.toolName);
      showToast(
        'success',
        t('shell.toolSwitched', { tool: result.toolName }),
        t('shell.toolRevertedDetail')
      );
      options.onChanged();
    } catch (error) {
      closeMenu(false);
      showToast('error', t('shell.toolFailed'), messageOf(error));
    } finally {
      setSwitching(false);
      setActive(active.id, active.name);
    }
  }

  pill.addEventListener('click', () => {
    if (switching) return;
    if (menu.hidden) openMenu();
    else closeMenu();
  });

  pill.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      if (menu.hidden) {
        event.preventDefault();
        openMenu();
      }
    }
  });

  menuRows.addEventListener('click', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLButtonElement>('.tool-menu__row');
    if (!row || row.disabled) return;
    selectTool(row.dataset.tool ?? '');
  });

  confirmBack.addEventListener('click', () => {
    const target = pending;
    showView('list');
    pending = null;
    focusRow(target);
  });

  confirmCancel.addEventListener('click', () => closeMenu());
  confirmGo.addEventListener('click', () => void beginSwitch());
  toastUndo.addEventListener('click', () => void undoTool());

  document.addEventListener('click', (event) => {
    if (menu.hidden || switching) return;
    const target = event.target as Node;
    if (menu.contains(target) || pill.contains(target)) return;
    closeMenu(false);
  });

  document.addEventListener('keydown', (event) => {
    if (menu.hidden) return;
    if (event.key === 'Escape') {
      if (switching) return;
      if (view === 'confirm') {
        const target = pending;
        showView('list');
        pending = null;
        focusRow(target);
        return;
      }
      closeMenu();
      return;
    }
    if (view !== 'list') return;
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = Array.from(menuRows.querySelectorAll<HTMLButtonElement>('.tool-menu__row:not(:disabled)'));
    if (!rows.length) return;
    event.preventDefault();
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      index < 0
        ? rows[event.key === 'ArrowDown' ? 0 : rows.length - 1]
        : event.key === 'ArrowDown'
          ? rows[(index + 1) % rows.length]
          : rows[(index - 1 + rows.length) % rows.length];
    next.focus({ preventScroll: true });
  });

  setActive(active.id, active.name);
  showView('list');

  return {
    setActive,
    applyRemote(tool, name) {
      if (switching || !tool) return;
      if (tool === active.id) {
        setActive(tool, name || active.name);
        return;
      }
      const label = name || catalog?.tools.find((entry) => entry.id === tool)?.name || tool;
      setActive(tool, label);
      catalog = null;
      showToast('success', t('shell.toolSwitched', { tool: label }), t('shell.toolRemoteDetail'));
      options.onChanged();
    },
    refreshLabels() {
      setActive(active.id, active.name);
      if (menu.hidden) return;
      if (view === 'list') renderList();
      else if (view === 'confirm') renderConfirm();
    },
    dismiss() {
      if (!menu.hidden) closeMenu(false);
    },
  };
}
