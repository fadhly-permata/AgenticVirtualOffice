import type { Catalog } from '../types';

/**
 * Halaman Tentang versi ringkas: nama, penulis, tautan, dan teknologi.
 * Nama orang dan URL adalah data, bukan teks UI — hanya judul bagian yang diterjemahkan.
 */
export const about: Catalog = {
  title: ['Tentang', 'About'],
  tagline: [
    'Kantor isometrik 2.5D dengan agen {tool} sungguhan sebagai karyawan.',
    'A 2.5D isometric office staffed by real {tool} agents.',
  ],
  authorGroup: ['Penulis', 'Author'],
  stackGroup: ['Teknologi', 'Technology'],
};
