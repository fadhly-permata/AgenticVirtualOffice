import { chatApi, ChatApiError } from './client';
import { el, ICON, icon } from './dom';
import type { BrowseEntry, RecentWorkspace, WorkspaceInfo } from './types';

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Elemen #${id} tidak ditemukan.`);
  return node as T;
}

function baseName(target: string): string {
  return target.split(/[\\/]/).filter(Boolean).pop() ?? target;
}

export class FolderPicker {
  #modal = byId<HTMLElement>('folder-modal');
  #pathForm = byId<HTMLFormElement>('folder-path-form');
  #pathInput = byId<HTMLInputElement>('folder-path');
  #up = byId<HTMLButtonElement>('folder-up');
  #crumb = byId<HTMLElement>('folder-crumb');
  #list = byId<HTMLUListElement>('folder-list');
  #recents = byId<HTMLElement>('folder-recents');
  #recentList = byId<HTMLElement>('folder-recent-list');
  #error = byId<HTMLElement>('folder-error');
  #selection = byId<HTMLElement>('folder-selection');
  #open = byId<HTMLButtonElement>('folder-open');
  #cancel = byId<HTMLButtonElement>('folder-cancel');
  #close = byId<HTMLButtonElement>('folder-close');

  #onSelect: (workspace: WorkspaceInfo) => void;
  #currentPath: string | null = null;
  #parentPath: string | null = null;
  #recentItems: RecentWorkspace[] = [];
  #busy = false;

  constructor(onSelect: (workspace: WorkspaceInfo) => void) {
    this.#onSelect = onSelect;

    this.#open.addEventListener('click', () => {
      if (this.#currentPath) void this.#openWorkspace(this.#currentPath);
    });
    this.#cancel.addEventListener('click', () => this.hide());
    this.#close.addEventListener('click', () => this.hide());
    this.#modal.querySelector('[data-folder-close]')?.addEventListener('click', () => this.hide());
    this.#up.addEventListener('click', () => {
      if (this.#parentPath) void this.#browse(this.#parentPath);
    });
    this.#pathForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const target = this.#pathInput.value.trim();
      if (!target) {
        this.#showError('Isi path folder terlebih dahulu.');
        return;
      }
      void this.#openWorkspace(target);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.isOpen) this.hide();
    });
  }

  get isOpen(): boolean {
    return !this.#modal.hidden;
  }

  show(startPath: string | null): void {
    this.#showError('');
    this.#modal.hidden = false;
    document.body.classList.add('modal-open');
    void this.#refreshRecents();
    void this.#browse(startPath);
    window.setTimeout(() => this.#pathInput.focus(), 60);
  }

  hide(): void {
    if (this.#busy) return;
    this.#modal.hidden = true;
    document.body.classList.remove('modal-open');
    document.getElementById('chat-launcher')?.focus();
  }

  async #refreshRecents(): Promise<void> {
    try {
      const state = await chatApi.workspace();
      this.#recentItems = state.recents;
      this.#renderRecents();
    } catch {
      this.#recentItems = [];
      this.#renderRecents();
    }
  }

  #renderRecents(): void {
    this.#recentList.replaceChildren();
    this.#recents.hidden = this.#recentItems.length === 0;
    for (const recent of this.#recentItems) {
      const button = el('button', 'folder__recent');
      button.type = 'button';
      button.title = recent.path;
      button.append(icon(ICON.folder, 14), el('span', undefined, recent.name));
      button.addEventListener('click', () => void this.#openWorkspace(recent.path));
      this.#recentList.append(button);
    }
  }

  async #browse(target: string | null): Promise<void> {
    this.#showError('');
    this.#setLoading(true);

    try {
      const result = await chatApi.browse(target);
      this.#currentPath = result.path;
      this.#parentPath = result.parent;
      this.#pathInput.value = result.path ?? '';
      this.#up.disabled = !result.parent;
      this.#crumb.textContent = result.path ?? 'Pilih drive atau folder';
      this.#open.disabled = !result.path;
      this.#selection.textContent = result.path ? `Buka: ${result.path}` : 'Belum ada folder dipilih';
      this.#renderEntries(result.entries);
    } catch (error) {
      this.#showError(error instanceof Error ? error.message : String(error));
      this.#renderEntries([]);
      this.#open.disabled = !this.#currentPath;
    } finally {
      this.#setLoading(false);
    }
  }

  #renderEntries(entries: BrowseEntry[]): void {
    this.#list.replaceChildren();
    if (!entries.length) {
      this.#list.append(el('li', 'folder__empty', this.#currentPath ? 'Tidak ada subfolder.' : 'Tidak ada drive.'));
      return;
    }

    for (const entry of entries) {
      const item = el('li');
      const row = el('button', 'folder__row');
      row.type = 'button';
      row.title = entry.path;

      const mark = el('span', 'folder__row-icon');
      mark.append(icon(entry.kind === 'drive' ? ICON.drive : ICON.folder, 16));

      const label = el('span', 'folder__row-label', entry.name);
      const chevron = el('span', 'folder__row-chevron');
      chevron.append(icon(ICON.chevron, 14));

      row.append(mark, label, chevron);
      row.addEventListener('click', () => void this.#browse(entry.path));
      item.append(row);
      this.#list.append(item);
    }
  }

  async #openWorkspace(target: string): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    this.#showError('');
    this.#open.textContent = 'Membuka…';
    this.#open.disabled = true;

    try {
      const state = await chatApi.openWorkspace(target);
      if (!state.workspace) throw new ChatApiError(400, 'Workspace tidak valid.');
      this.#busy = false;
      this.#modal.hidden = true;
      document.body.classList.remove('modal-open');
      this.#onSelect(state.workspace);
    } catch (error) {
      this.#showError(
        error instanceof ChatApiError ? error.message : error instanceof Error ? error.message : String(error)
      );
    } finally {
      this.#busy = false;
      this.#open.textContent = 'Buka folder ini';
      this.#open.disabled = !this.#currentPath;
    }
  }

  #showError(message: string): void {
    this.#error.textContent = message;
    this.#error.hidden = !message;
  }

  #setLoading(loading: boolean): void {
    this.#list.classList.toggle('is-loading', loading);
    if (loading) {
      this.#list.replaceChildren(el('li', 'folder__empty', 'Memuat folder…'));
      this.#list.append(el('li', 'folder__empty', `Membuka ${baseName(this.#pathInput.value || 'drive')}…`));
    }
  }
}
