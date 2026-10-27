const SVG_NS = 'http://www.w3.org/2000/svg';

export const ICON = {
  chevron: 'm9 6 6 6-6 6',
  drive: 'M4 5h16a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm4 6h.01M8 19h8',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM15.5 15.5 20 20',
  check: 'm5 13 4 4L19 7',
  close: 'm6 6 12 12M18 6 6 18',
  terminal: 'm5 7 4 5-4 5M12 17h7',
  file: 'M7 3h7l4 4v14H7ZM14 3v5h5',
  expand: 'M9 4H4v5M15 20h5v-5M20 9V4h-5M4 15v5h5',
  copy: 'M9 9h11v11H9zM4 15V4h11',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  refresh: 'M22.5 4.5v6h-6M20 15a9 9 0 1 1-2.1-9.4l4.6 4.4',
  pencil: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
  trash: 'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6M10 11v6M14 11v6',
  filePlus: 'M14 3v5h5M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8ZM12 11v6M9 14h6',
  folderPlus: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2ZM12 11v6M9 14h6',
  up: 'M12 20V6M6 12l6-6 6 6',
  down: 'M12 4v14M6 12l6 6 6-6',
  branch: 'M6 4v10M18 9a9 9 0 0 1-9 9M9 17a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM21 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l4 2',
  chevronDown: 'm6 9 6 6 6-6',
  paste: 'M9 4h6v3H9zM15 5h2a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2M12 10v6M9.5 13.5 12 16l2.5-2.5',
  wrap: 'M4 7h16M4 12h10a3.5 3.5 0 1 1 0 7h-3m1.5-2.5L10 17l2.5 2.5M4 17h4',
};

export function icon(d: string, size = 16): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function iconButton(label: string, d: string, onClick: () => void): HTMLButtonElement {
  const button = el('button', 'icon-btn');
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.append(icon(d, 15));
  button.addEventListener('click', onClick);
  return button;
}
