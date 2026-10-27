import type { Catalog } from '../types';

/** Halaman Mobile: QR dan URL LAN supaya app bisa dibuka dari ponsel. */
export const mobile: Catalog = {
  title: ['Buka di ponsel', 'Open on your phone'],
  intro: [
    'Pindai QR ini dari ponsel yang tersambung ke Wi-Fi yang sama.',
    'Scan this QR from a phone on the same Wi-Fi network.',
  ],
  loading: ['Menyiapkan alamat…', 'Preparing the address…'],
  qrAria: ['Kode QR untuk membuka VirtOffice dari ponsel', 'QR code to open VirtOffice on a phone'],
  howTo: ['Cara membuka', 'How to open'],
  hint: [
    'Pindai QR dengan kamera ponsel, atau ketik alamat di atas di browser ponsel. Jika halaman tidak terbuka, izinkan Node.js masuk lewat firewall Windows.',
    'Scan the QR with the phone camera, or type the address above into the phone browser. If the page does not load, allow Node.js through the Windows firewall.',
  ],
  warningTitle: ['Hati-hati', 'Careful'],
  warning: [
    'Alamat ini membuka chat, file, terminal, dan git ke semua perangkat di jaringan yang sama. Pakai hanya di jaringan yang tepercaya.',
    'This address exposes chat, files, terminal, and git to every device on the same network. Only use it on a trusted network.',
  ],
  refresh: ['Perbarui alamat', 'Refresh address'],
  others: ['Alamat lain di mesin ini', 'Other addresses on this machine'],
  noAddress: [
    'Tidak ada alamat LAN yang terdeteksi. Sambungkan komputer ini ke Wi-Fi atau kabel, lalu perbarui.',
    'No LAN address was detected. Connect this computer to Wi-Fi or Ethernet, then refresh.',
  ],
  loopback: [
    'Server hanya mendengarkan {bind}, jadi ponsel tidak bisa menjangkaunya. Jalankan ulang tanpa mengatur HOST.',
    'The server only listens on {bind}, so a phone cannot reach it. Restart without setting HOST.',
  ],
};
