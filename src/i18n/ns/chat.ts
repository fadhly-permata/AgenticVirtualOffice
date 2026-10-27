import type { Catalog } from '../types';

export const chat: Catalog = {
  // Composer & pencarian
  searchSessions: ['Cari sesi…', 'Search sessions…'],
  searchModels: ['Cari model…', 'Search models…'],
  placeholderNoWorkspace: ['Buka workspace untuk mulai…', 'Open a workspace to start…'],

  // Peluncur & judul jendela
  launcherEyebrow: ['Virtual Command Room', 'Virtual Command Room'],
  openWorkspace: ['Buka workspace', 'Open workspace'],
  launcherTitle: ['Chat OpenCode di {path}', 'OpenCode chat in {path}'],
  launcherTitleIdle: ['Pilih folder workspace untuk OpenCode', 'Pick a workspace folder for OpenCode'],
  shrinkChat: ['Perkecil chat', 'Shrink chat'],
  growChat: ['Perbesar chat', 'Maximize chat'],

  // Status di bawah composer
  statusChooseWorkspace: ['Pilih workspace', 'Choose a workspace'],
  statusReady: ['Siap', 'Ready'],
  statusSending: ['Mengirim…', 'Sending…'],
  statusWorking: ['OpenCode sedang bekerja…', 'OpenCode is working…'],
  statusWaitRetry: ['Menunggu percobaan ulang…', 'Waiting to retry…'],

  // Tombol kirim
  sendStop: ['Hentikan', 'Stop'],
  sendSend: ['Kirim', 'Send'],
  sendStopAria: ['Hentikan respons OpenCode', 'Stop OpenCode response'],
  sendSendAria: ['Kirim pesan', 'Send message'],

  // Muat awal & sesi
  booting: ['Menyiapkan OpenCode…', 'Preparing OpenCode…'],
  bootingBody: ['Menghubungkan CLI dan membaca konfigurasi workspace.', 'Connecting the CLI and reading workspace configuration.'],
  loadingSession: ['Memuat sesi…', 'Loading session…'],
  loadingSessionBody: ['Mengambil riwayat percakapan.', 'Fetching conversation history.'],
  noModels: ['Tidak ada model', 'No models'],
  newChat: ['＋ Chat baru', '＋ New chat'],
  untitledSession: ['Sesi tanpa judul', 'Untitled session'],
  chooseModelFirst: ['Pilih model OpenCode terlebih dahulu.', 'Choose an OpenCode model first.'],
  sendingPrompt: ['Mengirim permintaan…', 'Sending request…'],
  creatingSession: ['Membuat sesi…', 'Creating session…'],

  // Tindakan pesan (notice)
  retry: ['Coba lagi', 'Try again'],
  reload: ['Muat ulang', 'Reload'],

  // Pemberitahuan
  stopBeforeSwitch: [
    'Hentikan respons yang sedang berjalan sebelum mengganti workspace.',
    'Stop the running response before switching workspace.',
  ],
  serverOffline: ['Server lokal tidak tersedia. Jalankan npm run dev.', 'Local server unavailable. Run npm run dev.'],
  rulesWriteFailed: [
    'Aturan jeda delegasi tidak bisa ditulis ke workspace ini.',
    "Delegation-pause rules can't be written to this workspace.",
  ],
  rulesWriteError: ['Aturan jeda delegasi gagal ditulis.', 'Failed to write the delegation-pause rules.'],
  retryNotice: ['OpenCode mencoba ulang…', 'OpenCode is retrying…'],
  streamLost: ['Koneksi event terputus. Mencoba menyambung ulang…', 'Event connection dropped. Reconnecting…'],
  bridgeDown: ['Koneksi ke server terputus.', 'Connection to the server dropped.'],
  sessionDeleted: ['Sesi dihapus.', 'Session deleted.'],
  providerRetry: ['Provider sedang bermasalah, mencoba ulang…', 'Provider is having trouble, retrying…'],
  fatalSuffix: [
    ' — ganti model lewat dropdown Model untuk melanjutkan.',
    ' — switch model in the Model dropdown to continue.',
  ],

  // Keadaan kosong
  openCodeError: ['OpenCode error', 'OpenCode error'],
  emptyTitleNotReady: ['OpenCode belum siap', 'OpenCode is not ready yet'],
  emptyTitleStart: ['Mulai percakapan', 'Start a conversation'],
  emptyCheckError: ['Periksa pesan error di atas, lalu coba lagi.', 'Check the error message above, then try again.'],
  emptyWorkspaceBody: [
    'Pilih folder proyek untuk mulai menggunakan OpenCode.',
    'Pick a project folder to start using OpenCode.',
  ],
  emptyReadyBody: [
    'OpenCode akan bekerja langsung di folder {name}. Ia bisa membaca, menulis, dan menjalankan perintah — setiap aksi sensitif meminta izin.',
    'OpenCode works directly in the {name} folder. It can read, write, and run commands — every sensitive action asks for permission.',
  ],

  // Penalaran & alat
  reasoningLive: ['Penalaran…', 'Reasoning…'],
  reasoning: ['Penalaran', 'Reasoning'],

  // Panel izin
  permissionNeeded: ['Izin diperlukan', 'Permission needed'],
  permissionText: ['OpenCode ingin menggunakan tool ini di workspace.', 'OpenCode wants to use this tool in the workspace.'],
  moreTargets: ['+{count} lainnya', '+{count} more'],
  reject: ['Tolak', 'Reject'],
  allow: ['Izinkan', 'Allow'],
  allowAlways: ['Selalu izinkan', 'Always allow'],

  // Panel pertanyaan
  askQuestion: ['OpenCode bertanya', 'OpenCode is asking'],
  questionDefault: ['Pertanyaan', 'Question'],
  customAnswer: ['Jawaban lain…', 'Another answer…'],
  customAnswerAria: ['Jawaban lain untuk {header}', 'Another answer for {header}'],
  sendAnswer: ['Kirim jawaban', 'Send answer'],
  pickAnswer: [
    'Pilih minimal satu jawaban untuk setiap pertanyaan.',
    'Choose at least one answer for each question.',
  ],

  // Waktu & pemotongan
  justNow: ['baru saja', 'just now'],
  minutesAgo: ['{n} mnt lalu', '{n} min ago'],
  hoursAgo: ['{n} jam lalu', '{n} hours ago'],
  charsMore: ['\n… {count} karakter lagi', '\n… {count} more characters'],
  elapsedSeconds: ['{n} dtk', '{n}s'],
  elapsedMinutes: ['{m} mnt {s} dtk', '{m}m {s}s'],
};
