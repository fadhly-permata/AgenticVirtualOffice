import { chatApi } from './client';
import { ICON, el, icon, iconButton } from './dom';
import type { ScmDiff, ScmFile, ScmStatus, WorkspaceInfo } from './types';

export interface ScmHooks {
  /** Dipakai untuk menyisipkan path file ke composer chat. */
  onReference?: (path: string) => void;
}

export interface ScmPanel {
  setWorkspace(next: WorkspaceInfo | null): void;
  refresh(): void;
}

const LETTER_LABEL: Record<string, string> = {
  M: 'diubah',
  A: 'baru',
  D: 'hapus',
  R: 'ganti nama',
  C: 'disalin',
  U: 'konflik',
  '?': 'belum dilacak',
};

const GROUPS = [
  { key: 'staged', title: 'Disiapkan (staged)' },
  { key: 'unstaged', title: 'Perubahan kerja' },
  { key: 'untracked', title: 'Belum dilacak' },
] as const;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function letterOf(file: ScmFile, staged: boolean): string {
  const raw = staged ? file.index : file.worktree;
  return raw || (file.untracked ? '?' : 'M');
}

function counts(file: ScmFile, staged: boolean): string {
  const box = staged ? file.staged : file.unstaged;
  if (!box.added && !box.deleted) return '';
  return `+${box.added} −${box.deleted}`;
}

export function mountScm(container: HTMLElement, hooks: ScmHooks = {}): ScmPanel {
  let workspace: WorkspaceInfo | null = null;
  let state: ScmStatus | null = null;
  let open: { path: string; staged: boolean } | null = null;
  let diff: ScmDiff | null = null;
  let message = '';
  let loading = false;
  let token = 0;

  const root = el('div', 'scm');

  const head = el('div', 'scm__head');
  const branchEl = el('span', 'scm__branch');
  const syncEl = el('span', 'scm__sync');
  const lastEl = el('span', 'scm__last');
  const refreshButton = iconButton('Muat ulang status git', ICON.refresh, () => void load());
  head.append(branchEl, syncEl, lastEl, refreshButton);

  const messageEl = el('p', 'scm__message');
  messageEl.setAttribute('role', 'status');

  const list = el('div', 'scm__list');
  list.setAttribute('role', 'list');

  const viewer = el('section', 'scm__viewer');
  viewer.hidden = true;

  root.append(head, messageEl, list, viewer);
  container.append(root);

  function note(text: string): HTMLElement {
    return el('p', 'scm__note', text);
  }

  function paintHead(): void {
    if (!workspace) {
      branchEl.textContent = 'tidak ada workspace';
      branchEl.title = '';
      syncEl.textContent = '';
      lastEl.textContent = '';
      return;
    }
    if (!state) {
      branchEl.textContent = loading ? 'membaca git…' : '—';
      syncEl.textContent = '';
      lastEl.textContent = '';
      return;
    }
    const branch = state.branch || `HEAD ${state.detached}`;
    branchEl.textContent = branch;
    branchEl.title = state.detached && !state.branch ? 'commit terpisah (detached HEAD)' : state.head;
    syncEl.textContent = state.upstream
      ? `${state.upstream} · ↑${state.ahead} ↓${state.behind}`
      : 'tanpa upstream';
    lastEl.textContent = state.last ? `${state.last.sha} · ${state.last.subject} · ${state.last.when}` : '';
    lastEl.title = state.last?.subject ?? '';
  }

  function paintMessage(): void {
    messageEl.textContent = message;
    messageEl.hidden = !message;
  }

  function row(file: ScmFile, staged: boolean): HTMLElement {
    const letter = letterOf(file, staged);
    const line = el('div', 'scm__row');
    line.setAttribute('role', 'listitem');
    const active = open?.path === file.path && open.staged === staged;
    if (active) line.classList.add('scm__row--active');

    const chip = el('span', `scm__mark scm__mark--${letter === '?' ? 'q' : letter.toLowerCase()}`, letter);
    chip.title = LETTER_LABEL[letter] ?? letter;
    line.append(chip);

    const glyph = icon(ICON.file, 14);
    glyph.classList.add('scm__glyph');
    line.append(glyph);

    const label = file.origin ? `${file.origin} → ${file.path}` : file.path;
    const name = el('span', 'scm__name', label);
    name.title = file.path;
    line.append(name);

    const meta = el('span', 'scm__meta', counts(file, staged));
    line.append(meta);

    line.addEventListener('click', () => void openDiff(file.path, staged));
    return line;
  }

  function renderList(): void {
    list.textContent = '';
    if (!workspace) {
      list.append(note('Buka workspace lebih dulu untuk melihat perubahan git.'));
      return;
    }
    if (!state) {
      list.append(note(loading ? 'Membaca status repo…' : 'Belum ada status.'));
      return;
    }
    if (state.clean) {
      list.append(note(`Tidak ada perubahan di ${state.branch || state.detached || 'repo ini'}.`));
      return;
    }

    for (const group of GROUPS) {
      const files = state.files.filter((file) =>
        group.key === 'staged'
          ? Boolean(file.index) && file.index !== '?'
          : group.key === 'unstaged'
            ? Boolean(file.worktree) && file.worktree !== '?'
            : file.untracked
      );
      if (!files.length) continue;
      const title = el('p', 'scm__group', `${group.title} · ${files.length}`);
      list.append(title);
      for (const file of files) list.append(row(file, group.key === 'staged'));
    }
  }

  function renderViewer(): void {
    viewer.textContent = '';
    viewer.hidden = !diff;
    if (!diff) return;

    const headRow = el('header', 'scm__viewer-head');
    headRow.append(el('span', 'scm__viewer-path', diff.path));

    const info: string[] = [];
    if (diff.untracked) info.push('belum dilacak');
    else info.push(diff.staged ? 'versi index' : 'versi folder kerja');
    if (diff.truncated) info.push(`dipotong dari ${diff.total} baris`);
    headRow.append(el('span', 'scm__viewer-info', info.join(' · ')));

    const actions = el('span', 'scm__viewer-actions');
    if (!diff.untracked) {
      const flip = iconButton(
        diff.staged ? 'Lihat versi folder kerja' : 'Lihat versi index',
        ICON.refresh,
        () => void openDiff(diff?.path ?? '', !diff?.staged)
      );
      flip.classList.add('scm__flip');
      actions.append(flip);
    }
    if (hooks.onReference && !diff.untracked) {
      actions.append(iconButton('Sisipkan ke pesan', ICON.plus, () => hooks.onReference?.(diff?.path ?? '')));
    }
    actions.append(iconButton('Tutup diff', ICON.close, closeViewer));
    headRow.append(actions);
    viewer.append(headRow);

    if (diff.empty) {
      viewer.append(note('Tidak ada diff — perubahannya mungkin sudah disiapkan atau sudah di-commit.'));
      return;
    }

    const body = el('div', 'scm__code');
    for (const line of diff.lines) {
      const kind = line.startsWith('++') || line.startsWith('--') || line.startsWith('diff ')
        ? 'head'
        : line.startsWith('@@')
          ? 'hunk'
          : line.startsWith('+')
            ? 'add'
            : line.startsWith('-')
              ? 'del'
              : 'same';
      body.append(el('div', `scm__line scm__line--${kind}`, line === '' ? ' ' : line));
    }
    viewer.append(body);
  }

  function closeViewer(): void {
    diff = null;
    open = null;
    renderViewer();
  }

  async function openDiff(path: string, staged: boolean): Promise<void> {
    const mine = (token += 1);
    message = '';
    open = { path, staged };
    renderList();
    paintMessage();
    try {
      const result = await chatApi.scmDiff(path, staged);
      if (mine !== token) return;
      diff = result;
    } catch (error) {
      if (mine !== token) return;
      diff = null;
      open = null;
      message = describeError(error);
    } finally {
      if (mine === token) {
        paintMessage();
        renderList();
        renderViewer();
      }
    }
  }

  async function load(): Promise<void> {
    const mine = (token += 1);
    if (!workspace) {
      state = null;
      message = '';
      paintHead();
      paintMessage();
      renderList();
      closeViewer();
      return;
    }
    message = '';
    paintMessage();
    paintHead();
    renderList();
    loading = true;
    try {
      const next = await chatApi.scmStatus();
      if (mine !== token) return;
      state = next;
      // File yang sedang dibuka bisa hilang dari daftar setelah di-commit.
      if (open && !next.files.some((file) => file.path === open?.path)) closeViewer();
      else if (open) await openDiff(open.path, open.staged);
    } catch (error) {
      if (mine !== token) return;
      state = null;
      closeViewer();
      message = describeError(error);
    } finally {
      loading = false;
      paintHead();
      paintMessage();
      renderList();
    }
  }

  void load();

  return {
    setWorkspace(next) {
      workspace = next;
      state = null;
      diff = null;
      open = null;
      message = '';
      renderViewer();
      void load();
    },
    refresh() {
      void load();
    },
  };
}
