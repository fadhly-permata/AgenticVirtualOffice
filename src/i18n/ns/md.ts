import type { Catalog } from '../types';

/** Label di sekitar diagram mermaid yang dibangun `src/chat/markdown.ts`. */
export const md: Catalog = {
  diagramLoading: ['Menggambar diagram…', 'Drawing diagram…'],
  diagramError: ['Diagram gagal digambar: {message}', 'Diagram failed to render: {message}'],
  expandDiagram: ['Perbesar diagram', 'Expand diagram'],
  copyDiagramSource: ['Salin kode diagram', 'Copy diagram source'],
  showSource: ['Lihat kode', 'Show source'],
  zoomIn: ['Perbesar', 'Zoom in'],
  zoomOut: ['Perkecil', 'Zoom out'],
  zoomReset: ['Ukuran semula', 'Reset size'],
  close: ['Tutup', 'Close'],
};
