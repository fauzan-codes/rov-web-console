# Panduan Pengembang GCS ROV

Dokumen ini menjelaskan **bagaimana program ini bekerja di dalam** dan **cara menambah fitur** tanpa merusak yang sudah ada. Ditulis supaya orang yang baru pertama kali membaca kode bisa memahami alurnya hanya dari sini.

Dokumen lain:

| Dokumen | Isi |
|---|---|
| [README.md](../README.md) | Cara menjalankan dengan `.bat` (untuk pemula). |
| [MANUAL.md](MANUAL.md) | Cara menjalankan manual + pengecekan + diagnosa jaringan. |
| [ROADMAP.md](ROADMAP.md) | Masalah yang diketahui dan rencana pengembangan. |
| **DEVELOPER.md** (ini) | Arsitektur, alur data, kontrak antar-file, resep tambah fitur. |

---

## Daftar isi

1. [Gambaran besar](#1-gambaran-besar)
2. [Backend: cara kerjanya](#2-backend-cara-kerjanya)
3. [Frontend: cara kerjanya](#3-frontend-cara-kerjanya)
4. [Kontrak antar-file (jangan dilanggar)](#4-kontrak-antar-file-jangan-dilanggar)
5. [Peta: mau mengubah X, buka file Y](#5-peta-mau-mengubah-x-buka-file-y)
6. [Resep menambah fitur](#6-resep-menambah-fitur)
7. [Aturan penulisan kode](#7-aturan-penulisan-kode)
8. [Cara menguji perubahan](#8-cara-menguji-perubahan)
9. [Jebakan yang pernah terjadi](#9-jebakan-yang-pernah-terjadi)

---

## 1. Gambaran besar

```
 PIXHAWK ──MAVLink (UDP 14560)──┐
                                ▼
 KAMERA USB ──► [ BACKEND  gcs_server.py  (Flask, port 8080) ] ──HTTP──► [ FRONTEND (browser) ]
                  • thread MAVLink  → state{}          /telemetry          index.html + js/*.js
                  • thread kamera   → frame            /video_feed/<id>
                  • deteksi QR                         /snapshot/<id>
                  • (Jetson) RTSP                      /status, /zoom/...
```

Prinsip yang dipegang seluruh kode:

1. **Backend yang tahu semua tentang robot.** Frontend hanya menampilkan dan meminta. Frontend **tidak boleh menebak** data robot (misalnya posisi); kalau datanya tidak ada, tampilkan "menunggu".
2. **Frontend mengambil data dengan polling** (`GET /telemetry` tiap 100 ms). Tidak ada koneksi yang tetap terbuka kecuali stream video MJPEG.
3. **Mode DEV menggantikan hardware, bukan logika.** Di mode DEV hanya sumber data yang diganti (kamera sintetis, telemetri simulasi). Semua kode di atasnya sama dengan yang berjalan di Jetson. Jadi apa pun yang bekerja di mode DEV akan bekerja di Jetson, selama kontrak datanya sama.

---

## 2. Backend: cara kerjanya

File: `backend/gcs_server.py`. Dibagi menjadi 12 bagian bertanda `# ====`.

| # | Bagian | Isinya |
|---|---|---|
| 1 | Import & deteksi mode | `DEV_MODE`, import opsional (GStreamer, pyzbar, pymavlink). |
| 2 | Konfigurasi | `SERIAL_PORT`, `CAM_MAPPING`, `CAM_CONFIG`, pengaturan QR dan RTSP. |
| 3 | State global | `state{}` (data robot terbaru), zoom, flag kamera. |
| 4 | Utilitas kecil | `get_local_ip()`, dll. |
| 5 | Kamera | `CameraGrabber` (Jetson), `DevCameraGrabber` (laptop), `get_grabber()`. |
| 6 | MAVLink / telemetri | Handler per pesan, loop MAVLink asli, simulasi. |
| 7 | Pemrosesan gambar | Zoom, white balance, gamma. |
| 8 | Deteksi QR | Scan di thread terpisah, kotak hijau di video. |
| 9 | Pipeline frame | `processing_loop()` per kamera. |
| 10 | RTSP server | Hanya Jetson (butuh GStreamer). |
| 11 | Route Flask | Semua endpoint HTTP. |
| 12 | Main | Menyalakan thread dan server. |

### 2.1 Thread yang berjalan

Setelah `python gcs_server.py`, `start_background_services()` menyalakan:

| Thread | Tugas | Menulis ke |
|---|---|---|
| `mavlink_thread` | Membaca MAVLink (atau simulasi) | `state{}` |
| `processing_loop(cam_id)` ×N | Ambil frame → zoom → QR → gambar teks FPS | `_last_frames`, `_frame_sources` |
| `CameraGrabber._update` ×N | Membaca kamera terus-menerus | `grabber.frame` |
| `_scan_qr_worker` | Decode QR (sesaat, dibuat per scan) | `state["qr_data"]`, `_qr_box` |
| `rtsp_push_loop` ×N + `start_rtsp_server` | Kirim frame ke RTSP | (hanya Jetson) |
| Flask (thread utama) | Melayani HTTP | membaca `state{}` dan frame |

Aturan: **satu thread penulis per data.** `state{}` hanya ditulis `mavlink_thread` (dan `_scan_qr_worker` untuk QR). Route Flask hanya **membaca**.

### 2.2 Alur data telemetri

```
Pixhawk ──pesan MAVLink──► _run_mavlink_once()
                              │  msg.get_type()  (mis. 'ATTITUDE')
                              ▼
                       _MAVLINK_HANDLERS['ATTITUDE'] = _on_attitude(msg)
                              │  menulis
                              ▼
                          state["roll"], state["pitch"], ...
                              │  dibaca
                              ▼
                      GET /telemetry  →  JSON  →  frontend
```

Mode simulasi memakai alur yang sama, hanya sumbernya `_dev_telemetry_loop()` (DEV) atau `_fallback_simulation_loop()` (kalau `pymavlink` tidak terpasang).

### 2.3 Alur kamera

```
/dev/videoN ─► CameraGrabber (thread, selalu menimpa frame terbaru)
                    │ read()
                    ▼
            processing_loop(cam_id):  zoom → (enhance) → scan QR → gambar kotak QR → teks FPS
                    │
          ┌─────────┼───────────────┐
          ▼         ▼               ▼
   _last_frames  _frame_sources   (RTSP appsrc, Jetson)
      │  │
      │  └► /snapshot/<id>  (satu JPEG)
      └───► /video_feed/<id> (stream MJPEG)
```

Kamera **hanya dibaca satu kali** per frame, lalu hasilnya dipakai ulang untuk snapshot, MJPEG, dan RTSP. Jangan membuka kamera lagi di tempat lain.

### 2.4 Mode DEV

| Komponen asli (Jetson) | Pengganti di DEV |
|---|---|
| `CameraGrabber` (GStreamer + `nvv4l2decoder`) | `DevCameraGrabber` (gambar sintetis atau webcam laptop) |
| `_run_mavlink_once()` | `_dev_telemetry_loop()` |
| RTSP + NVENC | dimatikan |

Pemilihan terjadi di dua tempat saja: `get_grabber()` dan `mavlink_thread()`. Kalau kamu menambah sumber data baru, **sediakan juga simulasinya di mode DEV**, supaya bisa diuji tanpa robot.

### 2.5 Format JSON `/telemetry`

| Field | Satuan | Keterangan |
|---|---|---|
| `x`, `y`, `z` | meter | Posisi NED dari Pixhawk (valid kalau `pos_valid`). |
| `roll`, `pitch`, `yaw` | derajat | Orientasi. `yaw` 0–360. |
| `depth` | meter | Kedalaman terbaik yang tersedia. |
| `depth_cm` | cm | `depth × 100`. |
| `depth_pressure` | meter | Kedalaman dari sensor tekanan (0 kalau belum ada). |
| `dr_x`, `dr_y` | meter | Posisi dead reckoning (perkiraan kasar). |
| `pos_valid` | bool | `true` kalau `x`, `y` bisa dipercaya. |
| `qr_data` | objek | `target_id`, `type`, `valid`, `time`, `camera_id`. |
| `pwm` | objek | `PWM1`…`PWM6` (mikrodetik; ±1500 = diam). |
| `mavlink_connected` | bool | `true` kalau Pixhawk mengirim data. |
| `link` | string | `"connected"` atau `"reconnecting"`. |

> **Aturan kompatibilitas:** boleh **menambah** field. Jangan **mengubah nama atau satuan** field yang ada, karena frontend bergantung padanya.

---

## 3. Frontend: cara kerjanya

Folder `frontend/`. Dilayani lewat `http.server` (bukan `file://`).

### 3.1 Struktur dan ketergantungan modul

```
index.html ─ memuat ─► js/main.js ──┬─ config.js        (semua pengaturan)
            (urutan penting)        ├─ logger.js        (panel log)
                                    ├─ clock.js         (jam header)
                                    ├─ camera.js        (CAM 1/2)
                                    ├─ trajectory.js    (peta jejak)
                                    ├─ telemetry.js     (polling /telemetry)  ◄── inti
                                    ├─ status.js        (polling /status)
                                    ├─ recorder.js      (rekam)
                                    ├─ replay.js        (modal replay)
                                    ├─ session.js, storage.js, util.js
          ─ memuat ─► js/rov3d.js        (model 3D, script terpisah)
          ─ memuat ─► js/rovTopIcon.js   (ikon ROV di peta, script terpisah)
```

Aturan ketergantungan (tidak boleh ada lingkaran):

```
util, config, session   ← dasar, tidak mengimpor modul lain (selain util/config)
logger, clock, storage  ← memakai config/util/logger
camera, trajectory      ← memakai logger, storage, session
recorder                ← memakai camera, trajectory
replay                  ← memakai recorder, storage
telemetry               ← memakai trajectory, recorder, camera
status                  ← memakai camera
main                    ← memakai semuanya
```

Modul "di bawah" tidak boleh mengimpor modul "di atas". Kalau perlu memanggil ke atas, pakai **callback** (contoh: `setReplayReadyHandler()` di `recorder.js`, `onFolderChange()` di `storage.js`).

### 3.2 Alur data di frontend

```
setTimeout loop (TELEMETRY_POLL_MS)
   └► fetchTelemetry() ── GET /telemetry
          └► applyTelemetry(d)
                ├─ panel TELEMETRY (depth, roll, pitch, yaw)       → DOM
                ├─ updatePwm(d.pwm)                                 → DOM
                ├─ updateQr(d.qr_data)                              → DOM
                ├─ updateSpecs(d)    (CAMERA / GRIPPER / THRUSTER)  → DOM
                ├─ setSystemState()  (OPERATIONAL/NO PIXHAWK/OFFLINE)
                ├─ window.updateRovOrientation(...)                 → rov3d.js (model 3D)
                ├─ resolvePosition(d) → recordTrajPoint(...)        → trajectory.js (peta 2D)
                ├─ window.updateRov3DTrail(...)                     → rov3d.js (jejak 3D)
                ├─ updateDepthAlarm()
                ├─ pushCsvRow(d)                                    → recorder.js (kalau sedang rekam)
                └─ appendLog(...)  (dibatasi 1 baris/detik)
```

Request berikutnya baru dijadwalkan **setelah** yang sekarang selesai, jadi request tidak menumpuk walau jaringan lambat.

### 3.3 Memilih sumber posisi (`resolvePosition`)

| Kondisi | Mode | Sumber |
|---|---|---|
| `pos_valid` dan `x`, `y` angka | `PIXHAWK` | `x`, `y` |
| selain itu, `dr_x`, `dr_y` angka | `DR` | `dr_x`, `dr_y` |
| selain itu | `WAITING` | tidak ada |

Backend selalu mengirim `dr_x`/`dr_y` (mulai dari 0), jadi tanpa Pixhawk tampilan biasanya `DR` dengan jejak diam. `WAITING` hanya muncul kalau datanya tidak valid. `OFFLINE` ditetapkan terpisah kalau browser tidak bisa menghubungi backend.

---

## 4. Kontrak antar-file (jangan dilanggar)

Ini bagian yang paling mudah rusak diam-diam. Baca sebelum mengubah file mana pun.

### 4.1 Fungsi global `window.*` (jembatan ke file 3D)

`rov3d.js` dan `rovTopIcon.js` adalah script terpisah yang **tidak** memakai `import`/`export`. Mereka berkomunikasi lewat fungsi di `window`.

**Disediakan `rov3d.js`, dipanggil modul lain:**

| Fungsi | Parameter | Dipanggil oleh | Fungsi |
|---|---|---|---|
| `window.updateRovOrientation(roll, pitch, yaw, depth, linkOk)` | derajat, derajat, derajat, meter, bool | `telemetry.js` | Memutar model 3D, mengisi badge LIVE/NO LINK dan teks kedalaman. |
| `window.updateRov3DTrail(x, y, depth, yaw, hasPosition)` | meter, meter, meter, derajat, bool | `telemetry.js` | Menggeser model dan menggambar jejak 3D. |
| `window.clearRov3DTrail()` | — | `trajectory.js` (tombol CLR) | Menghapus jejak 3D. |

**Disediakan `rovTopIcon.js`, dipanggil `trajectory.js`:**

| Fungsi | Mengembalikan | Fungsi |
|---|---|---|
| `window.getRovTopIconCanvas()` | canvas 256×256, atau `null` bila model belum selesai dimuat | Sprite ROV tampak atas. |
| `window.rovTopIconReady()` | bool | Sudah siap atau belum. |
| `window.getRovIconForwardOffset()` / `setRovIconForwardOffset(deg)` | derajat | Kalibrasi arah "depan" ikon. Coba dari Console: `setRovIconForwardOffset(90)`. |

**Disediakan `config.js`, dibaca kedua file 3D:**

| Variabel | Isi |
|---|---|
| `window.ROV_BACKEND_URL` | Alamat backend. Diisi saat `main.js` dimuat. |

Karena itu **`main.js` harus dimuat sebelum `rov3d.js` dan `rovTopIcon.js`** di `index.html`. Kalau urutannya dibalik, keduanya memakai alamat fallback bawaan dan model 3D tidak ditemukan di mode DEV.

Kalau kamu menambah fungsi `window.*` baru: daftarkan di tabel ini, dan selalu cek keberadaannya sebelum memanggil (`if (window.xxx) window.xxx(...)`), karena file 3D dimuat belakangan dan bisa gagal.

### 4.2 Elemen HTML yang diacu file lain

| Dipakai oleh | Elemen |
|---|---|
| `rov3d.js` | `#rovViewport`, `#rov3dLink` (kelas `live` ditambah/dilepas), `#rov3dDepth`, kelas `.rov-viewport-error` |
| `camera.js` | `.camera-panel[data-cam-id]`, `.video-box`, `.cam-toggle`, `.signal`, `.cam-res`, `.cam-fps`, `.zoom-level`, `.capture-btn`, `.fullscreen-btn`, `.zoom-in-btn`, `.zoom-out-btn` |
| `telemetry.js` | `#telDepth`, `#depthCard`, `#telRoll`, `#telPitch`, `#telYaw`, `[data-pwm]`, `#qrCard`, `#qrTarget`, `#qrSource`, `#qrStatus`, `#qrTime`, `#specCamera`, `#specGripper`, `#specThruster`, `#sysStatus`, `#brandDot`, `#brandStatus` |
| `trajectory.js` | `#trajCanvas`, `#trajInfo`, `#trajDist`, `#trajMaxDepth`, `#trajPts`, `#trajClear`, `#trajPause`, `#trajPng` |
| `main.js` | `#btnRecord`, `#btnSnapshot`, `#btnReplay`, `#btnReset`, `#btnFolder`, `#folderLabel`, `#btnDepthAlert`, `.mode-toggle .mode`, `#menuBtn` |
| `logger.js` | `#consoleLog` |
| `clock.js` | `#currentDay`, `#currentTime` |
| `status.js` | `#devBadge` |

**Mengganti nama `id` = mengubah JS yang memakainya, dan sebaliknya.** Kalau elemen tidak ada, sebagian besar kode melewatinya diam-diam (tanpa error), jadi kerusakannya baru ketahuan saat tampilan tidak berubah. Cek ejaan `id` kalau ada panel yang "tidak hidup".

### 4.3 Kontrak data backend ↔ frontend

- Field JSON `/telemetry` dan `/status`: lihat [2.5](#25-format-json-telemetry). Hanya boleh ditambah.
- Nomor kamera: `CAM_MAPPING` di backend, `CAMERAS` di `config.js`, dan `data-cam-id` di HTML **harus sama**.
- Nama PWM: `PWM1`…`PWM6` di backend dan `data-pwm="1"`…`"6"` di HTML.

---

## 5. Peta: mau mengubah X, buka file Y

| Mau mengubah... | Buka |
|---|---|
| IP / alamat backend bawaan | `frontend/js/config.js` (`DEFAULT_BACKEND_URL`) |
| Seberapa sering data diambil, batas kedalaman, interval log | `frontend/js/config.js` |
| Port MAVLink, nomor kamera, resolusi/FPS kamera | `backend/gcs_server.py`, bagian 2 |
| Data baru dari Pixhawk | `backend/gcs_server.py`, bagian 6 (`_MAVLINK_HANDLERS`) |
| Endpoint baru | `backend/gcs_server.py`, bagian 11 |
| Tampilan simulasi mode DEV | `backend/gcs_server.py`, `_dev_telemetry_loop()` dan `DevCameraGrabber` |
| Isi panel TELEMETRY / QR / status header | `frontend/js/telemetry.js` + `index.html` |
| Peta jejak 2D | `frontend/js/trajectory.js` |
| Model 3D dan jejak 3D | `frontend/js/rov3d.js` |
| Ikon ROV di peta | `frontend/js/rovTopIcon.js` |
| Kamera (toggle, zoom, snapshot) | `frontend/js/camera.js` |
| Rekaman dan replay | `frontend/js/recorder.js`, `frontend/js/replay.js` |
| Tombol di panel Controls | `index.html` (tombol) + `frontend/js/main.js` (fungsi) |
| Warna, ukuran, tata letak | `frontend/css/style.css` (modal replay: `replay.css`) |
| Ukuran tampilan keseluruhan | `style.css`, aturan `html { font-size: clamp(...) }` |
| Gambar kamera terpotong | `style.css`, variabel `--video-fit` |

---

## 6. Resep menambah fitur

Setiap resep diberi urutan langkah. **Selalu uji di mode DEV dulu.**

### Resep A — Menambah data baru dari Pixhawk (contoh: tegangan baterai)

Tujuan: tampilkan tegangan baterai di panel TELEMETRY.

**Backend (`gcs_server.py`)**

1. **State**: tambah field awal di `state` (bagian 3):
   ```python
   "battery_v": 0.0,
   ```
2. **Handler**: tambah fungsi di bagian 6, di dekat handler lain:
   ```python
   def _on_sys_status(msg):
       # voltage_battery dalam milivolt; nilai 65535 berarti "tidak diketahui"
       if msg.voltage_battery != 65535:
           state["battery_v"] = msg.voltage_battery / 1000.0
   ```
3. **Daftarkan** ke tabel `_MAVLINK_HANDLERS`:
   ```python
   'SYS_STATUS': _on_sys_status,
   ```
4. **Minta pesan dikirim** di `_run_mavlink_once()`, di antara baris `request_message(...)` lainnya:
   ```python
   request_message(mavutil.mavlink.MAVLINK_MSG_ID_SYS_STATUS, 2)   # 2 Hz
   ```
5. **Simulasi DEV**: di `_dev_telemetry_loop()` isi nilai palsu supaya bisa diuji tanpa robot:
   ```python
   state["battery_v"] = 15.8 - 0.002 * t
   ```
6. **Kirim ke frontend**: tambah baris di `get_telemetry()` (bagian 11):
   ```python
   "battery_v": float(state.get("battery_v", 0.0)),
   ```

**Frontend**

7. **HTML** (`index.html`): tambah elemen dengan `id`, misalnya di salah satu `.telemetry-card`:
   ```html
   <p>BATTERY <b id="telBattery">-- V</b></p>
   ```
8. **Referensi elemen** di `telemetry.js`, objek `el`:
   ```js
   battery: $("telBattery"),
   ```
9. **Isi nilainya** di `applyTelemetry(d)`:
   ```js
   if (el.battery && Number.isFinite(d.battery_v)) {
     el.battery.textContent = `${d.battery_v.toFixed(1)} V`;
   }
   ```
10. Catat field baru di tabel [2.5](#25-format-json-telemetry) dokumen ini.

**Uji:** jalankan mode DEV, angka tegangan harus turun pelan-pelan. Lalu di Jetson, pastikan Pixhawk benar-benar mengirim `SYS_STATUS`.

### Resep B — Menambah endpoint dan tombol yang memanggilnya (contoh: nol-kan kedalaman)

Tujuan: tombol untuk mengkalibrasi ulang titik nol kedalaman (berguna kalau backend dinyalakan saat ROV sudah di dalam air, karena titik nol diambil dari tekanan pertama yang diterima).

**Backend** — tambah di bagian 11:
```python
@app.route('/depth/zero', methods=['POST'])
def depth_zero():
    global surface_pressure_hpa
    surface_pressure_hpa = None     # dikalibrasi ulang pada pesan tekanan berikutnya
    return jsonify({"status": "depth will be re-zeroed"})
```
Catatan: di mode DEV kedalaman tidak berasal dari tekanan, jadi endpoint ini tidak berpengaruh di DEV.

**Frontend**

1. Tambah tombol di `index.html` (panel Controls), dengan `id` baru, mis. `btnDepthZero`.
2. Di `main.js`, fungsi `bindControls()`:
   ```js
   $("btnDepthZero")?.addEventListener("click", async () => {
     try {
       await fetch(`${BACKEND_URL}/depth/zero`, { method: "POST" });
       appendLog("[DEPTH] Titik nol kedalaman akan dikalibrasi ulang.");
     } catch (e) {
       appendLog(`[DEPTH] Gagal: ${e.message}`, "error");
     }
   });
   ```
3. Kalau tombol itu perlu gaya, tambahkan di `style.css` memakai satuan `rem`.

Pola yang sama berlaku untuk semua perintah: **HTML (tombol) → `main.js` (klik) → `fetch` ke endpoint → backend mengubah state atau mengirim ke robot → hasilnya terlihat lewat `/telemetry`.**

### Resep C — Menambah panel baru

1. Di `index.html`, tambah `<section class="panel nama-panel">` di dalam `.main-grid`.
2. Di `style.css`, tentukan tempatnya di grid. Tata letak memakai `grid-template-areas` di `.main-grid`:
   ```css
   grid-template-areas:
     "cam1      cam2 status"
     "qr        rov  datalog"
     "telemetry rov  datalog"
     "controls  controls controls";
   ```
   Tambah area baru atau ubah susunannya, lalu beri `.nama-panel { grid-area: ...; }`.
3. Pakai satuan **`rem`**, bukan `px`, supaya ikut skala layar.
4. Kalau isi panel bisa tumbuh tinggi (daftar panjang, log), beri `overflow-y: auto; min-height: 0;` pada bagian yang boleh di-scroll. Kalau tidak, panel itu bisa mendorong baris grid dan menyusutkan panel kamera. Contoh: `.log-panel` memakai `contain: size`.
5. Logika isi panel taruh di modul JS baru (`js/namapanel.js`) dan panggil dari `main.js`. Jangan menambah kode ke `telemetry.js` kalau tidak ada hubungannya dengan telemetri.

### Resep D — Menambah kamera ke-3

1. **Backend**: tambah entri di `CAM_MAPPING` dan `CAM_CONFIG` (bagian 2). Dictionary state lain (`zoom_levels`, `_qr_busy`, `_qr_box`, `display_fps`, `qr_data_by_camera`) dibuat otomatis dari `CAM_MAPPING`.
2. **Frontend config**: tambah `{ id: 2, label: "CAM3" }` di `CAMERAS` (`config.js`).
3. **HTML**: duplikat salah satu `<section class="camera-panel">` dengan `data-cam-id="2"`.
4. **Tata letak**: grid baris pertama sekarang berisi 2 kamera + trajectory. Tambah kamera berarti harus memutuskan tata letak barunya (mis. kolom tambahan atau kamera ketiga di baris lain), lalu ubah `grid-template-columns` / `grid-template-areas`.
5. **Rekaman**: `recorder.js` dan `replay.js` mengulang daftar `CAMERAS`, jadi kamera baru ikut otomatis. `replay.css` memakai 2 kolom video (`.rp-video-row`); ubah kalau kamera lebih dari 2.
6. Perhatikan beban Jetson: tiap kamera menambah thread, encode JPEG, dan RTSP.

### Resep E — Menambah tombol di panel Controls

1. `index.html`, di dalam `.control-row`:
   ```html
   <button class="btn icon-btn" id="btnContoh" type="button">
     <i class="fa-solid fa-star"></i> Contoh
   </button>
   ```
2. `main.js`, di `bindControls()`:
   ```js
   $("btnContoh")?.addEventListener("click", () => { /* panggil fungsi dari modul */ });
   ```
3. Beri warna di `style.css` (ikuti pola `.record`, `.snapshot`, `.replay`).
4. Lebar `.control-row` terbatas. Kalau tombol jadi terlalu banyak, pertimbangkan memindahkan sebagian ke menu (tombol hamburger di header, saat ini masih kosong).

### Resep F — Menambah pengaturan baru

Angka, URL, atau ambang batas **jangan ditulis langsung di modul**. Tambah ke `config.js` dengan komentar, lalu `import { NAMA } from "./config.js"`. Untuk backend, taruh di bagian 2 `gcs_server.py`.

### Resep G — Mengirim perintah ke robot (pola umum)

Semua yang sekarang ada bersifat **baca saja**: backend hanya membaca dari Pixhawk. Mengirim perintah (arm, mode, kontrol, parameter) adalah kategori baru yang **berisiko**, dan butuh perhatian khusus (jalur koneksi MAVLink dua arah, pengaman, watchdog). Rencana lengkapnya ada di [ROADMAP.md](ROADMAP.md) bagian joystick dan thruster. **Jangan menambahkan perintah ke robot secara asal-asalan lewat resep B.**

---

## 7. Aturan penulisan kode

**Umum**
- Satu file = satu tanggung jawab. Beri komentar di atas file: apa tugasnya, siapa yang memanggil.
- Komentar menjelaskan **kenapa**, bukan mengulang **apa** yang jelas dari kode.
- Kalau memperbaiki hal yang membingungkan atau pernah jadi bug, tulis alasannya di komentar.

**Frontend**
- Angka dan URL di `config.js`.
- Elemen dicari lewat `id` atau `data-*`, bukan posisi (`:first-child`, `nth-child`).
- Satuan CSS: `rem`. `px` hanya untuk garis tipis (border 1px) dan modal replay.
- Pesan ke pengguna lewat `appendLog(pesan, level)` dengan level `""`, `"warn"`, atau `"error"`.
- Jangan menambah variabel global di `window` kecuali untuk file 3D, dan catat di [4.1](#41-fungsi-global-window-jembatan-ke-file-3d).
- Semua `fetch` ke backend memakai `BACKEND_URL` dari `config.js`.

**Backend**
- Satu thread penulis per data (lihat [2.1](#21-thread-yang-berjalan)).
- Route Flask hanya membaca `state{}`. Perubahan state dilakukan thread khusus atau lewat route yang jelas tujuannya (mis. zoom).
- Kalau menambah sumber data nyata, **tambah juga simulasinya** di mode DEV.
- Pesan log diawali tag: `[MAVLink]`, `[CAM ...]`, `[RTSP]`, `[DEV]`.
- Import yang hanya ada di Jetson (GStreamer) harus tetap opsional (`try/except`) supaya mode DEV di laptop tetap jalan.

---

## 8. Cara menguji perubahan

Urutan kerja yang disarankan:

1. **Ubah kode** → uji di **mode DEV** (`2A_RUN_DEV_LAPTOP.bat` di Windows; di Linux/macOS lihat [MANUAL.md](MANUAL.md#3-mode-dev-di-laptop-manual)).
2. Buka Console browser (`F12` → tab **Console**). **Pesan merah = ada yang salah.** Tidak boleh ada pesan merah baru setelah perubahanmu.
3. Cek `http://localhost:8080/telemetry` untuk memastikan field backend benar.
4. Baru uji di **Jetson** (`2B_RUN_WITH_JETSON.bat`), lalu terakhir dengan robot.

Pengecekan cepat yang bisa dijalankan tanpa menjalankan aplikasi:

```bash
python -m py_compile backend/gcs_server.py          # cek sintaks Python
node --check frontend/js/telemetry.js                # cek sintaks JS (butuh Node.js)
```

Daftar cek sebelum menyerahkan perubahan:

- [ ] Mode DEV jalan, dashboard hijau `OPERATIONAL`.
- [ ] Tidak ada pesan merah di Console.
- [ ] Fitur lama (kamera, telemetri, trajectory, model 3D) masih jalan.
- [ ] `id` baru sudah dicatat di [4.2](#42-elemen-html-yang-diacu-file-lain) kalau dipakai JS.
- [ ] Field JSON baru sudah dicatat di [2.5](#25-format-json-telemetry).
- [ ] Layar kecil (1366×768) tidak berantakan: perkecil jendela browser untuk mencoba.

---

## 9. Jebakan yang pernah terjadi

| Jebakan | Penjelasan |
|---|---|
| `Ctrl+Z` di jendela backend Jetson | Membekukan program. Port tetap terbuka tapi tidak melayani, jadi `curl` menggantung. Gunakan `Ctrl+C`. |
| Membuka `index.html` dengan klik dua kali | Browser memblokir modul JS dari `file://`. Selalu lewat `http://localhost:5500`. |
| Alamat backend lama tersimpan | `?backend=` disimpan di browser. Setelah pindah antara DEV dan Jetson, buka lagi dengan parameter baru atau `?backend=reset`. |
| `PowerShell` + `localhost` | `localhost` bisa dicoba lewat IPv6 dulu dan gagal berulang. Gunakan `127.0.0.1`, atau cek port lewat `netstat`. Ini sebabnya `2A_RUN_DEV_LAPTOP.bat` memakai `netstat`. |
| Menulis `IP_JETSON` apa adanya | Itu hanya contoh dalam dokumen. Pakai IP asli dari `hostname -I`. |
| `pip install opencv-python` di Jetson | Menimpa OpenCV bawaan JetPack yang punya GStreamer. Jangan. |
| Urutan `<script>` | `main.js` sebelum `rov3d.js` dan `rovTopIcon.js`. |
| Ikon hilang, model 3D tidak muncul | Laptop offline (library dimuat dari CDN). Lihat [ROADMAP.md](ROADMAP.md). |
| Kedalaman salah di awal | Titik nol diambil dari tekanan pertama yang diterima backend. Kalau backend dinyalakan saat ROV sudah di bawah permukaan, nol-nya salah (lihat Resep B). |
| Dialog pilih folder tidak muncul | Harus dipicu klik, dan hanya ada di Chrome/Edge pada `localhost` atau HTTPS. |