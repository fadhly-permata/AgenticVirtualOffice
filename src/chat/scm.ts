import { subscribeLocale, t } from '../i18n';
import { chatApi } from './client';
import { ICON, el, icon, iconButton } from './dom';
import { prefs, subscribePrefs } from './prefs';
import type { ScmBranch, ScmBranches, ScmDiff, ScmFile, ScmLogEntry, ScmStatus, WorkspaceInfo } from './types';

export interface ScmHooks {
  /** Dipakai untuk menyisipkan path file ke composer chat. */
  onReference?: (path: string) => void;
  /** Dipakai header diff untuk membuka berkas di viewer Files. */
  onOpenFile?: (path: string, line?: number) => void;
}

export interface ScmPanel {
  setWorkspace(next: WorkspaceInfo | null): void;
  refresh(): void;
}

type GroupKey = 'staged' | 'unstaged' | 'untracked';

/** Key i18n per huruf status git; dibaca lewat t() supaya tidak beku saat init. */
const LETTER_KEYS: Record<string, string> = {
  M: 'scm.letterM',
  A: 'scm.letterA',
  D: 'scm.letterD',
  R: 'scm.letterR',
  C: 'scm.letterC',
  U: 'scm.letterU',
  '?': 'scm.untracked',
};

const GROUPS: { key: GroupKey; titleId: string }[] = [
  { key: 'staged', titleId: 'scm.groupStaged' },
  { key: 'unstaged', titleId: 'scm.groupUnstaged' },
  { key: 'untracked', titleId: 'scm.groupUntracked' },
];

const HISTORY_LIMIT = 30;

/** Title + aria-label untuk tombol ikon; dipasang ulang saat bahasa diganti. */
function labelButton(button: HTMLButtonElement, label: string): void {
  button.title = label;
  button.setAttribute('aria-label', label);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Baris sisi baru dari hunk pertama, jadi diff bisa dibuka tepat di baris yang berubah. */
function firstHunkLine(lines: string[]): number {
  for (const line of lines) {
    const matched = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (matched) return Number(matched[1]);
  }
  return 0;
}

function inGroup(file: ScmFile, key: GroupKey): boolean {
  if (key === 'staged') return Boolean(file.index) && file.index !== '?';
  if (key === 'unstaged') return Boolean(file.worktree) && file.worktree !== '?';
  return file.untracked;
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

/** Rename harus ikut sepasang: tanpa path asal, rollback meninggalkan file hantu. */
function pairOf(file: ScmFile): string[] {
  return file.origin ? [file.origin, file.path] : [file.path];
}

function noteOf(body: unknown): string {
  const text = (body as { note?: unknown } | null)?.note;
  return typeof text === 'string' ? text : '';
}

function trackOf(branch: ScmBranch): string {
  const gap = branch.ahead || branch.behind ? ` ↑${branch.ahead} ↓${branch.behind}` : '';
  return `${branch.upstream || t('scm.noUpstream')}${gap}`;
}

export function mountScm(container: HTMLElement, hooks: ScmHooks = {}): ScmPanel {
  let workspace: WorkspaceInfo | null = null;
  let state: ScmStatus | null = null;
  let branches: ScmBranches | null = null;
  let history: ScmLogEntry[] | null = null;
  let open: { path: string; staged: boolean } | null = null;
  let diff: ScmDiff | null = null;
  let message = '';
  let loading = false;
  let busy = false;
  /** Baris yang sedang minta konfirmasi sebelum operasi merusak dijalankan. */
  let armed = '';
  let pickerOpen = false;
  let showHistory = false;
  let amend = false;
  let statusToken = 0;
  let diffToken = 0;
  let branchToken = 0;

  const root = el('div', 'scm');

  const head = el('div', 'scm__head');
  const branchButton = el('button', 'scm__branch');
  branchButton.type = 'button';
  const branchGlyph = icon(ICON.branch, 13);
  const branchName = el('span', 'scm__branch-name', '—');
  branchButton.append(branchGlyph, branchName, icon(ICON.chevronDown, 12));
  branchButton.title = t('scm.branchPicker');
  branchButton.addEventListener('click', () => togglePicker());
  const syncEl = el('span', 'scm__sync');
  const lastEl = el('span', 'scm__last');
  const pushButton = iconButton(t('scm.push'), ICON.up, () => void push('push'));
  const pullButton = iconButton(t('scm.pull'), ICON.down, () => void push('pull'));
  const historyButton = iconButton(t('scm.historyBtn'), ICON.clock, () => void toggleHistory());
  historyButton.setAttribute('aria-pressed', 'false');
  const refreshButton = iconButton(t('scm.refresh'), ICON.refresh, () => void load(true));
  head.append(branchButton, syncEl, lastEl, pushButton, pullButton, historyButton, refreshButton);

  const picker = el('div', 'scm__picker');
  picker.hidden = true;

  /* Nama branch disimpan di elemen yang tidak dibangun ulang supaya fokus dan
     isian tidak hilang setiap kali daftar di-render. */
  const branchInput = el('input', 'scm__picker-input');
  branchInput.type = 'text';
  branchInput.placeholder = t('scm.newBranchPh');
  branchInput.setAttribute('aria-label', t('scm.newBranchAria'));
  branchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void createBranch();
  });
  const makeBranch = el('button', 'scm__chip');
  makeBranch.type = 'button';
  makeBranch.textContent = t('scm.createSwitch');
  makeBranch.addEventListener('click', () => void createBranch());
  const branchNew = el('div', 'scm__picker-new');
  branchNew.append(branchInput, makeBranch);

  const compose = el('div', 'scm__compose');
  const draftArea = el('textarea', 'scm__draft');
  draftArea.placeholder = t('scm.draftPh');
  draftArea.rows = 3;
  draftArea.addEventListener('input', () => paintCompose());
  draftArea.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void commit();
    }
  });
  const commitButton = el('button', 'scm__run');
  commitButton.type = 'button';
  commitButton.textContent = t('scm.commit');
  commitButton.addEventListener('click', () => void commit());
  const amendButton = el('button', 'scm__chip');
  amendButton.type = 'button';
  amendButton.textContent = t('scm.amend');
  amendButton.title = t('scm.amendTitle');
  amendButton.addEventListener('click', () => {
    amend = !amend;
    paintCompose();
  });
  const undoButton = el('button', 'scm__chip');
  undoButton.type = 'button';
  undoButton.textContent = t('scm.undo');
  undoButton.title = t('scm.undoTitle');
  undoButton.addEventListener('click', () => {
    armed = 'undo';
    paintCompose();
  });
  const composeHint = el('span', 'scm__compose-hint', t('scm.hint'));
  const composeRow = el('div', 'scm__compose-row');
  compose.append(draftArea, composeRow);

  const messageEl = el('p', 'scm__message');
  messageEl.setAttribute('role', 'status');
  messageEl.hidden = true;

  const list = el('div', 'scm__list');
  list.setAttribute('role', 'list');

  const historyBox = el('div', 'scm__history');
  historyBox.hidden = true;

  const viewer = el('section', 'scm__viewer');
  viewer.hidden = true;

  // Dua pane: daftar perubahan + riwayat di satu sisi, diff di sisi lain. Mode split dipilih di Settings.
  const side = el('div', 'scm__side');
  side.append(list, historyBox);

  const panes = el('div', 'scm__panes');
  panes.append(side, viewer);

  root.append(head, picker, compose, messageEl, panes);
  container.append(root);
  panes.classList.toggle('scm__panes--side', prefs().previewSplit === 'vertical');

  subscribePrefs(() => {
    panes.classList.toggle('scm__panes--side', prefs().previewSplit === 'vertical');
  });

  function say(text: string, bad = false): void {
    message = text;
    messageEl.dataset.kind = bad ? 'error' : 'info';
    paintMessage();
  }

  /** Teks yang dipasang saat konstruksi: dipasang ulang tiap kali bahasa diganti. */
  function paintLabels(): void {
    labelButton(pushButton, t('scm.push'));
    labelButton(pullButton, t('scm.pull'));
    labelButton(historyButton, t('scm.historyBtn'));
    labelButton(refreshButton, t('scm.refresh'));
    branchInput.placeholder = t('scm.newBranchPh');
    branchInput.setAttribute('aria-label', t('scm.newBranchAria'));
    makeBranch.textContent = t('scm.createSwitch');
    draftArea.placeholder = t('scm.draftPh');
    amendButton.textContent = t('scm.amend');
    amendButton.title = t('scm.amendTitle');
    undoButton.textContent = t('scm.undo');
    undoButton.title = t('scm.undoTitle');
    composeHint.textContent = t('scm.hint');
  }

  function paintMessage(): void {
    messageEl.textContent = message;
    messageEl.hidden = !message;
  }

  function note(text: string): HTMLElement {
    return el('p', 'scm__note', text);
  }

  /** Tombol kecil di dalam baris: kliknya tidak boleh membuka diff. */
  function actionButton(label: string, glyph: string, run: () => void): HTMLButtonElement {
    const button = iconButton(label, glyph, run);
    button.classList.add('scm__act');
    button.addEventListener('click', (event) => event.stopPropagation());
    return button;
  }

  function confirmButtons(yesLabel: string, onYes: () => void): HTMLElement {
    const box = el('span', 'scm__confirm');
    box.append(el('span', 'scm__ask', t('scm.sure')));
    const yes = el('button', 'scm__yes');
    yes.type = 'button';
    yes.textContent = yesLabel;
    yes.addEventListener('click', (event) => {
      event.stopPropagation();
      armed = '';
      void onYes();
    });
    const no = el('button', 'scm__no');
    no.type = 'button';
    no.textContent = t('scm.cancel');
    no.addEventListener('click', (event) => {
      event.stopPropagation();
      armed = '';
      renderList();
      renderPicker();
      paintCompose();
    });
    box.append(yes, no);
    return box;
  }

  function paintHead(): void {
    const branchLabel = !workspace ? t('scm.noWorkspace') : state ? state.branch || `HEAD ${state.detached}` : loading ? t('scm.readingGit') : '—';
    branchName.textContent = branchLabel;
    branchButton.disabled = !workspace;
    if (!state) {
      branchButton.title = t('scm.branchPicker');
      syncEl.textContent = '';
      lastEl.textContent = '';
      return;
    }
    branchButton.title = state.detached && !state.branch ? t('scm.detachedHead') : state.head;
    syncEl.textContent = state.upstream ? `↑${state.ahead} ↓${state.behind}` : t('scm.noUpstream');
    lastEl.textContent = state.last ? `${state.last.sha} · ${state.last.subject} · ${state.last.when}` : '';
    lastEl.title = state.last?.subject ?? '';
  }

  function paintCompose(): void {
    const staged = state ? state.files.filter((file) => inGroup(file, 'staged')).length : 0;
    commitButton.textContent = `${amend ? t('scm.amend') : t('scm.commit')}${staged ? ` (${staged})` : ''}`;
    commitButton.disabled = busy || !state || (!amend && staged === 0);
    amendButton.disabled = busy || !state || !state.last;
    amendButton.classList.toggle('scm__chip--on', amend);
    draftArea.disabled = busy || !state;
    pushButton.disabled = busy || !state;
    pullButton.disabled = busy || !state || !state.upstream;
    historyButton.disabled = !workspace;
    undoButton.disabled = busy || !state || !state.last;
    root.classList.toggle('is-busy', busy);
    paintComposeRow();
  }

  /** Baris tombol commit dibangun ulang tiap kali agar konfirmasi "urungkan" bisa menempel di sana. */
  function paintComposeRow(): void {
    composeRow.textContent = '';
    composeRow.append(commitButton, amendButton);
    if (armed === 'undo') {
      composeRow.append(
        confirmButtons(t('scm.undoYes'), () =>
          void run(t('scm.undoing'), () => chatApi.scmCommitUndo(), (body) => {
            const back = (body as ScmStatus)?.last;
            return back
              ? t('scm.undone', { sha: back.sha, subject: back.subject })
              : t('scm.undoneFirst');
          })
        )
      );
      return;
    }
    composeRow.append(undoButton, composeHint);
  }

  function row(file: ScmFile, staged: boolean): HTMLElement {
    const letter = letterOf(file, staged);
    const line = el('div', 'scm__row');
    line.setAttribute('role', 'listitem');
    const active = open?.path === file.path && open.staged === staged;
    if (active) line.classList.add('scm__row--active');

    const chip = el('span', `scm__mark scm__mark--${letter === '?' ? 'q' : letter.toLowerCase()}`, letter);
    const letterKey = LETTER_KEYS[letter];
    chip.title = letterKey ? t(letterKey) : letter;
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

    const actions = el('span', 'scm__actions');
    if (armed === `${staged ? 's' : 'w'}:${file.path}`) {
      actions.append(confirmButtons(t('scm.discard'), () => void run(t('scm.discarding'), () => chatApi.scmDiscard(pairOf(file)), () => t('scm.discarded', { path: file.path }))));
    } else {
      actions.append(
        actionButton(staged ? t('scm.unstageFile') : t('scm.stageFile'), staged ? ICON.minus : ICON.plus, () =>
          void run(staged ? t('scm.unstaging') : t('scm.staging'), () => chatApi.scmStage(pairOf(file), !staged))
        )
      );
      actions.append(
        actionButton(t('scm.discardFile'), ICON.trash, () => {
          armed = `${staged ? 's' : 'w'}:${file.path}`;
          renderList();
        })
      );
    }
    line.append(actions);

    line.addEventListener('click', () => void openDiff(file.path, staged));
    return line;
  }

  function groupHeader(group: { key: GroupKey; titleId: string }, files: ScmFile[]): HTMLElement {
    const bar = el('div', 'scm__group');
    bar.append(el('span', 'scm__group-name', `${t(group.titleId)} · ${files.length}`));
    const paths = files.flatMap(pairOf);
    const actions = el('span', 'scm__actions');

    if (armed === `group:${group.key}`) {
      actions.append(
        confirmButtons(t('scm.discardAll'), () =>
          void run(t('scm.discarding'), () => chatApi.scmDiscard(paths), () => t('scm.discardedCount', { count: files.length }))
        )
      );
    } else {
      if (group.key === 'staged') {
        actions.append(
          actionButton(t('scm.unstageAll'), ICON.minus, () => void run(t('scm.unstaging'), () => chatApi.scmStageAll(false)))
        );
      } else {
        actions.append(
          actionButton(
            group.key === 'unstaged' ? t('scm.stageChanges') : t('scm.stageNew'),
            ICON.plus,
            () => void run(t('scm.staging'), () => chatApi.scmStageAll(true))
          )
        );
      }
      actions.append(
        actionButton(t('scm.discardGroup'), ICON.trash, () => {
          armed = `group:${group.key}`;
          renderList();
        })
      );
    }
    bar.append(actions);
    return bar;
  }

  function renderList(): void {
    list.textContent = '';
    if (!workspace) {
      list.append(note(t('scm.needWorkspace')));
      return;
    }
    if (!state) {
      list.append(note(loading ? t('scm.readingStatus') : t('scm.noStatus')));
      return;
    }
    if (state.clean) {
      list.append(note(t('scm.clean', { branch: state.branch || state.detached || t('scm.thisRepo') })));
      return;
    }

    for (const group of GROUPS) {
      const files = state.files.filter((file) => inGroup(file, group.key));
      if (!files.length) continue;
      list.append(groupHeader(group, files));
      for (const file of files) list.append(row(file, group.key === 'staged'));
    }
  }

  function branchLine(branch: ScmBranch, local: boolean): HTMLElement {
    const line = el('div', 'scm__branch-row');
    if (branch.current) line.classList.add('scm__branch-row--on');
    else line.title = local ? t('scm.switchTo', { name: branch.name }) : t('scm.checkoutLocal', { name: branch.name });

    const glyph = icon(branch.current ? ICON.check : ICON.branch, 14);
    glyph.classList.add('scm__glyph');
    line.append(glyph, el('span', 'scm__name', branch.name));
    line.append(el('span', 'scm__meta', local ? (branch.current ? branch.name : trackOf(branch)) : branch.when));

    if (armed === `branch:${branch.name}`) {
      line.append(confirmButtons(t('scm.delete'), () => void run(t('scm.deletingBranch'), () => chatApi.scmBranchDelete(branch.name), (body) => t('scm.branchDeleted', { name: branch.name, summary: branchSummary(body) }))));
    } else if (local && !branch.current) {
      line.append(
        actionButton(t('scm.deleteBranch', { name: branch.name }), ICON.trash, () => {
          armed = `branch:${branch.name}`;
          renderPicker();
        })
      );
    }
    if (!branch.current) line.addEventListener('click', () => void switchTo(branch.name, local));
    return line;
  }

  function branchSummary(body: unknown): string {
    const list2 = (body as ScmBranches | null)?.local;
    return Array.isArray(list2) ? t('scm.localCount', { count: list2.length }) : '';
  }

  function pickerGroup(title: string, items: ScmBranch[], local: boolean): HTMLElement {
    const box = el('div', 'scm__picker-block');
    box.append(el('p', 'scm__group', title));
    for (const branch of items) box.append(branchLine(branch, local));
    return box;
  }

  function renderPicker(): void {
    picker.textContent = '';
    picker.hidden = !pickerOpen;
    branchButton.setAttribute('aria-expanded', String(pickerOpen));
    if (!pickerOpen) return;

    const bar = el('div', 'scm__picker-head');
    bar.append(el('span', 'scm__picker-title', t('scm.branches')));
    const close = iconButton(t('scm.closeList'), ICON.close, () => {
      pickerOpen = false;
      renderPicker();
    });
    bar.append(close);
    picker.append(bar, branchNew);

    if (!branches) {
      picker.append(note(t('scm.readingBranches')));
      return;
    }
    if (!branches.local.length) picker.append(note(t('scm.noBranches')));
    else picker.append(pickerGroup(t('scm.local'), branches.local, true));
    if (branches.remote.length) picker.append(pickerGroup(t('scm.remote'), branches.remote, false));
  }

  function renderHistory(): void {
    historyBox.textContent = '';
    historyBox.hidden = !showHistory;
    if (!showHistory) return;
    historyBox.append(el('p', 'scm__group', history ? `${t('scm.history')} · ${history.length}` : t('scm.history')));
    if (!history) {
      historyBox.append(note(t('scm.readingHistory')));
      return;
    }
    if (!history.length) {
      historyBox.append(note(t('scm.noCommits')));
      return;
    }
    for (const entry of history) {
      const line = el('div', 'scm__log-row');
      line.append(el('span', 'scm__log-sha', entry.sha));
      const subject = el('span', 'scm__name', entry.subject);
      subject.title = `${entry.author} · ${entry.when}`;
      line.append(subject, el('span', 'scm__meta', `${entry.author} · ${entry.when}`));
      historyBox.append(line);
    }
  }

  function renderViewer(): void {
    viewer.textContent = '';
    viewer.hidden = !diff;
    if (!diff) return;

    const headRow = el('header', 'scm__viewer-head');
    headRow.append(el('span', 'scm__viewer-path', diff.path));

    const info: string[] = [];
    if (diff.untracked) info.push(t('scm.untracked'));
    else info.push(diff.staged ? t('scm.indexVersion') : t('scm.workVersion'));
    if (diff.truncated) info.push(t('scm.truncated', { count: diff.total }));
    headRow.append(el('span', 'scm__viewer-info', info.join(' · ')));

    const actions = el('span', 'scm__viewer-actions');
    if (!diff.untracked) {
      const flip = iconButton(
        diff.staged ? t('scm.viewWork') : t('scm.viewIndex'),
        ICON.refresh,
        () => void openDiff(diff?.path ?? '', !diff?.staged)
      );
      flip.classList.add('scm__flip');
      actions.append(flip);
    }
    if (hooks.onReference && !diff.untracked) {
      actions.append(iconButton(t('scm.insertRef'), ICON.plus, () => hooks.onReference?.(diff?.path ?? '')));
    }
    if (hooks.onOpenFile && !diff.untracked) {
      actions.append(
        iconButton(t('viewer.openFile'), ICON.expand, () =>
          hooks.onOpenFile?.(diff?.path ?? '', firstHunkLine(diff?.lines ?? []))
        )
      );
    }
    actions.append(iconButton(t('scm.closeDiff'), ICON.close, closeViewer));
    headRow.append(actions);
    viewer.append(headRow);

    if (diff.empty) {
      viewer.append(note(t('scm.emptyDiff')));
      return;
    }

    const body = el('div', 'scm__code');
    // Baris diff mentah = patch git, bukan teks UI — tidak diterjemahkan.
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

  function repaint(): void {
    paintLabels();
    paintHead();
    paintCompose();
    paintMessage();
    renderList();
    renderPicker();
    renderHistory();
    renderViewer();
  }

  /** Satu operasi git sekaligus: antre akan mengganggu status yang sedang dibaca. */
  async function run(
    label: string,
    call: () => Promise<unknown>,
    describe?: (body: unknown) => string
  ): Promise<boolean> {
    if (busy || !workspace) return false;
    busy = true;
    say(label);
    paintCompose();
    renderList();
    let ok = true;
    try {
      const body = await call();
      say(describe ? describe(body) : '');
    } catch (error) {
      ok = false;
      say(describeError(error), true);
    } finally {
      busy = false;
      armed = '';
      paintCompose();
    }
    await load(false);
    if (pickerOpen) void loadBranches();
    if (showHistory) void loadHistory();
    return ok;
  }

  async function commit(): Promise<void> {
    const text = draftArea.value.trim();
    if (!amend && !text) {
      say(t('scm.needMessage'), true);
      return;
    }
    const ok = await run(t('scm.committing'), () => chatApi.scmCommit(text, amend), (body) => {
      const head = (body as ScmStatus)?.head ?? '';
      return amend ? t('scm.amended', { head }) : t('scm.committed', { head });
    });
    if (ok) {
      draftArea.value = '';
      amend = false;
      paintCompose();
    }
  }

  async function push(kind: 'push' | 'pull'): Promise<void> {
    await run(kind === 'push' ? t('scm.pushing') : t('scm.pullFrom'), () =>
      kind === 'push' ? chatApi.scmPush() : chatApi.scmPull(),
      (body) => noteOf(body) || (kind === 'push' ? t('scm.pushed') : t('scm.upToDate'))
    );
  }

  async function switchTo(name: string, local: boolean): Promise<void> {
    await run(local ? t('scm.switching', { name }) : t('scm.checkout', { name }), () => chatApi.scmBranchSwitch(name), (body) =>
      t('scm.nowOn', { name: (body as ScmBranches)?.current ?? name, summary: branchSummary(body) })
    );
  }

  async function createBranch(): Promise<void> {
    const name = branchInput.value.trim();
    if (!name) {
      say(t('scm.needBranchName'), true);
      return;
    }
    const ok = await run(t('scm.creating', { name }), () => chatApi.scmBranchCreate(name, true), (body) =>
      t('scm.branchCreated', { name, summary: branchSummary(body) })
    );
    if (ok) branchInput.value = '';
  }

  async function togglePicker(): Promise<void> {
    pickerOpen = !pickerOpen;
    renderPicker();
    if (pickerOpen) await loadBranches();
  }

  async function toggleHistory(): Promise<void> {
    showHistory = !showHistory;
    historyButton.setAttribute('aria-pressed', String(showHistory));
    renderHistory();
    if (showHistory && !history) await loadHistory();
  }

  async function loadBranches(): Promise<void> {
    const mine = (branchToken += 1);
    try {
      const next = await chatApi.scmBranches();
      if (mine !== branchToken) return;
      branches = next;
    } catch (error) {
      if (mine !== branchToken) return;
      branches = null;
      say(describeError(error), true);
    }
    renderPicker();
  }

  async function loadHistory(): Promise<void> {
    const mine = (branchToken += 1);
    try {
      const next = await chatApi.scmHistory(HISTORY_LIMIT);
      if (mine !== branchToken) return;
      history = next.entries;
    } catch (error) {
      if (mine !== branchToken) return;
      history = [];
      say(describeError(error), true);
    }
    renderHistory();
  }

  async function fetchDiff(path: string, staged: boolean): Promise<void> {
    const mine = (diffToken += 1);
    try {
      const result = await chatApi.scmDiff(path, staged);
      if (mine !== diffToken) return;
      diff = result;
    } catch (error) {
      if (mine !== diffToken) return;
      diff = null;
      open = null;
      say(describeError(error), true);
    } finally {
      if (mine === diffToken) {
        renderViewer();
        renderList();
      }
    }
  }

  async function openDiff(path: string, staged: boolean): Promise<void> {
    open = { path, staged };
    diff = null;
    renderList();
    renderViewer();
    await fetchDiff(path, staged);
  }

  async function load(clearMessage = true): Promise<void> {
    const mine = (statusToken += 1);
    if (!workspace) {
      state = null;
      branches = null;
      history = null;
      if (clearMessage) say('');
      repaint();
      return;
    }
    if (clearMessage) say('');
    loading = true;
    paintHead();
    paintCompose();
    renderList();
    try {
      const next = await chatApi.scmStatus();
      if (mine !== statusToken) return;
      state = next;
      // File yang sedang dibuka bisa hilang dari daftar setelah di-commit.
      if (open && !next.files.some((file) => file.path === open?.path)) closeViewer();
      else if (open) await fetchDiff(open.path, open.staged);
    } catch (error) {
      if (mine !== statusToken) return;
      state = null;
      closeViewer();
      say(describeError(error), true);
    } finally {
      loading = false;
      if (mine === statusToken) repaint();
    }
  }

  subscribeLocale(repaint);
  void load();

  return {
    setWorkspace(next) {
      workspace = next;
      state = null;
      branches = null;
      history = null;
      diff = null;
      open = null;
      armed = '';
      pickerOpen = false;
      void load();
    },
    refresh() {
      if (pickerOpen) void loadBranches();
      if (showHistory) void loadHistory();
      void load(true);
    },
  };
}
