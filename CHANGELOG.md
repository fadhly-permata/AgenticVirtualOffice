# Changelog

Semua perubahan penting pada VirtOffice dicatat di sini. Format mengikuti
[Keep a Changelog](https://keepachangelog.com/id/1.1.0/) dan versi mengikuti
[Semantic Versioning](https://semver.org/lang/id/).

## [0.13.0] - 2026-10-28

### Ditambahkan

- Sakelar tool agentik langsung dari HUD: pill di panel brand membuka daftar adapter (OpenCode dan Claude aktif, Kilo/Phi/OpenClaw berlabel **Segera**), lengkap dengan tampilan konfirmasi, peringatan sesi yang masih bekerja beserta tombol **Hentikan & ganti**, status penggantian, dan toast dengan **Undo** selama 6 detik.
- `GET /api/chat/tool` dan `POST /api/chat/tool` (dukungan `force` untuk menghentikan sesi yang sibuk), pilihan tool disimpan di `.virtoffice/tool.json` dan dilaporkan ulang oleh bootstrap, health, serta event SSE `tool.changed`.
- Setelah berganti tool, seluruh kontrak chat dimuat ulang dari bridge baru (sesi, model, agent, roster kantor).

## [0.10.0] - 2026-10-28

### Diubah

- Terminal memakai PTY sungguhan lewat node-pty (ConPTY di Windows), menggantikan `child_process` + pipe. Echo, backspace, riwayat panah, Ctrl+C sebagai sinyal, dan aplikasi layar penuh seperti `vim` sekarang diurus shell; mode baris buatan klien dan field `echo` per shell dihapus.
- Ukuran grid xterm dikirim ke PTY lewat `POST /api/chat/terminal/resize` setiap kali terminal di-fit; ukuran di luar 2–500 × 1–300 ditolak 400.

## [0.9.0] - 2026-10-28

### Ditambahkan

- Roster yang lebih besar dari kapasitas lantai tidak lagi hilang diam-diam: header legend menampilkan badge `+N`, dan agen tanpa kursi muncul sebagai baris **Luar lantai** dengan namanya. Tooltip dan `aria-label` badge menyebut jumlah serta daftar namanya.

## [0.8.0] - 2026-10-28

### Ditambahkan

- Panel Sesi/Model/Agent di halaman chat bisa dilipat lewat chevron di pojok kanan. Saat terlipat, panel menjadi satu baris ringkas berisi sesi · model · agent, dan pilihan tetap berlaku. Statusnya diingat di `localStorage`.
- Legend agen di HUD tetap tampil di ponsel portrait; panel ditumpuk di atas tombol launcher agar tidak bertumpuk.

### Diperbaiki

- Chat di ponsel landscape tidak lagi kehabisan ruang baca: pada viewport 844×390 area pesan bertambah dari 80px menjadi 157px saat panel dilipat, dan tinggi panel saat terbuka tidak berubah.

## [0.7.0] - 2026-10-28

### Ditambahkan

- Tab **Mobile** di rail, di atas Tentang dan dipisah garis: berisi QR dan URL LAN untuk membuka aplikasi dari ponsel di jaringan yang sama.
- `GET /api/lan`: alamat IPv4 mesin, port, status bind, dan daftar kandidat adapter.
- Server mendengarkan `0.0.0.0` secara default (sebelumnya `127.0.0.1`), dan log startup mencetak URL untuk ponsel.
- Tombol **Perbarui alamat** serta daftar alamat alternatif saat mesin punya lebih dari satu adapter fisik.
- Peringatan di halaman Mobile bahwa alamat tersebut membuka chat, file, terminal, dan git ke seluruh jaringan.
- Teks halaman Mobile dalam bahasa Indonesia dan Inggris.

### Diperbaiki

- Pemilihan alamat LAN tidak lagi mendahulukan adapter virtual (Hyper-V, WSL, VPN) di atas adapter fisik; adapter fisik tetap dipilih meski IP-nya publik.
- Garis pemisah tab Mobile–Tentang ditempatkan di tengah celah rail, bukan menempel di dasar tombol Mobile.

### Catatan

- Karena bind ke `0.0.0.0`, API bisa dijangkau perangkat lain di jaringan lokal tanpa autentikasi. Firewall Windows mungkin perlu mengizinkan Node.js untuk koneksi masuk.
