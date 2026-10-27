import { locale, LOCALES, setLocale, subscribeLocale, t } from '../i18n';
import type { Locale } from '../i18n/types';
import { setTheme, subscribeTheme, swatch, theme, THEMES } from '../theme';
import { prefs, resetPrefs, setPref, subscribePrefs } from './prefs';
import type { FileView, Prefs } from './prefs';
import { el } from './dom';

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

function themeGrid(active: string): HTMLElement {
  const grid = el('div', 'settings__themes');
  for (const def of THEMES) {
    const card = el('button', 'settings__theme');
    card.type = 'button';
    card.dataset.active = String(def.id === active);
    card.setAttribute('aria-pressed', String(def.id === active));
    const chips = el('span', 'settings__theme-chips');
    for (const color of swatch(def)) {
      const chip = el('span', 'settings__theme-chip');
      chip.style.background = color;
      chips.append(chip);
    }
    card.append(el('span', 'settings__theme-name', def.name), chips);
    card.addEventListener('click', () => setTheme(def.id));
    grid.append(card);
  }
  return grid;
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

    const themeRow = row(t('settings.theme'), t('settings.themeHint'), themeGrid(theme()));
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
