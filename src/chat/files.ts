import { subscribeLocale, t } from '../i18n';
import { chatApi } from './client';
import { ICON, el, icon, iconButton } from './dom';
import { openContextMenu } from './context-menu';
import type { MenuEntry } from './context-menu';
import { highlightLines, languageForPath } from './highlight';
import { renderMarkdown } from './markdown';
import { prefs, subscribePrefs } from './prefs';
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

type PreviewKind = 'markdown' | 'html' | null;

function previewKind(path: string): PreviewKind {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'md' || ext === 'markdown' || ext === 'mdx') return 'markdown';
  if (ext === 'html' || ext === 'htm' || ext === 'xhtml') return 'html';
  return null;
}

/** URL asset workspace supaya gambar/CSS relatif di pratinjau HTML bisa dimuat. */
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
  let viewed: FileContent | null = null;
  let viewLine = 0;
  let viewMode: 'raw' | 'preview' = 'raw';
  let wrap = prefs().wrap;
  let zoom = 1;
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
  const newFileButton = iconButton(t('files.newFile'), ICON.filePlus, () => askCreate('file'));
  const newFolderButton = iconButton(t('files.newFolder'), ICON.folderPlus, () => askCreate('folder'));
  toolRow.append(refreshButton, newFileButton, newFolderButton);

  const bar = el('div', 'files__bar');
  bar.append(searchForm, toolRow);

  const messageEl = el('p', 'files__message');
  messageEl.setAttribute('role', 'status');

  const promptEl = el('div', 'files__prompt');
  promptEl.hidden = true;

  const list = el('div', 'files__list');
  list.setAttribute('role', 'tree');
  list.setAttribute('aria-label', t('files.treeAria'));

  const viewer = el('section', 'files__viewer');
  viewer.hidden = true;

  root.append(bar, messageEl, promptEl, list, viewer);
  container.append(root);
  setMode('name');

  function note(text: string): HTMLElement {
    return el('p', 'files__note', text);
  }

  function paintMessage(): void {
    messageEl.textContent = message;
    messageEl.hidden = !message;
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

  function askCreate(kind: FileKind, dir = targetDir()): void {
    if (!workspace) {
      message = t('files.needWorkspace');
      paintMessage();
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

  /* ------------------------------------ pohon file ------------------------------------ */

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
    line.dataset.path = entry.path;
    line.dataset.dir = String(entry.dir);
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
      iconButton(t('files.rename'), ICON.pencil, () => askRename(entry)),
      iconButton(t('files.remove'), ICON.trash, () => askDelete(entry))
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
        void openFile(entry.path, { mode: prefs().defaultView });
      }
    });
    return line;
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
      items.push({ separator: true });
    }
    if (entry) {
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
    } catch {
      message = t('viewer.copyFailed');
    }
    paintMessage();
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

  function closeViewer(): void {
    viewed = null;
    viewLine = 0;
    renderViewer();
  }

  function setViewMode(next: 'raw' | 'preview'): void {
    viewMode = next;
    renderViewer();
  }

  function toolbar(): HTMLElement {
    const barEl = el('div', 'viewer__bar');
    const kind = viewed ? previewKind(viewed.path) : null;

    if (kind && viewed && !viewed.binary) {
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
    if (viewed && !viewed.binary) {
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

      const zoomOut = el('button', 'viewer__icon');
      zoomOut.type = 'button';
      zoomOut.title = t('viewer.zoomOut');
      zoomOut.setAttribute('aria-label', zoomOut.title);
      zoomOut.append(icon(ICON.minus, 15));
      zoomOut.addEventListener('click', () => {
        zoom = Math.max(0.7, Number((zoom - 0.1).toFixed(2)));
        renderViewer();
      });

      const zoomIn = el('button', 'viewer__icon');
      zoomIn.type = 'button';
      zoomIn.title = t('viewer.zoomIn');
      zoomIn.setAttribute('aria-label', zoomIn.title);
      zoomIn.append(icon(ICON.plus, 15));
      zoomIn.addEventListener('click', () => {
        zoom = Math.min(1.8, Number((zoom + 0.1).toFixed(2)));
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
            message = t('viewer.copyFailed');
            paintMessage();
          });
      });

      if (hooks.onReference) {
        actions.append(
          iconButton(t('menu.reference'), ICON.plus, () => hooks.onReference?.(viewed?.path ?? ''))
        );
      }
      actions.append(wrapButton, zoomOut, zoomIn, copy);
    }
    actions.append(iconButton(t('viewer.close'), ICON.close, closeViewer));
    barEl.append(el('span', 'viewer__spacer'), actions);
    return barEl;
  }

  function renderViewer(): void {
    viewer.textContent = '';
    viewer.hidden = !viewed;
    if (!viewed) return;

    const head = el('header', 'files__viewer-head');
    head.append(el('span', 'files__viewer-path', viewed.path));
    const info = [humanSize(viewed.size)];
    if (viewed.truncated) info.push(t('viewer.truncated'));
    if (viewed.binary) info.push(t('viewer.binary'));
    const lines = viewed.binary ? 0 : viewed.text.split('\n').length;
    if (lines) info.push(t('viewer.lines', { count: lines }));
    head.append(el('span', 'files__viewer-info', info.join(' · ')));
    viewer.append(head, toolbar());

    if (viewed.binary) {
      viewer.append(el('p', 'viewer__note', t('viewer.binaryBody')));
      return;
    }

    const kind = previewKind(viewed.path);
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

    viewer.append(codeBody(viewed.text, viewed.path));
    if (viewLine > 1) scrollToOneLine(viewLine);
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
      message = describeError(error);
      paintMessage();
    }
  }

  async function openFile(
    path: string,
    options: { mode?: 'raw' | 'preview'; line?: number } = {}
  ): Promise<void> {
    const token = (renderToken += 1);
    message = '';
    try {
      const content = await chatApi.file(path);
      if (token !== renderToken) return;
      viewed = content;
      viewLine = options.line ?? 0;
      viewMode = options.mode ?? 'raw';
      wrap = prefs().wrap;
      zoom = 1;
      selected = path;
      renderViewer();
      paintMessage();
    } catch (error) {
      if (token !== renderToken) return;
      message = describeError(error);
      paintMessage();
    }
  }

  async function redraw(): Promise<void> {
    const token = (renderToken += 1);
    list.textContent = '';
    message = '';
    paintMessage();
    renderPrompt();
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

  function paintSearchLabels(): void {
    setMode(mode);
    searchInput.setAttribute('aria-label', t('files.searchAria'));
    list.setAttribute('aria-label', t('files.treeAria'));
    modeButton.title = t('files.modeSwitch');
    clearButton.title = t('files.clearSearch');
    clearButton.setAttribute('aria-label', t('files.clearSearch'));
    refreshButton.title = t('files.refresh');
    refreshButton.setAttribute('aria-label', t('files.refresh'));
    newFileButton.title = t('files.newFile');
    newFileButton.setAttribute('aria-label', t('files.newFile'));
    newFolderButton.title = t('files.newFolder');
    newFolderButton.setAttribute('aria-label', t('files.newFolder'));
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

  subscribePrefs(() => {
    wrap = prefs().wrap;
    if (viewed) renderViewer();
    void redraw();
  });

  subscribeLocale(() => {
    if (viewed) renderViewer();
    void redraw();
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
