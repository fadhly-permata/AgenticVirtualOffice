# Changelog

Semua perubahan penting pada VirtOffice dicatat di sini. Format mengikuti
[Keep a Changelog](https://keepachangelog.com/id/1.1.0/) dan versi mengikuti
[Semantic Versioning](https://semver.org/lang/id/).

## [0.21.0] - 2026-11-05

### Ditambahkan

- File teks bisa disunting langsung di pane pratinjau File List, dan tidak ada yang tersimpan sendiri. `src/chat/editor.ts` memasang CodeMirror 6 yang baru dimuat saat file teks benar-benar dibuka — nomor baris, fold, bracket matching, tutup kurung otomatis, plus paket bahasa (js/ts/tsx, json, html, css, python, markdown, yaml) yang juga dilazy-load; image, PDF, pratinjau markdown, file biner, dan file terpotong tetap baca-saja.
- Toolbar pratinjau mendapat **Urungkan**, **Ulangi**, **Simpan (Ctrl+S)**, dan **Cari & ganti** (panel `Ctrl+F` dengan match case / regexp / per kata / replace / replace all). Ikon `save`, `undo`, `redo` ditambahkan ke `ICON` di `src/chat/dom.ts`.
- Riwayat undo/redo adalah stack snapshot milik aplikasi, bukan `history()` CodeMirror, jadi tombol toolbar tetap bekerja saat fokus sedang di pohon file atau composer. Ledakan ketik dalam 600 ms diringkas jadi satu langkah; Save sengaja tidak menambah langkah, sehingga mengurut setelah simpan mengembalikan suntingannya dan menandai tab dirty lagi.
- Titik dirty di tab (`.viewer__tab-dot`) dan status posisi di bar toolbar: `baris N·kolom M — K baris — +a −b`, angkanya dihitung `lineDelta()` terhadap isi di disk.
- Meninggalkan tab yang belum disimpan bertanya lewat dialog, bukan diam-diam: **Batal / Buang / Simpan & lanjut** saat klik baris lain atau menutup tab; menutup pratinjau menyebut semua file yang belum ditulis (`viewer.unsavedMany`).
- Deteksi file berubah di disk: `GET /api/chat/file` ikut mengirim `mtime`, dan kalau `POST /api/chat/files/save` menemukan disk sudah bergerak (409) FE membuka dialog **Batal / Muat ulang / Timpa** — tulisan agent yang mendarat di tengah ketikan tidak lagi tertimpa tanpa kabar.
- `saveFileAt()` di `server/files.mjs`: tulis atomik lewat file sementara + `rename`, plafon 2 MB, menolak path kosong, teks non-string, folder, file hilang, dan path di luar workspace. Body save diizinkan sampai 4,2 MB (`MAX_SAVE_BODY_BYTES`) karena escaping JSON bisa membengkak.
- `chatApi.saveFile(path, text, baseMtime)` di `src/chat/client.ts`; tipe `FileContent` bertambah `mtime`.
- Pemisah baris bertahan: dokumen internal selalu LF (`toLF`), pemisah asli diingat (`separatorOf`) dan dipasang lagi saat menulis. Sebelumnya `lineSeparator` CodeMirror membuat tempelan teks LF di file CRLF jadi karakter asing di tengah baris dan menghasilkan berkas campur.
- Dependensi baru: `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/search`, `@codemirror/autocomplete`, tujuh paket bahasa, dan `@lezer/highlight` (dipakai langsung untuk peta tag → kelas CSS).
- Teks dua bahasa baru di `src/i18n/ns/viewer.ts`: `save`, `saved`, `undo`, `redo`, `findReplace`, `editStatus`, `unsaved*`, `conflict*`.
- Tes unit: `tests/editor.test.ts` (14 kasus untuk `toLF`, `separatorOf`, `lineDelta`) dan blok `save` di `tests/files.test.mjs` (7 kasus: tulis + ukuran/mtime, kesetiaan byte CRLF, 409 saat `baseMtime` tertinggal, tulis tanpa `baseMtime`, penolakan, 413 tanpa sisa file sementara, dan 404 saat induknya hilang).

### Berubah

- `showError()` sekarang satu kasus dari `showDialog(title, text, buttons)` — shell kartu `.modal__card--alert` dengan baris tombol berlabel dan satu tombol menonjol (`files__dialog-actions`, `files__dialog-btn--go`), dipakai bersama oleh error dan konfirmasi.
- Panel Cari & Ganti ikut bahasa UI lewat `EditorState.phrases`, dan token CodeMirror dipetakan ke kelas `.tok-*` milik tema (`tokenStyle()`), jadi warna sintaksis di editor sama dengan pratinjau baca-saja — `defaultHighlightStyle` bawaan memakai kelas acak berwarna terang yang nyaris tidak terbaca di latar gelap.
- `trimTabs()` tidak lagi membuang tab yang isinya belum disimpan; `setWorkspace` menutup semua draft bersama workspace lama, dan preferensi `lineNumbers` / `syntax` dikonfigurasi ulang tanpa membangun editor dari nol.

## [0.20.0] - 2026-11-05

### Berubah

- Papan klip File List sekarang bekerja tanpa suara. Menandai Copy/Cut tidak lagi menulis pesan apa pun dan tidak lagi memunculkan bar "chip" di bawah toolbar — yang tersisa cuma baris yang redup (untuk Cut) dan tombol Tempel yang ikut aktif. Panel chip beserta seluruh pesannya (`clipModeCopy`, `clipModeCut`, `clipLabel`, `clipHint`, `clipCopied`, `clipCut`, `clipCleared`) dihapus dari `src/style.css` dan `src/i18n/ns/files.ts`; hasil copy/move yang sukses juga diam (`copiedTo`/`movedTo` dihapus, `transferItem()` tidak menulis pesan lagi).
- Tiap kegagalan di File List tampil sebagai dialog popup, bukan satu baris teks yang mudah terlewat: `showError()` di `src/chat/files.ts` memasang shell `.modal` yang sudah ada (milik folder picker) dengan pesan plus satu tombol **Tutup**; `Esc` atau klik backdrop menutupnya. Dipakai di 10 titik — nama path ditolak server, rename/hapus/pindah gagal, tempel ke folder asal, pratinjau file yang hilang, error pencarian, gagal baca file, gagal salin text, dan batch unggah yang ditolak. Cuma satu kartu yang boleh muncul sekaligus supaya seretan 200 file tidak menumpuk 200 dialog.
- `noSelection` (belum ada baris yang diklik saat shortcut papan klip ditekan) ikut pindah ke dialog karena ia memang penolakan, bukan informasi.

### Ditambahkan

- Kelas `.modal__card--alert`: kartu dialog selebar `min(420px, 100%)` dengan tombol **Tutup** rata kanan (`files__error-ok`), khusus untuk pesan satu-dua kalimat. Ditulis dua kelas (`.modal__card.modal__card--alert`) supaya menang atas definisi `.modal__card` yang letaknya jauh di bawah di `src/style.css`.
- Teks dua bahasa `files.errTitle` ("Gagal" / "Failed") dan `files.errClose` ("Tutup" / "Close").

## [0.19.0] - 2026-11-05

### Ditambahkan

- Folder dari Explorer sekarang ikut terunggah, tidak lagi dilewati. Item drop dibaca lewat `webkitGetAsEntry()` lalu direkursi (`walk` di `src/chat/files.ts`): `docs/img/logo.txt` mendarat di path yang sama di bawah folder tujuan, dan cabang kosong (`docs/empty`) tetap dibuat lewat `createFile(..., 'folder')` supaya strukturnya utuh. Drop di atas baris folder memakai folder itu sebagai tujuan; drop di atas baris file memakai induknya — sama seperti seretan di dalam aplikasi.
- `readDir()` mengulang `readEntries()` sampai batch kosong, karena Chromium hanya mengembalikan maksimal 100 entri per panggilan — folder dengan lebih dari 100 isi tidak lagi terpotong diam-diam.
- Batas satu seretan: `MAX_DROP_FILES = 200`. Sisa entri tidak dibaca, dan pesannya menyebutkan di berapa file berhenti (`files.uploadCapped`).

### Berubah

- `files.uploadFolders` (pesan "folder dilewati") dihapus, diganti `files.uploadCapped`.

## [0.18.1] - 2026-11-05

### Berubah

- Bar pencarian File List sekarang tersembunyi secara bawaan (`filesSearch: false` di `DEFAULT_PREFS`) supaya pohon mendapat seluruh tinggi panel; icon **Cari** menampilkannya dan pilihan itu tetap diingat. `Settings → Restore defaults` ikut mengembalikan ke kondisi tersembunyi ini.

## [0.18.0] - 2026-11-05

### Ditambahkan

- Baris File List sekarang memakai tanda status git seperti Explorer VSCode: huruf `M`/`A`/`D`/`R`/`C`/`U` di ujung kanan dan warna nama ikut status (amber berubah, hijau baru/untracked, merah terhapus, biru rename/salin). Folder tidak dapat huruf tapi ikut warna anak paling penting di dalamnya, jadi direktori yang diutak-atik agent terlihat tanpa harus dibuka.
- `src/chat/gitmarks.ts` (`statusLetter` + `marksFor`): memetakan `ScmFile` hasil `GET /api/chat/scm/status` menjadi path → huruf, lengkap dengan pewarisan ke induk. Ditutupi 14 tes di `tests/gitmarks.test.ts`, termasuk kolom porcelain berupa spasi literal.
- Tanda disegarkan otomatis tiap 6 detik selagi halaman File List terlihat (`root.offsetParent`), dan seketika setiap kali pohon di-`invalidate()` — muat ulang, ganti workspace, buat/ganti nama/hapus/pindah/tempel/unggah. Tooltips hurufnya ada di namespace `files` (`gitM`…`gitU`), dua bahasa.

### Berubah

- Pembatas toolbar File List sekarang satu di antara grup, bukan satu di antara setiap icon: `[cari · muat ulang] | [salin · potong · tempel] | [file baru · folder baru]` — dua garis, bukan enam.

### Diperbaiki

- `setWorkspace()` memakai `invalidate()` alih-alih `children.clear()` dan mengosongkan `gitMarks` lebih dulu, supaya tanda dari workspace lama tidak menempel di baris workspace baru.

## [0.17.0] - 2026-11-05

### Ditambahkan

- Toolbar File List lengkap terlihat: icon **Cari** (sejajar dengan **Muat ulang**) menampilkan/menyembunyikan bar pencarian, dan **Salin** / **Potong** / **Tempel** sekarang punya tombol sendiri di samping menu kanan-klik dan `Ctrl+C`/`Ctrl+X`/`Ctrl+V`. **Tempel** otomatis redup selama belum ada yang ditandai. Setiap icon dipisahkan pembatas tipis (`files__sep`) supaya tujuh button tidak terbaca sebagai satu gumpalan.
- Status tampil/sembunyi bar pencarian disimpan di `virtoOffice.previewPrefs` (`filesSearch`), jadi tetap seperti terakhir kali setelah halaman dimuat ulang.

### Diperbaiki

- Baris petunjuk "Seret baris ke folder…" di bawah toolbar dihapus; teksnya memakan satu baris penuh di panel yang sempit dan informasinya sudah ada di README.
- `onlyRatioChanged` di `src/chat/prefs.ts` diganti `changedKeys()`: pemeriksaan "perubahan kecil apa yang tidak perlu menggambar ulang pane" sekarang satu mekanisme (rasio split dan tampil/sembunyi pencarian sama-sama tidak lagi mereset posisi gulir pohon).

## [0.16.0] - 2026-11-05

### Ditambahkan

- File dari Explorer bisa dijatuhkan ke pohon File List untuk diunggah. Baris di bawah kursor menentukan folder tujuan (baris file berarti induknya; latar kosong berarti akar workspace), nama yang sudah dipakai menjadi `a (2).txt`, dan beberapa file dalam satu seretan dikirim berurutan dengan baris progres. Folder yang ikut dijatuhkan dihitung lalu dilewati dengan pesan, bukan diunggah setengah.
- `POST /api/chat/files/upload?path=` (`writeUpload` di `server/files.mjs`): satu berkas per permintaan, body biner dialirkan langsung ke disk lewat `for await` tanpa parser multipart, dipanggil dari `chatApi.uploadFile` dengan `content-type: application/octet-stream`. Batas 50 MB (413), folder dengan nama yang diminta 409, `..`/path absolut/ nama kosong 400, dan berkas parsial dihapus bila stream putus atau client pergi di tengah jalan.

### Berubah

- Seretan `Files` dari luar aplikasi tidak lagi ditolak diam-diam seperti di 0.15.0 — sekarang ia diunggah. Penahan `dragover`/`drop` level dokumen dipasang supaya lepassan yang meleset dari pohon tidak membuat browser membuka file itu dan menghapus halaman aplikasi.

## [0.15.0] - 2026-11-05

### Ditambahkan

- File List bisa menyalin, memotong, dan menempel file/folder. Satu baris ditandai lewat menu kanan-klik (Salin/Potong/Tempel ke …) atau `Ctrl+C`/`Ctrl+X`/`Ctrl+V` selama halaman itu yang tampil; chip di bawah toolbar menyimpan tandanya, tombol **Tempel** di chip menempel ke folder terpilih, dan baris yang dipotong dibuat redup. Pindah memakai `POST /api/chat/files/rename` yang sudah ada; salin memakai endpoint baru `POST /api/chat/files/copy` (`copyEntry` di `server/files.mjs`, rekursif lewat `fs.cp`). Menempel hasil salin ke folder asalnya tidak lagi menabrak: tujuannya dinamai ulang otomatis menjadi `a (2).ts` / `docs (2)` (`unique`), dan menandai ulang `a.ts` menghasilkan `a (3).ts`.
- Baris File List bisa diseret ke folder untuk memindah; tahan `Ctrl` saat melepas untuk menyalin. Folder tujuan disorot selama seretan (`files__row--drop`), latar pohon menerima lepas untuk tujuan akar workspace, dan seretan dari luar aplikasi (tipe `Files`) tidak diterima supaya halaman tidak berpindah ke file itu.
- Penjaga path berlaku untuk kedua jalur: folder tidak bisa dipindah atau disalin ke dalam dirinya sendiri/cabangnya (400), sumber yang hilang 404, tujuan yang sudah ada 409, dan `..`/path absolut tetap ditolak `resolveInside`. Menempel hasil potong ke folder yang sama hanya menampilkan "Sudah ada di folder itu." tanpa mengubah disk.

## [0.14.6] - 2026-11-04

### Ditambahkan

- Jawaban Claude dan Qoder mengalir token per token. Keduanya di-spawn dengan `--include-partial-messages` dan bingkai `stream_event` diterjemahkan `server/partial.mjs` menjadi `message.part.updated` + `message.part.delta`, jadi gelembung muncul lebih dulu lalu terisi selagi giliran berjalan. Sebelumnya jawaban baru terlihat utuh di akhir giliran karena bridge hanya membaca event `assistant`. ID part yang dihasilkan (`<messageID>:t<index>` dan `:r<index>`) sama dengan punya `assistantParts`, jadi blok final hanya menambal teks yang sudah ada, tidak menambah gelembung kedua.
- Perintah `/stop` di composer. Ia menekan tombol merah yang sama lewat `stopResponse()`, tidak pernah terkirim sebagai prompt; saat tidak ada sesi yang berjalan panel menampilkan "No session is running.".
- Sesi percakapan bisa dihapus. Tombol sampah di kepala chat butuh dua klik (jeda 4 detik kembali sendiri), lalu `DELETE /api/chat/sessions/:id` memanggil abort bridge, menghapus transkrip JSONL milik sesi, dan menyiarkan `session.deleted`.

### Diperbaiki

- Lantai kantor tetap terisi untuk OpenCode. `GET /session/status` OpenCode hanya berisi `{type: "busy"}` tanpa pemilik sesi, jadi `withSessionOwners()` di `server/status.mjs` melengkapinya dari `GET /session` (agent dan parentID) sebelum `/api/chat/status` dikirim. Giliran `retry` ikut dihitung sibuk.
- Chip karyawan di kantor ikut menampilkan status ulang coba, bukan lagi "bekerja": `runState()` memakai label `chat.statusWaitRetry` selama `noticeKind === "retry"`, dan baris status chat menampilkan teks yang sama.
- Sesi yang dihapus saat giliran masih berjalan tidak lagi lahir kembali. Proses CLI yang sedang dimatikan menulis ulang transkripnya setelah `fs.rm` pertama, jadi `#deleteSession` menandai id di `#purged`; `#listSessions` melewati id itu dan menyapu file hantunya di daftar berikutnya.

## [0.14.5] - 2026-11-04

### Diperbaiki

- Katalog model tidak lagi tertukar antar tool. Cache katalog di server dulu hanya dipisah per folder kerja, jadi `/provider` milik tool lama yang selesai *setelah* ganti tool tetap menulis hasilnya ke cache dan dropdown menampilkan model tool sebelumnya sampai 5 menit (giliran Claude lalu diam-diam memakai `sonnet` karena id model asing diabaikan bridge). Cache sekarang keyed `tool|folder` dan kunci itu sudah ditentukan saat permintaan dimulai, sehingga jawaban terlambat hanya bisa mendarat di entri tool aslinya.

## [0.14.4] - 2026-11-04

### Diperbaiki

- Lantai kantor tidak lagi mati saat Claude/Qoder sedang bekerja. `GET /session/status` pada kedua bridge sekarang membawa `agent` dan `parentID` tiap sesi sibuk, dan `sessionActivities` memakainya sebagai sumber utama lalu melengkapi sesi sibuk yang tidak ada di daftar percakapan. Sebelumnya kursi hanya bisa diisi lewat event `session.updated`/`session.created`, jadi satu event yang hilang (stream SSE belum tersambung, `#emit` tanpa subscriber, atau sesi lama yang dipulihkan dari disk) membuat semua karyawan `idle` sementara panel chat tetap sibuk.

## [0.14.2] - 2026-10-28

### Diperbaiki

- Pesan `session.error` Qoder tidak lagi generik: bridge membaca `result`, `errors[]`, `api_error_status`, lalu `stderr` terakhir, dan menambahkan petunjuk untuk dua kasus nyata — katalog model Qoder yang berubah di tengah giliran ("The selected Qoder model definition changed") dan slash command seperti `/model` yang tidak didukung mode headless.

## [0.14.1] - 2026-10-28

### Ditambahkan

- Script `launch-dev.bat` / `launch-dev.sh` kini mematikan lebih dulu proses yang masih listening di port 5199 sebelum menyalakan server baru, dan pasangannya `stop-dev.bat` / `stop-dev.sh` menghentikan pohon proses tersebut. Script hanya menyasar PID pemilik port target, jadi `opencode serve` milik user di port 4096 tidak tersentuh.

## [0.14.0] - 2026-10-28

### Ditambahkan

- Adapter **Qoder** sebagai tool agentik ketiga: bridge `server/qoder.mjs` memakai protokol `-p --input-format stream-json --output-format stream-json`, sesi `--session-id`/`--resume`, izin tool lewat `control_request`/`control_response` stdio, pertanyaan `AskUserQuestion`, interrupt, dan subagent — seluruhnya diverifikasi langsung terhadap Qoder CLI 1.1.80.
- Pilihan tool membaca `VIRTOFFICE_TOOL=qoder`; katalog HUD menampilkan Qoder dengan model Auto/Ultimate/Fast/Efficient/DeepSeek-Flash/Qwen3.8-Flash, dan aturan workspace Qoder ditulis ke `AGENTS.md`.
- Spawn Qoder di Windows memakai dispatcher JS paket npm (`qoder-npm-dispatcher.cjs`) karena Node tidak bisa menjalankan shim `.cmd`; env SDK Qoder Desktop dibersihkan agar CLI tidak masuk mode SDK.

## [0.13.2] - 2026-10-28

### Diperbaiki

- Sesi Claude yang dipulihkan dari disk kini melaporkan `agent` lagi saat di-prompt, sehingga agen utama tetap mendapat kursi dan bubble di kantor setelah dev server dimulai ulang (`session.updated` dulu hanya dikirim ketika judul masih kosong).
- `#fail` (abort yang melewati batas waktu, CLI mati, atau gagal spawn) ikut menutup semua sesi subagent, jadi tidak ada karyawan hantu yang tersangkut "sibuk" di kantor setelah run gagal.

## [0.13.1] - 2026-10-28

### Diperbaiki

- Teks dan tool subagent Claude tidak lagi bocor ke transkrip induk: event sidechain yang membawa `parent_tool_use_id` diarahkan ke sesi sintetis subagent yang sama, dan sidechain tanpa sesi hidup dibuang alih-alih ditempel ke induk.
- `GET /session/:id/message` untuk sesi sintetis tidak lagi mengembalikan daftar kosong, jadi bubble agen yang menerima delegasi mengutip pekerjaannya sendiri (mis. `Running command: sleep 2`), bukan kalimat induk.

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
