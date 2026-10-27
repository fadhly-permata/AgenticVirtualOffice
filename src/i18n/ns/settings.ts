import type { Catalog } from '../types';

export const settings: Catalog = {
  title: ['Pengaturan', 'Settings'],
  subtitle: [
    'Bahasa, tema, dan perilaku pratinjau file untuk workspace ini.',
    'Language, theme, and file preview behaviour for this workspace.',
  ],
  language: ['Bahasa', 'Language'],
  languageHint: ['Bahasa antarmuka langsung berubah, tanpa muat ulang.', 'The interface switches instantly, no reload.'],
  appearance: ['Tampilan', 'Appearance'],
  theme: ['Tema', 'Theme'],
  themeHint: [
    'Tema mengatur panel, pratinjau file, dan pewarnaan sintaks.',
    'A theme drives panels, file previews, and syntax colours.',
  ],
  themeSearch: ['Cari tema…', 'Search themes…'],
  themeEmpty: ['Tema tidak ditemukan.', 'No themes found.'],
  preview: ['Pratinjau file', 'File preview'],
  other: ['Lainnya', 'Other'],
  wrap: ['Wrap kata', 'Word wrap'],
  wrapHint: [
    'Bungkus baris panjang alih-alih menggulir horizontal.',
    'Fold long lines instead of scrolling horizontally.',
  ],
  lineNumbers: ['Nomor baris', 'Line numbers'],
  lineNumbersHint: ['Tampilkan nomor baris di pratinjau.', 'Show line numbers in the preview.'],
  syntax: ['Pewarnaan sintaks', 'Syntax highlighting'],
  syntaxHint: [
    'Warnai file skrip dan blok kode di chat.',
    'Colour script files and code blocks in chat.',
  ],
  defaultView: ['Tampilan bawaan', 'Default view'],
  viewRaw: ['Raw', 'Raw'],
  viewPreview: ['Pratinjau', 'Preview'],
  viewHint: [
    'Apa yang muncul saat file diklik.',
    'What opens when a file is clicked.',
  ],
  split: ['Letak jendela pratinjau', 'Preview window layout'],
  splitHint: [
    'Berlaku saat jendela chat diperbesar: horizontal menumpuk di bawah daftar, vertikal berdampingan dengannya.',
    'Applies while the chat window is maximized: horizontal stacks under the list, vertical sits beside it.',
  ],
  splitHorizontal: ['Horizontal', 'Horizontal'],
  splitVertical: ['Vertikal', 'Vertical'],
  scripts: ['Izinkan skrip di pratinjau HTML', 'Allow scripts in HTML preview'],
  scriptsHint: [
    'Berisiko: halaman workspace bisa menjalankan kode saat pratinjau dibuka.',
    'Risky: workspace pages can run code when previewed.',
  ],
  agent: ['Agen', 'Agent'],
  delay: ['Jeda animasi agen', 'Agent animation pause'],
  delayHint: [
    'Detik jeda sebelum dan sesudah agen mengerjakan tugas yang didelegasikan.',
    'Seconds of pause before and after an agent handles delegated work.',
  ],
  delayTitle: [
    'Jeda sebelum dan sesudah pekerjaan yang didelegasikan',
    'Pause before and after delegated work',
  ],
  delayAria: ['Jeda delegasi dalam detik', 'Delegation pause in seconds'],
  delaySaved: ['Jeda agen diperbarui.', 'Agent pause updated.'],
  reset: ['Kembalikan bawaan', 'Reset to defaults'],
  resetHint: [
    'Bahasa, tema, dan opsi pratinjau kembali ke awal. Posisi jendela chat tidak diubah.',
    'Language, theme, and preview options go back to the start. Chat window position is kept.',
  ],
  resetDone: ['Preferensi dikembalikan ke bawaan.', 'Preferences restored to defaults.'],
  saved: ['Tersimpan', 'Saved'],
  dark: ['Gelap', 'Dark'],
  light: ['Terang', 'Light'],
  comingSoon: ['Opsi lain menyusul di halaman ini.', 'More options land here later.'],
};
