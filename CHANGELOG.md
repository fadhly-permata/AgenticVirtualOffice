# Changelog

Semua perubahan penting pada VirtOffice dicatat di sini. Format mengikuti
[Keep a Changelog](https://keepachangelog.com/id/1.1.0/) dan versi mengikuti
[Semantic Versioning](https://semver.org/lang/id/).

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
