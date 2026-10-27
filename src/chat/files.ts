import { chatApi } from './client';
import { ICON, el, icon, iconButton } from './dom';
import type { FileContent, FileKind, SearchResult, SearchMode, TreeEntry, WorkspaceInfo } from './types';

const KB = 1024;
const SEARCH_DEBOUNCE_MS = 320;

export interface FilesHooks {
  /** Dipakai untuk menyisipkan path ke composer chat. */
  onReference?: (path: string) => void;
}

export interface FilesPanel {
  setWorkspace(next: WorkspaceInfo | null): void;
  refresh(): void;
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
  let viewed: FileContent | null = null;
  let viewLine = 0;
  let results: SearchResult | null = null;
  let prompt: Prompt | null = null;
  let busy = false;
  let message = '';
  let renderToken = 0;
  let searchTimer = 0;

  const root = el('div', 'files');

  const searchForm = el('form', 'files__searchbar');
  searchForm.setAttribute('role', 'search');
  const searchInput = el('input', 'files__search');
  searchInput.type = 'search';
  searchInput.placeholder = 'Cari di workspace…';
  searchInput.setAttribute('aria-label', 'Cari file atau isi file');
  const modeButton = el('button', 'files__mode');
  modeButton.type = 'button';
  modeButton.title = 'Ganti mode pencarian';
  let mode: SearchMode = 'name';
  const clearButton = iconButton('Bersihkan pencarian', ICON.close, () => {
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
  let modeLabel = '';
  const setMode = (next: SearchMode): void => {
    mode = next;
    if (modeLabel !== next) {
      modeLabel = next;
      modeButton.textContent = next === 'name' ? 'Nama' : 'Isi';
      modeButton.setAttribute('aria-pressed', String(next === 'content'));
      searchInput.placeholder = next === 'name' ? 'Cari nama file…' : 'Cari di dalam file…';
    }
  };
  modeButton.addEventListener('click', () => {
    setMode(mode === 'name' ? 'content' : 'name');
    if (searchInput.value.trim()) void runSearch(searchInput.value);
  });
  const refreshButton = iconButton('Muat ulang', ICON.refresh, () => refresh());
  const newFileButton = iconButton('File baru', ICON.filePlus, () => askCreate('file'));
  const newFolderButton = iconButton('Folder baru', ICON.folderPlus, () => askCreate('folder'));
  toolRow.append(refreshButton, newFileButton, newFolderButton);

  const bar = el('div', 'files__bar');
  bar.append(searchForm, toolRow);

  const messageEl = el('p', 'files__message');
  messageEl.setAttribute('role', 'status');

  const promptEl = el('div', 'files__prompt');
  promptEl.hidden = true;

  const list = el('div', 'files__list');
  list.setAttribute('role', 'tree');
  list.setAttribute('aria-label', 'Isi workspace');

  const viewer = el('section', 'files__viewer');
  viewer.hidden = true;

  root.append(bar, messageEl, promptEl, list, viewer);
  container.append(root);
  setMode('name');

  function note(text: string): HTMLElement {
    const line = el('p', 'files__note', text);
    return line;
  }

  function paintMessage(): void {
    messageEl.textContent = message;
    messageEl.hidden = !message;
  }

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
    const cancel = el('button', 'files__prompt-cancel', 'Batal');
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
      message = describeError(error);
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

  function askCreate(kind: FileKind): void {
    if (!workspace) {
      message = 'Buka workspace dulu.';
      paintMessage();
      return;
    }
    const dir = targetDir();
    prompt = {
      label: kind === 'file' ? 'Nama file baru' : 'Nama folder baru',
      hint: dir ? `di ${dir}/` : 'di akar workspace',
      value: '',
      ok: 'Buat',
      danger: false,
      editable: true,
      submit: async (value) => {
        const name = value.trim().replace(/^\/+/, '');
        if (!name) throw new Error('Nama tidak boleh kosong.');
        const path = dir ? `${dir}/${name}` : name;
        await chatApi.createFile(path, kind);
        closePrompt();
        if (dir) expanded.add(dir);
        selected = path;
        invalidate();
        await redraw();
        // Ditulis setelah redraw karena redraw sendiri membersihkan pesan lama.
        message = `Dibuat: ${path}`;
      },
    };
    renderPrompt();
  }

  function askRename(entry: TreeEntry): void {
    prompt = {
      label: 'Nama ulang',
      hint: 'Path relatif terhadap akar workspace.',
      value: entry.path,
      ok: 'Simpan',
      danger: false,
      editable: true,
      submit: async (value) => {
        const to = value.trim().replace(/^\/+/, '');
        if (!to) throw new Error('Nama tidak boleh kosong.');
        if (to === entry.path) {
          closePrompt();
          return;
        }
        await chatApi.renameFile(entry.path, to);
        closePrompt();
        if (viewed?.path === entry.path) closeViewer();
        invalidate();
        await redraw();
        message = `Diganti: ${entry.path} → ${to}`;
      },
    };
    renderPrompt();
  }

  function askDelete(entry: TreeEntry): void {
    prompt = {
      label: `Hapus ${entry.name}?`,
      hint: entry.dir ? `Folder ${entry.path} dan isinya ikut terhapus.` : entry.path,
      value: entry.path,
      ok: 'Hapus',
      danger: true,
      editable: false,
      submit: async () => {
        await chatApi.deleteFile(entry.path);
        closePrompt();
        expanded.delete(entry.path);
        if (viewed?.path === entry.path || viewed?.path.startsWith(`${entry.path}/`)) closeViewer();
        invalidate();
        await redraw();
        message = `Dihapus: ${entry.path}`;
      },
    };
    renderPrompt();
  }

  function invalidate(): void {
    children.clear();
  }

  async function loadDir(dirPath: string): Promise<TreeEntry[]> {
    const cached = children.get(dirPath);
    if (cached) return cached;
    const tree = await chatApi.tree(dirPath);
    children.set(dirPath, tree.entries);
    return tree.entries;
  }

  function row(entry: TreeEntry, depth: number): HTMLElement {
    const line = el('div', entry.path === selected ? 'files__row files__row--active' : 'files__row');
    line.setAttribute('role', 'treeitem');
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

    line.append(glyph, name, meta);

    const actions = el('span', 'files__actions');
    actions.append(
      iconButton('Ganti nama', ICON.pencil, () => askRename(entry)),
      iconButton('Hapus', ICON.trash, () => askDelete(entry))
    );
    line.append(actions);

    line.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('.files__actions')) return;
      selected = entry.path;
      if (entry.dir) {
        if (expanded.has(entry.path)) expanded.delete(entry.path);
        else expanded.add(entry.path);
        void redraw();
      } else {
        void openFile(entry.path);
      }
    });
    return line;
  }

  async function collect(dirPath: string, depth: number): Promise<HTMLElement[]> {
    let entries: TreeEntry[];
    try {
      entries = await loadDir(dirPath);
    } catch (error) {
      return [note(`Gagal membaca ${dirPath || 'akar workspace'}: ${describeError(error)}`)];
    }
    const rows: HTMLElement[] = [];
    for (const entry of entries) {
      rows.push(row(entry, depth));
      if (entry.dir && expanded.has(entry.path)) rows.push(...(await collect(entry.path, depth + 1)));
    }
    if (entries.length === 0 && dirPath) rows.push(el('p', 'files__note', 'Kosong'));
    return rows;
  }

  function renderResults(): void {
    if (!results) return;
    const head = el('p', 'files__result-head', `${results.matches.length} hasil untuk “${results.query}”`);
    list.append(head);
    if (results.stopped === 'limit') {
      list.append(el('p', 'files__note', `Baru ${results.scanned} entri diperiksa — persempit kata kuncinya.`));
    }
    if (results.matches.length === 0) list.append(note('Tidak ada yang cocok.'));
    for (const match of results.matches) {
      const line = el('div', 'files__row files__row--hit');
      line.setAttribute('role', 'treeitem');
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
          void openFile(match.path, match.line ?? 0);
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
      message = describeError(error);
      paintMessage();
    }
  }

  async function openFile(path: string, line = 0): Promise<void> {
    const token = (renderToken += 1);
    message = '';
    try {
      const content = await chatApi.file(path);
      if (token !== renderToken) return;
      viewed = content;
      viewLine = line;
      selected = path;
      renderViewer();
      paintMessage();
    } catch (error) {
      if (token !== renderToken) return;
      message = describeError(error);
      paintMessage();
    }
  }

  function closeViewer(): void {
    viewed = null;
    viewLine = 0;
    renderViewer();
  }

  function renderViewer(): void {
    viewer.textContent = '';
    viewer.hidden = !viewed;
    if (!viewed) return;

    const head = el('header', 'files__viewer-head');
    head.append(el('span', 'files__viewer-path', viewed.path));
    const info = [humanSize(viewed.size)];
    if (viewed.truncated) info.push('dipotong');
    if (viewed.binary) info.push('file biner');
    head.append(el('span', 'files__viewer-info', info.join(' · ')));

    const buttons = el('span', 'files__viewer-actions');
    if (hooks.onReference && !viewed.binary) {
      buttons.append(
        iconButton('Sisipkan ke pesan', ICON.plus, () => hooks.onReference?.(viewed?.path ?? ''))
      );
    }
    buttons.append(iconButton('Tutup pratinjau', ICON.close, closeViewer));
    head.append(buttons);

    viewer.append(head);
    if (viewed.binary) {
      viewer.append(el('p', 'files__note', 'Isinya bukan teks, jadi tidak ditampilkan.'));
      return;
    }
    const body = el('pre', 'files__code');
    body.textContent = viewed.text;
    viewer.append(body);
    if (viewLine > 1) {
      const lineHeight = Number.parseFloat(window.getComputedStyle(body).lineHeight) || 19;
      body.scrollTop = Math.max(0, (viewLine - 4) * lineHeight);
    }
  }

  async function redraw(): Promise<void> {
    const token = (renderToken += 1);
    list.textContent = '';
    message = '';
    paintMessage();
    renderPrompt();

    if (!workspace) {
      list.append(note('Buka workspace untuk melihat daftarnya.'));
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

  return {
    setWorkspace(next) {
      workspace = next;
      children.clear();
      expanded.clear();
      selected = '';
      viewed = null;
      results = null;
      prompt = null;
      searchInput.value = '';
      renderViewer();
      void redraw();
    },
    refresh,
  };
}
