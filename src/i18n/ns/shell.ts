import type { Catalog } from '../types';

/**
 * Teks statis cangkang aplikasi: markup `index.html` yang dibaca `applyStatic()`
 * dan label HUD yang ditulis ulang `src/main.ts` tiap tick.
 */
export const shell: Catalog = {
  docTitle: ['VirtOffice — Kantor Isometrik', 'VirtOffice — Isometric Office'],
  brandTitle: ['VIRTUAL OFFICE', 'VIRTUAL OFFICE'],
  brandVersion: ['Versi {version}', 'Version {version}'],

  toolSwitchTitle: ['Ganti tool agentik', 'Change agentic tool'],
  toolPillAria: ['Agentic tool: {tool}. Klik untuk mengganti.', 'Agentic tool: {tool}. Click to change.'],
  toolMenuTitle: ['Agentic tool', 'Agentic tool'],
  toolAdapters: ['{n} adapter', '{n} adapters'],
  toolActive: ['Aktif', 'Active'],
  toolReady: ['Siap', 'Ready'],
  toolSoon: ['Segera', 'Soon'],
  toolLoading: ['Memuat daftar tool…', 'Loading tools…'],
  toolMenuFoot: [
    'Daftar sesi, model, dan agen mengikuti tool yang aktif.',
    'Sessions, models, and agents follow the active tool.',
  ],
  toolNoAdapter: ['belum ada adapter', 'no adapter yet'],
  toolBack: ['Kembali ke daftar', 'Back to the list'],
  toolConfirmTitle: ['Pindah ke {tool}?', 'Switch to {tool}?'],
  toolCaveatSessions: [
    'Sesi & agen {tool} dimuat ulang di kantor.',
    '{tool} sessions & agents reload in the office.',
  ],
  toolCaveatHistory: [
    'Riwayat {tool} tetap tersimpan — tidak ada sesi yang dihapus.',
    '{tool} history stays saved — no sessions are deleted.',
  ],
  toolCaveatRules: ['Aturan workspace beralih ke {file}.', 'Workspace rules switch to {file}.'],
  toolBusyWarn: [
    '{n} sesi sedang bekerja. Turn itu akan dihentikan sebelum tool baru dimuat.',
    '{n} sessions are working. They will be stopped before the new tool loads.',
  ],
  toolGo: ['Ganti tool', 'Switch tool'],
  toolGoBusy: ['Hentikan & ganti', 'Stop & switch'],
  toolConnecting: ['Menghubungkan ke {tool}…', 'Connecting to {tool}…'],
  toolStopping: ['Menghentikan turn & menghubungkan ke {tool}…', 'Stopping turns & connecting to {tool}…'],
  toolStepBridge: ['Bridge lama dihentikan', 'Old bridge stopped'],
  toolStepLoad: ['Memuat sesi & agen', 'Loading sessions & agents'],
  toolOverlayTitle: ['Memuat sesi {tool}…', 'Loading {tool} sessions…'],
  toolOverlayText: [
    'Agen kantor disiapkan ulang dari adapter baru. Riwayat tool lama tetap aman.',
    'Office agents rebuild from the new adapter. The old tool’s history stays safe.',
  ],
  toolSwitched: ['Tool aktif: {tool}', 'Active tool: {tool}'],
  toolSwitchedDetail: [
    'Sesi & agen dimuat ulang · riwayat {previous} tetap tersimpan',
    'Sessions & agents reloaded · {previous} history stays saved',
  ],
  toolRevertedDetail: ['Kembali ke pilihan sebelumnya', 'Back to the previous choice'],
  toolRemoteDetail: ['Diubah dari tab lain', 'Changed from another tab'],
  toolFailed: ['Gagal mengganti tool', 'Could not switch tools'],
  toolUndo: ['Undo', 'Undo'],
  toolUndoing: ['Kembali ke {tool}…', 'Returning to {tool}…'],
  toolBusyRetry: [
    'Sesi baru mulai bekerja. Cek peringatan lalu coba lagi.',
    'A new session started working. Check the warning and try again.',
  ],

  sceneAria: ['Diorama kantor isometrik 2.5D bergerak', 'Animated 2.5D isometric office diorama'],

  clockAria: ['Jam kantor', 'Office clock'],
  clockLabel: ['Waktu kantor', 'Office time'],

  legendAria: ['Status agen', 'Agent status'],
  agentsLabel: ['Agen', 'Agents'],
  offFloor: ['Luar lantai', 'Off the floor'],
  offFloorTitle: [
    '{n} agen tidak mendapat kursi: {names}',
    '{n} agents have no seat: {names}',
  ],
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
  tabMobile: ['Mobile', 'Mobile'],
  tabAbout: ['Tentang', 'About'],
  tabSettings: ['Pengaturan', 'Settings'],

  fieldSession: ['Sesi', 'Session'],
  fieldModel: ['Model', 'Model'],
  fieldAgent: ['Agent', 'Agent'],

  composerPlaceholder: ['Minta {tool} mengerjakan sesuatu…', 'Ask {tool} to work on something…'],
  composerAria: ['Pesan untuk {tool}', 'Message for {tool}'],

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
