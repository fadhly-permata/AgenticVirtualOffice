import type { Catalog } from '../types';

export const viewer: Catalog = {
  wrapOn: ['Matikan wrap kata', 'Turn word wrap off'],
  wrapOff: ['Nyalakan wrap kata', 'Turn word wrap on'],
  copy: ['Salin isi', 'Copy content'],
  copied: ['Tersalin', 'Copied'],
  copyFailed: ['Tidak bisa menyalin di webview.', 'Clipboard blocked in this webview.'],
  raw: ['Raw', 'Raw'],
  preview: ['Pratinjau', 'Preview'],
  lines: ['{count} baris', '{count} lines'],
  moreLines: ['{count} baris lagi tidak ditampilkan', '{count} more lines are not shown'],
  close: ['Tutup pratinjau', 'Close preview'],
  truncated: ['dipotong', 'truncated'],
  binary: ['file biner', 'binary file'],
  binaryBody: ['Isinya bukan teks, jadi tidak ditampilkan.', 'The content is not text, so nothing is shown.'],
  noPreview: ['Tidak ada mode pratinjau untuk jenis file ini.', 'No preview mode for this file type.'],
  previewOnly: ['Hanya pratinjau', 'Preview only'],
  size: ['Ukuran', 'Size'],
  openInTab: ['Buka di tab baru', 'Open in a new tab'],
  reload: ['Muat ulang pratinjau', 'Reload preview'],
  scriptBlocked: [
    'Skrip diblokir. Nyalakan “Izinkan skrip” di Pengaturan untuk menjalankannya.',
    'Scripts are blocked. Enable “Allow scripts” in Settings to run them.',
  ],
  zoomIn: ['Perbesar teks', 'Zoom text in'],
  zoomOut: ['Perkecil teks', 'Zoom text out'],
  zoomReset: ['Ukuran teks semula', 'Reset text size'],
};
