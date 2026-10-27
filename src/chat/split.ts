import { t } from '../i18n';
import { el } from './dom';
import { clampRatio, prefs, setPref } from './prefs';

export interface SplitHandle {
  el: HTMLElement;
  /** Samakan orientasi, rasio, dan visibilitas dengan keadaan pane saat ini. */
  sync(): void;
}

/** Dipancarkan shell saat ukuran/arah tata letak berubah (buka, maximize, seret). */
export const LAYOUT_EVENT = 'virto:layout';

export function notifyLayout(): void {
  window.dispatchEvent(new Event(LAYOUT_EVENT));
}

/**
 * Pembatas antara daftar dan pratinjau. Diseret dengan pointer; porsi pratinjau
 * disimpan di prefs supaya bertahan setelah halaman dimuat ulang.
 */
export function splitHandle(panes: HTMLElement, viewer: HTMLElement): SplitHandle {
  const handle = el('div', 'split-handle');
  handle.setAttribute('role', 'separator');

  const isRow = (): boolean => getComputedStyle(panes).flexDirection === 'row';

  function sync(): void {
    const label = t('viewer.dragSplit');
    handle.title = label;
    handle.setAttribute('aria-label', label);
    handle.setAttribute('aria-orientation', isRow() ? 'vertical' : 'horizontal');
    handle.hidden = viewer.hidden;
    viewer.style.flexBasis = `${prefs().previewRatio * 100}%`;
  }

  window.addEventListener(LAYOUT_EVENT, sync);

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const row = isRow();
    const rect = panes.getBoundingClientRect();
    let ratio = prefs().previewRatio;

    const move = (step: PointerEvent): void => {
      const share = row
        ? (rect.right - step.clientX) / rect.width
        : (rect.bottom - step.clientY) / rect.height;
      ratio = clampRatio(share);
      viewer.style.flexBasis = `${ratio * 100}%`;
    };
    const finish = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      delete handle.dataset.drag;
      setPref('previewRatio', ratio);
    };

    handle.dataset.drag = 'true';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  });

  return { el: handle, sync };
}
