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
npm test         # 72 test: layout, navigasi, autopilot, siklus waktu, agen, layar, scene, chat, presence, server
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
src/
  chat/
    chat.ts         controller jendela chat, streaming SSE, sesi, permission, composer
    client.ts       wrapper fetch ke /api/chat
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

- **Buka folder** — telusuri drive/folder, tempel path langsung (`C:\...` atau `~/...`), atau pilih dari recents. Folder harus sudah ada dan bisa dibaca.
- **Sesi** — dropdown sesi bisa dicari dan memuat riwayat OpenCode untuk folder tersebut; tombol `＋` membuat chat baru.
- **Model & agent** — dropdown model bisa dicari berdasarkan nama model atau provider; daftarnya diambil dari provider yang terhubung di OpenCode. Pilihan terakhir disimpan di browser, default mengikuti `model` di config OpenCode.
- **Streaming** — teks, tool call, status busy/retry, error, dan hasil tool tampil real-time lewat SSE. Tool call yang butuh izin memunculkan kartu **Izinkan / Selalu izinkan / Tolak**; pertanyaan agent memunculkan pilihan jawaban.
- **Render jawaban** — teks agent dan user dilewatkan parser markdown (heading, daftar bersarang, task list, tabel, kutipan, `kode` inline, blok kode) yang disanitasi DOMPurify. Blok ` ```mermaid ` digambar menjadi diagram atau chart (flowchart, sequence, gantt, pie, xychart, dan tipe lain) lengkap dengan tombol perbesar — panel zoom bisa ditutup lewat `Esc` atau klik latar — plus tombol salin kode. Mesin mermaid dipecah sebagai chunk terpisah dan baru dimuat saat blok diagram benar-benar muncul.
- **Stop** — tombol kirim berikon panah otomatis berganti menjadi kotak stop (merah) selagi sesi berjalan, lalu kembali jadi panah saat OpenCode selesai; satu tombol ikon tanpa teks.
- **Perbesar** — jendela chat bisa diperbesar melebar penuh satu layar; klik ikon restore (atau seret jendela) untuk mengembalikan ukuran mengambang.
- **Kantor** — jumlah karyawan mengikuti `roster` agent OpenCode di workspace. Setiap ~3 detik (dan setiap ada event sesi) server ditanya sesi mana yang busy, lalu `presence` menentukan kursinya: sesi biasa → meja kerja, sesi yang punya anak busy → ruang meeting bersama anak yang didelegasi. Di atas kepalanya muncul bubble berisi potongan aktivitas aslinya (`Mikir: …`, `Nulis: …`, `Membaca file: README.md`) yang diambil dari `/api/chat/activity`; kalau belum ada yang bisa dikutip, bubble berubah jadi pil titik-titik. Chip header menampilkan fase run sesi yang sedang dibuka beserta hitungan waktu. Saat sesi selesai, karyawan dilepas kembali ke autopilot.

Workspace dan recents disimpan di `.virtoffice/workspace.json` (gitignored). Bridge menjalankan `opencode serve --hostname 127.0.0.1 --port 0` dan mengarahkan setiap request ke folder aktif lewat query `directory`, sehingga config, `AGENTS.md`, dan tool OpenCode mengikuti proyek yang dibuka.

### API server

| Method | Path | Fungsi |
| --- | --- | --- |
| GET | `/api/health` | status server + OpenCode |
| GET/POST | `/api/workspace` | baca / buka workspace |
| GET | `/api/workspace/browse?path=` | isi folder (tanpa file, dot-dir, `node_modules`) |
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
