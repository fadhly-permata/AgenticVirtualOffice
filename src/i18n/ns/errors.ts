import type { Catalog } from '../types';

export const errors: Catalog = {
  timeout: ['Server tidak merespons. Cek terminal dev server.', "The server isn't responding. Check the dev server terminal."],
  noLocal: ['Tidak bisa menghubungi server lokal.', 'Cannot reach the local server.'],
  requestFailed: ['Permintaan gagal ({status}).', 'Request failed ({status}).'],
  notBridge: [
    'Server ini bukan bridge VirtOffice (mengembalikan HTML, bukan JSON). Jalankan npm run dev dan buka alamat yang dicetak di terminal.',
    "This server isn't a VirtOffice bridge (it returned HTML, not JSON). Run npm run dev and open the address printed in the terminal.",
  ],
  unknown: ['{tool} mengembalikan kesalahan yang tidak dikenal.', '{tool} returned an unrecognized error.'],
};
