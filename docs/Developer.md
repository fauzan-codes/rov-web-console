# Panduan Pengembang GCS ROV

Dokumen ini menjelaskan **bagaimana program ini bekerja di dalam** dan **cara menambah fitur** tanpa merusak yang sudah ada. Ditulis supaya orang yang baru pertama kali membaca kode bisa memahami alurnya hanya dari sini.

Dokumen lain:

| Dokumen | Isi |
|---|---|
| [README.md](../README.md) | Cara menjalankan dengan `.bat` (untuk pemula). |
| [MANUAL.md](MANUAL.md) | Cara menjalankan manual, memperbarui Jetson, Joystick Bridge, prosedur tes, diagnosa jaringan. |
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
 PIXHAWK ⇄ serial ⇄ mavlink-routerd (MAVProxy2.py) ⇄ UDP 14560 ⇄ ┐
                                                                   ▼
 KAMERA USB ──► [ BACKEND  gcs_server.py + rov_control.py  (Flask, :8080) ] ⇄ HTTP ⇄ [ FRONTEND (browser) ]
                  • thread MAVLink  → state{}                /telemetry              index.html + js/*.js
                  • thread kamera   → frame                  /video_feed/<id>
                  • deteksi QR                               /control/*  /buttons/*  /motors/*
                  • rov_control: sender 20 Hz + heartbeat 1 Hz
                  • (Jetson) RTSP                                       ▲
                                                                        │ POST /control/raw (20 Hz)
                                                       JOYSTICK BRIDGE (tools/joystick_bridge.py, laptop)
```

Prinsip yang dipegang seluruh kode:

1. **Backend yang tahu semua tentang robot.** Frontend hanya menampilkan dan meminta. Frontend **tidak boleh menebak** data robot (misalnya posisi); kalau datanya tidak ada, tampilkan "menunggu".
2. **Frontend mengambil data dengan polling** (`GET /telemetry` tiap 100 ms, `GET /control/status` tiap 150–500 ms). Tidak ada koneksi yang tetap terbuka kecuali stream video MJPEG.
3. **Mode DEV menggantikan hardware, bukan logika.** Di mode DEV hanya sumber data yang diganti (kamera sintetis, telemetri simulasi, parameter dan fungsi tombol simulasi). Semua kode di atasnya sama dengan yang berjalan di Jetson. Jadi apa pun yang bekerja di mode DEV akan bekerja di Jetson, selama kontrak datanya sama.
4. **Perintah ke robot hanya lewat jalur yang berpengaman.** Semua yang menulis ke Pixhawk (MANUAL_CONTROL, ARM, mode, parameter, uji motor) melewati backend dengan: sakelar `ROV_ENABLE_CONTROL` (default mati), pembatasan nilai di backend, watchdog, dan verifikasi baca-ulang. Browser tidak pernah dipercaya untuk waktu maupun nilai.

---

## 2. Backend: cara kerjanya

File: `backend/gcs_server.py` (dibagi 12 bagian bertanda `# ====`) dan `backend/rov_control.py` (modul Drive Control, dipasang lewat `rov_control.init(...)`).

| # | Bagian `gcs_server.py` | Isinya |
|---|---|---|
| 1 | Import & deteksi mode | `DEV_MODE`, import opsional (GStreamer, pyzbar, pymavlink), `import rov_control`. |
| 2 | Konfigurasi | `SERIAL_PORT`, pengaturan motor/uji motor, `MAV_SOURCE_SYSTEM`, `CAM_MAPPING`, `CAM_CONFIG`, QR, RTSP. |
| 3 | State global | `state{}` (data robot terbaru), zoom, flag kamera. |
| 4 | Utilitas kecil | `get_local_ip()`, dll. |
| 5 | Kamera | `CameraGrabber` (Jetson), `DevCameraGrabber` (laptop), `get_grabber()`. |
| 6 | MAVLink / telemetri / perintah | Handler per pesan, loop MAVLink asli, jalur perintah ke Pixhawk (parameter, uji motor), simulasi. |
| 7 | Pemrosesan gambar | Zoom, white balance, gamma. |
| 8 | Deteksi QR | Scan di thread terpisah, kotak hijau di video. |
| 9 | Pipeline frame | `processing_loop()` per kamera. |
| 10 | RTSP server | Hanya Jetson (butuh GStreamer). |
| 11 | Route Flask | Kamera, zoom, `/motors/*`, `/telemetry`, `/models`, `/status`; lalu `rov_control.init(...)` menambah `/control/*` dan `/buttons/*`. |
| 12 | Main | Menyalakan thread (`start_background_services()` dan `rov_control.start()`) dan server. |

### 2.1 Thread yang berjalan

Setelah `python gcs_server.py`, backend menyalakan:

| Thread | Tugas | Menulis ke |
|---|---|---|
| `mavlink_thread` | Membaca MAVLink (atau simulasi) | `state{}`, `_params`, `_last_ack`, `_statustext` |
| `processing_loop(cam_id)` ×N | Ambil frame → zoom → QR → gambar teks FPS | `_last_frames`, `_frame_sources` |
| `CameraGrabber._update` ×N | Membaca kamera terus-menerus | `grabber.frame` |
| `_scan_qr_worker` | Decode QR (sesaat, dibuat per scan) | `state["qr_data"]`, `_qr_box` |
| `rtsp_push_loop` ×N + `start_rtsp_server` | Kirim frame ke RTSP | (hanya Jetson) |
| `rov_control._sender_loop` | Mengirim `MANUAL_CONTROL` 20 Hz tetap | socket MAVLink (dilindungi `send_lock`) |
| `rov_control._heartbeat_loop` | Mengirim HEARTBEAT GCS 1 Hz | socket MAVLink |
| Flask (thread utama + thread per request) | Melayani HTTP | membaca `state{}` dan frame; route kontrol menulis state `rov_control` |

Aturan: **satu thread penulis per data.** `state{}` ditulis `mavlink_thread` (dan `_scan_qr_worker` untuk QR). Satu pengecualian yang disengaja: **di DEV mode saja**, `rov_control` meniru firmware dan menulis `state["armed"]` dan `state["custom_mode"]` (di robot sungguhan nilai itu hanya datang dari HEARTBEAT Pixhawk). Route Flask selain route kontrol hanya **membaca**.

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

Handler yang berkaitan dengan perintah (di tabel yang sama): `HEARTBEAT` (mengisi `armed` dan `custom_mode`; heartbeat bertipe GCS diabaikan), `PARAM_VALUE`, `COMMAND_ACK`, `STATUSTEXT`.

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
| Parameter Pixhawk (`MOT_n_DIRECTION`, `BTNn_FUNCTION`) | `_dev_params` dan `_dev_btn` (tabel di memori) |
| Uji motor ke Pixhawk | `_dev_motor_test` (PWM bergoyang di telemetri simulasi) |
| ARM / mode / fungsi tombol oleh firmware | `rov_control._dev_run()` (arm, disarm, mode, gain) |
| RTSP + NVENC | dimatikan |

Pemilihan terjadi di sedikit tempat: `get_grabber()`, `mavlink_thread()`, `mav_param_read/write()`, `mav_motor_test()`, dan cabang `dev_mode` di `rov_control`. Kalau kamu menambah sumber data atau perintah baru, **sediakan juga simulasinya di mode DEV**, supaya bisa diuji tanpa robot.

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
| `armed` | bool | Status ARM dari heartbeat Pixhawk. |
| `qr_data` | objek | `target_id`, `type`, `valid`, `time`, `camera_id`. |
| `pwm` | objek | `PWM1`…`PWM6` (mikrodetik; ±1500 = diam). |
| `mavlink_connected` | bool | `true` kalau Pixhawk mengirim data. |
| `link` | string | `"connected"` atau `"reconnecting"`. |

> **Aturan kompatibilitas:** boleh **menambah** field. Jangan **mengubah nama atau satuan** field yang ada, karena frontend bergantung padanya.

### 2.6 Jalur perintah ke Pixhawk

Backend memakai **satu** koneksi MAVLink dua arah (`_mav_master`, dibuat di `_run_mavlink_once()` dengan `source_system=MAV_SOURCE_SYSTEM`, 255 seperti QGC). Koneksi ini dipakai thread penerima (`mavlink_thread`) dan banyak pengirim, sehingga dilindungi beberapa objek sinkronisasi:

| Objek | Melindungi / fungsi |
|---|---|
| `_mav_send_lock` | **Semua** pengiriman ke socket (parameter, command, MANUAL_CONTROL, heartbeat). Dibagi dengan `rov_control` lewat `init(send_lock=...)`. |
| `_mav_cmd_lock` | Menyerialkan operasi bertahap (baca/tulis parameter, uji motor) supaya dua request tidak saling menimpa balasan. |
| `_mav_cond` + `_last_ack` / `_params` | Pola "kirim lalu tunggu balasan": handler `COMMAND_ACK` dan `PARAM_VALUE` mengisi dictionary dan `notify_all()`; pemanggil menunggu dengan `cond.wait()` sampai balasan **yang lebih baru dari waktu kirim** tiba atau timeout. |
| `_statustext` | 30 pesan `STATUSTEXT` terakhir; `recent_statustext(since)` dipakai untuk menampilkan alasan penolakan dari Pixhawk. |

Fungsi level bawah: `mav_param_read(name)`, `mav_param_write(name, value)` (menulis lalu **membaca ulang**; mengembalikan `(nilai_lama, nilai_baru)`), `mav_motor_test(motor, percent, seconds)`.

**Uji motor (ArduSub, `MAV_CMD_DO_MOTOR_TEST`)**: parameter ke-6 **wajib** `MOTOR_TEST_ORDER_BOARD` (2), perintah harus **dikirim ulang ≥ 2 Hz** selama motor berputar (kita memakai 10 Hz), nomor motor dikirim `n - MOTOR_TEST_INDEX_BASE`, robot harus ARMED, dan setelah tes selesai Pixhawk **disarm sendiri** dengan cooldown ±10 detik. Nilai daya dan durasi dibatasi di backend (`MOTOR_TEST_MAX_PERCENT`, `MOTOR_TEST_MAX_SECONDS`).

**Penjaga akses**: `_control_guard(require_armed)` di `gcs_server.py` untuk route `/motors/*` (sakelar `ENABLE_MOTOR_CONFIG`, tidak boleh saat Drive Control aktif, dan status ARM yang sesuai). `rov_control._guard()` melakukan hal serupa untuk route `/control/*` dan `/buttons/*` (ditambah pemeriksaan token).

### 2.7 `rov_control.py` (Drive Control)

Modul ini dipasang dengan `rov_control.init(app, get_master=..., send_lock=..., cmd_lock=..., cond=..., last_ack=..., state=..., statustext_since=..., enabled=..., dev_mode=..., mavutil=..., sysid=..., param_read=..., param_write=..., param_error=...)`, lalu dihidupkan dengan `rov_control.start()`. Modul **tidak mengimpor `gcs_server`**: semua yang dibutuhkan diberikan lewat `init()`, sehingga tidak ada impor melingkar dan mudah diuji.

```
 sumber input ──► backend menyimpan nilai TERBARU (axes 4 sumbu + bitmask tombol)
                                  │
              _sender_loop (20 Hz tetap) ──► _tick()
                    │  active?  watchdog?  stale?
                    ▼
        MANUAL_CONTROL(x, y, z, r, buttons) ──► mavlink-routerd ──► Pixhawk
```

**Dua input source** (dipilih saat Enable Control):

| Source | Alur | Pengolahan | Kendala |
|---|---|---|---|
| `bridge` | `joystick_bridge.py` → `POST /control/raw` | Backend: mapping, invert, deadband, exponential, gain (`_process` / `_curve`) memakai `joystick_config.json` | Tidak bergantung tab/fokus (disarankan) |
| `browser` | `control.js` → `POST /control/axes` | Browser (`processAxes()` di `joystick.js`); backend hanya membatasi nilai | Gamepad API berhenti saat tab disembunyikan / jendela tidak fokus |

> `_curve()` di Python dan `applyCurve()` di `joystick.js` **harus tetap identik**. Begitu juga `JOY_DEFAULT` (Python) dan `defaultConfig()` (JS).

**Pengaman (jangan dilepas):**

| # | Pengaman | Cara kerja |
|---|---|---|
| 1 | Default mati | `ROV_ENABLE_CONTROL=1` + operator menekan Enable di UI |
| 2 | Watchdog | Tanpa data > `WATCHDOG_S` (0.4 s): kirim netral dan lepas semua tombol |
| 3 | Stale-off | Tanpa data > `STALE_OFF_S` (2 s): control **dimatikan**, harus Enable ulang |
| 4 | Syarat Enable | Semua stick netral dan tidak ada tombol ditekan |
| 5 | Pembatasan nilai | Dibatasi −1..1 lalu dikali `LIMIT` (`ROV_CONTROL_LIMIT`) di backend |
| 6 | Satu pengirim | System id 255 (sama dengan QGC): joystick QGC harus dimatikan |
| 7 | Putus sumber | Bridge/joystick berhenti → control dimatikan + `NEUTRAL_BURST` frame netral |
| 8 | STOP selalu boleh | `/control/stop` tanpa token dan tanpa syarat |
| 9 | Verifikasi | ARM, mode, dan penulisan parameter dilaporkan `verified` setelah dibaca ulang dari Pixhawk |

**Satuan `MANUAL_CONTROL` (ArduSub):** `x` (maju +), `y` (kanan +), `r` (yaw searah jarum jam +): −1000..1000. `z` (naik +): **0..1000, netral 500**. `buttons`: bitmask 16 bit. Konversi ada di `_packet()`.

**Fungsi tombol.** Fungsi tiap tombol disimpan di Pixhawk (`BTNn_FUNCTION` dan `BTNn_SFUNCTION`); backend hanya meneruskan bitmask tombol yang sedang ditekan. Daftar fungsi yang dikenal UI ada di `BTN_FUNCTIONS` (nomor fungsi = nilai parameter). Di **DEV mode**, `_dev_run()` meniru fungsi dasar firmware (arm, arm_toggle, disarm, mode_manual/stabilize/depth_hold, gain_inc/dec/toggle, shift) memakai tabel `_dev_btn`; fungsi lain hanya dicatat di log.

**Data Bridge untuk UI** (`_bridge_view()`): selain nilai mentah/olahan, backend menahan tombol yang baru ditekan selama `BTN_LATCH_S` (0,6 s) sebagai `recent` supaya ketukan singkat tidak hilang di antara dua polling, menghitung laju paket (`rate_hz`), dan mencatat 5 tombol terakhir (`events`). Dipakai oleh panel Drive, Settings, dan Button Assignment.

**Endpoint** (daftar lengkap di [MANUAL.md, bagian 9](MANUAL.md#9-referensi-endpoint-backend)): `/control/status`, `/control/bridge`, `/control/config`, `/control/enable`, `/control/raw`, `/control/axes`, `/control/stop`, `/control/arm`, `/control/mode`, `/buttons/functions`, `/buttons/<n>/function`.

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
                                    ├─ control.js       (Drive Control: chip DRIVE + panel)
                                    └─ settings.js      (popup Settings)
                                          ├─ thruster.js   (tab Thruster)
                                          ├─ buttons.js    (tab Button Assignment)
                                          ├─ bridge.js     (status Joystick Bridge)
                                          └─ joystick.js   (Gamepad API, konfigurasi, kurva)
          ─ memuat ─► js/rov3d.js        (model 3D, script terpisah)
          ─ memuat ─► js/rovTopIcon.js   (ikon ROV di peta, script terpisah)
```

Aturan ketergantungan (tidak boleh ada lingkaran):

```
util, config, session   ← dasar, tidak mengimpor modul lain (selain util/config)
logger, clock, storage  ← memakai config/util/logger
joystick                ← memakai logger
bridge                  ← memakai config
camera, trajectory      ← memakai logger, storage, session
recorder                ← memakai camera, trajectory
replay                  ← memakai recorder, storage
telemetry               ← memakai trajectory, recorder, camera
status                  ← memakai camera
control, thruster, buttons ← memakai config, logger, joystick
settings                ← memakai thruster, buttons, bridge, joystick, storage
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

**Alur Drive Control (`control.js`)** berjalan terpisah dari telemetri:

```
setInterval pollStatus (500 ms; 150 ms bila panel terbuka dan Bridge aktif)
   └► GET /control/status ─► applyStatus(s) ─► render()  (chip, pill, tombol, diagnostik Bridge)

setInterval tick (50 ms)
   ├─ panel terbuka ─► renderBars / renderButtons  (dari status.bridge jika Bridge aktif, selain itu dari Gamepad API)
   └─ source "browser" aktif ─► POST /control/axes (nilai olahan + bitmask tombol)   [source "bridge": tidak mengirim apa pun]

setInterval pushConfig (2 s) ─► POST /control/config (hanya jika konfigurasi berubah)
```

Aksi operator: `enableDrive()` → `POST /control/enable`; `stopDrive()` → `POST /control/stop`; `toggleArm()` → `/control/arm`; `changeMode()` → `/control/mode`. Variabel `epoch` membuang balasan status yang berangkat **sebelum** Enable/Stop terakhir supaya UI tidak "berkedip" ke status lama.

### 3.3 Memilih sumber posisi (`resolvePosition`)

| Kondisi | Mode | Sumber |
|---|---|---|
| `pos_valid` dan `x`, `y` angka | `PIXHAWK` | `x`, `y` |
| selain itu, `dr_x`, `dr_y` angka | `DR` | `dr_x`, `dr_y` |
| selain itu | `WAITING` | tidak ada |

Backend selalu mengirim `dr_x`/`dr_y` (mulai dari 0), jadi tanpa Pixhawk tampilan biasanya `DR` dengan jejak diam. `WAITING` hanya muncul kalau datanya tidak valid. `OFFLINE` ditetapkan terpisah kalau browser tidak bisa menghubungi backend.

### 3.4 Joystick: dua source, satu penomoran

| Source | Modul | Format axis | Format tombol |
|---|---|---|---|
| Bridge | `bridge.js` (`getBridge()`) | 6 axis urutan SDL: LX, LY, RX, RY, LT, RT | bitmask nomor QGC (`recent` untuk tampilan) |
| Browser | `joystick.js` (`readSnapshot()`) | `gamepad.axes` | `gamepad.buttons`, diterjemahkan ke nomor QGC lewat `STD_TO_SDL` (hanya jika `mapping === "standard"`) |

`settings.js` memilih source lewat `pickSnapshot()`: Bridge aktif → data Bridge; selain itu → browser. Bentuk snapshot keduanya sama supaya kode lain tidak perlu membedakan.

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
| `main.js` | `#btnRecord`, `#btnSnapshot`, `#btnReplay`, `#btnReset`, `#btnFolder`, `#folderLabel`, `#btnDepthAlert`, `.mode-toggle .mode` |
| `control.js` | `.system-info` (tempat chip `#driveChip` disisipkan, sebelum `#settingBtn`). Panel `#drivePop` dibuat oleh `control.js` sendiri. |
| `settings.js` | `#settingBtn` (tombol gear di header). Popup `#settings-modal` dibuat oleh `settings.js` sendiri. |
| `logger.js` | `#consoleLog` |
| `clock.js` | `#currentDay`, `#currentTime` |
| `status.js` | `#devBadge` |

`index.html` juga harus memuat stylesheet `css/control.css` dan `css/settings.css` (selain `style.css` dan `replay.css`).

**Mengganti nama `id` = mengubah JS yang memakainya, dan sebaliknya.** Kalau elemen tidak ada, sebagian besar kode melewatinya diam-diam (tanpa error), jadi kerusakannya baru ketahuan saat tampilan tidak berubah. Cek ejaan `id` kalau ada panel yang "tidak hidup".

### 4.3 Kontrak data backend ↔ frontend

- Field JSON `/telemetry`, `/status`, `/control/status`, `/control/bridge`: hanya boleh **ditambah**, jangan diubah namanya/satuannya.
- Nomor kamera: `CAM_MAPPING` di backend, `CAMERAS` di `config.js`, dan `data-cam-id` di HTML **harus sama**.
- Nama PWM: `PWM1`…`PWM6` di backend dan `data-pwm="1"`…`"6"` di HTML.
- **Penomoran tombol joystick** (0–14, urutan SDL GameController) harus sama di: `joystick_bridge.py`, `STD_TO_SDL` di `joystick.js` dan `control.js`, `QGC_BUTTON_LABELS`, dan `BTN_COUNT` / `BTN_FUNCTIONS` di `rov_control.py`.
- **Konfigurasi joystick**: `JOY_DEFAULT` + `_curve()` di `rov_control.py` ≡ `defaultConfig()` + `applyCurve()` di `joystick.js`.
- **Satuan MANUAL_CONTROL** dikonversi hanya di `rov_control._packet()`.

---

## 5. Peta: mau mengubah X, buka file Y

| Mau mengubah... | Buka |
|---|---|
| IP / alamat backend bawaan | `frontend/js/config.js` (`DEFAULT_BACKEND_URL`) |
| Seberapa sering data diambil, batas kedalaman, interval log | `frontend/js/config.js` |
| Port MAVLink, nomor kamera, resolusi/FPS kamera | `backend/gcs_server.py`, bagian 2 |
| Data baru dari Pixhawk | `backend/gcs_server.py`, bagian 6 (`_MAVLINK_HANDLERS`) |
| Endpoint baru (baca saja) | `backend/gcs_server.py`, bagian 11 |
| Perintah baru ke robot | `backend/rov_control.py` (lihat Resep G) |
| Pengaman Drive Control (watchdog, limit, syarat Enable) | `backend/rov_control.py`, bagian KONFIGURASI dan `_tick()` |
| Fungsi tombol joystick yang dikenal UI | `backend/rov_control.py` (`BTN_FUNCTIONS`, Resep H) |
| Pengolahan joystick (deadband, exponential, gain) | `frontend/js/joystick.js` **dan** `backend/rov_control.py` (harus sama) |
| Tampilan simulasi mode DEV | `backend/gcs_server.py`, `_dev_telemetry_loop()` dan `DevCameraGrabber`; `rov_control._dev_run()` |
| Isi panel TELEMETRY / QR / status header | `frontend/js/telemetry.js` + `index.html` |
| Panel Drive Control (chip DRIVE) | `frontend/js/control.js` + `frontend/css/control.css` |
| Popup Settings, tab Joystick | `frontend/js/settings.js` + `frontend/css/settings.css` |
| Tab Button Assignment | `frontend/js/buttons.js` |
| Tab Thruster | `frontend/js/thruster.js` |
| Cara joystick dibaca di laptop | `tools/joystick_bridge.py` |
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

Resep ini untuk perintah yang **hanya mengubah state backend** (bukan mengirim ke robot). Untuk perintah ke Pixhawk pakai Resep G.

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

Pola yang sama berlaku: **HTML (tombol) → `main.js` (klik) → `fetch` ke endpoint → backend mengubah state → hasilnya terlihat lewat `/telemetry`.**

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

Untuk panel yang mengambang di atas halaman (seperti Drive Control) atau popup (seperti Settings), buat elemennya dari JavaScript dan beri stylesheet sendiri; lihat `control.js` / `settings.js` sebagai contoh.

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
4. Lebar `.control-row` terbatas. Kalau tombol jadi terlalu banyak, pertimbangkan memindahkannya ke Settings atau panel Drive Control.

### Resep F — Menambah pengaturan baru

Angka, URL, atau ambang batas **jangan ditulis langsung di modul**. Tambah ke `config.js` dengan komentar, lalu `import { NAMA } from "./config.js"`. Untuk backend, taruh di bagian 2 `gcs_server.py` (atau bagian KONFIGURASI `rov_control.py` untuk hal yang khusus Drive Control).

### Resep G — Mengirim perintah ke robot (pola yang benar)

Perintah ke robot memakai jalur **yang sudah ada**; jangan membuat jalur baru dan jangan memakai Resep B untuk ini. Contoh: menambah perintah "nyalakan lampu" (`MAV_CMD_DO_SET_SERVO` atau yang sesuai firmware).

**Backend (`rov_control.py`)**

1. Tambah fungsi route. Mulai dengan `_guard()` (token + sakelar `ROV_ENABLE_CONTROL`), validasi input sendiri, lalu kirim:
   ```python
   def control_lights():
     g = _guard()
     if g:
       return g
     body = request.get_json(force=True, silent=True) or {}
     level = max(0, min(100, int(_num(body.get("level")))))
     try:
       if _ctx.dev_mode:
         _log(f"[DEV] lampu {level}%")          # simulasi: jangan menyentuh Pixhawk
       else:
         mav = _ctx.mavutil.mavlink if _ctx.mavutil else None
         if mav is None:
           raise ControlError("pymavlink is not installed on the backend", 503)
         result, text, px = _command_long(mav.MAV_CMD_DO_SET_SERVO, 8, 1100 + level * 8)
         if result != 0:
           return _err(f"Pixhawk rejected the command ({text})", 409, pixhawk_text=px)
     except ControlError as e:
       return _err(str(e), e.code, **e.extra)
     return jsonify({"ok": True, "level": level})
   ```
2. Daftarkan di `init()`:
   ```python
   app.add_url_rule("/control/lights", "control_lights", control_lights, methods=["POST"])
   ```
3. Aturan wajib:
   - **Batasi nilai di backend**; jangan percaya angka dari browser.
   - Gunakan `_ctx.send_lock` (sudah dilakukan `_command_long`) untuk semua tulis ke socket.
   - Perintah yang berbahaya harus menolak saat kondisi tidak aman (ARMED, Drive Control ON) seperti `buttons_set()` dan `_control_guard()`.
   - **Verifikasi dengan membaca balik** bila ada yang bisa dibaca (heartbeat, `PARAM_VALUE`), dan laporkan `verified`.
   - **Sediakan cabang `dev_mode`** supaya fitur bisa diuji tanpa robot.
   - Pesan yang akan tampil di UI ditulis dalam bahasa Inggris; log di terminal dalam bahasa Indonesia dengan tag `[CTRL]`.

**Frontend**: ikuti pola `api()` di `control.js` (header `Content-Type: text/plain` agar tidak memicu preflight CORS, token dari `localStorage`, timeout, dan penanganan error lewat `reportError()`).

### Resep H — Menambah fungsi tombol joystick baru

Fungsi tombol dijalankan firmware ArduSub (parameter `BTNn_FUNCTION`), jadi web hanya perlu **mengenalinya**:

1. Tambah `(nomor, "nama")` ke `BTN_FUNCTIONS` di `rov_control.py`. Nomor = nilai parameter pada dokumentasi ArduSub versi firmware kalian. **Verifikasi nomornya** (mis. lewat halaman Joystick di QGC). Fungsi apa pun juga tetap bisa dipasang lewat opsi "Other number…" di UI.
2. Kalau ingin fungsi itu bisa diuji di **DEV mode**, tambahkan cabangnya di `_dev_run()`. Kalau tidak, fungsi akan hanya dicatat di log.
3. Frontend tidak perlu diubah: daftar fungsi dikirim dari backend lewat `/buttons/functions`.

### Resep I — Menambah axis atau mengubah layout joystick default

Layout default (Mode 4) ada di **dua tempat yang harus sama**: `defaultConfig()` di `joystick.js` dan `JOY_DEFAULT` di `rov_control.py`. Naikkan `CONFIG_VERSION` di `joystick.js` kalau struktur konfigurasi berubah, supaya konfigurasi lama di `localStorage` di-reset sekali. Hapus `backend/joystick_config.json` agar backend memakai default baru.

---

## 7. Aturan penulisan kode

**Umum**
- Satu file = satu tanggung jawab. Beri komentar di atas file: apa tugasnya, siapa yang memakai, dan hal penting yang perlu diketahui pembaca baru.
- Komentar menjelaskan **kenapa**, bukan mengulang **apa** yang jelas dari kode.
- Kalau memperbaiki hal yang membingungkan atau pernah jadi bug, tulis alasannya di komentar.

**Bahasa**
- **Komentar dan dokumentasi kode:** bahasa Indonesia, ditulis sebagai dokumentasi untuk pembaca yang belum mengenal proyek (hindari konteks percakapan atau istilah internal tim). Istilah teknis tetap bahasa Inggris (watchdog, heartbeat, deadband, polling, dst.).
- **Nama fungsi dan variabel:** bahasa Inggris.
- **Teks yang tampil di UI** (label, tooltip, pesan di panel, pesan error backend yang diteruskan ke UI): bahasa Inggris dengan istilah teknis baku (Drive Control, Enable Control, Joystick Bridge, …).
- **Log** (panel DATA LOG dan terminal): bahasa Indonesia, diawali tag.

**Frontend**
- Angka dan URL di `config.js`.
- Elemen dicari lewat `id` atau `data-*`, bukan posisi (`:first-child`, `nth-child`).
- Satuan CSS: `rem`. `px` hanya untuk garis tipis (border 1px) dan modal replay.
- Pesan ke pengguna lewat `appendLog(pesan, level)` dengan level `""`, `"warn"`, atau `"error"`.
- Jangan menambah variabel global di `window` kecuali untuk file 3D, dan catat di [4.1](#41-fungsi-global-window-jembatan-ke-file-3d).
- Semua `fetch` ke backend memakai `BACKEND_URL` dari `config.js`.
- Request yang dikirim berulang (joystick, status) memakai `Content-Type: text/plain` supaya tidak memicu preflight CORS di setiap paket.

**Backend**
- Satu thread penulis per data (lihat [2.1](#21-thread-yang-berjalan)).
- Route Flask hanya membaca `state{}`. Perubahan state dilakukan thread khusus atau lewat route yang jelas tujuannya (mis. zoom, kontrol).
- Kalau menambah sumber data atau perintah nyata, **tambah juga simulasinya** di mode DEV.
- Pesan log diawali tag: `[MAVLink]`, `[CAM ...]`, `[RTSP]`, `[DEV]`, `[CTRL]`, `[Pixhawk]`.
- Import yang hanya ada di Jetson (GStreamer) harus tetap opsional (`try/except`) supaya mode DEV di laptop tetap jalan.
- Kode backend dijalankan di Jetson dengan Python yang mungkin lebih lama (f-string dipakai, jadi minimal 3.6): hindari fitur Python yang lebih baru tanpa memeriksa versi di Jetson.
- Hal yang mengirim ke robot: lihat aturan wajib di Resep G.

---

## 8. Cara menguji perubahan

Urutan kerja yang disarankan:

1. **Ubah kode** → uji di **mode DEV** (`2A_RUN_DEV_LAPTOP.bat` di Windows; di Linux/macOS lihat [MANUAL.md](MANUAL.md#3-mode-dev-di-laptop-manual)).
2. Buka Console browser (`F12` → tab **Console**). **Pesan merah = ada yang salah.** Tidak boleh ada pesan merah baru setelah perubahanmu. Muat ulang dengan `Ctrl+Shift+R` supaya file lama tidak dipakai.
3. Cek `http://localhost:8080/telemetry` dan `/control/status` untuk memastikan field backend benar.
4. Uji fitur kontrol di DEV (lihat di bawah).
5. Baru uji di **Jetson** (`2B_RUN_WITH_JETSON.bat`), lalu terakhir dengan robot mengikuti [prosedur tes](MANUAL.md#5-prosedur-tes-drive-control).

Pengecekan cepat yang bisa dijalankan tanpa menjalankan aplikasi:

```bash
python -m py_compile backend/gcs_server.py backend/rov_control.py tools/joystick_bridge.py   # sintaks Python
node --check frontend/js/control.js                                                          # sintaks JS (butuh Node.js)
```

**Menguji Drive Control tanpa joystick fisik (mode DEV).** Satu perintah Python di bawah berpura-pura menjadi Joystick Bridge (axis stick maju 70%). Jalankan berulang ≥ 2× per detik agar tidak dianggap putus, atau gunakan beberapa kali berturut-turut:

```bash
python -c "import json,urllib.request as u; r=u.Request('http://127.0.0.1:8080/control/raw', json.dumps({'connected':True,'name':'Test','axes':[0,-0.7,0,0,0,0],'buttons':0}).encode(), {'Content-Type':'text/plain'}); print(u.urlopen(r).read().decode())"
```

Setelah itu `http://127.0.0.1:8080/control/bridge` menunjukkan `connected: true`, `raw` berisi nilai itu, dan panel DRIVE menampilkan Bridge hijau. Tekan **Enable Control** saat stick netral, lalu kirim nilai di atas: `Sent X 700` (× `LIMIT`) muncul di panel. Berhenti mengirim: dalam 0,4 s output kembali netral, dalam 2 s Drive Control mati sendiri.

Alat bantu: `python tools/joystick_bridge.py --list` (joystick yang terdeteksi) dan `--verbose` (nilai tiap detik).

Daftar cek sebelum menyerahkan perubahan:

- [ ] Mode DEV jalan, dashboard hijau `OPERATIONAL`, `[CTRL] Siap` muncul di terminal backend.
- [ ] Tidak ada pesan merah di Console.
- [ ] Fitur lama (kamera, telemetri, trajectory, model 3D) masih jalan.
- [ ] Drive Control di DEV: Enable ditolak saat stick bergeser, STOP/Space bekerja, watchdog menetralkan setelah data berhenti.
- [ ] `id` baru sudah dicatat di [4.2](#42-elemen-html-yang-diacu-file-lain) kalau dipakai JS.
- [ ] Field JSON baru sudah dicatat di [2.5](#25-format-json-telemetry).
- [ ] Layar kecil (1366×768) tidak berantakan: perkecil jendela browser untuk mencoba.
- [ ] Komentar dan teks UI mengikuti aturan bahasa di bagian 7.

---

## 9. Jebakan yang pernah terjadi

| Jebakan | Penjelasan |
|---|---|
| `Ctrl+Z` di jendela backend Jetson | Membekukan program. Port tetap terbuka tapi tidak melayani, jadi `curl` menggantung. Gunakan `Ctrl+C`. |
| Membuka `index.html` dengan klik dua kali | Browser memblokir modul JS dari `file://`. Selalu lewat `http://localhost:5500`. |
| Alamat backend lama tersimpan | `?backend=` disimpan di browser. Setelah pindah antara DEV dan Jetson, buka lagi dengan parameter baru atau `?backend=reset`. |
| Joystick Bridge dan dashboard menunjuk backend berbeda | Bridge terlihat "OK" di terminalnya tetapi dashboard tidak melihat Bridge. Samakan alamat keduanya. |
| `PowerShell` + `localhost` | `localhost` bisa dicoba lewat IPv6 dulu dan gagal berulang. Gunakan `127.0.0.1`, atau cek port lewat `netstat`. Ini sebabnya `2A_RUN_DEV_LAPTOP.bat` memakai `netstat`. |
| Menulis `IP_JETSON` apa adanya | Itu hanya contoh dalam dokumen. Pakai IP asli dari `hostname -I`. |
| `pip install opencv-python` di Jetson | Menimpa OpenCV bawaan JetPack yang punya GStreamer. Jangan. |
| Urutan `<script>` | `main.js` sebelum `rov3d.js` dan `rovTopIcon.js`. |
| Ikon hilang, model 3D tidak muncul | Laptop offline (library dimuat dari CDN). Lihat [ROADMAP.md](ROADMAP.md). |
| Kedalaman salah di awal | Titik nol diambil dari tekanan pertama yang diterima backend. Kalau backend dinyalakan saat ROV sudah di bawah permukaan, nol-nya salah (lihat Resep B). |
| Dialog pilih folder tidak muncul | Harus dipicu klik, dan hanya ada di Chrome/Edge pada `localhost` atau HTTPS. |
| **Dashboard stuck di `CONNECTING`** | Satu modul JS gagal dimuat (file baru belum disalin → 404, atau versi file campur akibat cache). Satu `import` yang gagal menghentikan **semua** modul. Cek tab Network (404) dan Console, lalu `Ctrl+Shift+R`. |
| `TypeError: init() got an unexpected keyword argument` saat backend start | `gcs_server.py` dan `rov_control.py` beda versi. Selalu salin **keduanya** bersamaan (ke laptop dan ke Jetson). |
| Backend lama masih berjalan setelah kode diubah | `2A_RUN_DEV_LAPTOP.bat` memakai ulang backend yang sudah mendengarkan port. Tutup jendela backend lama dulu. |
| QGroundControl dan Drive Control bersamaan | Keduanya memakai system id 255 dan sama-sama mengirim `MANUAL_CONTROL`. ArduSub menerima dari keduanya dan hasilnya berebut. Matikan joystick QGC. |
| Gamepad API berhenti saat tab tidak aktif | Perilaku browser. Itu sebabnya ada Joystick Bridge; sumber Browser otomatis mematikan control saat tab disembunyikan. |
| Hot-plug joystick tidak terdeteksi (SDL/pygame) | SDL tidak selalu memindai ulang perangkat sendiri. Bridge memindai ulang tiap detik saat tidak ada joystick, dan memakai XInput (hot-plug otomatis) lebih dulu di Windows. |
| Tap tombol terlalu singkat tidak terlihat di UI | Polling UI (150–500 ms) lebih lambat dari ketukan (±100 ms). Backend menahan tombol selama `BTN_LATCH_S` sebagai `recent`; tampilkan `recent`, bukan `buttons`. |
| Nomor tombol browser ≠ nomor QGC | Gamepad API memakai urutan "standard" yang berbeda dari SDL. Terjemahan `STD_TO_SDL` hanya berlaku jika `gamepad.mapping === "standard"` (`readSnapshot()` mengembalikan field `mapping`). |
| `localStorage` hilang saat pindah alamat | Konfigurasi joystick disimpan per *origin*: `http://localhost:5500` dan `http://127.0.0.1:5500` terpisah. Pakai satu alamat yang konsisten, atau Export/Import. |
| File `.bat` rusak (perintah aneh / tulisan tidak terbaca) | `.bat` harus berakhir baris **CRLF** dan hanya berisi karakter **ASCII**. Jangan menyimpannya dengan editor yang mengubah line ending atau menambahkan karakter khusus. |
| Fungsi tombol "tidak jalan" padahal tombol terbaca | Fungsi tombol dijalankan firmware, hanya saat `MANUAL_CONTROL` dikirim (Enable Control ON) dan hanya jika `BTNn_FUNCTION` sudah diatur di Pixhawk. |