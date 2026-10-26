# VirtOffice — Kantor Isometrik 2.5D

Diorama kantor bergaya isometrik yang dibangun penuh dengan Three.js, tanpa aset 3D eksternal. Empat ruangan — **Ruang Kerja**, **Ruang Meeting**, **Pantry**, dan **Ruang Santai** — dihuni lima karyawan low-poly yang bekerja, ngopi, meeting, main game, dan menonton TV. Pencahayaan bergerak mengikuti siklus pagi–siang–sore–malam.

Tujuan akhirnya: setiap karyawan mewakili satu agent OpenCode. Saat ini animasinya berjalan sendiri (auto-play), tetapi sudah ada API siap pakai untuk mengendalikan tiap agent dari luar.

## Menjalankan

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build ke dist/
npm run preview  # menyajikan hasil build
npm test         # 23 test: layout, navigasi, autopilot, siklus waktu, agen, scene
```

Kamera isometrik memakai `OrthographicCamera` dengan sudut 45°/35.26° dan tidak bisa di-rotate — scene dibuat sebagai diorama statis.

## Yang ada di scene

- **Ruang Kerja** — lima meja dengan monitor yang menyala sesuai aktivitas agen, kursi roda, rak buku, tanaman, jam dinding, dan jendela.
- **Ruang Meeting** — meja 6 kursi, laptop, papan tulis, dan dinding kaca.
- **Pantry** — counter dengan coffee machine (uapnya beranimasi), sink, kulkas, dispenser, meja bundar dengan stool, dan ubin lantai.
- **Ruang Santai** — sofa, bean bag, TV dengan layar yang berkedip dinamis, konsol game, karpet, lampu lantai, dan tanaman.
- **Siklus waktu** — matahari terbit/terbenam, warna langit, lampu gantung menyala dengan halo saat gelap, dan TV menerangi ruangan di malam hari.
- **Material** — pencahayaan berbasis lingkungan (IBL) untuk pantulan logam/kaca, tekstur kayu & kain, lantai papan/ubin dengan variasi nada, dan contact shadow di bawah perabot.
- **Agen** — berjalan mengikuti graph navigasi, duduk di kursi/sofa, mengetik, menyeruput kopi, memegang controller, dan melihat layar.

## Struktur

```
src/
  core/
    dayNight.ts     jam simulasi, faktor siang/malam, warna langit
    math.ts         clamp, smoothstep, damping sudut
    palette.ts      palet warna + cache material
    textures.ts     tekstur prosedural (kayu, kain, plester, halo lampu, contact shadow)
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
    seeds.ts        data lima karyawan dan posisi awal
  api.ts            jembatan window.virtOffice
  main.ts           renderer, kamera, HUD, loop
tests/              vitest
```

## Mengubah denah

Semua koordinat ada di `src/world/layout.ts`:

- `ROOMS` — pembagian empat kuadran 13 × 10.5.
- `PARTITIONS` — dinding interior beserta celah pintu; test memastikan tidak ada edge navigasi yang menembus dinding di luar pintu.
- `SPOTS` — titik aktivitas (`activity`, posisi, arah hadap, tinggi duduk).
- `AISLES` + `EDGES` — graph pergerakan. Setiap spot otomatis mendapat node `s:<id>`.

Setelah menambah spot, tambahkan juga edge ke aisle terdekat, lalu jalankan `npm test` — test konektivitas dan pintu akan menangkap kesalahan.

## Integrasi dengan OpenCode (tahap berikutnya)

Saat ini tersedia API global:

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

Pola yang disarankan untuk menghubungkan OpenCode nanti: buat bridge kecil (WebSocket atau HTTP lokal) yang menerjemahkan status tool/agent OpenCode menjadi `virtOffice.setActivity(...)`, misalnya `working` saat tool dieksekusi, `meeting` saat sesi review, dan `idle`/`coffee`/`gaming` saat tidak ada tugas. API ini sengaja dipisah dari scene supaya bridge tersebut tidak perlu menyentuh kode Three.js.

## Catatan teknis

- Tidak ada file model/tekstur: seluruh geometri dibuat dari primitif dan `RoundedBoxGeometry`.
- Bayangan memakai satu directional light dengan shadow map 2048; lampu ruangan memakai `PointLight` yang hanya menyala saat malam.
- Kaca partisi memakai material transparan tanpa `depthWrite` agar interior tetap terbaca dari kamera isometrik.
- Bahasa UI: Indonesia. Ubah label di `layout.ts` dan `activities.ts` bila perlu.
