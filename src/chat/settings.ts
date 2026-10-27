import { locale, LOCALES, setLocale, subscribeLocale, t } from '../i18n';
import type { Locale } from '../i18n/types';
import { setTheme, subscribeTheme, swatch, theme, themeById, THEMES } from '../theme';
import type { ThemeDef } from '../theme';
import { prefs, resetPrefs, setPref, subscribePrefs } from './prefs';
import type { FileView, Prefs, SplitMode } from './prefs';
import { el, icon, ICON } from './dom';

export interface SettingsPanel {
  refresh(): void;
}

/** Jeda delegasi dimiliki chat.ts; halaman ini hanya membacanya dan melapor perubahan. */
export interface SettingsHooks {
  delayMs(): number;
  setDelayMs(ms: number): void;
}

function toggle(key: keyof Prefs, value: boolean): HTMLButtonElement {
  const button = el('button', 'settings__switch');
  button.type = 'button';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-checked', String(value));
  button.append(el('span', 'settings__switch-knob'));
  button.addEventListener('click', () => setPref(key, !prefs()[key]));
  return button;
}

function segmented<T extends string>(
  options: { value: T; label: string }[],
  active: T,
  onPick: (value: T) => void
): HTMLElement {
  const wrap = el('div', 'settings__segmented');
  for (const option of options) {
    const button = el('button', 'settings__segment', option.label);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(option.value === active));
    button.addEventListener('click', () => onPick(option.value));
    wrap.append(button);
  }
  return wrap;
}

function row(label: string, hint: string, control: HTMLElement): HTMLElement {
  const line = el('div', 'settings__row');
  const text = el('div', 'settings__row-text');
  text.append(el('p', 'settings__row-label', label), el('p', 'settings__row-hint', hint));
  line.append(text, control);
  return line;
}

function group(title: string, rows: HTMLElement[]): HTMLElement {
  const section = el('section', 'settings__group');
  section.append(el('p', 'settings__group-title', title));
  section.append(...rows);
  return section;
}

let closeOpenPicker: (() => void) | null = null;

function paletteStrip(def: ThemeDef, className = 'settings__theme-palette'): HTMLElement {
  const strip = el('span', className);
  for (const color of swatch(def)) {
    const chip = el('span', 'settings__theme-color');
    chip.style.background = color;
    strip.append(chip);
  }
  return strip;
}

function themePicker(): HTMLElement {
  const wrap = el('div', 'settings__theme-picker');
  const trigger = el('button', 'settings__theme-trigger');
  trigger.type = 'button';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');

  const current = themeById(theme()) ?? THEMES[0];
  trigger.append(el('span', 'settings__theme-trigger-name', current.name));
  trigger.append(paletteStrip(current, 'settings__theme-palette settings__theme-palette--trigger'));
  const chevron = icon(ICON.chevron, 13);
  chevron.classList.add('settings__theme-chevron');
  trigger.append(chevron);

  const popup = el('div', 'settings__theme-popup');
  popup.hidden = true;
  const searchBox = el('div', 'settings__theme-search');
  const search = el('input');
  search.type = 'search';
  search.autocomplete = 'off';
  search.spellcheck = false;
  search.placeholder = t('settings.themeSearch');
  search.setAttribute('aria-label', t('settings.themeSearch'));
  searchBox.append(icon(ICON.search, 13), search);
  const list = el('div', 'settings__theme-list');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', t('settings.theme'));
  popup.append(searchBox, list);

  let open = false;
  let active = -1;
  let rows: HTMLButtonElement[] = [];

  function setActive(index: number): void {
    active = index;
    for (const [position, row] of rows.entries()) {
      row.classList.toggle('is-active', position === index);
    }
  }

  function close(focusTrigger = false): void {
    if (!open) return;
    open = false;
    popup.hidden = true;
    popup.remove();
    wrap.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    search.value = '';
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', closeNow);
    window.removeEventListener('scroll', onScroll, true);
    if (closeOpenPicker === closeNow) closeOpenPicker = null;
    if (focusTrigger) trigger.focus();
  }

  const closeNow = (): void => close();

  function onScroll(event: Event): void {
    if (event.target instanceof Node && popup.contains(event.target)) return;
    close();
  }

  function pick(id: string): void {
    if (!id) return;
    close();
    setTheme(id);
  }

  function renderList(): void {
    const query = search.value.trim().toLocaleLowerCase();
    rows = [];
    list.replaceChildren();
    for (const def of THEMES) {
      if (
        query &&
        !def.name.toLocaleLowerCase().includes(query) &&
        !def.id.toLocaleLowerCase().includes(query)
      ) {
        continue;
      }
      const option = el('button', 'settings__theme-option');
      option.type = 'button';
      option.tabIndex = -1;
      option.setAttribute('role', 'option');
      option.dataset.theme = def.id;
      const selected = def.id === theme();
      option.setAttribute('aria-selected', String(selected));

      const top = el('span', 'settings__theme-option-top');
      top.append(el('span', 'settings__theme-option-name', def.name));
      if (selected) {
        const check = icon(ICON.check, 13);
        check.classList.add('settings__theme-check');
        top.append(check);
      }
      option.append(top, paletteStrip(def));
      option.addEventListener('click', () => pick(def.id));
      option.addEventListener('pointermove', () => {
        const index = rows.indexOf(option);
        if (index >= 0 && index !== active) setActive(index);
      });

      list.append(option);
      rows.push(option);
    }

    if (!rows.length) {
      list.append(el('p', 'settings__theme-empty', t('settings.themeEmpty')));
      active = -1;
      return;
    }
    const index = rows.findIndex((row) => row.dataset.theme === theme());
    setActive(index >= 0 ? index : 0);
  }

  function place(): void {
    const margin = 8;
    const gap = 6;
    const anchor = trigger.getBoundingClientRect();
    popup.style.width = `${Math.max(anchor.width, 260)}px`;
    list.style.maxHeight = '';
    // Animasi masuk memakai transform; matikan dulu supaya ukuran yang diukur akurat.
    popup.style.animation = 'none';
    const natural = popup.getBoundingClientRect();
    const left = Math.min(Math.max(margin, anchor.left), window.innerWidth - natural.width - margin);

    const spaceBelow = window.innerHeight - anchor.bottom - gap - margin;
    const spaceAbove = anchor.top - gap - margin;
    const openBelow = spaceBelow >= natural.height || spaceBelow >= spaceAbove;
    const available = Math.max(120, openBelow ? spaceBelow : spaceAbove);
    if (natural.height > available) {
      const chrome = natural.height - list.clientHeight;
      list.style.maxHeight = `${Math.max(96, available - chrome)}px`;
    }
    const height = popup.getBoundingClientRect().height;
    popup.style.left = `${Math.max(margin, left)}px`;
    popup.style.top = openBelow
      ? `${anchor.bottom + gap}px`
      : `${Math.max(margin, anchor.top - gap - height)}px`;
    popup.style.animation = '';
  }

  function openPopup(): void {
    if (open) return;
    open = true;
    popup.hidden = false;
    wrap.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    search.value = '';
    renderList();
    document.body.append(popup);
    place();
    list.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    closeOpenPicker = closeNow;
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', closeNow);
    window.addEventListener('scroll', onScroll, true);
    search.focus();
  }

  function onOutside(event: Event): void {
    if (event.target instanceof Node && (wrap.contains(event.target) || popup.contains(event.target))) return;
    close();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === 'Tab') {
      close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!rows.length) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = (active + step + rows.length) % rows.length;
      setActive(next);
      rows[next].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (event.key === 'Enter') {
      const row = rows[active];
      if (!row) return;
      event.preventDefault();
      pick(row.dataset.theme ?? '');
    }
  }

  trigger.addEventListener('click', () => {
    if (open) close();
    else openPopup();
  });
  trigger.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    if (!open) openPopup();
  });
  search.addEventListener('input', renderList);

  wrap.append(trigger);
  return wrap;
}

export function mountSettings(container: HTMLElement, hooks: SettingsHooks): SettingsPanel {
  const root = el('div', 'settings');
  const notice = el('p', 'settings__notice');
  notice.hidden = true;
  notice.setAttribute('role', 'status');
  container.append(root, notice);

  function flash(message: string): void {
    notice.textContent = message;
    notice.hidden = false;
    window.setTimeout(() => {
      notice.hidden = true;
    }, 2_600);
  }

  function render(): void {
    const options = prefs();
    closeOpenPicker?.();
    root.replaceChildren();

    const head = el('header', 'settings__head');
    head.append(
      el('h2', 'settings__title', t('settings.title')),
      el('p', 'settings__subtitle', t('settings.subtitle'))
    );
    root.append(head);

    root.append(
      group(t('settings.language'), [
        row(
          t('settings.language'),
          t('settings.languageHint'),
          segmented<Locale>(
            LOCALES.map((value) => ({
              value,
              label: value === 'id' ? 'Bahasa Indonesia' : 'English',
            })),
            locale(),
            (value) => setLocale(value)
          )
        ),
      ])
    );

    const themeRow = row(t('settings.theme'), t('settings.themeHint'), themePicker());
    themeRow.classList.add('settings__row--stack');
    root.append(group(t('settings.appearance'), [themeRow]));

    root.append(
      group(t('settings.preview'), [
        row(
          t('settings.defaultView'),
          t('settings.viewHint'),
          segmented<FileView>(
            [
              { value: 'raw', label: t('settings.viewRaw') },
              { value: 'preview', label: t('settings.viewPreview') },
            ],
            options.defaultView,
            (value) => setPref('defaultView', value)
          )
        ),
        row(
          t('settings.split'),
          t('settings.splitHint'),
          segmented<SplitMode>(
            [
              { value: 'horizontal', label: t('settings.splitHorizontal') },
              { value: 'vertical', label: t('settings.splitVertical') },
            ],
            options.previewSplit,
            (value) => setPref('previewSplit', value)
          )
        ),
        row(t('settings.wrap'), t('settings.wrapHint'), toggle('wrap', options.wrap)),
        row(
          t('settings.lineNumbers'),
          t('settings.lineNumbersHint'),
          toggle('lineNumbers', options.lineNumbers)
        ),
        row(t('settings.syntax'), t('settings.syntaxHint'), toggle('syntax', options.syntax)),
        row(
          t('settings.scripts'),
          t('settings.scriptsHint'),
          toggle('scriptedPreview', options.scriptedPreview)
        ),
      ])
    );

    const resetButton = el('button', 'settings__reset', t('settings.reset'));
    resetButton.type = 'button';
    resetButton.addEventListener('click', () => {
      resetPrefs();
      setTheme('virtoffice');
      setLocale('id');
      flash(t('settings.resetDone'));
    });
    const delayInput = el('input', 'field__number');
    delayInput.type = 'number';
    delayInput.min = '0';
    delayInput.max = '10';
    delayInput.step = '0.5';
    delayInput.inputMode = 'decimal';
    delayInput.value = String(hooks.delayMs() / 1000);
    delayInput.title = t('settings.delayTitle');
    delayInput.setAttribute('aria-label', t('settings.delayAria'));
    delayInput.addEventListener('change', () => {
      hooks.setDelayMs(Number(delayInput.value) * 1000);
      delayInput.value = String(hooks.delayMs() / 1000);
      flash(t('settings.delaySaved'));
    });

    root.append(group(t('settings.agent'), [row(t('settings.delay'), t('settings.delayHint'), delayInput)]));

    const other = group(t('settings.other'), [
      row(t('settings.reset'), t('settings.resetHint'), resetButton),
      el('p', 'settings__note', t('settings.comingSoon')),
    ]);
    root.append(other);
  }

  render();
  subscribeLocale(render);
  subscribeTheme(render);
  subscribePrefs(render);

  return { refresh: render };
}
