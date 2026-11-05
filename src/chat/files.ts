import { subscribeLocale, t } from '../i18n';
import { ChatApiError, chatApi } from './client';
import { ICON, el, icon, iconButton } from './dom';
import { openContextMenu } from './context-menu';
import { Draft } from './editor';
import { marksFor } from './gitmarks';
import type { MenuEntry } from './context-menu';
import { highlightLines, languageForPath } from './highlight';
import { renderMarkdown } from './markdown';
import { changedKeys, prefs, setPref, subscribePrefs } from './prefs';
import { splitHandle } from './split';
import type { FileContent, FileKind, SearchResult, SearchMode, TreeEntry, WorkspaceInfo } from './types';

const KB = 1024;
const SEARCH_DEBOUNCE_MS = 320;
/** File raksasa dibuat baris per baris, jadi dibatasi supaya DOM tidak meledak. */
const ROW_LIMIT = 8_000;

export interface FilesHooks {
  /** Dipakai untuk menyisipkan path ke composer chat. */
  onReference?: (path: string) => void;
}

export interface FilesPanel {
  setWorkspace(next: WorkspaceInfo | null): void;
  refresh(): void;
  /** Dipakai kartu tool dan header diff untuk membuka berkas pada baris tertentu. */
  openPath(path: string, line?: number): void;
}

function humanSize(bytes: number): string {
  if (bytes < KB) return `${bytes} B`;
  if (bytes < KB * KB) return `${(bytes / KB).toFixed(1)} kB`;
  return `${(bytes / (KB * KB)).toFixed(1)} MB`;
}

function parentOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? '' : path.slice(0, cut);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const GIT_LABELS: Record<string, string> = {
  M: 'files.gitM',
  A: 'files.gitA',
  D: 'files.gitD',
  R: 'files.gitR',
  C: 'files.gitC',
  U: 'files.gitU',
};

/** Tooltip singkat untuk huruf status; huruf tak dikenal tidak dapat tooltip. */
function gitTitle(mark: string): string {
  const key = GIT_LABELS[mark];
  return key ? t(key) : '';
}

/** Agent bisa menulis file kapan saja, jadi tanda git disegarkan selagi halamannya terlihat. */
const GIT_POLL_MS = 6000;

/** Batas satu seretan: folder seukuran node_modules tidak boleh mengubah workspace jadi disk. */
const MAX_DROP_FILES = 200;

type PreviewKind = 'markdown' | 'html' | 'image' | 'pdf' | null;

/** Satu file yang terbuka di viewer; mode, zoom, dan barisnya diingat per tab. */
interface ViewTab {
  path: string;
  content: FileContent;
  mode: 'raw' | 'preview';
  zoom: number;
  line: number;
}

const MAX_TABS = 8;
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg']);
/** Tipe dataTransfer khusus supaya drag dari Explorer tidak dianggap seret internal. */
const DRAG_TYPE = 'application/x-virtoffice-path';

/** Satu entri yang ditandai untuk Copy/Cut; dipindah lewat rename, disalin lewat endpoint copy. */
interface Clip {
  path: string;
  name: string;
  dir: boolean;
  cut: boolean;
}

function extensionOf(path: string): string {
  return path.slice(path.lastIndexOf('.') + 1).toLowerCase();
}

function previewKind(path: string): PreviewKind {
  const ext = extensionOf(path);
  if (ext === 'md' || ext === 'markdown' || ext === 'mdx') return 'markdown';
  if (ext === 'html' || ext === 'htm' || ext === 'xhtml') return 'html';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  return null;
}

/** URL berkas mentah; dipakai aset relatif pratinjau HTML dan sisipan gambar/PDF. */
function rawUrl(path: string): string {
  return `/api/chat/raw/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** URL akar folder file, supaya `<base href>` bisa menurunkan path relatif. */
function assetBase(path: string): string {
  const dir = parentOf(path);
  const prefix = dir ? `${dir.split('/').map(encodeURIComponent).join('/')}/` : '';
  return `/api/chat/raw/${prefix}`;
}

interface Prompt {
  label: string;
  hint: string;
  value: string;
  ok: string;
  danger: boolean;
  editable: boolean;
  submit: (value: string) => Promise<void>;
}

export function mountFiles(container: HTMLElement, hooks: FilesHooks = {}): FilesPanel {
  let workspace: WorkspaceInfo | null = null;
  const children = new Map<string, TreeEntry[]>();
  const expanded = new Set<string>();
  let selected = '';
  const tabs: ViewTab[] = [];
  let activePath = '';
  let viewed: FileContent | null = null;
  let viewLine = 0;
  let viewMode: 'raw' | 'preview' = 'raw';
  let wrap = prefs().wrap;
  let zoom = 1;
  let findValue = '';
  let hits: HTMLElement[] = [];
  let hitIndex = -1;
  let findCount: HTMLElement | null = null;
  let results: SearchResult | null = null;
  let prompt: Prompt | null = null;
  let clip: Clip | null = null;
  let gitMarks = new Map<string, string>();
  let dragging: Clip | null = null;
  let dropNode: HTMLElement | null = null;
  let busy = false;
  let message = '';
  let renderToken = 0;
  let searchTimer = 0;

  const root = el('div', 'files');

  const searchForm = el('form', 'files__searchbar');
  searchForm.setAttribute('role', 'search');
  const searchInput = el('input', 'files__search');
  searchInput.type = 'search';
  searchInput.setAttribute('aria-label', t('files.searchAria'));
  const modeButton = el('button', 'files__mode');
  modeButton.type = 'button';
  modeButton.title = t('files.modeSwitch');
  let mode: SearchMode = 'name';
  const clearButton = iconButton(t('files.clearSearch'), ICON.close, () => {
    searchInput.value = '';
    void runSearch('');
  });
  clearButton.className = 'files__clear';
  searchForm.append(searchInput, modeButton, clearButton);
  searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    window.clearTimeout(searchTimer);
    void runSearch(searchInput.value);
  });

  const toolRow = el('div', 'files__tools');
  const setMode = (next: SearchMode): void => {
    mode = next;
    modeButton.textContent = next === 'name' ? t('files.modeName') : t('files.modeContent');
    modeButton.setAttribute('aria-pressed', String(next === 'content'));
    searchInput.placeholder = next === 'name' ? t('files.searchNames') : t('files.searchContent');
  };
  modeButton.addEventListener('click', () => {
    setMode(mode === 'name' ? 'content' : 'name');
    if (searchInput.value.trim()) void runSearch(searchInput.value);
  });
  const refreshButton = iconButton(t('files.refresh'), ICON.refresh, () => refresh());
  const searchButton = iconButton(t('files.showSearch'), ICON.search, () => toggleSearch());
  searchButton.setAttribute('aria-pressed', 'false');
  const copyButton = iconButton(t('menu.copy'), ICON.copy, () => markFromKeys(false));
  const cutButton = iconButton(t('menu.cut'), ICON.cut, () => markFromKeys(true));
  const pasteButton = iconButton(t('menu.paste'), ICON.paste, () => {
    if (clip) void transferItem(clip, targetDir());
  });
  const newFileButton = iconButton(t('files.newFile'), ICON.filePlus, () => askCreate('file'));
  const newFolderButton = iconButton(t('files.newFolder'), ICON.folderPlus, () => askCreate('folder'));

  // Pembatas hanya di antara grup: lihat/cari, papan klip, buat baru.
  // Satu-satu per icon membuat tujuh button terlihat seperti daftar bertanda.
  const toolGroups = [
    [searchButton, refreshButton],
    [copyButton, cutButton, pasteButton],
    [newFileButton, newFolderButton],
  ];
  toolGroups.forEach((group, index) => {
    if (index) toolRow.append(el('span', 'files__sep'));
    toolRow.append(...group);
  });
  pasteButton.disabled = true;

  const bar = el('div', 'files__bar');
  bar.append(searchForm, toolRow);

  const messageEl = el('p', 'files__message');
  messageEl.setAttribute('role', 'status');

  // Path lengkap workspace aktif, supaya tidak perlu menebak folder mana yang sedang dibuka.
  const rootBar = el('div', 'files__root');
  const rootPath = el('span', 'files__root-path');
  rootBar.append(icon(ICON.folder, 13), rootPath);

  const promptEl = el('div', 'files__prompt');
  promptEl.hidden = true;

  const list = el('div', 'files__list');
  list.setAttribute('role', 'tree');
  list.setAttribute('aria-label', t('files.treeAria'));
  list.tabIndex = 0;

  const viewer = el('section', 'files__viewer');
  viewer.hidden = true;

  // Dua pane: daftar di kiri/atas, pratinjau di kanan/bawah. Arah dipilih di Settings,
  // porsinya digeser lewat pembatas di antaranya.
  const panes = el('div', 'files__panes');
  const split = splitHandle(panes, viewer);
  panes.append(list, split.el, viewer);

  root.append(rootBar, bar, messageEl, promptEl, panes);
  container.append(root);
  setMode('name');
  paintSearch();
  applySplit();
  paintRoot();

  function paintRoot(): void {
    const path = workspace?.path ?? '';
    rootBar.hidden = !path;
    rootPath.textContent = path;
    rootBar.title = path ? t('files.rootHint', { path }) : '';
  }

  function note(text: string): HTMLElement {
    return el('p', 'files__note', text);
  }

  function paintMessage(): void {
    messageEl.textContent = message;
    messageEl.hidden = !message;
  }

  /* ------------------------------------ dialog gagal ------------------------------------ */

  /* ------------------------------------------ dialog ------------------------------------------ */

  let openModal: HTMLElement | null = null;

  interface DialogButton {
    label: string;
    /** Tombol utama satu kartu saja; sisanya tampil netral. */
    emphasis?: boolean;
    action?: () => void;
  }

  function closeModal(): void {
    if (!openModal) return;
    openModal.remove();
    openModal = null;
    document.body.classList.remove('modal-open');
    window.removeEventListener('keydown', onDialogKey);
  }

  function onDialogKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') closeModal();
  }

  /**
   * Satu permukaan untuk semua yang harus dilihat user: gagal, konflik tulis, dan tab yang
   * belum disimpan. Shell-nya kelas .modal milik folder picker supaya permukaannya sama.
   */
  function showDialog(title: string, text: string, buttons: DialogButton[]): void {
    if (!text || !buttons.length) return;
    // Satu kartu per kali: seretan 200 file yang gagal tidak boleh menumpuk 200 dialog.
    closeModal();
    const modal = el('div', 'modal');
    const backdrop = el('div', 'modal__backdrop');
    const card = el('section', 'modal__card modal__card--alert');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'files-dialog-title');
    const head = el('header', 'modal__head');
    const heading = el('h2', '', title);
    heading.id = 'files-dialog-title';
    head.append(heading);
    const row = el('div', 'files__dialog-actions');

    for (const option of buttons) {
      const button = el('button', 'button files__dialog-btn', option.label);
      button.type = 'button';
      if (option.emphasis) button.classList.add('files__dialog-btn--go');
      button.addEventListener('click', () => {
        closeModal();
        option.action?.();
      });
      row.append(button);
    }

    backdrop.addEventListener('click', closeModal);
    card.append(head, el('p', 'files__error', text), row);
    modal.append(backdrop, card);
    document.body.append(modal);
    document.body.classList.add('modal-open');
    window.addEventListener('keydown', onDialogKey);
    openModal = modal;
    const primary =
      row.querySelector<HTMLElement>('.files__dialog-btn--go') ?? (row.firstElementChild as HTMLElement | null);
    primary?.focus();
  }

  function showError(text: string): void {
    showDialog(t('files.errTitle'), text, [{ label: t('files.errClose') }]);
  }

  /* ----------------------------------------- menyunting ----------------------------------------- */

  /** Satu draft per file yang terbuka; dibuang saat tab ditutup atau workspace berganti. */
  const drafts = new Map<string, Draft>();
  /** Titik dirty per tab, diisi tabStrip() dan dikendalikan paintEditorUi(). */
  const tabDots = new Map<string, HTMLElement>();
  let editorUi: {
    save: HTMLButtonElement;
    undo: HTMLButtonElement;
    redo: HTMLButtonElement;
    caret: HTMLElement;
    info: HTMLElement;
    dots: Map<string, HTMLElement>;
  } | null = null;
  /** Baris status milik jendela editor, dibuat toolbar() lalu ditempel renderViewer(). */
  let editBar: HTMLElement | null = null;

  function baseName(path: string): string {
    return path.split('/').pop() ?? path;
  }

  /**
   * Hanya teks utuh yang boleh disunting. File terpotong akan tertulis kembali sebagai
   * separuh isinya, dan gambar/PDF/biner tidak punya teks untuk diketik.
   */
  function editable(content: FileContent | null): boolean {
    if (!content || content.binary || content.truncated || viewMode !== 'raw') return false;
    const kind = previewKind(content.path);
    return kind !== 'image' && kind !== 'pdf';
  }

  function draftFor(content: FileContent): Draft {
    const known = drafts.get(content.path);
    if (known) return known;
    const draft = new Draft({
      path: content.path,
      text: content.text,
      mtime: content.mtime,
      hooks: {
        onActivity: paintEditorUi,
        onSave: () => void saveDraft(draft),
      },
    });
    drafts.set(content.path, draft);
    return draft;
  }

  function dropDraft(path: string): void {
    drafts.get(path)?.destroy();
    drafts.delete(path);
  }

  function disposeDrafts(): void {
    for (const path of Array.from(drafts.keys())) dropDraft(path);
    editorUi = null;
  }

  /** Digambar ulang tiap ketikan: hanya tombol dan status, bukan seluruh viewer. */
  function paintEditorUi(): void {
    if (!editorUi) return;
    for (const [path, dot] of editorUi.dots) {
      const marked = drafts.get(path)?.dirty() ?? false;
      dot.hidden = !marked;
    }
    const draft = drafts.get(activePath);
    if (!draft) {
      editorUi.caret.textContent = '';
      editorUi.info.textContent = '';
      return;
    }
    const caret = draft.caret();
    const delta = draft.delta();
    editorUi.save.disabled = !draft.dirty();
    editorUi.undo.disabled = !draft.canUndo();
    editorUi.redo.disabled = !draft.canRedo();
    editorUi.caret.textContent = t('viewer.editCaret', { line: caret.line, column: caret.column });
    editorUi.info.textContent =
      delta.added || delta.removed
        ? t('viewer.editDiff', { lines: caret.lines, added: delta.added, removed: delta.removed })
        : t('viewer.editInfo', { lines: caret.lines });
  }

  /** Tulis ke disk. force dipakai setelah user memilih menimpa file yang berubah di disk. */
  async function saveDraft(draft: Draft, force = false): Promise<boolean> {
    const tab = tabs.find((item) => item.path === draft.path);
    const text = draft.text();
    try {
      const saved = await chatApi.saveFile(draft.path, text, force ? undefined : draft.mtime);
      draft.markSaved(saved.mtime);
      if (tab) tab.content = { ...tab.content, text, size: saved.size, mtime: saved.mtime };
      if (viewed?.path === draft.path && tab) viewed = tab.content;
      // Isi disk berubah, jadi ukuran di pohon dan tanda git harus diminta ulang.
      invalidate();
      message = t('viewer.saved', { name: baseName(draft.path) });
      paintMessage();
      return true;
    } catch (error) {
      if (error instanceof ChatApiError && error.status === 409) {
        askConflict(draft);
        return false;
      }
      showError(describeError(error));
      return false;
    }
  }

  async function reloadDraft(draft: Draft): Promise<void> {
    try {
      const content = await chatApi.file(draft.path);
      const tab = tabs.find((item) => item.path === draft.path);
      if (tab) tab.content = content;
      if (viewed?.path === draft.path) viewed = content;
      draft.reset(content.text, content.mtime);
    } catch (error) {
      showError(describeError(error));
    }
  }

  function askConflict(draft: Draft): void {
    showDialog(t('viewer.conflictTitle'), t('viewer.conflictBody', { name: baseName(draft.path) }), [
      { label: t('files.cancel') },
      { label: t('viewer.conflictReload'), action: () => void reloadDraft(draft) },
      { label: t('viewer.conflictOverwrite'), emphasis: true, action: () => void saveDraft(draft, true) },
    ]);
  }

  /** Tab yang belum disimpan tidak pernah ditinggal diam-diam. */
  function guardAway(path: string, then: () => void): void {
    const draft = drafts.get(path);
    if (!draft || !draft.dirty()) {
      then();
      return;
    }
    showDialog(t('viewer.unsavedTitle'), t('viewer.unsavedBody', { name: baseName(path) }), [
      { label: t('files.cancel') },
      {
        label: t('viewer.unsavedDiscard'),
        action: () => {
          dropDraft(path);
          then();
        },
      },
      {
        label: t('viewer.unsavedSave'),
        emphasis: true,
        action: () => {
          void saveDraft(draft).then((saved) => {
            if (saved) then();
          });
        },
      },
    ]);
  }

  /** Semua draf yang belum ditulis, untuk satu pertanyaan saat preview ditutup seluruhnya. */
  function dirtyDrafts(): Draft[] {
    return Array.from(drafts.values()).filter((draft) => draft.dirty());
  }

  function guardAll(then: () => void): void {
    const dirty = dirtyDrafts();
    if (!dirty.length) {
      then();
      return;
    }
    const names = dirty.map((draft) => baseName(draft.path)).join(', ');
    showDialog(t('viewer.unsavedTitle'), t('viewer.unsavedMany', { names }), [
      { label: t('files.cancel') },
      {
        label: t('viewer.unsavedDiscard'),
        action: () => {
          disposeDrafts();
          then();
        },
      },
      {
        label: t('viewer.unsavedSave'),
        emphasis: true,
        action: () => {
          // Satu per satu: yang gagal berhenti di dialog, sisanya tidak ikut dibuang.
          void dirty
            .reduce(
              (chain, draft) => chain.then((ok) => (ok ? saveDraft(draft) : Promise.resolve(false))),
              Promise.resolve(true)
            )
            .then((ok) => {
              if (ok) then();
            });
        },
      },
    ]);
  }

  function applySplit(): void {
    panes.classList.toggle('files__panes--side', prefs().previewSplit === 'vertical');
    split.sync();
  }

  /* ---------------------------------- prompt inline ---------------------------------- */

  function renderPrompt(): void {
    promptEl.textContent = '';
    if (!prompt) {
      promptEl.hidden = true;
      return;
    }
    promptEl.hidden = false;
    promptEl.classList.toggle('files__prompt--danger', prompt.danger);
    promptEl.append(el('span', 'files__prompt-label', prompt.label));

    let field: HTMLInputElement | null = null;
    if (prompt.editable) {
      field = el('input', 'files__prompt-input');
      field.type = 'text';
      field.value = prompt.value;
      field.setAttribute('aria-label', prompt.label);
      field.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closePrompt();
        if (event.key === 'Enter') {
          event.preventDefault();
          void submitPrompt(field?.value ?? '');
        }
      });
      promptEl.append(field);
    }
    if (prompt.hint) promptEl.append(el('span', 'files__prompt-hint', prompt.hint));

    const ok = el('button', 'files__prompt-ok', prompt.ok);
    ok.type = 'button';
    ok.addEventListener('click', () => void submitPrompt(field?.value ?? ''));
    const cancel = el('button', 'files__prompt-cancel', t('files.cancel'));
    cancel.type = 'button';
    cancel.addEventListener('click', closePrompt);
    promptEl.append(ok, cancel);
    field?.focus();
    field?.select();
  }

  function closePrompt(): void {
    prompt = null;
    renderPrompt();
  }

  async function submitPrompt(value: string): Promise<void> {
    const action = prompt;
    if (!action || busy) return;
    busy = true;
    paintMessage();
    try {
      await action.submit(value);
    } catch (error) {
      showError(describeError(error));
    } finally {
      busy = false;
      paintMessage();
    }
  }

  function targetDir(): string {
    if (!selected) return '';
    const entry = children.get(parentOf(selected))?.find((item) => item.path === selected);
    if (!entry) return parentOf(selected);
    return entry.dir ? entry.path : parentOf(entry.path);
  }

  function askCreate(kind: FileKind, dir = targetDir()): void {
    if (!workspace) {
      showError(t('files.needWorkspace'));
      return;
    }
    prompt = {
      label: kind === 'file' ? t('files.newFileLabel') : t('files.newFolderLabel'),
      hint: dir ? t('files.inFolder', { path: dir }) : t('files.atRoot'),
      value: '',
      ok: t('files.create'),
      danger: false,
      editable: true,
      submit: async (value) => {
        const name = value.trim().replace(/^\/+/, '');
        if (!name) throw new Error(t('files.emptyName'));
        const path = dir ? `${dir}/${name}` : name;
        await chatApi.createFile(path, kind);
        closePrompt();
        if (dir) expanded.add(dir);
        selected = path;
        invalidate();
        await redraw();
        // Ditulis setelah redraw karena redraw sendiri membersihkan pesan lama.
        message = t('files.created', { path });
      },
    };
    renderPrompt();
  }

  function askRename(entry: TreeEntry): void {
    prompt = {
      label: t('files.renameLabel'),
      hint: t('files.renameHint'),
      value: entry.path,
      ok: t('files.save'),
      danger: false,
      editable: true,
      submit: async (value) => {
        const to = value.trim().replace(/^\/+/, '');
        if (!to) throw new Error(t('files.emptyName'));
        if (to === entry.path) {
          closePrompt();
          return;
        }
        await chatApi.renameFile(entry.path, to);
        closePrompt();
        if (viewed?.path === entry.path) closeViewer();
        invalidate();
        await redraw();
        message = t('files.renamed', { from: entry.path, to });
      },
    };
    renderPrompt();
  }

  function askDelete(entry: TreeEntry): void {
    prompt = {
      label: t('files.deleteLabel', { name: entry.name }),
      hint: entry.dir ? t('files.deleteFolderHint', { path: entry.path }) : entry.path,
      value: entry.path,
      ok: t('files.remove'),
      danger: true,
      editable: false,
      submit: async () => {
        await chatApi.deleteFile(entry.path);
        closePrompt();
        expanded.delete(entry.path);
        if (viewed?.path === entry.path || viewed?.path.startsWith(`${entry.path}/`)) closeViewer();
        invalidate();
        await redraw();
        message = t('files.deleted', { path: entry.path });
      },
    };
    renderPrompt();
  }

  /* ------------------------------------ papan klip ------------------------------------ */

  /** Baris mana pun yang sedang ditandai potong dibuat redup. */
  function paintClipMarks(): void {
    for (const rowEl of Array.from(list.querySelectorAll<HTMLElement>('.files__row'))) {
      rowEl.classList.toggle('files__row--cut', Boolean(clip?.cut && rowEl.dataset.path === clip.path));
    }
  }

  /** Menandai tanpa suara: yang tersisa cuma baris yang redup dan tombol Tempel yang aktif. */
  function markClip(entry: TreeEntry, cut: boolean): void {
    clip = { path: entry.path, name: entry.name, dir: entry.dir, cut };
    paintClipMarks();
    paintTools();
  }

  function clearClip(): void {
    if (!clip) return;
    clip = null;
    paintClipMarks();
    paintTools();
  }

  /** Pindah = rename lintas folder, salin = endpoint copy; keduanya pakai path relatif. */
  async function transferItem(item: Clip, dir: string): Promise<void> {
    if (busy) return;
    const to = dir ? `${dir}/${item.name}` : item.name;
    if (item.cut && to === item.path) {
      showError(t('files.alreadyThere'));
      return;
    }
    busy = true;
    paintMessage();
    try {
      const done = item.cut ? await chatApi.renameFile(item.path, to) : await chatApi.copyFile(item.path, to);
      if (viewed && item.cut && (viewed.path === item.path || viewed.path.startsWith(`${item.path}/`))) {
        closeViewer();
      }
      // Setelah pindah, jalurnya berubah jadi tandanya tidak berlaku lagi; salinan dibiarkan
      // menempel supaya satu item bisa ditempel ke beberapa folder.
      if (item.cut && clip && (clip.path === item.path || clip.path.startsWith(`${item.path}/`))) clip = null;
      reveal(done.to);
      invalidate();
      await redraw();
    } catch (error) {
      showError(describeError(error));
    } finally {
      busy = false;
      paintMessage();
    }
  }

  function selectedEntry(): TreeEntry | null {
    return selected ? entryAt(selected) : null;
  }

  function markFromKeys(cut: boolean): boolean {
    const entry = selectedEntry();
    if (!entry) {
      showError(t('files.noSelection'));
      return false;
    }
    markClip(entry, cut);
    return true;
  }

  /* -------------------------------------- seret-lepas -------------------------------------- */

  function rowUnder(event: DragEvent): HTMLElement | null {
    return event.target instanceof Element ? event.target.closest<HTMLElement>('.files__row') : null;
  }

  function hasOwnDrag(event: DragEvent): boolean {
    const types = event.dataTransfer?.types;
    return Boolean(dragging || (types && Array.from(types).includes(DRAG_TYPE)));
  }

  function hasFiles(event: DragEvent): boolean {
    const types = event.dataTransfer?.types;
    return Boolean(types && Array.from(types).includes('Files'));
  }

  /** Folder tujuan di bawah kursor; file row menerima untuk folder induknya. */
  function folderUnder(event: DragEvent): { dir: string; node: HTMLElement } {
    const rowEl = rowUnder(event);
    if (!rowEl?.dataset.path) return { dir: '', node: list };
    const path = rowEl.dataset.path;
    return { dir: rowEl.dataset.dir === 'true' ? path : parentOf(path), node: rowEl };
  }

  function dropTarget(event: DragEvent): { dir: string; node: HTMLElement } | null {
    if (!dragging || !hasOwnDrag(event)) return null;
    const hit = folderUnder(event);
    if (!hit.node.dataset.path) return hit;
    if (hit.node.dataset.path === dragging.path) return null;
    // Menaruh folder ke dalam dirinya sendiri akan menghapus seluruh cabangnya.
    if (hit.dir === dragging.path || hit.dir.startsWith(`${dragging.path}/`)) return null;
    return hit;
  }

  function paintDrop(node: HTMLElement | null): void {
    if (dropNode === node) return;
    dropNode?.classList.remove('files__row--drop', 'files__list--drop');
    dropNode = node;
    if (node) node.classList.add(node === list ? 'files__list--drop' : 'files__row--drop');
  }

  /** Satu seretan dari Explorer: berkas dengan path relatifnya plus daftar folder. */
  interface Drop {
    items: { path: string; file: File }[];
    dirs: string[];
    capped: boolean;
  }

  /** Entry hanya bisa diambil sinkron saat event drop; membacanya baru boleh belakangan. */
  function droppedEntries(event: DragEvent): { entries: FileSystemEntry[]; loose: File[] } {
    const data = event.dataTransfer;
    const entries: FileSystemEntry[] = [];
    const loose: File[] = [];
    if (!data) return { entries, loose };
    if (!data.items.length) {
      for (const file of Array.from(data.files)) loose.push(file);
      return { entries, loose };
    }
    for (const item of Array.from(data.items)) {
      if (item.kind !== 'file') continue;
      // Folder cuma terlihat lewat entry; daftar File[] saja tidak bisa mengenalinya.
      const entry = item.webkitGetAsEntry?.() ?? null;
      if (entry) entries.push(entry);
      else {
        const file = item.getAsFile();
        if (file) loose.push(file);
      }
    }
    return { entries, loose };
  }

  /** readEntries mengembalikan maksimal 100 per panggilan, jadi diulang sampai kosong. */
  function readDir(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
    const reader = dir.createReader();
    return new Promise((resolve, reject) => {
      const all: FileSystemEntry[] = [];
      const step = (): void =>
        reader.readEntries(
          (batch) => {
            if (!batch.length) resolve(all);
            else {
              all.push(...batch);
              step();
            }
          },
          (error) => reject(error)
        );
      step();
    });
  }

  function fileOf(entry: FileSystemFileEntry): Promise<File> {
    return new Promise((resolve, reject) => entry.file(resolve, (error) => reject(error)));
  }

  /** Jalan rekursif pohon folder yang diseret; path memakai nama folder teratas. */
  async function walk(entry: FileSystemEntry, prefix: string, drop: Drop): Promise<void> {
    if (drop.items.length >= MAX_DROP_FILES) {
      drop.capped = true;
      return;
    }
    if (entry.isFile) {
      try {
        drop.items.push({ path: `${prefix}${entry.name}`, file: await fileOf(entry as FileSystemFileEntry) });
      } catch {
        // Folder sistem yang lagi terkunci bisa gagal dibaca: lewati satu ini.
      }
      return;
    }
    if (!entry.isDirectory) return;
    drop.dirs.push(`${prefix}${entry.name}`);
    const children = await readDir(entry as FileSystemDirectoryEntry).catch(() => []);
    for (const child of children) {
      await walk(child, `${prefix}${entry.name}/`, drop);
      if (drop.capped) return;
    }
  }

  async function collectDrop(event: DragEvent): Promise<Drop> {
    const drop: Drop = { items: [], dirs: [], capped: false };
    const { entries, loose } = droppedEntries(event);
    for (const entry of entries) await walk(entry, '', drop);
    for (const file of loose) drop.items.push({ path: file.name, file });
    return drop;
  }

  /** Satu berkas per permintaan, berurutan: dua tulis bersamaan sulit dibaca progresnya. */
  async function uploadAll(drop: Drop, dir: string): Promise<void> {
    if (busy) return;
    const join = (rel: string): string => (dir ? `${dir}/${rel}` : rel);
    busy = true;
    const done: string[] = [];
    const failed: string[] = [];
    let reason = '';
    for (const [index, item] of drop.items.entries()) {
      message = t('files.uploading', { index: index + 1, total: drop.items.length, name: item.path });
      paintMessage();
      try {
        const up = await chatApi.uploadFile(join(item.path), item.file);
        // Nama bisa berubah jadi '(2)' di server, jadi path hasilnya yang dipakai.
        done.push(up.path);
        reveal(up.path);
      } catch (error) {
        failed.push(item.path);
        reason = describeError(error);
      }
    }
    // Cabang kosong juga dibuat supaya struktur yang diseret utuh lagi. Gagal di sini
    // hampir selalu berarti foldernya sudah ada di tujuan, jadi bukan sesuatu untuk dilaporkan.
    for (const rel of drop.dirs) {
      if (done.some((p) => p.startsWith(`${join(rel)}/`))) continue;
      await chatApi.createFile(join(rel), 'folder').catch(() => {});
    }
    invalidate();
    await redraw();
    busy = false;
    const notes: string[] = [];
    if (done.length === 1) notes.push(t('files.uploadedOne', { name: done[0] }));
    if (done.length > 1) notes.push(t('files.uploadedMany', { count: done.length }));
    if (drop.capped) notes.push(t('files.uploadCapped', { count: MAX_DROP_FILES }));
    message = notes.join(' ');
    paintMessage();
    // Yang gagal tetap lewat dialog: satu baris teks terlalu mudah terlewat di tengah batch.
    if (failed.length) showError(t('files.uploadFailed', { names: failed.join(', '), reason }));
  }

  function bindDragAndDrop(): void {
    list.addEventListener('dragstart', (event) => {
      const rowEl = rowUnder(event);
      const entry = rowEl?.dataset.path ? entryAt(rowEl.dataset.path) : null;
      if (!rowEl || !entry) {
        event.preventDefault();
        return;
      }
      dragging = { path: entry.path, name: entry.name, dir: entry.dir, cut: false };
      selected = entry.path;
      const data = event.dataTransfer;
      if (data) {
        data.effectAllowed = 'copyMove';
        data.setData(DRAG_TYPE, entry.path);
        data.setData('text/plain', entry.path);
      }
      rowEl.classList.add('files__row--drag');
    });

    list.addEventListener('dragover', (event) => {
      const hit = dropTarget(event);
      if (hit) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = event.ctrlKey || event.metaKey ? 'copy' : 'move';
        paintDrop(hit.node);
        return;
      }
      if (hasFiles(event) && !dragging) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        paintDrop(folderUnder(event).node);
      }
    });

    list.addEventListener('dragleave', (event) => {
      if (!list.contains(event.relatedTarget as Node | null)) paintDrop(null);
    });

    list.addEventListener('drop', (event) => {
      if (!dragging && hasFiles(event)) {
        event.preventDefault();
        paintDrop(null);
        // Semuanya harus dibaca sinkron sebelum event selesai: dataTransfer
        // sudah dilucuti browser saat promise traversal tiba.
        const dir = folderUnder(event).dir;
        void collectDrop(event).then((drop) => uploadAll(drop, dir));
        return;
      }
      const hit = dropTarget(event);
      const item = dragging;
      paintDrop(null);
      if (!hit || !item) return;
      event.preventDefault();
      const copy = event.ctrlKey || event.metaKey;
      void transferItem({ ...item, cut: !copy }, hit.dir);
    });

    list.addEventListener('dragend', () => {
      dragging = null;
      paintDrop(null);
      for (const rowEl of Array.from(list.querySelectorAll<HTMLElement>('.files__row--drag'))) {
        rowEl.classList.remove('files__row--drag');
      }
    });

    // Lepes di luar pohon tetap ditelan: tanpa ini browser membuka file itu dan
    // halaman berpindah, lalu semua state aplikasi hilang.
    document.addEventListener('dragover', (event) => {
      if (!dragging && hasFiles(event)) event.preventDefault();
    });
    document.addEventListener('drop', (event) => {
      if (!dragging && hasFiles(event)) event.preventDefault();
    });
  }

  function bindClipKeys(): void {
    document.addEventListener('keydown', (event) => {
      // Hanya saat halaman File List yang tampil; kolom teks dan blok teks yang diseleksi
      // dibiarkan memakai Ctrl+C/X/V biasa, dan pohon tidak selalu bisa memegang fokus.
      if (root.offsetParent === null) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'c') {
        if (window.getSelection()?.toString()) return;
        if (markFromKeys(false)) event.preventDefault();
      } else if (key === 'x') {
        if (markFromKeys(true)) event.preventDefault();
      } else if (key === 'v') {
        if (clip) {
          event.preventDefault();
          void transferItem(clip, targetDir());
        }
      }
    });
  }

  /* ------------------------------------ pohon file ------------------------------------ */

  /** Isi disk berubah: buang cache direktori sekaligus minta tanda git yang baru. */
  function invalidate(): void {
    children.clear();
    void syncGit();
  }

  async function loadDir(dirPath: string): Promise<TreeEntry[]> {
    const cached = children.get(dirPath);
    if (cached) return cached;
    const tree = await chatApi.tree(dirPath);
    children.set(dirPath, tree.entries);
    return tree.entries;
  }

  /** Huruf status git per path, dari endpoint SCM yang sama dengan tab Source Control. */
  async function syncGit(): Promise<void> {
    if (!workspace) {
      gitMarks = new Map();
      return;
    }
    try {
      gitMarks = marksFor((await chatApi.scmStatus()).files);
    } catch {
      // Bukan repo git atau git belum siap: pohon tampil tanpa tanda.
      gitMarks = new Map();
    }
    paintGitMarks();
  }

  /** Menempelkan huruf status ke baris yang sudah ada, tanpa menggambar ulang pohon. */
  function paintGitMarks(): void {
    for (const rowEl of Array.from(list.querySelectorAll<HTMLElement>('.files__row'))) {
      const mark = gitMarks.get(rowEl.dataset.path ?? '') ?? '';
      rowEl.dataset.git = mark;
      const badge = rowEl.querySelector<HTMLElement>('.files__git');
      if (!badge) continue;
      badge.textContent = rowEl.dataset.dir === 'true' ? '' : mark;
      badge.title = gitTitle(mark);
    }
  }

  function row(entry: TreeEntry, depth: number): HTMLElement {
    const line = el('div', entry.path === selected ? 'files__row files__row--active' : 'files__row');
    line.setAttribute('role', 'treeitem');
    line.dataset.path = entry.path;
    line.dataset.dir = String(entry.dir);
    line.draggable = true;
    if (clip?.cut && clip.path === entry.path) line.classList.add('files__row--cut');
    line.style.setProperty('--depth', String(depth));
    if (entry.dir) {
      line.setAttribute('aria-expanded', String(expanded.has(entry.path)));
      line.append(el('span', 'files__twist', expanded.has(entry.path) ? '▾' : '▸'));
    } else {
      line.append(el('span', 'files__twist', ''));
    }

    const glyph = icon(entry.dir ? ICON.folder : ICON.file, 14);
    glyph.classList.add('files__glyph');
    const name = el('span', 'files__name', entry.name);
    name.title = entry.path;
    const meta = el('span', 'files__meta', entry.dir ? '' : humanSize(entry.size));
    const mark = gitMarks.get(entry.path) ?? '';
    // Huruf status hanya di baris file; folder cukup ikut warna namanya.
    const git = el('span', 'files__git', entry.dir ? '' : mark);
    git.title = gitTitle(mark);
    line.dataset.git = mark;

    line.append(glyph, name, meta, git);

    const actions = el('span', 'files__actions');
    actions.append(
      iconButton(t('files.rename'), ICON.pencil, () => askRename(entry)),
      iconButton(t('files.remove'), ICON.trash, () => askDelete(entry))
    );
    line.append(actions);

    line.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('.files__actions')) return;
      selected = entry.path;
      // Fokus ke pohon supaya Ctrl+C/X/V langsung jalan tanpa klik tambahan.
      list.focus({ preventScroll: true });
      if (entry.dir) {
        if (expanded.has(entry.path)) expanded.delete(entry.path);
        else expanded.add(entry.path);
        void redraw();
      } else {
        void openFile(entry.path, { mode: prefs().defaultView });
      }
    });
    return line;
  }

  /** Item "Tempel" hanya muncul saat ada yang ditandai; arahnya diambil saat menu dibangun. */
  function pasteItem(dir: string, label: string): MenuEntry[] {
    if (!clip) return [];
    const item = clip;
    return [{ label, glyph: ICON.paste, run: () => void transferItem(item, dir) }];
  }

  function buildMenu(entry: TreeEntry | null): MenuEntry[] {
    const items: MenuEntry[] = [];
    if (entry && !entry.dir) {
      items.push({
        label: t('menu.openRaw'),
        glyph: ICON.file,
        run: () => void openFile(entry.path, { mode: 'raw' }),
      });
      if (previewKind(entry.path)) {
        items.push({
          label: t('menu.openPreview'),
          glyph: ICON.expand,
          run: () => void openFile(entry.path, { mode: 'preview' }),
        });
      }
      items.push({
        label: t('menu.copyPath'),
        glyph: ICON.copy,
        run: () => void copyPath(entry.path),
      });
      if (hooks.onReference) {
        items.push({
          label: t('menu.reference'),
          glyph: ICON.plus,
          run: () => hooks.onReference?.(entry.path),
        });
      }
      items.push(...pasteItem(parentOf(entry.path), t('menu.paste')));
      items.push({ separator: true });
    }
    if (entry?.dir) {
      items.push({
        label: t('menu.newFile'),
        glyph: ICON.filePlus,
        run: () => askCreate('file', entry.path),
      });
      items.push({
        label: t('menu.newFolder'),
        glyph: ICON.folderPlus,
        run: () => askCreate('folder', entry.path),
      });
      items.push(...pasteItem(entry.path, t('menu.pasteInto', { name: entry.name })));
      items.push({ separator: true });
    } else if (!entry) {
      items.push({
        label: t('menu.newFile'),
        glyph: ICON.filePlus,
        run: () => askCreate('file', ''),
      });
      items.push({
        label: t('menu.newFolder'),
        glyph: ICON.folderPlus,
        run: () => askCreate('folder', ''),
      });
      const dir = targetDir();
      items.push(
        ...pasteItem(dir, dir ? t('menu.pasteInto', { name: dir.split('/').pop() ?? dir }) : t('menu.paste'))
      );
      items.push({ separator: true });
    }
    if (entry) {
      items.push({ label: t('menu.copy'), glyph: ICON.copy, run: () => markClip(entry, false) });
      items.push({ label: t('menu.cut'), glyph: ICON.cut, run: () => markClip(entry, true) });
      if (clip) items.push({ label: t('menu.clearClip'), glyph: ICON.close, run: clearClip });
      items.push({ separator: true });
      items.push({
        label: t('menu.rename'),
        glyph: ICON.pencil,
        run: () => askRename(entry),
      });
      items.push({
        label: t('menu.delete'),
        glyph: ICON.trash,
        danger: true,
        run: () => askDelete(entry),
      });
    } else {
      items.push({
        label: t('menu.refresh'),
        glyph: ICON.refresh,
        run: () => refresh(),
      });
    }
    return items;
  }

  function entryAt(path: string): TreeEntry | null {
    for (const entries of children.values()) {
      const found = entries.find((item) => item.path === path);
      if (found) return found;
    }
    return null;
  }

  async function copyPath(path: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(path);
      message = t('files.copiedPath');
      paintMessage();
    } catch {
      showError(t('viewer.copyFailed'));
    }
  }

  function bindContextMenu(): void {
    list.addEventListener('contextmenu', (event) => {
      const rowEl = event.target instanceof Element ? event.target.closest<HTMLElement>('.files__row') : null;
      const path = rowEl?.dataset.path ?? '';
      const entry = path ? entryAt(path) : null;
      event.preventDefault();
      openContextMenu(
        { clientX: event.clientX, clientY: event.clientY },
        buildMenu(entry),
        entry?.path ?? workspace?.name ?? t('files.treeAria')
      );
      if (path) {
        selected = path;
        void redraw();
      }
    });
  }

  /* -------------------------------------- pratinjau -------------------------------------- */

  function current(): ViewTab | null {
    return tabs.find((tab) => tab.path === activePath) ?? null;
  }

  /** State viewer yang lagi tampil dikembalikan ke tab-nya sebelum berpindah. */
  function saveTab(): void {
    const tab = current();
    if (!tab) return;
    tab.mode = viewMode;
    tab.zoom = zoom;
    tab.line = viewLine;
  }

  function activate(tab: ViewTab | null): void {
    if (tab && tab.path === activePath) {
      applyActivate(tab);
      return;
    }
    guardAway(activePath, () => applyActivate(tab));
  }

  function applyActivate(tab: ViewTab | null): void {
    saveTab();
    findValue = '';
    hits = [];
    hitIndex = -1;
    if (!tab) {
      activePath = '';
      viewed = null;
      renderViewer();
      return;
    }
    activePath = tab.path;
    viewed = tab.content;
    viewMode = tab.mode;
    zoom = tab.zoom;
    viewLine = tab.line;
    wrap = prefs().wrap;
    selected = tab.path;
    renderViewer();
  }

  function closeTab(path: string): void {
    guardAway(path, () => applyCloseTab(path));
  }

  function applyCloseTab(path: string): void {
    const index = tabs.findIndex((tab) => tab.path === path);
    if (index < 0) return;
    const wasActive = tabs[index].path === activePath;
    tabs.splice(index, 1);
    dropDraft(path);
    if (!wasActive) {
      renderViewer();
      return;
    }
    const next = tabs[Math.min(index, tabs.length - 1)] ?? null;
    activePath = '';
    applyActivate(next);
  }

  function closeViewer(): void {
    guardAll(() => {
      tabs.length = 0;
      activePath = '';
      viewed = null;
      viewLine = 0;
      findValue = '';
      disposeDrafts();
      renderViewer();
    });
  }

  function setViewMode(next: 'raw' | 'preview'): void {
    viewMode = next;
    renderViewer();
  }

  function tabStrip(): HTMLElement {
    const strip = el('div', 'viewer__tabs');
    strip.setAttribute('role', 'tablist');
    for (const tab of tabs) {
      const button = el('button', 'viewer__tab');
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(tab.path === activePath));
      button.title = tab.path;
      const name = tab.path.split('/').pop() ?? tab.path;
      button.append(el('span', 'viewer__tab-name', name));
      // Titik dirty: satu-satunya penanda tab ini punya draf yang belum ditulis.
      const dot = el('span', 'viewer__tab-dot', '•');
      dot.title = t('viewer.unsavedDot');
      dot.hidden = !(drafts.get(tab.path)?.dirty() ?? false);
      tabDots.set(tab.path, dot);
      button.append(dot);
      const close = el('span', 'viewer__tab-close', '×');
      close.setAttribute('role', 'button');
      close.setAttribute('aria-label', t('viewer.tabClose', { name }));
      close.addEventListener('click', (event) => {
        event.stopPropagation();
        closeTab(tab.path);
      });
      button.append(close);
      button.addEventListener('click', () => activate(tab));
      strip.append(button);
    }
    const clear = iconButton(t('viewer.close'), ICON.close, closeViewer);
    clear.className = 'viewer__icon viewer__icon--tail';
    strip.append(clear);
    return strip;
  }

  function toolbar(): HTMLElement {
    const barEl = el('div', 'viewer__bar');
    const kind = viewed ? previewKind(viewed.path) : null;

    // Seg hanya untuk teks yang bisa tampil dua wajah; gambar dan PDF selalu satu wajah.
    if (viewed && !viewed.binary && (kind === 'markdown' || kind === 'html')) {
      const seg = el('div', 'viewer__seg');
      for (const option of ['raw', 'preview'] as const) {
        const button = el('button', 'viewer__seg-btn', t(option === 'raw' ? 'viewer.raw' : 'viewer.preview'));
        button.type = 'button';
        button.setAttribute('aria-pressed', String(viewMode === option));
        button.addEventListener('click', () => setViewMode(option));
        seg.append(button);
      }
      barEl.append(seg);
    }

    const actions = el('span', 'viewer__actions');
    if (viewed) {
      // Penanda hanya muncul kalau isinya memang dipotong atau bukan teks.
      const flags = [
        viewed.truncated ? t('viewer.truncated') : '',
        viewed.binary && kind !== 'image' && kind !== 'pdf' ? t('viewer.binary') : '',
      ].filter(Boolean);
      if (flags.length) barEl.append(el('span', 'viewer__count', flags.join(' · ')));
    }

    // Grup ikon dipisah garis rambut, sama seperti bar di atas pohon file: satu pembatas
    // per kelompok, bukan per ikon.
    const groups: HTMLElement[][] = [];

    if (viewed && (kind === 'image' || kind === 'pdf')) {
      if (kind === 'image') groups.push([zoomButton('out'), zoomButton('in')]);
      groups.push([openLinkButton(viewed.path)]);
    } else if (viewed && !viewed.binary) {
      const wrapButton = el('button', 'viewer__icon');
      wrapButton.type = 'button';
      wrapButton.title = t(wrap ? 'viewer.wrapOn' : 'viewer.wrapOff');
      wrapButton.setAttribute('aria-label', wrapButton.title);
      wrapButton.setAttribute('aria-pressed', String(wrap));
      wrapButton.append(icon(ICON.wrap, 15));
      wrapButton.addEventListener('click', () => {
        wrap = !wrap;
        renderViewer();
      });

      const copy = el('button', 'viewer__icon');
      copy.type = 'button';
      copy.title = t('viewer.copy');
      copy.setAttribute('aria-label', copy.title);
      copy.append(icon(ICON.copy, 15));
      copy.addEventListener('click', () => {
        const text = viewed?.text ?? '';
        void navigator.clipboard
          ?.writeText(text)
          .then(() => {
            message = t('viewer.copied');
            paintMessage();
          })
          .catch(() => {
            showError(t('viewer.copyFailed'));
          });
      });

      if (hooks.onReference) {
        groups.push([
          iconButton(t('menu.reference'), ICON.plus, () => hooks.onReference?.(viewed?.path ?? '')),
        ]);
      }
      groups.push([wrapButton, zoomButton('out'), zoomButton('in')], [copy]);

      // Mode sunting: grup terakhir adalah cari & ganti plus riwayat/simpan; posisi kursor
      // ada di baris status dasar editor. Pencarian lama dilompati karena panel CodeMirror
      // sudah cari sekaligus ganti.
      if (editable(viewed)) {
        const draft = draftFor(viewed);
        const caret = el('span', 'viewer__status-caret');
        const info = el('span', 'viewer__status-info');
        editBar = el('div', 'viewer__status');
        editBar.append(caret, info);
        const find = iconButton(t('viewer.findReplace'), ICON.search, () => draft.openFind());
        const undo = iconButton(t('viewer.undo'), ICON.undo, () => draft.undo());
        const redo = iconButton(t('viewer.redo'), ICON.redo, () => draft.redo());
        const save = iconButton(t('viewer.save'), ICON.save, () => void saveDraft(draft));
        editorUi = { save, undo, redo, caret, info, dots: tabDots };
        groups.push([find, undo, redo, save]);
      } else {
        editorUi = null;
        barEl.append(findControl());
      }
    }
    groups.forEach((group, index) => {
      if (index) actions.append(el('span', 'files__sep'));
      actions.append(...group);
    });
    // Rata kiri seperti bar di atas pohon file: tanpa spacer, ikon tidak menggantung di kanan.
    barEl.append(actions);
    return barEl;
  }

  function zoomButton(direction: 'in' | 'out'): HTMLButtonElement {
    const button = el('button', 'viewer__icon');
    button.type = 'button';
    button.title = direction === 'in' ? t('viewer.zoomIn') : t('viewer.zoomOut');
    button.setAttribute('aria-label', button.title);
    button.append(icon(direction === 'in' ? ICON.plus : ICON.minus, 15));
    button.addEventListener('click', () => {
      zoom =
        direction === 'in'
          ? Math.min(1.8, Number((zoom + 0.1).toFixed(2)))
          : Math.max(0.7, Number((zoom - 0.1).toFixed(2)));
      renderViewer();
    });
    return button;
  }

  /** pranala ke berkas mentah; gambar/PDF tidak bisa disisipkan lebih dari ini. */
  function openLinkButton(path: string): HTMLAnchorElement {
    const link = el('a', 'viewer__icon');
    link.href = rawUrl(path);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = t('viewer.openInTab');
    link.setAttribute('aria-label', link.title);
    link.append(icon(ICON.expand, 15));
    return link;
  }

  function findControl(): HTMLElement {
    const box = el('div', 'viewer__findbox');
    const input = el('input', 'viewer__find');
    input.type = 'search';
    input.placeholder = t('viewer.findPlaceholder');
    input.setAttribute('aria-label', t('viewer.findPlaceholder'));
    input.value = findValue;
    const count = el('span', 'viewer__find-count');
    findCount = count;

    const arrow = (key: 'findPrev' | 'findNext', glyph: string): HTMLButtonElement => {
      const button = el('button', 'viewer__find-btn', glyph);
      button.type = 'button';
      button.title = t(`viewer.${key}`);
      button.setAttribute('aria-label', button.title);
      button.addEventListener('click', () => step(key === 'findNext' ? 1 : -1));
      return button;
    };

    input.addEventListener('input', () => {
      findValue = input.value;
      runFind();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        step(event.shiftKey ? -1 : 1);
      } else if (event.key === 'Escape') {
        input.value = '';
        findValue = '';
        runFind();
      }
    });

    box.append(input, arrow('findPrev', '↑'), arrow('findNext', '↓'), count);
    return box;
  }

  function runFind(): void {
    const body = viewer.querySelector<HTMLElement>('[data-view="code"]');
    const rows = body ? Array.from(body.querySelectorAll<HTMLElement>('.code__row')) : [];
    for (const row of rows) row.classList.remove('code__row--hit', 'code__row--active');
    hits = [];
    hitIndex = -1;

    if (!findValue || !rows.length) {
      paintFindCount();
      return;
    }

    if (findValue.startsWith(':')) {
      const target = Number(findValue.slice(1));
      if (Number.isInteger(target) && target >= 1 && target <= rows.length) {
        rows[target - 1].classList.add('code__row--active');
        body?.scrollTo({ top: Math.max(0, rows[target - 1].offsetTop - 40) });
      } else {
        showError(
          t('viewer.gotoMissing', { line: Number.isFinite(target) ? target : 0, count: rows.length })
        );
      }
      paintFindCount();
      return;
    }

    const needle = findValue.toLowerCase();
    hits = rows.filter((row) => (row.querySelector('.code__text')?.textContent ?? '').toLowerCase().includes(needle));
    for (const row of hits) row.classList.add('code__row--hit');
    if (hits.length) {
      hitIndex = 0;
      focusHit();
    }
    paintFindCount();
  }

  function step(delta: number): void {
    if (!hits.length) {
      runFind();
      return;
    }
    hitIndex = (hitIndex + delta + hits.length) % hits.length;
    focusHit();
    paintFindCount();
  }

  function focusHit(): void {
    for (const row of hits) row.classList.remove('code__row--active');
    const row = hits[hitIndex];
    if (!row) return;
    row.classList.add('code__row--active');
    row.scrollIntoView({ block: 'center' });
  }

  function paintFindCount(): void {
    if (!findCount) return;
    if (!findValue || findValue.startsWith(':')) {
      findCount.textContent = '';
      return;
    }
    if (!hits.length) {
      findCount.textContent = t('viewer.findEmpty');
      return;
    }
    findCount.textContent = t('viewer.findCount', { index: hitIndex + 1, total: hits.length });
  }

  function renderViewer(): void {
    viewer.textContent = '';
    tabDots.clear();
    findCount = null;
    editBar = null;
    viewer.hidden = tabs.length === 0;
    split.sync();
    if (!viewed) {
      editorUi = null;
      return;
    }

    viewer.append(tabStrip());

    const kind = previewKind(viewed.path);
    // Nama file ada di tab, path penuh di tooltip tab — tidak ada lagi baris judul.
    viewer.append(toolbar());

    if (kind === 'image' || kind === 'pdf') {
      viewer.append(mediaBody(viewed.path, kind));
      return;
    }
    if (viewed.binary) {
      viewer.append(el('p', 'viewer__note', t('viewer.binaryBody')));
      return;
    }

    if (viewMode === 'preview' && kind === 'markdown') {
      const box = el('div', 'viewer__md');
      box.setAttribute('tabindex', '-1');
      viewer.append(box);
      renderMarkdown(box, viewed.text);
      return;
    }
    if (viewMode === 'preview' && kind === 'html') {
      viewer.append(htmlFrame(viewed.text, viewed.path));
      return;
    }

    // Mode sunting: CodeMirror menempel di host stabil milik draft, bukan dibangun ulang.
    if (editable(viewed)) {
      const draft = draftFor(viewed);
      viewer.append(draft.host);
      if (editBar) viewer.append(editBar);
      draft.setWrap(wrap);
      draft.setFontSize(11.5 * zoom);
      paintEditorUi();
      if (viewLine > 1) {
        void draft.ready().then(() => {
          if (!draft.gotoLine(viewLine)) {
            showError(t('viewer.gotoMissing', { line: viewLine, count: draft.caret().lines }));
          }
        });
      }
      return;
    }

    viewer.append(codeBody(viewed.text, viewed.path));
    if (viewLine > 1) scrollToOneLine(viewLine);
    if (findValue) runFind();
  }

  function mediaBody(path: string, kind: 'image' | 'pdf'): HTMLElement {
    const box = el('div', 'viewer__media');
    if (kind === 'image') {
      const image = el('img', 'viewer__img');
      image.src = rawUrl(path);
      image.alt = t('viewer.imageAlt', { name: path.split('/').pop() ?? path });
      // Tanpa lazy: kotaknya belum punya ukuran intrinsik, jadi pemuatan malas tidak pernah dimulai.
      image.decoding = 'async';
      image.style.transform = `scale(${zoom})`;
      const frame = el('div', 'viewer__media-frame');
      frame.append(image);
      box.append(frame);
      return box;
    }
    box.append(el('p', 'viewer__note', t('viewer.pdfBody')));
    return box;
  }

  function htmlFrame(source: string, path: string): HTMLIFrameElement {
    const frame = el('iframe', 'viewer__frame');
    frame.setAttribute('title', path);
    // Tanpa allow-scripts default: halaman workspace tidak boleh menjalankan kode.
    frame.setAttribute('sandbox', prefs().scriptedPreview ? 'allow-scripts' : '');
    const guard = previewKind(path) === 'html' && !prefs().scriptedPreview ? scriptNotice() : '';
    frame.setAttribute('srcdoc', `<base href="${assetBase(path)}">${guard}${source}`);
    return frame;
  }

  function scriptNotice(): string {
    return `<div style="font:12px system-ui;padding:8px 10px;background:#fff3cd;color:#665">
      ${t('viewer.scriptBlocked')}</div>`;
  }

  function codeBody(text: string, path: string): HTMLElement {
    const lines = text.split('\n');
    const body = el('div', 'code');
    body.dataset.view = 'code';
    body.style.fontSize = `${(11.5 * zoom).toFixed(2)}px`;
    body.classList.toggle('code--wrap', wrap);
    body.classList.toggle('code--plain', !prefs().lineNumbers);

    const shown = Math.min(lines.length, ROW_LIMIT);
    for (let index = 0; index < shown; index += 1) {
      const line = el('div', 'code__row');
      line.append(el('span', 'code__ln', String(index + 1)));
      const content = el('code', 'code__text');
      content.textContent = lines[index];
      line.append(content);
      body.append(line);
    }
    if (lines.length > ROW_LIMIT) {
      body.append(
        el('p', 'viewer__note', `… ${t('viewer.moreLines', { count: lines.length - ROW_LIMIT })}`)
      );
    }

    if (prefs().syntax) {
      const language = languageForPath(path);
      const token = renderToken;
      void highlightLines(lines.slice(0, ROW_LIMIT).join('\n'), language).then((html) => {
        if (token !== renderToken) return;
        const rows = Array.from(body.querySelectorAll<HTMLElement>('.code__row'));
        html.forEach((lineHtml, index) => {
          const cell = rows[index]?.querySelector('.code__text');
          if (cell) cell.innerHTML = lineHtml;
        });
      });
    }
    return body;
  }

  function scrollToOneLine(line: number): void {
    const body = viewer.querySelector<HTMLElement>('[data-view="code"]');
    const rowEl = body?.children[line - 1] as HTMLElement | undefined;
    if (rowEl) {
      rowEl.classList.add('code__row--active');
      body?.scrollTo({ top: Math.max(0, rowEl.offsetTop - 40) });
    }
  }

  /* ---------------------------------------- daftar ---------------------------------------- */

  async function collect(dirPath: string, depth: number): Promise<HTMLElement[]> {
    let entries: TreeEntry[];
    try {
      entries = await loadDir(dirPath);
    } catch (error) {
      return [
        note(
          t('files.readFailed', {
            path: dirPath || t('files.rootLabel'),
            error: describeError(error),
          })
        ),
      ];
    }
    const rows: HTMLElement[] = [];
    for (const entry of entries) {
      rows.push(row(entry, depth));
      if (entry.dir && expanded.has(entry.path)) rows.push(...(await collect(entry.path, depth + 1)));
    }
    if (entries.length === 0 && dirPath) rows.push(el('p', 'files__note', t('files.emptyDir')));
    return rows;
  }

  function renderResults(): void {
    if (!results) return;
    const head = el(
      'p',
      'files__result-head',
      t('files.results', { count: results.matches.length, query: results.query })
    );
    list.append(head);
    if (results.stopped === 'limit') {
      list.append(el('p', 'files__note', t('files.scannedLimit', { count: results.scanned })));
    }
    if (results.matches.length === 0) list.append(note(t('files.noMatch')));
    for (const match of results.matches) {
      const line = el('div', 'files__row files__row--hit');
      line.setAttribute('role', 'treeitem');
      line.dataset.path = match.path;
      const glyph = icon(match.dir ? ICON.folder : ICON.file, 14);
      glyph.classList.add('files__glyph');
      line.append(glyph, el('span', 'files__name', match.path));
      if (match.line) line.append(el('span', 'files__meta', `:${match.line}`));
      if (match.preview) line.append(el('span', 'files__preview', match.preview));
      line.addEventListener('click', () => {
        selected = match.path;
        if (match.dir) {
          results = null;
          reveal(match.path);
          void redraw();
        } else {
          void openFile(match.path, { mode: prefs().defaultView, line: match.line ?? 0 });
        }
      });
      list.append(line);
    }
  }

  function reveal(path: string): void {
    const parts = path.split('/');
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      expanded.add(acc);
    }
  }

  async function runSearch(raw: string): Promise<void> {
    const query = raw.trim();
    const token = (renderToken += 1);
    window.clearTimeout(searchTimer);
    if (!workspace || !query) {
      results = null;
      await redraw();
      return;
    }
    message = '';
    try {
      const found = await chatApi.search(query, mode);
      if (token !== renderToken) return;
      results = found;
      await redraw();
    } catch (error) {
      if (token !== renderToken) return;
      showError(describeError(error));
    }
  }

  async function openFile(
    path: string,
    options: { mode?: 'raw' | 'preview'; line?: number } = {}
  ): Promise<void> {
    const existing = tabs.find((tab) => tab.path === path);
    if (existing) {
      if (options.mode) existing.mode = options.mode;
      existing.line = options.line ?? 0;
      if (existing.path === activePath) {
        viewMode = existing.mode;
        viewLine = existing.line;
        renderViewer();
      } else {
        activate(existing);
      }
      return;
    }

    // Tab yang sedang dibuka tidak boleh tertimpa oleh klik berikutnya tanpa pertanyaan.
    guardAway(activePath, () => void loadTab(path, options));
  }

  /** Tab tertua dibuang saat penuh; yang masih punya draf tidak hilang diam-diam. */
  function trimTabs(): void {
    while (tabs.length > MAX_TABS) {
      const victim = tabs.find((tab) => !(drafts.get(tab.path)?.dirty() ?? false));
      if (!victim) return;
      tabs.splice(tabs.indexOf(victim), 1);
      dropDraft(victim.path);
    }
  }

  async function loadTab(path: string, options: { mode?: 'raw' | 'preview'; line?: number }): Promise<void> {
    const token = (renderToken += 1);
    message = '';
    try {
      const content = await chatApi.file(path);
      if (token !== renderToken) return;
      const tab: ViewTab = {
        path,
        content,
        mode: options.mode ?? 'raw',
        zoom: 1,
        line: options.line ?? 0,
      };
      tabs.push(tab);
      trimTabs();
      applyActivate(tab);
      paintMessage();
    } catch (error) {
      if (token !== renderToken) return;
      showError(describeError(error));
    }
  }

  async function redraw(): Promise<void> {
    const token = (renderToken += 1);
    list.textContent = '';
    message = '';
    paintMessage();
    renderPrompt();
    paintTools();
    paintSearchLabels();

    if (!workspace) {
      list.append(note(t('files.openWorkspaceHint')));
      viewer.hidden = true;
      return;
    }
    if (results) {
      renderResults();
      return;
    }
    const rows = await collect('', 0);
    if (token !== renderToken) return;
    list.append(...rows);
  }

  /** Bar pencarian bisa disembunyikan supaya pohon memakai seluruh tinggi panel. */
  function paintSearch(): void {
    const on = prefs().filesSearch;
    searchForm.hidden = !on;
    searchButton.setAttribute('aria-pressed', String(on));
    const label = t(on ? 'files.hideSearch' : 'files.showSearch');
    searchButton.title = label;
    searchButton.setAttribute('aria-label', label);
  }

  function toggleSearch(): void {
    const on = !prefs().filesSearch;
    // Hasil pencarian tidak boleh tinggal di pohon saat kolom pencariannya disembunyikan.
    if (!on && (searchInput.value || results)) {
      searchInput.value = '';
      void runSearch('');
    }
    setPref('filesSearch', on);
    paintSearch();
    if (on) searchInput.focus();
  }

  function paintTools(): void {
    pasteButton.disabled = !clip;
  }

  function paintSearchLabels(): void {
    setMode(mode);
    searchInput.setAttribute('aria-label', t('files.searchAria'));
    list.setAttribute('aria-label', t('files.treeAria'));
    modeButton.title = t('files.modeSwitch');
    clearButton.title = t('files.clearSearch');
    clearButton.setAttribute('aria-label', t('files.clearSearch'));
    refreshButton.title = t('files.refresh');
    refreshButton.setAttribute('aria-label', t('files.refresh'));
    copyButton.title = t('menu.copy');
    copyButton.setAttribute('aria-label', t('menu.copy'));
    cutButton.title = t('menu.cut');
    cutButton.setAttribute('aria-label', t('menu.cut'));
    pasteButton.title = t('menu.paste');
    pasteButton.setAttribute('aria-label', t('menu.paste'));
    newFileButton.title = t('files.newFile');
    newFileButton.setAttribute('aria-label', t('files.newFile'));
    newFolderButton.title = t('files.newFolder');
    newFolderButton.setAttribute('aria-label', t('files.newFolder'));
    paintSearch();
  }

  function refresh(): void {
    invalidate();
    void redraw();
  }

  searchInput.addEventListener('input', () => {
    // Ketikan ditunda sebentar supaya tidak menembak server tiap huruf.
    window.clearTimeout(searchTimer);
    const value = searchInput.value;
    searchTimer = window.setTimeout(() => void runSearch(value), SEARCH_DEBOUNCE_MS);
  });

  bindContextMenu();
  bindDragAndDrop();
  bindClipKeys();

  window.setInterval(() => {
    // Halaman tersembunyi tidak perlu ikut mengantri proses git.
    if (root.offsetParent !== null && !busy) void syncGit();
  }, GIT_POLL_MS);

  // Geseran pembatas hanya perlu rasio baru; menulis ulang isi viewer dan pohon
  // akan membuang posisi gulir user tepat setelah ia mengatur ukuran.
  let lastPrefs = prefs();
  subscribePrefs(() => {
    const next = prefs();
    // Rasio split dan tampil/sembunyi bar pencarian tidak menyentuh isi pane: menulis ulang
    // pohon justru membuang posisi gulir user tepat setelah ia mengaturnya.
    const changed = changedKeys(lastPrefs, next);
    const light =
      changed.length === 1 && (changed[0] === 'previewRatio' || changed[0] === 'filesSearch');
    lastPrefs = next;
    wrap = next.wrap;
    applySplit();
    paintSearch();
    if (changed.includes('lineNumbers') || changed.includes('syntax')) {
      // Editor tidak dibangun ulang: nomor baris dan warna cukup dikonfigurasi ulang.
      for (const draft of drafts.values()) draft.setLook();
    }
    if (light) return;
    if (viewed) renderViewer();
    void redraw();
  });

  subscribeLocale(() => {
    paintRoot();
    // Label panel Cari & Ganti ikut bahasa tanpa membangun ulang editor.
    for (const draft of drafts.values()) draft.setLook();
    if (viewed) renderViewer();
    void redraw();
  });

  return {
    setWorkspace(next) {
      workspace = next;
      paintRoot();
      // Tanda workspace lama tidak boleh menempel di baris workspace baru.
      gitMarks = new Map();
      invalidate();
      expanded.clear();
      selected = '';
      // Draf workspace lama tidak punya arti di workspace baru, dan jangan pernah ditulis ke sana.
      disposeDrafts();
      tabs.length = 0;
      activePath = '';
      viewed = null;
      findValue = '';
      hits = [];
      results = null;
      prompt = null;
      clip = null;
      dragging = null;
      paintDrop(null);
      searchInput.value = '';
      renderViewer();
      void redraw();
    },
    refresh,
    openPath(path, line) {
      void openFile(path, { mode: prefs().defaultView, line: line ?? 0 });
    },
  };
}
