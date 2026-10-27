import qrcode from 'qrcode-generator';
import { subscribeLocale, t } from '../i18n';
import { chatApi } from './client';
import { ICON, el, icon } from './dom';
import type { LanInfo } from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Modul QR digambar sebagai satu path supaya tajam di semua ukuran. */
function qrSvg(text: string): SVGSVGElement {
  const code = qrcode(0, 'M');
  code.addData(text);
  code.make();
  const count = code.getModuleCount();
  let d = '';
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (code.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
    }
  }

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${count} ${count}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#0b0f14');
  svg.append(path);
  return svg;
}

export function mountMobile(container: HTMLElement): void {
  const root = el('div', 'settings mobile');
  container.append(root);

  let info: LanInfo | null = null;
  let failure = '';
  let loading = false;
  let generation = 0;

  async function load(): Promise<void> {
    const stamp = (generation += 1);
    loading = true;
    failure = '';
    render();
    try {
      const next = await chatApi.lan();
      if (stamp !== generation) return;
      info = next;
    } catch (error) {
      if (stamp !== generation) return;
      failure = error instanceof Error ? error.message : String(error);
    }
    if (stamp !== generation) return;
    loading = false;
    render();
  }

  function head(): HTMLElement {
    const box = el('div', 'settings__head');
    box.append(
      el('h2', 'settings__title', t('mobile.title')),
      el('p', 'settings__subtitle', t('mobile.intro'))
    );
    return box;
  }

  function refreshButton(): HTMLButtonElement {
    const button = el('button', 'mobile__refresh');
    button.type = 'button';
    button.disabled = loading;
    button.append(icon(ICON.refresh, 14), el('span', '', t('mobile.refresh')));
    button.addEventListener('click', () => void load());
    return button;
  }

  function noteCard(text: string, className = ''): HTMLElement {
    const card = el('section', `settings__group${className ? ` ${className}` : ''}`);
    card.append(el('p', 'mobile__note', text), refreshButton());
    return card;
  }

  function qrCard(url: string, alternatives: string[]): HTMLElement {
    const card = el('section', 'settings__group mobile__card');
    const frame = el('div', 'mobile__qr');
    frame.setAttribute('role', 'img');
    frame.setAttribute('aria-label', t('mobile.qrAria'));
    frame.append(qrSvg(url));

    const link = el('a', 'mobile__url', url);
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';

    card.append(frame, link, refreshButton());
    if (alternatives.length) {
      const others = el('div', 'mobile__others');
      others.append(el('p', 'settings__group-title', t('mobile.others')));
      for (const candidate of alternatives) {
        const anchor = el('a', 'mobile__alt', candidate);
        anchor.href = candidate;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        others.append(anchor);
      }
      card.append(others);
    }
    return card;
  }

  function hintCard(): HTMLElement {
    const card = el('section', 'settings__group');
    card.append(
      el('p', 'settings__group-title', t('mobile.howTo')),
      el('p', 'mobile__note', t('mobile.hint'))
    );
    return card;
  }

  function warningCard(): HTMLElement {
    const card = el('section', 'settings__group mobile__warn');
    card.append(
      el('p', 'settings__group-title', t('mobile.warningTitle')),
      el('p', 'mobile__note', t('mobile.warning'))
    );
    return card;
  }

  function body(): HTMLElement[] {
    if (loading) return [noteCard(t('mobile.loading'))];
    if (failure) return [noteCard(failure)];
    if (!info) return [noteCard(t('mobile.loading'))];
    if (!info.reachable) return [noteCard(t('mobile.loopback', { bind: info.bind }))];
    if (!info.url) return [noteCard(t('mobile.noAddress'))];

    const { address, port } = info;
    const alternatives = info.candidates
      .filter((candidate) => !candidate.virtual && candidate.address !== address)
      .map((candidate) => `http://${candidate.address}:${port}`);
    return [qrCard(info.url, alternatives), hintCard(), warningCard()];
  }

  function render(): void {
    root.replaceChildren(head(), ...body());
  }

  render();
  void load();
  subscribeLocale(render);
}
