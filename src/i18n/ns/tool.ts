import type { Catalog } from '../types';

export const tool: Catalog = {
  statusRunning: ['Berjalan', 'Running'],
  statusDone: ['Selesai', 'Completed'],
  statusError: ['Gagal', 'Failed'],
  statusPending: ['Menunggu', 'Pending'],
  default: ['Tool', 'Tool'],

  input: ['Input', 'Input'],
  output: ['Output', 'Output'],
  error: ['Error', 'Error'],

  bash: ['Menjalankan perintah', 'Running command'],
  edit: ['Mengubah file', 'Editing file'],
  glob: ['Mencari file', 'Finding files'],
  grep: ['Mencari teks', 'Searching text'],
  list: ['Melihat folder', 'Listing folder'],
  question: ['Bertanya', 'Asking'],
  read: ['Membaca file', 'Reading file'],
  task: ['Menjalankan subagent', 'Running subagent'],
  todoread: ['Membaca rencana', 'Reading plan'],
  todowrite: ['Menyusun rencana', 'Drafting plan'],
  webfetch: ['Mengambil halaman', 'Fetching page'],
  websearch: ['Mencari di web', 'Searching the web'],
  write: ['Menulis file', 'Writing file'],

  runPrepare: ['Menyiapkan…', 'Preparing…'],
  runThink: ['Menalar…', 'Reasoning…'],
  runTool: ['Menjalankan alat…', 'Running tool…'],
  runWrite: ['Menulis jawaban…', 'Writing reply…'],

  bubbleThink: ['Mikir: {detail}', 'Thinking: {detail}'],
  bubbleWrite: ['Nulis: {detail}', 'Writing: {detail}'],
};
