import { ICON, el, icon } from './dom';

export interface MenuItem {
  label: string;
  run: () => void;
  danger?: boolean;
  glyph?: string;
}

export interface MenuSeparator {
  separator: true;
}

export type MenuEntry = MenuItem | MenuSeparator;

function isSeparator(entry: MenuEntry): entry is MenuSeparator {
  return 'separator' in entry;
}

let openMenu: HTMLElement | null = null;

function close(): void {
  if (!openMenu) return;
  const node = openMenu;
  openMenu = null;
  node.remove();
  document.removeEventListener('pointerdown', onOutside, true);
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('resize', close);
  window.removeEventListener('scroll', close, true);
}

function onOutside(event: Event): void {
  if (!openMenu) return;
  if (event.target instanceof Node && openMenu.contains(event.target)) return;
  close();
}

function onKey(event: KeyboardEvent): void {
  if (!openMenu) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const items = Array.from(openMenu.querySelectorAll<HTMLButtonElement>('.ctx__item'));
  if (!items.length) return;
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === 'ArrowDown'
      ? items[(index + 1) % items.length]
      : items[(index - 1 + items.length) % items.length];
  next.focus();
  event.preventDefault();
}

/** Menu konteks kustom: tanpa confirm()/prompt() browser, sesuai aturan proyek. */
export function openContextMenu(
  position: { clientX: number; clientY: number },
  entries: MenuEntry[],
  header?: string
): void {
  close();
  const menu = el('div', 'ctx');
  menu.setAttribute('role', 'menu');
  if (header) {
    const title = el('p', 'ctx__head', header);
    title.title = header;
    menu.append(title);
  }

  for (const entry of entries) {
    if (isSeparator(entry)) {
      menu.append(el('div', 'ctx__sep'));
      continue;
    }
    const item = el('button', entry.danger ? 'ctx__item ctx__item--danger' : 'ctx__item');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    const mark = el('span', 'ctx__mark');
    mark.append(icon(entry.glyph ?? ICON.chevron, 13));
    item.append(mark, el('span', 'ctx__label', entry.label));
    item.addEventListener('click', () => {
      close();
      entry.run();
    });
    menu.append(item);
  }

  document.body.append(menu);
  const box = menu.getBoundingClientRect();
  const left = Math.min(position.clientX, window.innerWidth - box.width - 8);
  const top = Math.min(position.clientY, window.innerHeight - box.height - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
  openMenu = menu;

  menu.querySelector<HTMLButtonElement>('.ctx__item')?.focus();
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', close);
  window.addEventListener('scroll', close, true);
}
