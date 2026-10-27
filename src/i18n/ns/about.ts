import type { Catalog } from '../types';

/**
 * Halaman Tentang: identitas aplikasi, penulis, tautan, dan teknologi yang dipakai.
 * Nama orang, username, dan URL sengaja tidak diterjemahkan — hanya label di sekitarnya.
 */
export const about: Catalog = {
  title: ['Tentang', 'About'],
  subtitle: [
    'Identitas aplikasi, siapa yang membuatnya, dan apa yang berjalan di bawahnya.',
    'What this app is, who made it, and what runs underneath.',
  ],

  appGroup: ['Aplikasi', 'Application'],
  tagline: [
    'Kantor isometrik 2.5D yang menampilkan agen OpenCode sungguhan sebagai karyawan.',
    'A 2.5D isometric office that shows real OpenCode agents as office staff.',
  ],
  versionLabel: ['Versi', 'Version'],
  versionHint: [
    'Dibaca langsung dari package.json lewat src/version.ts.',
    'Read straight from package.json through src/version.ts.',
  ],
  serverLabel: ['Jembatan server', 'Server bridge'],
  serverHint: [
    'Satu proses Node: HUD kantor, bridge OpenCode, file, git, dan terminal.',
    'One Node process: office HUD, OpenCode bridge, files, git, and terminal.',
  ],

  authorGroup: ['Penulis', 'Author'],
  authorName: ['Fadhly Permata', 'Fadhly Permata'],
  authorRole: ['Pembuat dan pengelola proyek', 'Creator and maintainer'],
  authorLocation: ['Jakarta, Indonesia', 'Jakarta, Indonesia'],
  authorBio: [
    'Bio pada profil GitHub: "Focusing on Dart. I am programmer, not pro gamer 🤣"',
    'Profile bio on GitHub: "Focusing on Dart. I am programmer, not pro gamer 🤣"',
  ],

  linksGroup: ['Tautan penulis', 'Author links'],
  githubLabel: ['GitHub', 'GitHub'],
  githubHint: [
    'Profil publik @fadhly-permata — repositori dan kontribusi.',
    'Public profile @fadhly-permata — repositories and contributions.',
  ],
  linkedinLabel: ['LinkedIn', 'LinkedIn'],
  linkedinHint: [
    'Profil profesional fadhlypermata.',
    'Professional profile of fadhlypermata.',
  ],
  opensLabel: ['buka di tab baru', 'opens in a new tab'],

  stackGroup: ['Teknologi', 'Technology'],
  stackThree: [
    'three.js — diorama, material berbasis lingkungan, dan bayangan.',
    'three.js — the diorama, image-based lighting, and shadows.',
  ],
  stackOpenCode: [
    'OpenCode (SST) — sesi, agen, model, dan stream SSE yang asli.',
    'OpenCode (SST) — the real sessions, agents, models, and SSE stream.',
  ],
  stackTypeScript: [
    'TypeScript + Vite + Vitest — antarmuka dan tes unitnya.',
    'TypeScript + Vite + Vitest — the UI and its unit tests.',
  ],
  stackTerminal: [
    'xterm.js — terminal shell multi-tab di folder workspace.',
    'xterm.js — multi-tab shell terminals inside the workspace.',
  ],
  stackMarkdown: [
    'marked, DOMPurify, highlight.js, mermaid — jawaban agent digambar aman.',
    'marked, DOMPurify, highlight.js, mermaid — agent answers rendered safely.',
  ],

  noteGroup: ['Catatan', 'Notes'],
  noteLicense: [
    'Proyek pribadi; belum ada berkas lisensi di repo.',
    'A private project; the repo carries no license file yet.',
  ],
  noteData: [
    'Semua data tetap di mesin sendiri — tidak ada telemetri.',
    'Everything stays on this machine — there is no telemetry.',
  ],
};
