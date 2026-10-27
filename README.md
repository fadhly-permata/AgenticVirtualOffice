# VirtOffice — Kantor Isometrik 2.5D + OpenCode

Diorama kantor bergaya isometrik yang dibangun penuh dengan Three.js, tanpa aset 3D eksternal. Empat ruangan — **Ruang Kerja**, **Ruang Meeting**, **Pantry**, dan **Ruang Santai** — dihuni 2–15 karyawan low-poly (default 5) yang bekerja, ngopi, meeting, main game, dan menonton TV. Pencahayaan bergerak mengikuti siklus pagi–siang–sore–malam.

Selain auto-play, aplikasi ini sekarang punya **pemilih folder workspace** dan **jendela chat OpenCode**. Chat terhubung ke OpenCode CLI lokal lewat bridge HTTP di `127.0.0.1`, mendukung streaming teks, reasoning langsung, tool call, permission, pertanyaan agent, serta stop. Karyawan di kantor disusun dari daftar agent OpenCode workspace (bukan nama demo lagi) dan posisi mereka mengikuti sesi yang benar-benar berjalan: yang sedang bekerja duduk di meja, yang mendelegasi dan yang didelegasi duduk di ruang meeting.

## Prasyarat

- Node.js 20+ dan npm.
- OpenCode CLI terpasang dan sudah punya provider/model yang terhubung:

```bash
npm i -g opencode-ai
opencode auth login
```

## Menjalankan

```bash
npm install
npm run dev      # bridge + Vite di http://127.0.0.1:5199
npm run build    # typecheck + production build ke dist/
npm start        # menyajikan dist/ + API di http://127.0.0.1:4180
npm test         # 112 test: layout, navigasi, autopilot, siklus waktu, agen, layar, chat, presence, server, file workspace, terminal
```

`npm run dev` menjalankan server Node lokal (bukan `vite` langsung). Server yang sama melayani API, proxy event OpenCode, dan Vite dev middleware. Port dev sengaja jauh dari 5173 supaya Vite yang lupa dimatikan tidak bisa menyamar jadi bridge ini (gejalanya: `/api/*` dijawab HTML). Untuk port lain:

```bash
npm run dev -- --port 5299
```

Jumlah agent diatur lewat query `?agents=N` (dibatasi ke 2–15, default 5):

```bash
http://127.0.0.1:5199/?agents=2
http://127.0.0.1:5199/?agents=15
```

Roster demo berisi 15 agent dengan spot awal unik. Ruang kerja punya sepuluh meja dalam dua baris, jadi sepuluh agent pertama langsung terlihat bekerja; lima sisanya dibagikan autopilot ke meeting, pantry, dan lounge. Begitu workspace OpenCode dimuat, roster ini diganti oleh agent asli dari workspace (maksimal 15, sesuai jumlah kursi).

Kamera isometrik memakai `OrthographicCamera` dan bisa di-orbit terbatas di sekitar diorama.

## Yang ada di scene

- **Ruang Kerja** — sepuluh meja dalam dua baris, masing-masing dengan monitor yang mengetik baris kode acak saat agen bekerja dan meredup bersih saat idle, kursi roda, rak buku, tanaman, jam dinding, dan jendela.
- **Ruang Meeting** — meja 6 kursi, laptop, papan tulis, dan dinding kaca.
- **Pantry** — counter dengan coffee machine (uapnya beranimasi), sink, kulkas, dispenser, meja bundar dengan stool, dan ubin lantai.
- **Ruang Santai** — sofa, bean bag, TV dengan delapan slide berganti-ganti plus transisi static, konsol game, karpet, lampu lantai, dan tanaman.
- **Siklus waktu** — matahari terbit/terbenam, warna langit, lampu gantung menyala dengan halo saat gelap, dan TV menerangi ruangan di malam hari.
- **Material** — pencahayaan berbasis lingkungan (IBL) untuk pantulan logam/kaca, tekstur kayu & kain, lantai papan/ubin dengan variasi nada, dan contact shadow di bawah perabot.
- **Agen** — berjalan mengikuti graph navigasi, duduk di kursi/sofa, mengetik, menyeruput kopi, memegang controller, dan melihat layar.

## Struktur

```
server/
  index.mjs         HTTP server, routing API, SSE proxy, Vite middleware / static dist
  http.mjs          helper JSON body, error, dan response
  opencode.mjs      proses `opencode serve`, katalog model/agent/sesi, event stream
  workspace.mjs     validasi folder, browse direktori, simpan workspace + recents
  files.mjs         pohon file, baca/tulis/hapus, pencarian — terkunci di dalam workspace
  terminal.mjs      shell lewat child_process + pipe (tanpa PTY), max 6 sesi, SSE per terminal
src/
  chat/
    chat.ts         controller jendela chat, streaming SSE, sesi, permission, composer
    client.ts       wrapper fetch ke /api/chat
    files.ts        halaman File List: pohon, pratinjau, CRUD, pencarian
    scm.ts          halaman Source Control: status, diff, commit, branch, riwayat
    settings.ts     halaman Pengaturan: bahasa, tema, pratinjau, jeda agen
    about.ts        halaman Tentang: identitas aplikasi, penulis, tautan
    terminal.ts     halaman Terminal: tab ganda xterm.js, mode echo per shell, SSE
    state.ts        reducer event OpenCode + helper format
    folder.ts       modal pemilih folder workspace
    types.ts        tipe payload chat
    dom.ts          helper elemen + ikon SVG
    markdown.ts     render markdown jawaban + diagram mermaid
  core/
    dayNight.ts     jam simulasi, faktor siang/malam, warna langit
    math.ts         clamp, smoothstep, damping sudut
    palette.ts      palet warna + cache material
    textures.ts     tekstur prosedural (kayu, kain, plester, halo lampu, contact shadow, slide TV)
    textBubble.ts   bubble teks di atas kepala karyawan (canvas 2D → sprite)
    typing.ts       simulasi baris kode yang mengetik sendiri untuk monitor
  world/
    layout.ts       denah 4 ruangan, daftar spot, node & edge navigasi
    nav.ts          graph berbobot + Dijkstra
    kit.ts          helper geometri (box, rounded box, silinder, bola)
    office.ts       pembangunan seluruh diorama + lighting + animasi ambient
  agents/
    character.ts    rig karyawan low-poly (dua segmen kaki, lengan, mug, gamepad)
    agent.ts        state machine, path following, pose prosedural
    autopilot.ts    penjadwal aktivitas berbobot
    activities.ts   label, durasi, bobot aktivitas per waktu
    seeds.ts        roster 15 karyawan, batas jumlah agent, dan posisi awal unik
  office/
    presence.ts     daftar agent + status sesi → peran tiap karyawan (working/delegating/delegated/idle)
  api.ts            jembatan window.virtOffice
  main.ts           renderer, kamera, HUD, loop, pemasangan chat
tests/              vitest (scene, chat reducer, helper server)
```

## Mengubah denah

Semua koordinat ada di `src/world/layout.ts`:

- `ROOMS` — pembagian empat kuadran 13 × 10.5.
- `PARTITIONS` — dinding interior beserta celah pintu; test memastikan tidak ada edge navigasi yang menembus dinding di luar pintu.
- `SPOTS` — titik aktivitas (`activity`, posisi, arah hadap, tinggi duduk).
- `AISLES` + `EDGES` — graph pergerakan. Setiap spot otomatis mendapat node `s:<id>`.

Setelah menambah spot, tambahkan juga edge ke aisle terdekat, lalu jalankan `npm test` — test konektivitas dan pintu akan menangkap kesalahan.

## Workspace & chat OpenCode

Klik pill **OpenCode** di kanan bawah untuk membuka chat. Kalau belum ada workspace, modal folder langsung muncul; kalau sudah ada, chat memakai workspace terakhir.

- **Buka folder** — telusuri drive/folder, tempel path langsung (`C:\...` atau `~/...`), atau pilih dari recents. Folder harus sudah ada dan bisa dibaca. Nama folder aktif tampil di batang judul chat dan di peluncur; path lengkapnya muncul di tooltip keduanya dan ditulis utuh di puncak halaman File List.
- **Sesi** — dropdown sesi bisa dicari dan memuat riwayat OpenCode untuk folder tersebut; tombol `＋` membuat chat baru.
- **Model & agent** — dropdown model bisa dicari berdasarkan nama model atau provider; daftarnya diambil dari provider yang terhubung di OpenCode. Pilihan terakhir disimpan di browser, default mengikuti `model` di config OpenCode. Panel pemilih di atas halaman Agentic memakai dua kolom — **Sesi** selebar baris pertama, **Model** dan **Agent** berbagi baris kedua — dan dipisah dari jendela chat oleh garis bawah, bukan nempel ke daftar pesan.
- **Streaming** — teks, tool call, status busy/retry, error, dan hasil tool tampil real-time lewat SSE. Tool call yang butuh izin memunculkan kartu **Izinkan / Selalu izinkan / Tolak**; pertanyaan agent memunculkan pilihan jawaban.
- **Render jawaban** — teks agent dan user dilewatkan parser markdown (heading, daftar bersarang, task list, tabel, kutipan, `kode` inline, blok kode) yang disanitasi DOMPurify. Blok ` ```mermaid ` digambar menjadi diagram atau chart (flowchart, sequence, gantt, pie, xychart, dan tipe lain) lengkap dengan tombol perbesar — panel zoom bisa ditutup lewat `Esc` atau klik latar — plus tombol salin kode. Mesin mermaid dipecah sebagai chunk terpisah dan baru dimuat saat blok diagram benar-benar muncul.
- **Format jawaban** — kalau prompt menyebut diagram / flowchart / chart / graph / grafik / bagan / skema / visual, chat menambahkan satu kalimat instruksi di ujung prompt agar OpenCode menjawab dengan blok ` ```mermaid ` dan bukan ASCII art (model tidak tahu panel ini bisa menggambar). Instruksi sisipan dipotong lagi saat render, jadi gelembung user tetap menampilkan teks aslinya — termasuk setelah reload. Prompt tanpa kata visual tidak ikut dikirimkan instruksi.
- **Diagram gagal** — nilai persen ala model (`"Backend" : 40%` di diagram pie) dibetulkan otomatis sebelum digambar; kalau masih gagal parse, kartunya menampilkan pesan ringkas (tanpa header `Syntax error in text / mermaid version`) plus tombol salin kode dan panel **Lihat kode** berisi sumber aslinya. Node sementara mermaid (`#d<id>`) selalu dibersihkan — termasuk saat parse gagal — karena gambar error bawaan mermaid tertinggal di `document.body` dan tampil sebagai teks mentah kalau tidak.
- **Stop** — tombol kirim berikon panah otomatis berganti menjadi kotak stop (merah) selagi sesi berjalan, lalu kembali jadi panah saat OpenCode selesai; satu tombol ikon tanpa teks.
- **Perbesar** — jendela chat bisa diperbesar melebar penuh satu layar; klik ikon restore (atau seret jendela) untuk mengembalikan ukuran mengambang.
- **Tab vertikal** — rail ikon di kiri jendela membagi chat jadi enam halaman: **Agentic** (halaman chat), **File List**, **Source Control**, **Terminal**, lalu **Tentang** dan **Pengaturan** yang dipisah garis dan dipatok ke dasar rail. Halaman terakhir yang dibuka disimpan di browser dan berpindah dengan `↑`/`↓` saat rail fokus.
- **Source Control** — halaman git lengkap di dalam jendela, seperti SCM-nya VSCode. Chip branch membuka picker: daftar branch lokal (dengan `↑n ↓m` terhadap upstream) dan remote, input nama untuk membuat branch sekaligus pindah ke dalamnya, klik branch untuk pindah, dan hapus branch non-aktif dengan konfirmasi inline. Di bawahnya ada komposer pesan: `Commit (n)` hanya aktif kalau ada file yang disiapkan, `Amend` menimpa commit terakhir, `Ctrl+Enter` mengirim commit, dan `Urungkan commit` membatalkan commit terakhir dengan soft reset — isinya kembali masuk daftar *Disiapkan*, tidak ada file yang hilang. Daftar perubahan dikelompokkan jadi *Disiapkan*, *Perubahan kerja*, *Belum dilacak* — tiap baris memakai huruf porcelain (`M`/`A`/`D`/`R`/`?`) plus hitungan `+tambah −buang`. Aksi per baris muncul saat hover: `+`/`−` menyiapkan atau membatalkan stage (rename ikut sepasang supaya file asal tidak jadi hantu) dan tempat sampah membuang perubahan; tombol di header kelompok mengerjakan seluruh kelompok. Membuang selalu minta konfirmasi di dalam panel — tidak ada `confirm()` browser — dan file yang belum dilacak ikut terhapus dari disk. Panah atas/bawah di header menjalankan push/pull, tombol jam membuka 30 commit terakhir, dan baris diklik untuk membuka diff per file (tombol putar menukar versi index dan versi folder kerja, file belum dilacak digambar sebagai diff seluruhnya tambah). Semua aksi memanggil git sungguhan lewat `server/scm.mjs`, jadi isi halaman sama dengan `git status` di terminal. Folder yang bukan repo git dilaporkan sebagai pesan; path disaring sama ketatnya dengan File List dan nama branch diuji sebelum dikirim ke git.
- **File List** — pohon isi workspace aktif dengan **path lengkap workspace** di puncak halaman: folder dibuka per kebutuhan (isinya baru diambil saat diklik), file diklik untuk pratinjau isinya, dan baris daftar menampilkan ukuran. Pratinjau tidak lagi punya baris judul (nama file + ukuran + jumlah baris): nama file ada di tab, path lengkapnya di tooltip tab, dan penanda `dipotong` / `file biner` muncul di toolbar hanya kalau memang perlu. Letak jendela pratinjau diatur di **Pengaturan → Pratinjau file → Letak jendela pratinjau** — *horizontal* menumpuk di bawah daftar, *vertikal* berdampingan; mode berdampingan hanya berlaku saat jendela diperbesar (murni CSS `.chat--max`), jadi jendela sempit selalu menumpuk. Garis pemisah antara daftar dan pratinjau bisa **diseret** (kursor `row-resize` saat menumpuk, `col-resize` saat berdampingan) untuk mengatur porsi pratinjau antara 20–80%; porsinya disimpan di `virtoOffice.previewPrefs` dan ikut kembali ke bawaan lewat **Kembalikan bawaan**. Aturan yang sama berlaku untuk diff di Source Control. Aksi per baris (ganti nama, hapus) muncul saat hover; hapus meminta konfirmasi di dalam panel, bukan dialog browser. Ada tombol buat file/folder baru, muat ulang, dan pencarian nama atau isi file (dengan nomor baris + cuplikan, lalu lompat ke baris itu saat file dibuka). Semua path dikirim relatif terhadap akar workspace dan bridge menolak `..`, path absolut, drive letter, serta karakter pemisah — lihat `server/files.mjs`.
- **Sisip ke pesan** — tombol `＋` di toolbar pratinjau file menulis `@path/file.ts` ke composer lalu kembali ke tab Agentic, jadi file yang sedang dilihat bisa langsung ditunjuk ke OpenCode.
- **Terminal** — multi-tab shell (cmd, PowerShell, PowerShell 7 — yang ada di mesin) yang berjalan di folder workspace aktif. `＋` membuka tab baru dengan shell dari dropdown, `×` menutupnya; maksimal 6 shell hidup bersamaan, dan shell ikut mati saat dev server berhenti. xterm.js baru dimuat ketika tab ini dibuka, jadi halaman lain tidak ikut menanggung bundlenya.
- **Salin/tempel terminal** — blok teks lalu `Ctrl+C` (tanpa pilihan, `Ctrl+C` tetap mengirim interupsi) atau tombol Salin; `Ctrl+Shift+C` / `Ctrl+Shift+V` memaksa jalur clipboard. Tombol Tempel memakai `navigator.clipboard`; kalau browser menolak baca clipboard, muncul kolom tempel — paste ke kolom itu, `Enter`, teks masuk ke terminal dan baru jalan setelah `Enter` berikutnya. Paste multi-baris dipecah jadi satu baris per perintah.
- **Lingkungan shell** — di Windows, tiap shell dapat PATH dari registry (`HKLM\...\Session Manager\Environment` + `HKCU\Environment`, `%VAR%` ditegakkan, duplikat dibuang, variabel MSYS seperti `MSYSTEM` dihapus), bukan warisan proses dev server. Jadi tab cmd tidak ikut bisa menjalankan coreutils Git Bash. Kalau `reg query` gagal, PATH warisan yang dipakai; tooltip tab menunjukkan sumbernya. Di Linux/macOS environment diwarisi apa adanya plus `TERM=xterm-256color`.
- **Catatan terminal** — jalurnya `child_process` + pipe, bukan PTY (tanpa dependency native). Akibatnya: tidak ada sinyal Ctrl+C sungguhan, tidak ada aplikasi layar penuh (`vim`, `htop`), dan output program yang di-buffer bisa baru muncul saat process selesai. cmd memakai mode baris milik klien (backspace dan `↑`/`↓` riwayat berfungsi); PowerShell mengulang baris sendiri sehingga tombol diteruskan apa adanya — di sanalah bedanya `echo: local` dan `echo: shell`.
- **Tentang** — halaman ringkas: nama aplikasi + versi (dibaca dari `package.json` lewat `src/version.ts`) dengan satu kalimat tagline, lalu **Penulis** (Fadhly Permata, Jakarta, plus kartu tautan `github.com/fadhly-permata` dan `linkedin.com/in/fadhlypermata` yang terbuka di tab baru dengan `rel="noopener noreferrer"`) dan satu baris **Teknologi**. Tanpa paragraf penjelas; nama orang dan URL tidak diterjemahkan.
- **Kantor** — jumlah karyawan mengikuti `roster` agent OpenCode di workspace. Setiap ~3 detik (dan setiap ada event sesi) server ditanya sesi mana yang busy, lalu `presence` menentukan kursinya: sesi biasa → meja kerja, sesi yang punya anak busy → ruang meeting bersama anak yang didelegasi. Di atas kepalanya muncul bubble berisi potongan aktivitas aslinya (`Mikir: …`, `Nulis: …`, `Membaca file: README.md`) yang diambil dari `/api/chat/activity`; kalau belum ada yang bisa dikutip, bubble berubah jadi pil titik-titik. Chip header menampilkan fase run sesi yang sedang dibuka beserta hitungan waktu. Saat sesi selesai, karyawan dilepas kembali ke autopilot.

Workspace dan recents disimpan di `.virtoffice/workspace.json` (gitignored). Bridge menjalankan `opencode serve --hostname 127.0.0.1 --port 0` dan mengarahkan setiap request ke folder aktif lewat query `directory`, sehingga config, `AGENTS.md`, dan tool OpenCode mengikuti proyek yang dibuka.

### API server

| Method | Path | Fungsi |
| --- | --- | --- |
| GET | `/api/health` | status server + OpenCode |
| GET/POST | `/api/workspace` | baca / buka workspace |
| GET | `/api/workspace/browse?path=` | isi folder (tanpa file, dot-dir, `node_modules`) |
| GET | `/api/chat/tree?path=` | satu level pohon file workspace (folder dulu, lalu file) |
| GET | `/api/chat/file?path=` | isi teks file (maks 256 kB, ditandai kalau terpotong/biner) |
| GET | `/api/chat/search?q=&mode=name\|content` | cari nama file atau kata di dalam file |
| POST | `/api/chat/files` | buat file/folder (`path`, `kind`) |
| POST | `/api/chat/files/rename` | ganti nama / pindah (`from`, `to`) |
| POST | `/api/chat/files/delete` | hapus file atau folder rekursif |
| GET | `/api/chat/scm/status` | branch, upstream, commit terakhir, dan daftar perubahan (`git status`/`numstat`) |
| GET | `/api/chat/scm/diff?path=&staged=1` | diff satu file; file belum dilacak digambar sebagai diff seluruhnya tambah |
| POST | `/api/chat/scm/stage` | stage/unstage daftar path (`paths`, `staged`) — rename dikirim sepasang |
| POST | `/api/chat/scm/stage/all` | stage atau unstage seluruh perubahan sekaligus |
| POST | `/api/chat/scm/commit` | commit dengan pesan lewat stdin (`message`, `amend`); kosong tanpa amend ditolak 400 |
| POST | `/api/chat/scm/commit/undo` | `reset --soft HEAD~1`; commit pertama dibatalkan sampai repo unborn, tanpa commit sama sekali → 409 |
| POST | `/api/chat/scm/discard` | rollback per file: yang ada di HEAD dipulihkan, sisanya dihapus dari disk |
| GET | `/api/chat/scm/branches` | branch lokal (upstream + `↑n ↓m`) dan branch remote |
| POST | `/api/chat/scm/branch/switch` | `git switch` — branch remote di-checkout jadi branch lokal |
| POST | `/api/chat/scm/branch/create` | `git switch -c` (`name`, `checkout`) |
| POST | `/api/chat/scm/branch/delete` | `git branch -d`; branch aktif ditolak 400 |
| GET | `/api/chat/scm/history?limit=` | daftar commit terakhir (maks 100) |
| POST | `/api/chat/scm/push` / `pull` | kirim/ambil ke upstream; tanpa remote atau upstream → 409 |
| GET | `/api/chat/terminal/shells` | shell yang tersedia di mesin ini + mode echo-nya |
| GET | `/api/chat/terminal` | daftar sesi terminal yang masih dipegang server |
| POST | `/api/chat/terminal` | buka shell (`shell`, `cwd` — dipaksa di dalam workspace) |
| GET | `/api/chat/terminal/events?id=` | SSE output satu terminal; stream tertutup saat shell selesai |
| POST | `/api/chat/terminal/input` | kirim keystroke/baris ke stdin shell (`id`, `data`) |
| POST | `/api/chat/terminal/close` | tutup terminal dan bunuh proses shell beserta anaknya |
| GET | `/api/chat/bootstrap` | workspace, model, agent (pemilih chat), `roster` (semua agent untuk lantai kantor), sesi |
| GET | `/api/chat/status` | peta `sessionID → status` untuk presence kantor |
| GET | `/api/chat/activity?ids=a,b` | ekor pesan terakhir tiap sesi (fase, alat, potongan teks) untuk bubble kantor |
| POST | `/api/chat/sessions` | buat sesi |
| GET | `/api/chat/sessions/:id` | riwayat pesan + status + permission |
| POST | `/api/chat/sessions/:id/messages` | kirim prompt (`prompt_async`) |
| POST | `/api/chat/sessions/:id/abort` | hentikan respons |
| GET | `/api/chat/events` | SSE event OpenCode |
| POST | `/api/chat/permissions/:id` | balas izin (`once`/`always`/`reject`) |
| POST | `/api/chat/questions/:id` | balas pertanyaan agent |

Payload `/provider` tidak pernah diteruskan mentah ke browser: server hanya mengirim id/nama model dari provider yang terhubung, tanpa `key` atau `options`.

## API kantor

API global untuk mengendalikan karyawan tetap tersedia:

```js
virtOffice.agents();
// [{ id: 'build', name: 'build', activity: 'working', state: 'settled', signal: 'writing', bubble: 'Mikir: …', ... }]

virtOffice.setCrew([{ id: 'build', label: 'build' }]);   // susun ulang karyawan dari daftar agent
virtOffice.applyPresence([                                // duduk sesuai aktivitas sesi
  { agent: 'build', role: 'delegating', sessionID: 'ses_1' },
  { agent: 'explore', role: 'delegated', sessionID: 'ses_2' },
], { ses_1: 'Menjalankan subagent: cari README' });      // argumen kedua: teks bubble per sesi
virtOffice.setActivity('build', 'gaming');      // true bila berhasil
virtOffice.setAgentSignal('build', 'tool', 'Mikir: …');  // pil / bubble di atas kepalanya
virtOffice.release('build');                    // kembalikan ke autopilot (sekaligus menghapus pil)
virtOffice.setTimeOfDay(19.5);
virtOffice.setTimeScale(0);                     // bekukan waktu
```

Aktivitas yang tersedia: `working`, `meeting`, `coffee`, `gaming`, `tv`, `idle`.
Sinyal pil: `waiting`, `thinking`, `tool`, `writing`.
Peran presence: `working` (meja kerja), `delegating` + `delegated` (ruang meeting), `idle` (bebas).

Perilaku penting:

- Jumlah karyawan mengikuti `roster` dari `/api/chat/bootstrap` (maksimal 15 karena kursi terbatas); tanpa workspace, lantai kantor tetap memakai karyawan demo.
- `applyPresence` hanya memindahkan karyawan yang perannya benar-benar berubah, jadi karyawan tidak berjalan ulang tanpa perlu.
- `setActivity` memilih spot kosong untuk aktivitas tersebut, mengunci (`pinned`) agent, dan membuatnya berjalan ke sana. Agent tetap di sana sampai `release` dipanggil.
- Agent yang di-`release` akan dijadwalkan ulang oleh autopilot pada tick berikutnya.
- Setiap kali agent tiba di tujuannya, event `virtoffice:agent` dipancarkan:

```js
document.addEventListener('virtoffice:agent', (event) => {
  console.log(event.detail); // { id, name, activity, spot, room }
});
```

## Catatan teknis

- Tidak ada file model/tekstur: seluruh geometri dibuat dari primitif dan `RoundedBoxGeometry`.
- Bayangan memakai satu directional light dengan shadow map 2048; lampu ruangan memakai `PointLight` yang hanya menyala saat malam.
- Kaca partisi memakai material transparan tanpa `depthWrite` agar interior tetap terbaca dari kamera isometrik.
- Bahasa UI: Indonesia. Ubah label di `layout.ts` dan `activities.ts` bila perlu.
