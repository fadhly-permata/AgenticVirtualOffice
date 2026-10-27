import type { Catalog } from '../types';

/**
 * Teks statis cangkang aplikasi: markup `index.html` yang dibaca `applyStatic()`
 * dan label HUD yang ditulis ulang `src/main.ts` tiap tick.
 */
export const shell: Catalog = {
  docTitle: ['VirtOffice — Kantor Isometrik', 'VirtOffice — Isometric Office'],
  brandTitle: ['VIRTUAL OFFICE', 'VIRTUAL OFFICE'],
  brandVersion: ['Versi {version}', 'Version {version}'],

  sceneAria: ['Diorama kantor isometrik 2.5D bergerak', 'Animated 2.5D isometric office diorama'],

  clockAria: ['Jam kantor', 'Office clock'],
  clockLabel: ['Waktu kantor', 'Office time'],

  legendAria: ['Status agen', 'Agent status'],
  agentsLabel: ['Agen', 'Agents'],
  floorLive: ['LIVE', 'LIVE'],
  floorAutoPlay: ['AUTO-PLAY', 'AUTO-PLAY'],

  chatAria: ['Virtual Command Room', 'Virtual Command Room'],
  chatHeadTitle: ['Seret untuk memindahkan jendela chat', 'Drag to move the chat window'],
  chatHeadAria: [
    'Batang judul chat. Seret, atau pakai tombol panah, untuk memindahkan jendela.',
    'Chat title bar. Drag, or use the arrow keys, to move the window.',
  ],
  chatWorkspace: ['Virtual Command Room', 'Virtual Command Room'],
  changeWorkspace: ['Ganti workspace', 'Change workspace'],
  newChat: ['Chat baru', 'New chat'],
  closeChat: ['Tutup chat', 'Close chat'],
  railAria: ['Bagian chat', 'Chat sections'],

  tabAgentic: ['Agentic', 'Agentic'],
  tabFiles: ['Daftar File', 'File List'],
  tabScm: ['Kontrol Sumber', 'Source Control'],
  tabTerminal: ['Terminal', 'Terminal'],
  tabAbout: ['Tentang', 'About'],
  tabSettings: ['Pengaturan', 'Settings'],

  fieldSession: ['Sesi', 'Session'],
  fieldModel: ['Model', 'Model'],
  fieldAgent: ['Agent', 'Agent'],

  composerPlaceholder: ['Minta OpenCode mengerjakan sesuatu…', 'Ask OpenCode to work on something…'],
  composerAria: ['Pesan untuk OpenCode', 'Message for OpenCode'],

  folderEyebrow: ['Ruang kerja', 'Workspace'],
  folderTitle: ['Buka folder proyek', 'Open a project folder'],
  folderClose: ['Tutup', 'Close'],
  folderCloseAria: ['Tutup pemilih folder', 'Close the folder picker'],
  folderUp: ['Naik satu level', 'Up one level'],
  folderPathPlaceholder: ['Tempel path folder…', 'Paste a folder path…'],
  folderPathAria: ['Path folder', 'Folder path'],
  browse: ['Telusuri', 'Browse'],
  browseTitle: ['Tampilkan isi folder', 'Show folder contents'],
  recents: ['Terakhir dibuka', 'Recently opened'],
  cancel: ['Batal', 'Cancel'],
  openFolder: ['Buka folder ini', 'Open this folder'],

  canvasMissing: ['Canvas #scene tidak ditemukan.', 'Canvas #scene not found.'],
  renderError: ['Render gagal: {message}', 'Render error: {message}'],
};
