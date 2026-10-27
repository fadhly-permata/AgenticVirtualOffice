# Aturan agent

Dokumen fitur ada di `README.md`; state runtime ada di `.virtoffice/` (gitignored).

## Verifikasi real-time di BE dan FE sebelum bilang "beres"

Setiap perubahan kode diuji sungguhan di kedua sisi, bukan cuma type-check dan tes unit.

**Backend** (dev server `npm run dev` → http://localhost:5199, produksi 4180):
- `npm run typecheck` dan `npm test` harus hijau.
- Panggil endpoint yang berubah lewat HTTP betulan (fetch/curl ke dev server) dan baca respons mentahnya. Jangan simpulkan bentuk respons dari kode sumber saja.
- Perubahan di `server/*.mjs` baru terpakai setelah dev server dimulai ulang. Mulai ulang dengan `netstat -ano | findstr :5199` untuk memastikan yang mati hanya proses Vite sendiri — `opencode serve` di 4096 adalah proses milik user, jangan disentuh.

**Frontend** (browser internal Qoder saja, via tool `browser-use`; Chrome/Edge eksternal dan computer-use dilarang untuk testing):
- Lakukan aksi user yang sebenarnya (klik, ketik, tempel) lalu ambil bukti dari DOM/konsol/jaringan, misalnya `title` tab, isi `.term__stage`, atau frame SSE dari `EventSource` kedua.
- `take_screenshot` sering gagal di webview (`NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`) dan repaint xterm tidak selalu terlihat — assertion DOM + tangkapan stream itu bukti yang sah.
- `navigator.clipboard` bisa ditolak di webview; kalau jalur itu yang diuji, sebut hasil fallbacknya.

**Di balasan**: kutip perintah dan output mentahnya (tabel perintah → hasil lebih baik daripada paragraf alasan). Kalau ada bagian yang tidak bisa dibuktikan, tulis eksplisit bagian mana dan mengapa.

## Gate lain

- Belum terverifikasi real-time = jangan commit, jangan lapor selesai.
- Unit yang sudah terverifikasi di-commit segera; jangan pernah `push` atau merge tanpa diminta.
- Jangan pakai `confirm()`/`prompt()` browser di UI chat — konfirmasi ada di dalam panel.
- Kalau user melaporkan perilaku yang bertentangan dengan kesimpulanmu, penjelasan pertamamu kemungkinan salah: cari mekanisme yang mereproduksi pengamatannya persis.
- Setiap perubahan kode menaikkan versi di `package.json` (`[MAJOR].[MINOR].[PATCH]`) — HUD "Versi" membacanya lewat `src/version.ts`, jadi jangan menulis nomor versi di tempat lain.

<!-- virtoffice:rules:start -->
## VirtOffice: jeda delegasi

Blok ini diatur otomatis oleh VirtOffice (jeda 2 detik) supaya animasi kantor tidak melihat subagent berdiri terlalu cepat.

- Tugas yang datang dari delegasi (`task` subagent): jalankan `sleep 2` sebelum mulai bekerja, lalu `sleep 2` lagi setelah pekerjaan selesai sebelum mengirim laporan akhir.
- Saat mendelegasikan lewat `task`, sertakan aturan jeda ini di prompt subagent.
<!-- virtoffice:rules:end -->
