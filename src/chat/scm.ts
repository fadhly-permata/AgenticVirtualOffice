import { chatApi } from './client';
import { ICON, el, icon, iconButton } from './dom';
import type { ScmBranch, ScmBranches, ScmDiff, ScmFile, ScmLogEntry, ScmStatus, WorkspaceInfo } from './types';

export interface ScmHooks {
  /** Dipakai untuk menyisipkan path file ke composer chat. */
  onReference?: (path: string) => void;
}

export interface ScmPanel {
  setWorkspace(next: WorkspaceInfo | null): void;
  refresh(): void;
}

type GroupKey = 'staged' | 'unstaged' | 'untracked';

const LETTER_LABEL: Record<string, string> = {
  M: 'diubah',
  A: 'baru',
  D: 'hapus',
  R: 'ganti nama',
  C: 'disalin',
  U: 'konflik',
  '?': 'belum dilacak',
};

const GROUPS: { key: GroupKey; title: string }[] = [
  { key: 'staged', title: 'Disiapkan' },
  { key: 'unstaged', title: 'Perubahan kerja' },
  { key: 'untracked', title: 'Belum dilacak' },
];

const HISTORY_LIMIT = 30;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  return `${branch.upstream || 'tanpa upstream'}${gap}`;
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
  branchButton.title = 'Pilih, buat, atau hapus branch';
  branchButton.addEventListener('click', () => togglePicker());
  const syncEl = el('span', 'scm__sync');
  const lastEl = el('span', 'scm__last');
  const pushButton = iconButton('Kirim commit ke remote (push)', ICON.up, () => void push('push'));
  const pullButton = iconButton('Ambil commit dari remote (pull)', ICON.down, () => void push('pull'));
  const historyButton = iconButton('Tampilkan riwayat commit', ICON.clock, () => void toggleHistory());
  historyButton.setAttribute('aria-pressed', 'false');
  const refreshButton = iconButton('Muat ulang status git', ICON.refresh, () => void load(true));
  head.append(branchButton, syncEl, lastEl, pushButton, pullButton, historyButton, refreshButton);

  const picker = el('div', 'scm__picker');
  picker.hidden = true;

  /* Nama branch disimpan di elemen yang tidak dibangun ulang supaya fokus dan
     isian tidak hilang setiap kali daftar di-render. */
  const branchInput = el('input', 'scm__picker-input');
  branchInput.type = 'text';
  branchInput.placeholder = 'nama branch baru';
  branchInput.setAttribute('aria-label', 'Nama branch baru');
  branchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void createBranch();
  });
  const makeBranch = el('button', 'scm__chip');
  makeBranch.type = 'button';
  makeBranch.textContent = 'Buat + pindah';
  makeBranch.addEventListener('click', () => void createBranch());
  const branchNew = el('div', 'scm__picker-new');
  branchNew.append(branchInput, makeBranch);

  const compose = el('div', 'scm__compose');
  const draftArea = el('textarea', 'scm__draft');
  draftArea.placeholder = 'Pesan commit untuk perubahan yang disiapkan…';
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
  commitButton.textContent = 'Commit';
  commitButton.addEventListener('click', () => void commit());
  const amendButton = el('button', 'scm__chip');
  amendButton.type = 'button';
  amendButton.textContent = 'Amend';
  amendButton.title = 'Timpa commit terakhir alih-alih menambah commit baru';
  amendButton.addEventListener('click', () => {
    amend = !amend;
    paintCompose();
  });
  const composeRow = el('div', 'scm__compose-row');
  composeRow.append(commitButton, amendButton, el('span', 'scm__compose-hint', 'Ctrl+Enter untuk commit'));
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

  root.append(head, picker, compose, messageEl, list, historyBox, viewer);
  container.append(root);

  function say(text: string, bad = false): void {
    message = text;
    messageEl.dataset.kind = bad ? 'error' : 'info';
    paintMessage();
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
    box.append(el('span', 'scm__ask', 'Yakin?'));
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
    no.textContent = 'Batal';
    no.addEventListener('click', (event) => {
      event.stopPropagation();
      armed = '';
      renderList();
      renderPicker();
    });
    box.append(yes, no);
    return box;
  }

  function paintHead(): void {
    const branchLabel = !workspace ? 'tidak ada workspace' : state ? state.branch || `HEAD ${state.detached}` : loading ? 'membaca git…' : '—';
    branchName.textContent = branchLabel;
    branchButton.disabled = !workspace;
    if (!state) {
      syncEl.textContent = '';
      lastEl.textContent = '';
      return;
    }
    branchButton.title = state.detached && !state.branch ? 'commit terpisah (detached HEAD)' : state.head;
    syncEl.textContent = state.upstream ? `↑${state.ahead} ↓${state.behind}` : 'tanpa upstream';
    lastEl.textContent = state.last ? `${state.last.sha} · ${state.last.subject} · ${state.last.when}` : '';
    lastEl.title = state.last?.subject ?? '';
  }

  function paintCompose(): void {
    const staged = state ? state.files.filter((file) => inGroup(file, 'staged')).length : 0;
    commitButton.textContent = `${amend ? 'Amend' : 'Commit'}${staged ? ` (${staged})` : ''}`;
    commitButton.disabled = busy || !state || (!amend && staged === 0);
    amendButton.disabled = busy || !state || !state.last;
    amendButton.classList.toggle('scm__chip--on', amend);
    draftArea.disabled = busy || !state;
    pushButton.disabled = busy || !state;
    pullButton.disabled = busy || !state || !state.upstream;
    historyButton.disabled = !workspace;
    root.classList.toggle('is-busy', busy);
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

    const actions = el('span', 'scm__actions');
    if (armed === `${staged ? 's' : 'w'}:${file.path}`) {
      actions.append(confirmButtons('Buang', () => void run('Membuang perubahan…', () => chatApi.scmDiscard(pairOf(file)), () => `Dibuang: ${file.path}.`)));
    } else {
      actions.append(
        actionButton(staged ? 'Batalkan stage file ini' : 'Siapkan file ini', staged ? ICON.minus : ICON.plus, () =>
          void run(staged ? 'Membatalkan stage…' : 'Menyiapkan…', () => chatApi.scmStage(pairOf(file), !staged))
        )
      );
      actions.append(
        actionButton('Buang perubahan file ini', ICON.trash, () => {
          armed = `${staged ? 's' : 'w'}:${file.path}`;
          renderList();
        })
      );
    }
    line.append(actions);

    line.addEventListener('click', () => void openDiff(file.path, staged));
    return line;
  }

  function groupHeader(group: { key: GroupKey; title: string }, files: ScmFile[]): HTMLElement {
    const bar = el('div', 'scm__group');
    bar.append(el('span', 'scm__group-name', `${group.title} · ${files.length}`));
    const paths = files.flatMap(pairOf);
    const actions = el('span', 'scm__actions');

    if (armed === `group:${group.key}`) {
      actions.append(
        confirmButtons('Buang semua', () =>
          void run('Membuang perubahan…', () => chatApi.scmDiscard(paths), () => `Dibuang: ${files.length} file.`)
        )
      );
    } else {
      if (group.key === 'staged') {
        actions.append(
          actionButton('Batalkan stage semua file', ICON.minus, () => void run('Membatalkan stage…', () => chatApi.scmStageAll(false)))
        );
      } else {
        actions.append(
          actionButton(
            group.key === 'unstaged' ? 'Siapkan semua perubahan' : 'Siapkan semua file baru',
            ICON.plus,
            () => void run('Menyiapkan…', () => chatApi.scmStageAll(true))
          )
        );
      }
      actions.append(
        actionButton('Buang semua perubahan di kelompok ini', ICON.trash, () => {
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
      const files = state.files.filter((file) => inGroup(file, group.key));
      if (!files.length) continue;
      list.append(groupHeader(group, files));
      for (const file of files) list.append(row(file, group.key === 'staged'));
    }
  }

  function branchLine(branch: ScmBranch, local: boolean): HTMLElement {
    const line = el('div', 'scm__branch-row');
    if (branch.current) line.classList.add('scm__branch-row--on');
    else line.title = local ? `Pindah ke ${branch.name}` : `Checkout ${branch.name} sebagai branch lokal`;

    const glyph = icon(branch.current ? ICON.check : ICON.branch, 14);
    glyph.classList.add('scm__glyph');
    line.append(glyph, el('span', 'scm__name', branch.name));
    line.append(el('span', 'scm__meta', local ? (branch.current ? branch.name : trackOf(branch)) : branch.when));

    if (armed === `branch:${branch.name}`) {
      line.append(confirmButtons('Hapus', () => void run('Menghapus branch…', () => chatApi.scmBranchDelete(branch.name), (body) => `Branch ${branch.name} dihapus. ${branchSummary(body)}`)));
    } else if (local && !branch.current) {
      line.append(
        actionButton(`Hapus branch ${branch.name}`, ICON.trash, () => {
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
    return Array.isArray(list2) ? `${list2.length} branch lokal.` : '';
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
    bar.append(el('span', 'scm__picker-title', 'Branch'));
    const close = iconButton('Tutup daftar branch', ICON.close, () => {
      pickerOpen = false;
      renderPicker();
    });
    bar.append(close);
    picker.append(bar, branchNew);

    if (!branches) {
      picker.append(note('Membaca daftar branch…'));
      return;
    }
    if (!branches.local.length) picker.append(note('Belum ada branch — repo ini belum punya commit.'));
    else picker.append(pickerGroup('Lokal', branches.local, true));
    if (branches.remote.length) picker.append(pickerGroup('Remote', branches.remote, false));
  }

  function renderHistory(): void {
    historyBox.textContent = '';
    historyBox.hidden = !showHistory;
    if (!showHistory) return;
    historyBox.append(el('p', 'scm__group', history ? `Riwayat · ${history.length}` : 'Riwayat'));
    if (!history) {
      historyBox.append(note('Membaca riwayat commit…'));
      return;
    }
    if (!history.length) {
      historyBox.append(note('Belum ada commit di branch ini.'));
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

  function repaint(): void {
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
      say('Pesan commit harus diisi lebih dulu.', true);
      return;
    }
    const ok = await run('Meng-commit…', () => chatApi.scmCommit(text, amend), (body) => {
      const head = (body as ScmStatus)?.head ?? '';
      return amend ? `Commit terakhir ditimpa menjadi ${head}.` : `Tersimpan sebagai ${head}.`;
    });
    if (ok) {
      draftArea.value = '';
      amend = false;
      paintCompose();
    }
  }

  async function push(kind: 'push' | 'pull'): Promise<void> {
    await run(kind === 'push' ? 'Mengirim ke remote…' : 'Mengambil dari remote…', () =>
      kind === 'push' ? chatApi.scmPush() : chatApi.scmPull(),
      (body) => noteOf(body) || (kind === 'push' ? 'Terkirim ke upstream.' : 'Sudah paling baru.')
    );
  }

  async function switchTo(name: string, local: boolean): Promise<void> {
    await run(local ? `Pindah ke ${name}…` : `Checkout ${name}…`, () => chatApi.scmBranchSwitch(name), (body) =>
      `Sekarang di ${(body as ScmBranches)?.current ?? name}. ${branchSummary(body)}`
    );
  }

  async function createBranch(): Promise<void> {
    const name = branchInput.value.trim();
    if (!name) {
      say('Tulis nama branch lebih dulu.', true);
      return;
    }
    const ok = await run(`Membuat ${name}…`, () => chatApi.scmBranchCreate(name, true), (body) =>
      `Branch ${name} dibuat. ${branchSummary(body)}`
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
