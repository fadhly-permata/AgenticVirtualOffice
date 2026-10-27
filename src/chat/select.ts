import { subscribeLocale, t } from '../i18n';
import { el, icon, ICON } from './dom';

type OptionEntry = { value: string; row: HTMLButtonElement };

type SearchSelectOptions = {
  searchable?: boolean;
  searchPlaceholder?: string;
};

let listCounter = 0;

export class SearchSelect {
  readonly #select: HTMLSelectElement;
  readonly #root: HTMLDivElement;
  readonly #trigger: HTMLButtonElement;
  readonly #label: HTMLSpanElement;
  readonly #popup: HTMLDivElement;
  readonly #list: HTMLDivElement;
  readonly #search: HTMLInputElement | null;
  readonly #placeholderGiven: string | null;
  #fieldLabel: string;
  #entries: OptionEntry[] = [];
  #active = -1;
  #open = false;

  constructor(select: HTMLSelectElement, options: SearchSelectOptions = {}) {
    this.#select = select;
    select.hidden = true;

    this.#fieldLabel = select.closest('.field')?.querySelector(':scope > span')?.textContent?.trim() || t('select.chooseOption');
    this.#placeholderGiven = options.searchPlaceholder ?? null;
    const searchable = options.searchable ?? false;

    this.#root = el('div', 'search-select');
    this.#trigger = el('button', 'search-select__trigger');
    this.#trigger.type = 'button';
    this.#trigger.setAttribute('aria-haspopup', 'listbox');
    this.#trigger.setAttribute('aria-expanded', 'false');
    this.#trigger.setAttribute('aria-label', this.#fieldLabel);

    this.#label = el('span', 'search-select__label', '—');
    const chevron = icon(ICON.chevron, 13);
    chevron.classList.add('search-select__chevron');
    this.#trigger.append(this.#label, chevron);

    const listId = `search-select-list-${++listCounter}`;
    this.#trigger.setAttribute('aria-controls', listId);

    this.#popup = el('div', 'search-select__popup');
    this.#popup.hidden = true;

    let search: HTMLInputElement | null = null;
    if (searchable) {
      const wrap = el('div', 'search-select__search');
      wrap.append(icon(ICON.search, 13));
      search = el('input');
      search.type = 'search';
      search.autocomplete = 'off';
      search.spellcheck = false;
      search.placeholder = this.#placeholderGiven ?? t('select.search');
      search.setAttribute('aria-label', search.placeholder);
      wrap.append(search);
      this.#popup.append(wrap);
    }
    this.#search = search;

    this.#list = el('div', 'search-select__list');
    this.#list.id = listId;
    this.#list.setAttribute('role', 'listbox');
    this.#list.setAttribute('aria-label', this.#fieldLabel);
    this.#popup.append(this.#list);

    this.#root.append(this.#trigger, this.#popup);
    select.insertAdjacentElement('afterend', this.#root);

    this.#bind();
    this.#sync();
    subscribeLocale(() => this.#applyLocale());
  }

  /** Label statis dipasang ulang saat bahasa diganti; teks opsi diurus pemilik select. */
  #applyLocale(): void {
    this.#fieldLabel =
      this.#select.closest('.field')?.querySelector(':scope > span')?.textContent?.trim() || t('select.chooseOption');
    this.#trigger.setAttribute('aria-label', this.#fieldLabel);
    this.#list.setAttribute('aria-label', this.#fieldLabel);
    if (this.#search) {
      const placeholder = this.#placeholderGiven ?? t('select.search');
      this.#search.placeholder = placeholder;
      this.#search.setAttribute('aria-label', placeholder);
    }
    if (this.#open) this.#renderList();
  }

  #bind(): void {
    this.#trigger.addEventListener('click', () => {
      if (this.#open) this.#close();
      else this.#openPopup();
    });

    this.#trigger.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      event.stopPropagation();
      if (!this.#open) this.#openPopup();
      this.#move(event.key === 'ArrowDown' ? 1 : -1);
    });

    this.#root.addEventListener('keydown', (event) => {
      if (!this.#open) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.#close(true);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.#move(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.#move(-1);
      } else if (event.key === 'Enter') {
        const entry = this.#entries[this.#active];
        if (!entry) return;
        event.preventDefault();
        this.#choose(entry.value);
      } else if (event.key === 'Tab') {
        this.#close();
      }
    });

    this.#search?.addEventListener('input', () => this.#renderList(true));

    document.addEventListener('pointerdown', (event) => {
      if (!this.#open) return;
      if (event.target instanceof Node && !this.#root.contains(event.target)) this.#close();
    });

    new MutationObserver(() => this.#sync()).observe(this.#select, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['disabled'],
    });

    this.#select.addEventListener('change', () => this.#sync());
  }

  #sync(): void {
    const option = this.#select.selectedIndex >= 0 ? this.#select.options[this.#select.selectedIndex] : null;
    const text = option?.textContent?.trim() ?? '';
    this.#label.textContent = text || '—';
    this.#trigger.title = text;
    this.#trigger.disabled = this.#select.disabled;

    if (!this.#open) return;
    if (this.#select.disabled) {
      this.#close();
      return;
    }
    this.#renderList();
  }

  #openPopup(): void {
    if (this.#open || this.#select.disabled) return;
    this.#open = true;
    this.#popup.hidden = false;
    this.#root.classList.add('is-open');
    this.#trigger.setAttribute('aria-expanded', 'true');
    if (this.#search) this.#search.value = '';
    this.#renderList(true);
    this.#search?.focus();
  }

  #close(focusTrigger = false): void {
    if (!this.#open) return;
    this.#open = false;
    this.#popup.hidden = true;
    this.#root.classList.remove('is-open');
    this.#trigger.setAttribute('aria-expanded', 'false');
    if (this.#search) this.#search.value = '';
    if (focusTrigger) this.#trigger.focus();
  }

  #choose(value: string): void {
    this.#close();
    if (this.#select.value !== value) {
      this.#select.value = value;
      this.#select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    this.#sync();
    this.#trigger.focus();
  }

  #move(delta: number): void {
    if (!this.#entries.length) return;
    let index = this.#active;
    for (let step = 0; step < this.#entries.length; step += 1) {
      index = (index + delta + this.#entries.length) % this.#entries.length;
      const entry = this.#entries[index];
      if (entry.row.disabled) continue;
      this.#active = index;
      this.#applyActive();
      entry.row.scrollIntoView({ block: 'nearest' });
      return;
    }
  }

  #applyActive(): void {
    this.#entries.forEach((entry, index) => {
      entry.row.classList.toggle('is-active', index === this.#active);
    });
  }

  #renderList(reset = false): void {
    const query = this.#search?.value.trim() ?? '';
    const normalized = query.toLocaleLowerCase();
    const previous = reset ? this.#select.value : (this.#entries[this.#active]?.value ?? this.#select.value);

    this.#entries = [];
    this.#list.replaceChildren();

    const candidates: Array<{ group: string; option: HTMLOptionElement }> = [];
    for (const node of Array.from(this.#select.children)) {
      if (node instanceof HTMLOptGroupElement) {
        for (const child of Array.from(node.children)) {
          if (child instanceof HTMLOptionElement) candidates.push({ group: node.label, option: child });
        }
      } else if (node instanceof HTMLOptionElement) {
        candidates.push({ group: '', option: node });
      }
    }

    let lastGroup: string | null = null;
    for (const { group, option } of candidates) {
      const text = option.textContent?.trim() || option.value;
      if (normalized && !text.toLocaleLowerCase().includes(normalized) && !group.toLocaleLowerCase().includes(normalized)) {
        continue;
      }
      if (group !== lastGroup) {
        if (group) this.#list.append(el('p', 'search-select__group', group));
        lastGroup = group;
      }
      this.#list.append(this.#optionRow(option));
    }

    if (!this.#entries.length) {
      const message = query ? t('select.noResults', { query }) : t('select.noOptions');
      this.#list.append(el('p', 'search-select__empty', message));
      this.#active = -1;
      return;
    }

    let active = this.#entries.findIndex((entry) => entry.value === previous && !entry.row.disabled);
    if (active < 0) active = this.#entries.findIndex((entry) => !entry.row.disabled);
    this.#active = active;
    this.#applyActive();
  }

  #optionRow(option: HTMLOptionElement): HTMLButtonElement {
    const row = el('button', 'search-select__option');
    row.type = 'button';
    row.tabIndex = -1;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(option.selected));
    row.dataset.value = option.value;

    const text = option.textContent?.trim() || option.value;
    row.append(el('span', 'search-select__option-label', text));
    if (option.selected) {
      const check = icon(ICON.check, 13);
      check.classList.add('search-select__check');
      row.append(check);
    }
    row.title = option.title || text;
    row.disabled = option.disabled;

    row.addEventListener('click', () => this.#choose(option.value));
    row.addEventListener('pointermove', () => {
      const index = this.#entries.findIndex((entry) => entry.row === row);
      if (index >= 0 && index !== this.#active) {
        this.#active = index;
        this.#applyActive();
      }
    });

    this.#entries.push({ value: option.value, row });
    return row;
  }
}
