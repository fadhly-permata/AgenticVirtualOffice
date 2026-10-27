import type { Catalog } from '../types';

export const term: Catalog = {
  tabsAria: ['Terminal yang terbuka', 'Open terminals'],
  pickerAria: ['Shell untuk terminal baru', 'Shell for the new terminal'],
  new: ['Terminal baru', 'New terminal'],
  copy: ['Salin pilihan ke clipboard', 'Copy selection to clipboard'],
  paste: ['Tempel dari clipboard', 'Paste from clipboard'],
  close: ['Tutup terminal ini', 'Close this terminal'],
  padPh: [
    'Tempel teks di sini (Ctrl+V atau menu klik kanan), lalu Enter untuk menyisipkan ke terminal.',
    'Paste text here (Ctrl+V or the right-click menu), then Enter to insert it into the terminal.',
  ],
  padAria: ['Kolom tempel ke terminal', 'Terminal paste field'],
  padTitle: ['Enter untuk menyisipkan, Esc untuk menutup', 'Enter to insert, Esc to close'],
  pasteBtn: ['Tempel', 'Paste'],
  emptyTitle: ['Belum ada terminal', 'No terminals yet'],
  emptyBody: [
    'Buka shell di folder workspace aktif. Beberapa tab bisa berjalan bersamaan.',
    'Open a shell in the active workspace folder. Several tabs can run at once.',
  ],
  pathNative: ['asli Windows (registry)', 'native Windows (registry)'],
  pathInherited: ['warisan proses server', 'inherited from the server process'],
  closeTab: ['Tutup {name}', 'Close {name}'],
  shellDone: ['shell sudah selesai', 'shell has finished'],
  shellExit: ['shell selesai, kode {code}', 'shell finished, code {code}'],
  disconnected: [
    'Koneksi terminal terputus; browser mencoba menyambung lagi.',
    'Terminal connection lost; the browser is trying to reconnect.',
  ],
  selectFirst: ['Blok teks di terminal lebih dulu, baru salin.', 'Select text in the terminal first, then copy.'],
  copiedLines: ['{count} baris tersalin ke clipboard.', '{count} lines copied to clipboard.'],
  clipCopyDenied: [
    'Browser menolak akses clipboard — klik kanan lalu pilih Salin.',
    'The browser refused clipboard access — right-click and choose Copy.',
  ],
  pastedHint: [
    'Teks masuk ke terminal — tekan Enter untuk menjalankan baris terakhir.',
    'Text inserted into the terminal — press Enter to run the last line.',
  ],
  clipReadDenied: [
    'Browser menolak baca clipboard — tempel di kolom di bawah.',
    'The browser refused to read the clipboard — paste in the field below.',
  ],
  clipEmpty: ['Clipboard kosong.', 'Clipboard is empty.'],
  needWorkspace: [
    'Buka workspace lebih dulu sebelum menjalankan terminal.',
    'Open a workspace before running a terminal.',
  ],
};
