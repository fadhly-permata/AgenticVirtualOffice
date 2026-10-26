# VirtOffice — Kantor Isometrik 2.5D + OpenCode

Diorama kantor bergaya isometrik yang dibangun penuh dengan Three.js, tanpa aset 3D eksternal. Empat ruangan — **Ruang Kerja**, **Ruang Meeting**, **Pantry**, dan **Ruang Santai** — dihuni 2–15 karyawan low-poly (default 5) yang bekerja, ngopi, meeting, main game, dan menonton TV. Pencahayaan bergerak mengikuti siklus pagi–siang–sore–malam.

Selain auto-play, aplikasi ini sekarang punya **pemilih folder workspace** dan **jendela chat OpenCode**. Chat terhubung ke OpenCode CLI lokal lewat bridge HTTP di `127.0.0.1`, mendukung streaming teks, tool call, permission, pertanyaan agent, serta stop. Saat satu agent OpenCode bekerja, salah satu karyawan di kantor otomatis dipin ke meja kerja.

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
npm test         # 52 test: layout, navigasi, autopilot, siklus waktu, agen, layar, scene, chat, server
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

Roster berisi 15 agent dengan spot awal unik. Ruang kerja punya sepuluh meja dalam dua baris, jadi sepuluh agent pertama langsung terlihat bekerja; lima sisanya dibagikan autopilot ke meeting, pantry, dan lounge.

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
  core/
    dayNight.ts     jam simulasi, faktor siang/malam, warna langit
    math.ts         clamp, smoothstep, damping sudut
    palette.ts      palet warna + cache material
    textures.ts     tekstur prosedural (kayu, kain, plester, halo lampu, contact shadow, slide TV)
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
- **Stop** — tombol stop memanggil abort pada sesi yang sedang berjalan.
- **Kantor** — selama satu sesi bekerja, satu karyawan dipin ke aktivitas `working` (chip “X bekerja di kantor”); saat idle ia dilepas kembali ke autopilot.

Workspace dan recents disimpan di `.virtoffice/workspace.json` (gitignored). Bridge menjalankan `opencode serve --hostname 127.0.0.1 --port 0` dan mengarahkan setiap request ke folder aktif lewat query `directory`, sehingga config, `AGENTS.md`, dan tool OpenCode mengikuti proyek yang dibuka.

### API server

| Method | Path | Fungsi |
| --- | --- | --- |
| GET | `/api/health` | status server + OpenCode |
| GET/POST | `/api/workspace` | baca / buka workspace |
| GET | `/api/workspace/browse?path=` | isi folder (tanpa file, dot-dir, `node_modules`) |
| GET | `/api/chat/bootstrap` | workspace, model, agent, sesi |
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
// [{ id: 'budi', name: 'Budi', activity: 'working', state: 'settled', room: 'workspace', ... }]

virtOffice.setActivity('budi', 'gaming'); // true bila berhasil
virtOffice.release('budi');               // kembalikan ke autopilot
virtOffice.setTimeOfDay(19.5);
virtOffice.setTimeScale(0);               // bekukan waktu
```

Aktivitas yang tersedia: `working`, `meeting`, `coffee`, `gaming`, `tv`, `idle`.

Perilaku penting:

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
