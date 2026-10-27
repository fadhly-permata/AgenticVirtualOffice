import { subscribeLocale, t } from '../i18n';
import { APP_VERSION } from '../version';
import { ICON, el, icon } from './dom';

const GITHUB_URL = 'https://github.com/fadhly-permata';
const LINKEDIN_URL = 'https://id.linkedin.com/in/fadhlypermata';
const STACK = 'three.js · OpenCode (SST) · TypeScript · Vite · xterm.js';

function group(title: string, ...rows: HTMLElement[]): HTMLElement {
  const section = el('section', 'settings__group');
  section.append(el('p', 'settings__group-title', title), ...rows);
  return section;
}

/** Satu kartu tautan: label, URL, dan ikon buka-di-tab-baru. */
function link(label: string, url: string): HTMLElement {
  const anchor = el('a', 'about__link');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.append(icon(ICON.expand, 14));

  const text = el('div', 'about__link-text');
  text.append(el('p', 'settings__row-label', label), el('p', 'about__link-url', url));
  anchor.append(text);
  return anchor;
}

function hero(): HTMLElement {
  const card = el('section', 'settings__group about__hero');
  const mark = el('span', 'about__mark');
  mark.append(icon(ICON.about, 26));

  const text = el('div', 'settings__row-text');
  const name = el('p', 'about__name', 'VirtOffice');
  name.append(el('span', 'about__value', `v${APP_VERSION}`));
  text.append(name, el('p', 'settings__row-hint', t('about.tagline')));

  card.append(mark, text);
  return card;
}

export function mountAbout(container: HTMLElement): void {
  const root = el('div', 'settings about');
  container.append(root);

  function render(): void {
    const who = el('div', 'about__who');
    who.append(
      el('p', 'about__name', 'Fadhly Permata'),
      el('p', 'settings__row-hint', 'Jakarta, Indonesia')
    );

    root.replaceChildren(
      el('h2', 'settings__title', t('about.title')),
      hero(),
      group(
        t('about.authorGroup'),
        who,
        link('GitHub', GITHUB_URL),
        link('LinkedIn', LINKEDIN_URL)
      ),
      group(t('about.stackGroup'), el('p', 'about__stack', STACK))
    );
  }

  render();
  subscribeLocale(render);
}
