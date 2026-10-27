import { subscribeLocale, t } from '../i18n';
import { APP_VERSION } from '../version';
import { ICON, el, icon } from './dom';

const GITHUB_URL = 'https://github.com/fadhly-permata';
const LINKEDIN_URL = 'https://id.linkedin.com/in/fadhlypermata';

function row(label: string, hint = ''): HTMLElement {
  const line = el('div', 'settings__row');
  const text = el('div', 'settings__row-text');
  text.append(el('p', 'settings__row-label', label));
  if (hint) text.append(el('p', 'settings__row-hint', hint));
  line.append(text);
  return line;
}

function valueRow(label: string, hint: string, value: string): HTMLElement {
  const line = row(label, hint);
  line.append(el('span', 'about__value', value));
  return line;
}

function group(title: string, rows: HTMLElement[]): HTMLElement {
  const section = el('section', 'settings__group');
  section.append(el('p', 'settings__group-title', title));
  section.append(...rows);
  return section;
}

function linkRow(label: string, hint: string, url: string): HTMLElement {
  const link = el('a', 'about__link');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.append(icon(ICON.expand, 14));

  const text = el('div', 'about__link-text');
  text.append(el('p', 'settings__row-label', label), el('p', 'about__link-url', url));
  link.append(text);
  link.append(el('p', 'settings__row-hint', `${hint} · ${t('about.opensLabel')}`));
  return link;
}

/** Kartu identitas: nama aplikasi plus versi, diambil dari package.json. */
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
    root.replaceChildren();

    const head = el('header', 'settings__head');
    head.append(
      el('h2', 'settings__title', t('about.title')),
      el('p', 'settings__subtitle', t('about.subtitle'))
    );
    root.append(head, hero());

    root.append(
      group(t('about.appGroup'), [
        valueRow(t('about.versionLabel'), t('about.versionHint'), APP_VERSION),
        valueRow(t('about.serverLabel'), t('about.serverHint'), 'Node · dev 5199 / prod 4180'),
      ])
    );

    const author = el('section', 'settings__group');
    author.append(el('p', 'settings__group-title', t('about.authorGroup')));
    const who = el('div', 'settings__row');
    const whoText = el('div', 'settings__row-text');
    whoText.append(
      el('p', 'about__name', t('about.authorName')),
      el('p', 'settings__row-hint', `${t('about.authorRole')} · ${t('about.authorLocation')}`),
      el('p', 'settings__row-hint', t('about.authorBio'))
    );
    who.append(whoText);
    author.append(
      who,
      linkRow(t('about.githubLabel'), t('about.githubHint'), GITHUB_URL),
      linkRow(t('about.linkedinLabel'), t('about.linkedinHint'), LINKEDIN_URL)
    );
    root.append(author);

    root.append(
      group(t('about.stackGroup'), [
        row('three.js + WebGL', t('about.stackThree')),
        row('OpenCode (SST)', t('about.stackOpenCode')),
        row('TypeScript · Vite · Vitest', t('about.stackTypeScript')),
        row('xterm.js', t('about.stackTerminal')),
        row('marked · DOMPurify · highlight.js · mermaid', t('about.stackMarkdown')),
      ])
    );

    root.append(
      group(t('about.noteGroup'), [
        el('p', 'settings__row-hint', t('about.noteLicense')),
        el('p', 'settings__row-hint', t('about.noteData')),
      ])
    );
  }

  render();
  subscribeLocale(render);
}
