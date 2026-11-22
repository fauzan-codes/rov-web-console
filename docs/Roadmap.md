# Masalah yang Diketahui dan Rencana Pengembangan

Dokumen ini mencatat **apa yang belum beres** dan **apa yang direncanakan**, supaya siapa pun yang melanjutkan proyek tahu posisinya.

> Dokumen ini hidup. Kalau sebuah masalah selesai, **pindahkan atau hapus barisnya**. Kalau menemukan masalah baru, **tambahkan** dengan format yang sama.

Dokumen terkait: [DEVELOPER.md# Masalah yang Diketahui dan Rencana Pengembangan

Dokumen ini mencatat **apa yang belum beres** dan **apa yang direncanakan**, supaya siapa pun yang melanjutkan proyek tahu posisinya.

> Dokumen ini hidup. Kalau sebuah masalah selesai, **pindahkan atau hapus barisnya**. Kalau menemukan masalah baru, **tambahkan** dengan format yang sama.

Dokumen terkait: [DEVELOPER.md](DEVELOPER.md) (cara menambah fitur), [MANUAL.md](MANUAL.md) (cara menjalankan dan prosedur tes).

---

## Daftar isi

1. [Masalah yang diketahui](#1-masalah-yang-diketahui)
2. [Joystick dan pengaturan thruster: status dan langkah berikutnya](#2-joystick-dan-pengaturan-thruster-status-dan-langkah-berikutnya)
3. [Rekomendasi fitur dari QGroundControl / ArduSub](#3-rekomendasi-fitur-dari-qgroundcontrol--ardusub)
4. [Perbaikan lain (prioritas lebih rendah)](#4-perbaikan-lain-prioritas-lebih-rendah)
5. [Jangka panjang](#5-jangka-panjang)
6. [Pertanyaan yang masih terbuka](#6-pertanyaan-yang-masih-terbuka)

---

## 1. Masalah yang diketahui

Status: 🔴 belum berfungsi · 🟠 berfungsi sebagian / belum terverifikasi · 🟡 hanya tampilan · ⚪ keterbatasan desain

| # | Masalah | Status | Keterangan |
|---|---|---|---|
| 1 | **Record, Replay, Snapshot, simpan file ke laptop** | 🔴 | Belum berfungsi semestinya sejak kode awal. Lihat [1.1](#11-record-replay-snapshot-dan-simpan-file). |
| 2 | **Kedalaman (depth)** | 🟠 | Belum berfungsi semestinya. Lihat [1.2](#12-kedalaman-depth). |
| 3 | **Model 3D terlalu besar dan menyatu dengan jejak 3D** | 🟠 | Dot dan garis jejak 3D tertutup model. Belum diputuskan: digabung dengan trajectory atau dipisah. Lihat [1.3](#13-model-3d-dan-jejak-3d). |
| 4 | **Trajectory 2D belum bermakna** | 🟠 | Belum ada cara andal untuk mengetahui posisi robot. Lihat [1.4](#14-trajectory-2d-dan-posisi-robot). |
| 5 | **Ketergantungan CDN** | ⚪ | Tanpa internet di laptop, ikon hilang dan model 3D tidak muncul. Lihat [1.5](#15-ketergantungan-cdn-saat-offline). |
| 6 | **Tombol MANUAL / AUTONOMOUS** (panel Controls) | 🟡 | Hanya mengganti tampilan, tidak mengirim apa pun ke robot. Mode terbang (Manual / Stabilize / Depth Hold) sudah bisa diganti lewat panel **Drive Control**. Pilih: hubungkan tombol ini ke Drive Control, atau hapus. |
| 7 | **Kartu GRIPPER** | 🟡 | Menampilkan `N/A`. Backend belum mengirim data gripper. |
| 8 | **Alamat RTSP `127.0.0.1`** | ⚪ | Terjadi kalau Jetson tidak punya default gateway. Lihat [1.6](#16-alamat-rtsp-127001). |
| 9 | **Autentikasi backend** | ⚪ | Sebagian teratasi: fitur yang menulis ke robot **mati secara default** (`ROV_ENABLE_CONTROL`) dan token opsional (`ROV_CONTROL_TOKEN`). Endpoint baca (`/telemetry`, `/status`, video) tetap terbuka bagi siapa pun di jaringan yang sama; token tidak diwajibkan. |
| 10 | **`rov3d.js` dan `rovTopIcon.js` belum memakai `config.js`** | ⚪ | Masih punya alamat fallback dan batas kedalaman sendiri (duplikat). Bergantung pada urutan `<script>`. |
| 11 | **Trajectory 2D / 3D dua sistem terpisah** | ⚪ | Keduanya menghitung jejak sendiri dari data yang sama; bisa berbeda. |
| 12 | **Label kamera di overlay video backend** | ⚪ | Backend menulis `CAM 0`/`CAM 1` (mulai dari 0), sedangkan UI menulis CAM 1/CAM 2. Kosmetik. |
| 13 | **Drive Control belum dites dengan robot** | 🟠 | Teruji di mode DEV (tombol, ARM, mode, watchdog, Bridge). Belum dibandingkan dengan QGC di robot sungguhan (arah stick, PWM, fungsi tombol). Ikuti [prosedur tes](MANUAL.md#5-prosedur-tes-drive-control). |
| 14 | **Motor 4 tidak bersuara saat Test** | 🟠 | Motor 1, 2, 3, 5, 6 berputar, motor 4 belum. Dugaan awal mekanis/kabel/ESC; belum didiagnosis. Lihat [1.7](#17-motor-4-tidak-bersuara-saat-test). |
| 15 | **Nomor fungsi tombol belum terverifikasi** | ⚪ | `mode_stabilize` (6) dan `lights1_cycle` (31) di `BTN_FUNCTIONS` diturunkan dari urutan dokumentasi ArduSub, belum dicocokkan dengan firmware yang dipakai. Fungsi servo/relay/trim selalu lewat "Other number…". |
| 16 | **Pembaca XInput belum dicoba dengan joystick fisik** | 🟠 | Joystick Bridge (XInput + SDL, hot-plug) diuji di Linux dengan pembaca palsu terhadap backend asli. Pembacaan XInput di Windows dengan controller sungguhan belum dikonfirmasi. |
| 17 | **Tabel fungsi tombol di DEV tidak persisten** | ⚪ | `_dev_btn` hanya di memori; kembali ke default setiap backend di-restart. Di robot sungguhan tidak relevan (tabel dibaca dari Pixhawk). |
| 18 | **STATUSTEXT belum tampil di panel DATA LOG** | 🟡 | Backend menangkap pesan Pixhawk (dipakai untuk alasan penolakan ARM/mode/Test, dan dicetak di terminal), tetapi belum ditampilkan sebagai aliran di panel log dashboard. |
| 19 | **"Compass performance degraded" dari Pixhawk** | ⚪ | Pesan ini pernah muncul. Kalibrasi kompas tetap dikerjakan di QGC (lihat [2.5](#25-yang-tetap-dikerjakan-di-qgc-jangan-ditiru-di-web)). |
| 20 | **Satu pengirim kontrol (system id 255)** | ⚪ | Backend dan QGC memakai id yang sama; ArduSub hanya menerima `MANUAL_CONTROL` dari id itu. Joystick QGC harus dimatikan saat memakai Drive Control. |
| 21 | **Sumber Browser terbatas fokus tab** | ⚪ | Gamepad API berhenti saat tab disembunyikan; control dimatikan otomatis. Gunakan Joystick Bridge untuk operasi nyata. |

### 1.1 Record, Replay, Snapshot, dan simpan file

Gejala: tidak menghasilkan file yang bisa dipakai.

Penyebab yang mungkin (**perlu dikonfirmasi satu per satu**):

| Dugaan | Cara memeriksa | Perbaikan |
|---|---|---|
| Rekaman video hitam karena canvas "tainted" (gambar dari alamat lain, tanpa izin CORS) | Console browser menampilkan pesan *tainted canvas* / *SecurityError* saat merekam | Set `STREAM_CROSS_ORIGIN = true` di `config.js`. Cek preview kamera masih tampil. |
| Dialog pilih folder tidak tersedia | Tombol **Folder** tidak membuka dialog, atau pesan di panel log | Dialog hanya ada di Chrome/Edge, di `http://localhost` atau HTTPS, dan harus dipicu klik. Kalau dashboard dibuka lewat `http://192.168.x.x`, file masuk ke folder Downloads. |
| Snapshot gagal | Pesan `[SNAP] Kamera ... tidak tersedia` | Kamera harus **ON** dulu; endpoint `/snapshot/<id>` hanya ada frame kalau kamera aktif. Cek langsung `http://IP:8080/snapshot/0` di browser. |
| MediaRecorder tidak menghasilkan data | Ukuran file 0 MB di log | Pastikan stream kamera benar-benar jalan (ikon sinyal hijau) sebelum START RECORD. |
| Browser memblokir banyak unduhan sekaligus | Chrome menanyakan "Allow multiple downloads" | Klik izinkan, atau pilih folder lewat tombol **Folder**. |

Cara menyelidiki yang disarankan: buka Console (`F12`), tekan tombolnya, dan salin pesan merah pertama. Satu pesan error biasanya langsung menunjuk penyebabnya.

### 1.2 Kedalaman (depth)

Hal yang sudah diketahui dari kode:

- Titik nol kedalaman (`surface_pressure_hpa`) diambil dari **pesan tekanan pertama** setelah backend dinyalakan. Kalau backend dinyalakan saat ROV sudah di bawah permukaan, semua pembacaan akan bergeser.
- Tidak ada tombol untuk **mengkalibrasi ulang** titik nol. (Resep B di [DEVELOPER.md](DEVELOPER.md#resep-b--menambah-endpoint-dan-tombol-yang-memanggilnya-contoh-nol-kan-kedalaman) menunjukkan cara membuatnya.)
- Sumber kedalaman berganti otomatis: sensor tekanan (utama) → estimasi posisi NED / VFR_HUD (sementara, sebelum sensor tekanan tersedia).
- Tombol **Depth** di panel Controls saat ini hanya alarm tampilan (kartu kedalaman berkedip merah bila melewati `DEPTH_WARN_M`); belum ada alarm suara atau tindakan ke robot.

Yang perlu dikonfirmasi: masalah "depth belum berfungsi semestinya" itu tepatnya yang mana (angka salah / tidak berubah / tombol Depth / alarm)? Catat gejalanya di sini setelah diketahui.

### 1.3 Model 3D dan jejak 3D

- Model dibesarkan agar muat di panel (`fitModel()` di `rov3d.js`, skala `2.4 / ukuran-terbesar`), sedangkan jejak memakai skala 1 meter = 1 unit dunia dan penanda berukuran sekitar 0,05 unit. Hasilnya robot jauh lebih besar daripada jejak.
- Model ikut bergeser mengikuti jejak (posisi dari NED atau DR), dan selalu bergerak vertikal mengikuti kedalaman.
- Keputusan yang belum diambil:
  - **A. Model diam di tengah, hanya berputar** (roll/pitch/yaw), tanpa jejak. Sederhana dan mudah dibaca.
  - **B. Model bergerak mengikuti jejak** (seperti sekarang) tetapi diperkecil, atau jejak/penanda diperbesar, atau kamera mengikuti.
  - **C. Gabung** jejak 3D dan 2D menjadi satu sistem.
- Perubahan kecil untuk A: di `telemetry.js`, panggil `window.updateRov3DTrail(0, 0, depth, yaw, false)` supaya tidak ada gerak horizontal.

### 1.4 Trajectory 2D dan posisi robot

Tantangan intinya: **robot tidak punya sumber posisi bawah air yang andal.**

| Sumber | Kondisi sekarang |
|---|---|
| GPS | Tidak bekerja di bawah air. |
| `LOCAL_POSITION_NED` dari Pixhawk | Hanya valid kalau ada sumber posisi (DVL, GPS, atau sensor eksternal). Di kolam biasanya tidak ada. |
| Dead reckoning (`dr_x`, `dr_y`) di backend | Perkiraan kasar: kecepatan dari stick maju (RC kanal 5) dan integrasi percepatan IMU. **Melenceng (drift) dengan cepat** dan tidak bisa dipercaya untuk jarak jauh. |

> Catatan: dead reckoning memakai **RC kanal 5** (`RC_CHANNELS`) sebagai perkiraan stick maju. Saat robot dikemudikan lewat `MANUAL_CONTROL` dari web, kanal RC itu tidak mencerminkan stick yang dipakai, sehingga perkiraan DR bisa tidak sesuai. Perlu dievaluasi kalau trajectory ingin dipakai bersama Drive Control.

Pilihan arah jika ingin trajectory yang bermakna (butuh riset):
- **DVL** (Doppler Velocity Log): kecepatan di atas dasar, terbaik untuk posisi relatif.
- **USBL** / sistem akustik: posisi absolut.
- **Pelacakan visual** dari kamera (mis. penanda QR di dasar kolam) untuk koreksi posisi.
- Untuk kolam kompetisi: peta dengan penanda yang sudah diketahui, lalu koreksi posisi tiap kali penanda terbaca.

Sampai ada sumber yang andal, anggap trajectory sebagai **indikasi arah dan perkiraan**, bukan peta presisi.

### 1.5 Ketergantungan CDN saat offline

Dua hal dimuat dari internet saat dashboard dibuka:

| Isi | Sumber | Dampak kalau offline |
|---|---|---|
| Ikon (Font Awesome) | `cdnjs.cloudflare.com` | Ikon hilang. |
| Library 3D (three.js, GLTFLoader, OrbitControls) | `cdn.jsdelivr.net` | Panel ROV DESIGN dan ikon ROV di peta tidak muncul. |

Dua cara mengatasinya:

| Cara | Kelebihan | Kekurangan |
|---|---|---|
| **A. Simpan file ke proyek** (folder `frontend/vendor/`) lalu ubah `index.html` dan *import map* | Selalu jalan, termasuk **pertama kali** tanpa internet. Sederhana, ikut ter-push ke GitHub. | Menambah ukuran repo; perlu mengunduh file sekali. |
| **B. Cache di browser** (Service Worker): menyimpan CDN pada kunjungan pertama | Repo tetap kecil. | **Kunjungan pertama tetap harus online.** Lebih rumit. Cache bisa hilang kalau browser dibersihkan. |

Rekomendasi: **cara A**, karena kebutuhan lomba biasanya di lokasi tanpa internet dan kunjungan pertama pun bisa terjadi di sana. Ide menyimpan di browser tetap valid sebagai tambahan.

Yang perlu disiapkan untuk cara A: `three.module.js`, `GLTFLoader.js`, `OrbitControls.js` (dan berkas yang mereka impor dari `three/addons/`), plus CSS dan folder `webfonts` Font Awesome.

### 1.6 Alamat RTSP `127.0.0.1`

Backend membentuk alamat RTSP dari IP Jetson memakai fungsi `get_local_ip()`:

```python
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.connect(("8.8.8.8", 80))       # "andaikan" mengirim ke internet
ip = s.getsockname()[0]          # lihat IP mana yang dipilih sistem
```

Trik ini bertanya ke sistem operasi: *"kalau kamu mau menghubungi 8.8.8.8, kamu pakai IP yang mana?"* Tidak ada paket yang benar-benar dikirim. Tapi kalau Jetson **tidak punya default gateway** (tidak ada rute ke luar jaringan lokal, misalnya hanya tersambung kabel LAN ke laptop), sistem menjawab "network unreachable", fungsi gagal, dan jatuh ke nilai cadangan `127.0.0.1` (alamat "diri sendiri").

Akibatnya URL RTSP di `/status` dan log menjadi `rtsp://127.0.0.1:8554/camera0`, yang **salah untuk laptop** (di laptop `127.0.0.1` berarti laptop sendiri). Dashboard web tidak memakai URL ini sehingga tidak terganggu, tapi VLC/ffplay di laptop akan gagal memakainya.

Cara memperbaiki (belum dikerjakan): ambil IP dari antarmuka jaringan yang aktif tanpa bergantung pada rute keluar, misalnya memilih alamat non-loopback dari daftar antarmuka, atau menyediakan variabel lingkungan `ROV_HOST_IP` yang bisa diatur manual. Sementara ini, alamat RTSP yang benar tinggal mengganti `127.0.0.1` dengan IP Jetson (`hostname -I`).

### 1.7 Motor 4 tidak bersuara saat Test

Gejala: pada **Settings → Thruster → Test**, motor 1, 2, 3, 5, 6 berputar, motor 4 tidak. Perintah dari backend sama untuk semua motor (`mav_motor_test`), dan Pixhawk menerimanya, jadi sumber masalah kemungkinan di luar web.

Langkah diagnosa yang disarankan (urut dari yang termurah):

| Langkah | Yang dilihat | Arti |
|---|---|---|
| Jalankan Test motor 4 sambil melihat **PWM4** di panel Telemetry | PWM4 berubah dari ±1500 ke ±1500 + `percent × 4` | Berubah → Pixhawk mengeluarkan sinyal; masalah di ESC, kabel, atau thruster. Tidak berubah → pemetaan output/`MOT_4_FUNCTION`, atau perintah tidak sampai. |
| Naikkan daya uji ke 20–30% (batas `MOTOR_TEST_MAX_PERCENT`) | Motor berputar pada daya lebih tinggi? | Daya rendah bisa di bawah deadband ESC tertentu. |
| Tukar kabel sinyal / ESC motor 4 dengan motor yang berfungsi | Masalah ikut berpindah? | Ikut berpindah → ESC atau kabel. Tetap di posisi → thruster atau output Pixhawk. |
| Bandingkan dengan **Motor Setup** di QGroundControl | Motor 4 berputar di QGC? | Berputar di QGC tetapi tidak di web → periksa `ROV_MOTOR_TEST_INDEX_BASE` dan nomor motor yang dikirim. Tidak berputar di QGC → masalah di robot. |

---

## 2. Joystick dan pengaturan thruster: status dan langkah berikutnya

**Tujuan awal:** tidak perlu QGroundControl lagi untuk dua hal yang selama ini hanya dipakai di sana: **mengendalikan ROV dengan joystick** dan **mengatur motor/thruster** (mis. membalik arah). Cukup dari web GCS.

**Status:** fitur sudah dibangun dan teruji di **mode DEV**. Test motor sudah teruji di robot. **Mengemudi dengan joystick, ARM, dan fungsi tombol di robot sungguhan belum dites.** Cara kerja kode ada di [DEVELOPER.md, bagian 2.7](DEVELOPER.md#27-rov_controlpy-drive-control); prosedur tes di [MANUAL.md, bagian 5](MANUAL.md#5-prosedur-tes-drive-control).

### 2.1 Cara kerjanya (ringkas)

ArduSub menerima kendali dari GCS lewat pesan MAVLink **`MANUAL_CONTROL`** (sumbu x, y, z, r dan bitmask tombol). Autopilot-lah yang mengubahnya menjadi PWM tiap thruster (frame mixing), jadi web **tidak** menghitung PWM sendiri.

```
 Joystick ──► Joystick Bridge ──HTTP──► Backend ──MAVLink──► mavlink-routerd ──► Pixhawk ──PWM──► Thruster
 (USB)        (laptop; XInput/SDL)      validasi, watchdog,  (MAVProxy2.py,      MANUAL_CONTROL    (mixing di
              atau Gamepad API          kirim 20 Hz tetap    Jetson)             + HEARTBEAT GCS    ArduSub)
              di browser                + heartbeat 1 Hz
```

Nilai yang perlu tetap diverifikasi terhadap dokumentasi ArduSub sesuai versi firmware:
- Rentang dan nilai netral tiap sumbu `MANUAL_CONTROL` (di kode: x, y, r −1000…1000; z 0…1000 dengan netral 500).
- Arti bit tombol dan fungsi yang dipasang ke tiap tombol (parameter `BTNn_FUNCTION`).
- Nama parameter failsafe GCS dan perilakunya (`FS_GCS_ENABLE`).

### 2.2 Pembagian pekerjaan (sesuai implementasi)

| Bagian | Dikerjakan di | Catatan |
|---|---|---|
| Membaca joystick | **Joystick Bridge** (XInput / SDL di laptop) atau **browser** (Gamepad API) | Bridge tidak terpengaruh fokus/tab. |
| Deadband, invert, exponential, gain, pemetaan axis → gerak | **Dashboard** (Settings → Joystick) menyimpan; **backend** menerapkannya untuk Bridge, browser untuk sumber Browser | Konfigurasi disalin ke `backend/joystick_config.json`. |
| Fungsi tombol (arm, mode, gain, lampu, …) | **Firmware** (`BTNn_FUNCTION`, `BTNn_SFUNCTION`) | Dikonfigurasi dari Settings → Button Assignment. |
| Mixing thruster dan PWM | **Firmware ArduSub** | Web tidak menyentuhnya. |
| Arah putar motor | **Firmware** (`MOT_n_DIRECTION`) | Dibaca/ditulis dari Settings → Thruster; sumber kebenaran tetap di Pixhawk. |
| Pengiriman 20 Hz tetap, watchdog, heartbeat GCS | **Backend** (`rov_control.py`) | Tidak mengandalkan browser untuk waktu yang presisi. |

### 2.3 Tahapan dan statusnya

| Tahap | Isi | Status |
|---|---|---|
| **0. Investigasi** | Jalur QGC ke Pixhawk dan port: **terjawab** (Pixhawk → `mavlink-routerd` lewat `MAVProxy2.py` di Jetson → UDP: QGC `192.168.1.3:14550`, backend `127.0.0.1:14560`, program lain `127.0.0.1:14570`). Backend memakai jalur yang sama untuk menerima dan mengirim. | ✅ Selesai. Masih terbuka: versi firmware ArduSub dan ekspor daftar parameter sebagai cadangan; laju `MANUAL_CONTROL` QGC belum diukur. |
| **1. Deteksi joystick** | Settings → Joystick: daftar perangkat, bar axis, kotak tombol, mapping, deadband/exponential/gain, Save/Export/Import | ✅ Selesai. |
| **2. Saluran perintah di backend** | Koneksi MAVLink bersama (dengan lock), heartbeat GCS 1 Hz, `MANUAL_CONTROL` 20 Hz, watchdog, ARM/DISARM, mode (Manual/Stabilize/Depth Hold), `ROV_ENABLE_CONTROL`, token opsional, Joystick Bridge | ✅ Selesai dan teruji di DEV. ⏳ **Uji bangku di robot (baling-baling dilepas) belum dilakukan.** |
| **3. Pengaturan thruster** | Reverse per motor (tulis parameter, baca ulang, verifikasi), Test motor (batas daya/durasi), **Button Assignment** | ✅ Selesai. Test teruji di robot; Reverse dan Button Assignment di Pixhawk belum dicoba di robot. Belum ada tombol "kembalikan" nilai lama (riwayat perubahan ditampilkan di tab Thruster). |
| **4. Pelengkap** | Indikator status kontrol di header (chip `DRIVE`, ARMED/DISARMED, mode) | ✅ Selesai. |
| | Tombol lampu, gripper, camera tilt lewat tombol joystick | ⏳ Tinggal mengatur `BTNn_FUNCTION` yang sesuai dan memverifikasi di robot (tidak butuh kode baru kecuali kalau butuh tampilan khusus). |
| | Fitur dari [bagian 3](#3-rekomendasi-fitur-dari-qgroundcontrol--ardusub) | ⏳ |

### 2.4 Aturan keselamatan (sudah diterapkan, wajib dipertahankan)

| # | Aturan | Implementasi |
|---|---|---|
| 1 | **Default mati.** Kontrol dari web butuh tindakan sadar. | `ROV_ENABLE_CONTROL=1` di backend + tombol Enable Control di UI |
| 2 | **Watchdog di backend**, bukan di browser. | `WATCHDOG_S` (0,4 s) → netral; `STALE_OFF_S` (2 s) → control dimatikan |
| 3 | **Netral saat putus** (joystick dicabut, tab ditutup, jaringan putus). | Bridge melaporkan `connected:false`; sumber Browser dimatikan saat tab disembunyikan / kehilangan fokus; `NEUTRAL_BURST` frame netral setelah control dimatikan |
| 4 | **Satu sumber kontrol saja.** | System id 255 = QGC; joystick QGC harus dimatikan (dicatat di UI, MANUAL, README) |
| 5 | **Pembatasan nilai dan laju** di backend. | Clamp −1..1, `LIMIT` (`ROV_CONTROL_LIMIT`), laju kirim tetap 20 Hz |
| 6 | **Arm dan mode butuh konfirmasi**, tampilkan status sesungguhnya. | Dialog konfirmasi ARM; status dari heartbeat; `verified` |
| 7 | **Setiap penulisan parameter dicatat**, dengan nilai lama dan baru. | Log `[CTRL]` / `[MAVLink]` di backend dan `[BUTTON]` / riwayat di UI |
| 8 | **Uji tanpa baling-baling dulu**, lalu bangku, baru air. | Prosedur di [MANUAL.md, bagian 5](MANUAL.md#5-prosedur-tes-drive-control) |
| 9 | **Jangan mengunci diri dari QGC.** Simpan QGC sebagai cadangan sampai fitur web terbukti stabil, terutama menjelang lomba. | Tetap berlaku |
| 10 | **Autentikasi minimal** pada endpoint kontrol dan batasi ke jaringan lokal. | Token opsional; **belum diwajibkan** (lihat masalah #9) |
| 11 | **Enable hanya jika stick netral dan tidak ada tombol ditekan.** | `START_NEUTRAL_TOL`, pemeriksaan di `control_enable()` |
| 12 | **STOP selalu tersedia.** | `/control/stop` tanpa token; tombol STOP dan `Space` |

### 2.5 Yang tetap dikerjakan di QGC (jangan ditiru di web)

Kalibrasi sensor (kompas, akselerometer), pemasangan firmware, pengaturan ESC/radio, dan pengaturan frame awal berisiko tinggi kalau salah dan jarang dilakukan. Biarkan di QGC.

### 2.6 Langkah berikutnya (urutan disarankan)

1. Perbarui Jetson dengan `gcs_server.py` dan `rov_control.py` terbaru ([MANUAL.md, bagian 4.2](MANUAL.md#42-memperbarui-file-di-jetson)).
2. Jalankan **prosedur tes bagian 5** (baling-baling dilepas): bandingkan PWM1–6 dengan QGC untuk gerakan stick yang sama, catat arah yang terbalik.
3. Verifikasi nomor fungsi tombol (`mode_stabilize`=6, `lights1_cycle`=31) dan atur tombol lampu/camera tilt di Pixhawk.
4. Tes di air dengan `ROV_CONTROL_LIMIT=0.5`, lalu naikkan bertahap.
5. Putuskan nasib tombol MANUAL/AUTONOMOUS (#6) dan diagnosa motor 4 (#14).
6. Catat hasil (arah, PWM, jenis joystick, versi firmware) di dokumen ini.

---

## 3. Rekomendasi fitur dari QGroundControl / ArduSub

Disusun berdasarkan **manfaat untuk robot kalian** dibanding **usaha** pengerjaan. Semua diperiksa ulang terhadap dokumentasi ArduSub sebelum dibuat.

| Fitur | Manfaat | Usaha | Status / catatan |
|---|---|---|---|
| **Arm / Disarm + pilih mode** (Manual, Stabilize, Depth Hold) | Tinggi | Sedang | ✅ Selesai (Drive Control). Belum dites di robot. |
| **Pesan dari autopilot** (`STATUSTEXT`) di panel log | Tinggi | Rendah | ⏳ Sebagian: backend sudah menangkap pesan (alasan penolakan ARM/mode/Test tampil di UI); belum menjadi aliran di panel DATA LOG (masalah #18). |
| **Tegangan dan arus baterai** (`SYS_STATUS`) | Tinggi (keselamatan) | Rendah | ⏳ Contoh langkah lengkap ada di [DEVELOPER.md, Resep A](DEVELOPER.md#resep-a--menambah-data-baru-dari-pixhawk-contoh-tegangan-baterai). |
| **Indikator kebocoran (leak)** | Tinggi (keselamatan) | Rendah–sedang | ⏳ Periksa dulu bagaimana firmware kalian melaporkannya. |
| **Fungsi tombol joystick** (lampu, gripper, kemiringan kamera) | Tinggi | Rendah | ✅ Infrastruktur selesai (Button Assignment). Tinggal diatur dan diverifikasi di robot. |
| **Editor parameter** (cari, baca, ubah) | Sedang–tinggi | Sedang | ⏳ Sebagian: jalur baca/tulis parameter dengan verifikasi sudah ada (dipakai `MOT_n_DIRECTION` dan `BTNn_FUNCTION`); belum ada UI pencarian parameter umum. Perlu pengaman tulis (konfirmasi, catatan, cadangan). |
| **Nol-kan kedalaman** | Tinggi | Rendah | ⏳ Resep B di DEVELOPER.md. |
| **Gain / sensitivitas pilot** | Sedang | Rendah | ✅ Gain di Settings (skala di web) dan fungsi tombol `gain_inc`/`gain_dec` (firmware, parameter `JS_GAIN_*`). |
| **Tampilan HUD** (garis horizon, kompas, kedalaman) di atas video | Sedang | Sedang | ⏳ |
| **Rekam video dengan overlay telemetri** | Sedang | Sedang–tinggi | ⏳ Setelah rekaman dasar beres. |
| **Unduh log penerbangan** dari Pixhawk | Rendah–sedang | Sedang | ⏳ Berguna untuk analisis setelah lomba. |
| **Misi otomatis / waypoint** | Rendah sekarang | Tinggi | ⏳ Butuh posisi yang andal (lihat [1.4](#14-trajectory-2d-dan-posisi-robot)). |
| **Kalibrasi sensor, firmware, ESC** | Tidak disarankan | — | Tetap di QGC. |

Urutan yang disarankan setelah Drive Control terbukti di robot: pesan autopilot di panel log → baterai → leak → nol-kan kedalaman → HUD.

---

## 4. Perbaikan lain (prioritas lebih rendah)

| Pekerjaan | Keterangan |
|---|---|
| Perbaiki record / replay / snapshot / simpan | Lihat [1.1](#11-record-replay-snapshot-dan-simpan-file). |
| Selidiki dan perbaiki kedalaman | Lihat [1.2](#12-kedalaman-depth). |
| Putuskan nasib model 3D dan jejak | Lihat [1.3](#13-model-3d-dan-jejak-3d). |
| Jadikan frontend jalan offline | Lihat [1.5](#15-ketergantungan-cdn-saat-offline), cara A. |
| Perbaiki `get_local_ip()` | Lihat [1.6](#16-alamat-rtsp-127001). |
| Rapikan `rov3d.js` dan `rovTopIcon.js` | Pakai `import` dari `config.js`, hilangkan duplikat dan ketergantungan urutan `<script>`. Komentar kedua file masih menyebut `interact.js` (nama lama). |
| Tampilkan STATUSTEXT di panel DATA LOG | Lihat masalah #18. |
| Diagnosa motor 4 | Lihat [1.7](#17-motor-4-tidak-bersuara-saat-test). |
| Kalibrasi kompas | Lihat masalah #19; dikerjakan di QGC. |
| Kartu GRIPPER | Backend mengirim field `gripper`; frontend sudah siap menampilkannya (`updateSpecs()` di `telemetry.js`). |
| Hubungkan atau hapus tombol MANUAL / AUTONOMOUS | Lihat masalah #6. |
| Samakan label kamera backend (0-based) dengan UI (1-based) | Kosmetik. |
| Tentukan satu sistem jejak | Gabungkan jejak 2D dan 3D (lihat [1.3](#13-model-3d-dan-jejak-3d)). |
| Tombol "kembalikan" nilai lama di tab Thruster | Menyimpan nilai sebelum diubah dan memulihkannya dengan satu klik (saat ini hanya riwayat tampilan). |
| Simpan tabel fungsi tombol DEV ke file | Opsional; hanya mempermudah pengembangan (masalah #17). |
| Skrip deploy ke Jetson | Menyalin `gcs_server.py` dan `rov_control.py` ke Jetson dan me-restart backend (saat ini manual lewat `scp`). |
| Backend jalan otomatis di Jetson | `systemd` atau `tmux` otomatis saat boot, termasuk `MAVProxy2.py`. |

---

## 5. Jangka panjang

- **Refactor kode inti robot** milik angkatan sebelumnya (jalur MAVLink antara laptop dan robot, dan berkas inti lain). `MAVProxy2.py` (peluncur `mavlink-routerd` dengan watchdog heartbeat dan daftar endpoint UDP) sudah dipahami perilakunya. Pendekatan yang sama dengan GCS: pahami dulu perilakunya, tulis ulang rapi tanpa mengubah perilaku, baru tambah fitur. Mulai dengan menuliskan *apa yang dikerjakan tiap file* sebelum mengubah apa pun.
- **Pengujian otomatis** untuk logika yang tidak bergantung pada perangkat keras: parser pesan, `resolvePosition`, dead reckoning, dan terutama **`rov_control`** (mapping dan kurva joystick, watchdog, syarat Enable, emulator tombol). Backend sudah mudah diuji karena `rov_control` tidak mengimpor `gcs_server` (cukup memakai Flask test client dengan pembaca Bridge palsu).
- **Server produksi** menggantikan server pengembangan Flask (peringatan yang muncul di log Jetson) kalau backend mulai melayani banyak klien atau fitur kontrol.
- **Satu pintu konfigurasi** untuk backend (berkas atau variabel lingkungan), seperti `config.js` di frontend. Saat ini konfigurasi tersebar di konstanta `gcs_server.py`, `rov_control.py`, dan variabel lingkungan.
- **Autentikasi yang wajib** pada endpoint kontrol dan pembatasan akses jaringan, bila robot dipakai di jaringan bersama.
- **Distribusi Joystick Bridge** yang lebih mudah (mis. satu file `.exe`) bagi anggota tim yang tidak memasang Python.
- **Proses rilis**: tandai versi (tag) di GitHub sebelum lomba, supaya selalu ada versi yang terbukti jalan untuk dikembalikan.

---

## 6. Pertanyaan yang masih terbuka

Jawabannya menentukan arah pekerjaan. Isi di sini begitu sudah diketahui.

**Sudah terjawab:**
- ~~**Bagaimana QGC tersambung ke Pixhawk sekarang?**~~ Pixhawk → serial USB → `mavlink-routerd` (dijalankan `MAVProxy2.py` di Jetson) → UDP ke QGC (`192.168.1.3:14550`), backend web (`127.0.0.1:14560`), dan program lain (`127.0.0.1:14570`). Backend mengirim perintah lewat endpoint yang sama dengan penerimaan telemetri.

**Masih terbuka:**
1. **Versi firmware ArduSub** yang terpasang (dan ekspor daftar parameter sebagai cadangan). Frame sudah diketahui: 6 thruster (3 vertikal, 2 maju/mundur, 1 lateral).
2. **Joystick apa yang dipakai di lomba** (merek/tipe, XInput atau bukan, jumlah tombol). Menentukan jalur pembacaan Bridge dan layout default.
3. **Gejala tepat masalah kedalaman** (lihat [1.2](#12-kedalaman-depth)).
4. **Model 3D dan jejak: digabung atau dipisah?** (lihat [1.3](#13-model-3d-dan-jejak-3d)).
5. **Apakah dashboard akan dipakai di tempat tanpa internet?** Kalau ya, naikkan prioritas [1.5](#15-ketergantungan-cdn-saat-offline).
6. **Siapa yang boleh mengendalikan robot?** Menentukan apakah token kontrol diwajibkan (masalah #9).
7. **Apakah QGroundControl tetap disiapkan sebagai cadangan saat lomba?** Rekomendasi: ya (aturan 9 di [2.4](#24-aturan-keselamatan-sudah-diterapkan-wajib-dipertahankan)). Perlu disepakati prosedur beralih (matikan Drive Control di web, aktifkan joystick di QGC).
8. **Nilai `FS_GCS_ENABLE` dan perilaku failsafe** yang diinginkan saat dashboard/Bridge terputus di air (backend sudah mengirim heartbeat GCS 1 Hz dan menetralkan output, tetapi reaksi akhir dikendalikan firmware).](DEVELOPER.md) (cara menambah fitur), [MANUAL.md](MANUAL.md) (cara menjalankan).

---

## Daftar isi

1. [Masalah yang diketahui](#1-masalah-yang-diketahui)
2. [Prioritas utama: joystick dan pengaturan thruster](#2-prioritas-utama-joystick-dan-pengaturan-thruster)
3. [Rekomendasi fitur dari QGroundControl / ArduSub](#3-rekomendasi-fitur-dari-qgroundcontrol--ardusub)
4. [Perbaikan lain (prioritas lebih rendah)](#4-perbaikan-lain-prioritas-lebih-rendah)
5. [Jangka panjang](#5-jangka-panjang)
6. [Pertanyaan yang masih terbuka](#6-pertanyaan-yang-masih-terbuka)

---

## 1. Masalah yang diketahui

Status: 🔴 belum berfungsi · 🟠 berfungsi sebagian · 🟡 hanya tampilan · ⚪ keterbatasan desain

| # | Masalah | Status | Keterangan |
|---|---|---|---|
| 1 | **Record, Replay, Snapshot, simpan file ke laptop** | 🔴 | Belum berfungsi semestinya sejak kode awal. Lihat [1.1](#11-record-replay-snapshot-dan-simpan-file). |
| 2 | **Kedalaman (depth)** | 🟠 | Belum berfungsi semestinya. Lihat [1.2](#12-kedalaman-depth). |
| 3 | **Model 3D terlalu besar dan menyatu dengan jejak 3D** | 🟠 | Dot dan garis jejak 3D tertutup model. Belum diputuskan: digabung dengan trajectory atau dipisah. Lihat [1.3](#13-model-3d-dan-jejak-3d). |
| 4 | **Trajectory 2D belum bermakna** | 🟠 | Belum ada cara andal untuk mengetahui posisi robot. Lihat [1.4](#14-trajectory-2d-dan-posisi-robot). |
| 5 | **Ketergantungan CDN** | ⚪ | Tanpa internet di laptop, ikon hilang dan model 3D tidak muncul. Lihat [1.5](#15-ketergantungan-cdn-saat-offline). |
| 6 | **Tombol MANUAL / AUTONOMOUS** | 🟡 | Hanya mengganti tampilan, tidak mengirim apa pun ke robot. |
| 7 | **Tombol menu (pojok kanan atas)** | 🟡 | Belum ada isinya. Rencana: halaman pengaturan robot. |
| 8 | **Kartu GRIPPER** | 🟡 | Menampilkan `N/A`. Backend belum mengirim data gripper. |
| 9 | **Alamat RTSP `127.0.0.1`** | ⚪ | Terjadi kalau Jetson tidak punya default gateway. Lihat [1.6](#16-alamat-rtsp-127001). |
| 10 | **Backend tanpa autentikasi** | ⚪ | Siapa pun di jaringan yang sama bisa memanggil endpoint. Aman untuk saat ini (hanya baca), **harus diatasi sebelum ada fitur kontrol** (bagian 2). |
| 11 | **`rov3d.js` dan `rovTopIcon.js` belum memakai `config.js`** | ⚪ | Masih punya alamat fallback dan batas kedalaman sendiri (duplikat). Bergantung pada urutan `<script>`. |
| 12 | **Trajectory 2D / 3D dua sistem terpisah** | ⚪ | Keduanya menghitung jejak sendiri dari data yang sama; bisa berbeda. |
| 13 | **Label kamera di overlay video backend** | ⚪ | Backend menulis `CAM 0`/`CAM 1` (mulai dari 0), sedangkan UI menulis CAM 1/CAM 2. Kosmetik. |

### 1.1 Record, Replay, Snapshot, dan simpan file

Gejala: tidak menghasilkan file yang bisa dipakai.

Penyebab yang mungkin (**perlu dikonfirmasi satu per satu**):

| Dugaan | Cara memeriksa | Perbaikan |
|---|---|---|
| Rekaman video hitam karena canvas "tainted" (gambar dari alamat lain, tanpa izin CORS) | Console browser menampilkan pesan *tainted canvas* / *SecurityError* saat merekam | Set `STREAM_CROSS_ORIGIN = true` di `config.js`. Cek preview kamera masih tampil. |
| Dialog pilih folder tidak tersedia | Tombol **Folder** tidak membuka dialog, atau pesan di panel log | Dialog hanya ada di Chrome/Edge, di `http://localhost` atau HTTPS, dan harus dipicu klik. Kalau dashboard dibuka lewat `http://192.168.x.x`, file masuk ke folder Downloads. |
| Snapshot gagal | Pesan `[SNAP] Kamera ... tidak tersedia` | Kamera harus **ON** dulu; endpoint `/snapshot/<id>` hanya ada frame kalau kamera aktif. Cek langsung `http://IP:8080/snapshot/0` di browser. |
| MediaRecorder tidak menghasilkan data | Ukuran file 0 MB di log | Pastikan stream kamera benar-benar jalan (ikon sinyal hijau) sebelum START RECORD. |
| Browser memblokir banyak unduhan sekaligus | Chrome menanyakan "Allow multiple downloads" | Klik izinkan, atau pilih folder lewat tombol **Folder**. |

Cara menyelidiki yang disarankan: buka Console (`F12`), tekan tombolnya, dan salin pesan merah pertama. Satu pesan error biasanya langsung menunjuk penyebabnya.

### 1.2 Kedalaman (depth)

Hal yang sudah diketahui dari kode:

- Titik nol kedalaman (`surface_pressure_hpa`) diambil dari **pesan tekanan pertama** setelah backend dinyalakan. Kalau backend dinyalakan saat ROV sudah di bawah permukaan, semua pembacaan akan bergeser.
- Tidak ada tombol untuk **mengkalibrasi ulang** titik nol. (Resep B di [DEVELOPER.md](DEVELOPER.md#resep-b--menambah-endpoint-dan-tombol-yang-memanggilnya-contoh-nol-kan-kedalaman) menunjukkan cara membuatnya.)
- Sumber kedalaman berganti otomatis: sensor tekanan (utama) → estimasi posisi NED / VFR_HUD (sementara, sebelum sensor tekanan tersedia).
- Tombol **Depth** di panel Controls saat ini hanya alarm tampilan (kartu kedalaman berkedip merah bila melewati `DEPTH_WARN_M`); belum ada alarm suara atau tindakan ke robot.

Yang perlu dikonfirmasi: masalah "depth belum berfungsi semestinya" itu tepatnya yang mana (angka salah / tidak berubah / tombol Depth / alarm)? Catat gejalanya di sini setelah diketahui.

### 1.3 Model 3D dan jejak 3D

- Model dibesarkan agar muat di panel (`fitModel()` di `rov3d.js`, skala `2.4 / ukuran-terbesar`), sedangkan jejak memakai skala 1 meter = 1 unit dunia dan penanda berukuran sekitar 0,05 unit. Hasilnya robot jauh lebih besar daripada jejak.
- Model ikut bergeser mengikuti jejak (posisi dari NED atau DR), dan selalu bergerak vertikal mengikuti kedalaman.
- Keputusan yang belum diambil:
  - **A. Model diam di tengah, hanya berputar** (roll/pitch/yaw), tanpa jejak. Sederhana dan mudah dibaca.
  - **B. Model bergerak mengikuti jejak** (seperti sekarang) tetapi diperkecil, atau jejak/penanda diperbesar, atau kamera mengikuti.
  - **C. Gabung** jejak 3D dan 2D menjadi satu sistem.
- Perubahan kecil untuk A: di `telemetry.js`, panggil `window.updateRov3DTrail(0, 0, depth, yaw, false)` supaya tidak ada gerak horizontal.

### 1.4 Trajectory 2D dan posisi robot

Tantangan intinya: **robot tidak punya sumber posisi bawah air yang andal.**

| Sumber | Kondisi sekarang |
|---|---|
| GPS | Tidak bekerja di bawah air. |
| `LOCAL_POSITION_NED` dari Pixhawk | Hanya valid kalau ada sumber posisi (DVL, GPS, atau sensor eksternal). Di kolam biasanya tidak ada. |
| Dead reckoning (`dr_x`, `dr_y`) di backend | Perkiraan kasar: kecepatan dari stick maju (RC kanal 5) dan integrasi percepatan IMU. **Melenceng (drift) dengan cepat** dan tidak bisa dipercaya untuk jarak jauh. |

Pilihan arah jika ingin trajectory yang bermakna (butuh riset):
- **DVL** (Doppler Velocity Log): kecepatan di atas dasar, terbaik untuk posisi relatif.
- **USBL** / sistem akustik: posisi absolut.
- **Pelacakan visual** dari kamera (mis. penanda QR di dasar kolam) untuk koreksi posisi.
- Untuk kolam kompetisi: peta dengan penanda yang sudah diketahui, lalu koreksi posisi tiap kali penanda terbaca.

Sampai ada sumber yang andal, anggap trajectory sebagai **indikasi arah dan perkiraan**, bukan peta presisi.

### 1.5 Ketergantungan CDN saat offline

Dua hal dimuat dari internet saat dashboard dibuka:

| Isi | Sumber | Dampak kalau offline |
|---|---|---|
| Ikon (Font Awesome) | `cdnjs.cloudflare.com` | Ikon hilang. |
| Library 3D (three.js, GLTFLoader, OrbitControls) | `cdn.jsdelivr.net` | Panel ROV DESIGN dan ikon ROV di peta tidak muncul. |

Dua cara mengatasinya:

| Cara | Kelebihan | Kekurangan |
|---|---|---|
| **A. Simpan file ke proyek** (folder `frontend/vendor/`) lalu ubah `index.html` dan *import map* | Selalu jalan, termasuk **pertama kali** tanpa internet. Sederhana, ikut ter-push ke GitHub. | Menambah ukuran repo; perlu mengunduh file sekali. |
| **B. Cache di browser** (Service Worker): menyimpan CDN pada kunjungan pertama | Repo tetap kecil. | **Kunjungan pertama tetap harus online.** Lebih rumit. Cache bisa hilang kalau browser dibersihkan. |

Rekomendasi: **cara A**, karena kebutuhan lomba biasanya di lokasi tanpa internet dan kunjungan pertama pun bisa terjadi di sana. Ide menyimpan di browser tetap valid sebagai tambahan.

Yang perlu disiapkan untuk cara A: `three.module.js`, `GLTFLoader.js`, `OrbitControls.js` (dan berkas yang mereka impor dari `three/addons/`), plus CSS dan folder `webfonts` Font Awesome.

### 1.6 Alamat RTSP `127.0.0.1`

Backend membentuk alamat RTSP dari IP Jetson memakai fungsi `get_local_ip()`:

```python
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.connect(("8.8.8.8", 80))       # "andaikan" mengirim ke internet
ip = s.getsockname()[0]          # lihat IP mana yang dipilih sistem
```

Trik ini bertanya ke sistem operasi: *"kalau kamu mau menghubungi 8.8.8.8, kamu pakai IP yang mana?"* Tidak ada paket yang benar-benar dikirim. Tapi kalau Jetson **tidak punya default gateway** (tidak ada rute ke luar jaringan lokal, misalnya hanya tersambung kabel LAN ke laptop), sistem menjawab "network unreachable", fungsi gagal, dan jatuh ke nilai cadangan `127.0.0.1` (alamat "diri sendiri").

Akibatnya URL RTSP di `/status` dan log menjadi `rtsp://127.0.0.1:8554/camera0`, yang **salah untuk laptop** (di laptop `127.0.0.1` berarti laptop sendiri). Dashboard web tidak memakai URL ini sehingga tidak terganggu, tapi VLC/ffplay di laptop akan gagal memakainya.

Cara memperbaiki (belum dikerjakan): ambil IP dari antarmuka jaringan yang aktif tanpa bergantung pada rute keluar, misalnya memilih alamat non-loopback dari daftar antarmuka, atau menyediakan variabel lingkungan `ROV_HOST_IP` yang bisa diatur manual. Sementara ini, alamat RTSP yang benar tinggal mengganti `127.0.0.1` dengan IP Jetson (`hostname -I`).

---

## 2. Prioritas utama: joystick dan pengaturan thruster

**Tujuan:** tidak perlu QGroundControl lagi untuk dua hal yang selama ini hanya dipakai di sana: **mengendalikan ROV dengan joystick** dan **mengatur motor/thruster** (mis. membalik arah). Cukup dari web GCS.

Ini fitur pertama yang **mengirim perintah ke robot**, jadi sifatnya berbeda dari semua fitur sebelumnya (yang hanya membaca). Ia butuh desain dan pengaman yang matang. **Jangan dikerjakan dengan resep sederhana.**

### 2.1 Cara kerjanya (gambaran)

ArduSub menerima kendali dari GCS lewat pesan MAVLink **`MANUAL_CONTROL`** (sumbu x, y, z, r dan bitmask tombol). Autopilot-lah yang mengubahnya menjadi PWM tiap thruster (frame mixing), jadi web **tidak** menghitung PWM sendiri.

```
 Joystick ──► Browser (Gamepad API) ──► Backend ──MAVLink──► Pixhawk ──PWM──► Thruster
 (USB)        baca sumbu & tombol       validasi,            MANUAL_CONTROL      (mixing di
              + pemetaan/deadzone       watchdog, kirim      + HEARTBEAT GCS      ArduSub)
                                        20 Hz tetap
```

Nilai-nilai yang perlu diverifikasi ke dokumentasi ArduSub sesuai versi firmware kalian (jangan percaya dokumen ini tanpa mengecek):
- Rentang dan nilai netral tiap sumbu `MANUAL_CONTROL`. Pada ArduSub, sumbu `z` (naik/turun) biasanya berskala 0–1000 dengan netral di tengah, berbeda dari x, y, r yang −1000…1000.
- Arti bit tombol dan fungsi yang dipasang ke tiap tombol (parameter `BTNn_FUNCTION` di firmware: lampu, gripper, ganti mode, dll.).
- Nama parameter failsafe GCS dan perilakunya (parameter `FS_GCS_ENABLE`).

### 2.2 Pembagian pekerjaan

| Bagian | Dikerjakan di | Catatan |
|---|---|---|
| Membaca joystick | **Browser** (Gamepad API, Chrome/Edge) | Sumbu −1…1, tombol 0/1. |
| Deadzone, inversi sumbu, ekspo, gain, pemetaan sumbu → gerak | **Web** (disimpan di `localStorage`) | QGC mengerjakan ini di sisi GCS; di web harus dibuat sendiri. |
| Fungsi tombol (lampu, gripper, mode) | **Firmware** (parameter `BTNn_FUNCTION`) | Web cukup mengirim status tombol; arti tiap tombol dikonfigurasi di Pixhawk. |
| Mixing thruster dan PWM | **Firmware ArduSub** | Web tidak menyentuhnya. |
| Arah putar motor | **Firmware** (parameter `MOT_n_DIRECTION`, n = nomor motor; cek nama pastinya di versi firmware kalian) | Web membaca dan menulis parameter ini. Sumber kebenaran tetap di Pixhawk, sama seperti di QGC. |
| Mengirim MAVLink 20 Hz tetap, watchdog, heartbeat | **Backend** | Jangan mengandalkan browser untuk waktu yang presisi. |

### 2.3 Tahapan yang disarankan

Kerjakan **berurutan**. Tiap tahap harus lolos uji sebelum lanjut.

**Tahap 0: Investigasi (tanpa mengubah kode)**
- Cari tahu **bagaimana QGC tersambung sekarang**: lewat apa (Jetson? MAVProxy? BlueOS? kabel?), dan apa yang mengirim ke UDP `14560`.
- Catat versi firmware ArduSub dan **daftar parameter** saat ini (ekspor dari QGC). Ini cadangan sekaligus bahan referensi nama parameter.
- Ukur: berapa Hz `MANUAL_CONTROL` yang dikirim QGC, dan apa heartbeat GCS-nya.
- Putuskan: apakah backend bisa mengirim ke Pixhawk lewat jalur yang sama dengan yang sekarang dipakai untuk menerima.

**Tahap 1: Deteksi joystick (hanya tampilan, tanpa kirim apa pun)**
- Panel **JOYSTICK** baru: daftar perangkat, sumbu dan tombol hidup (bar), indikator terhubung/terputus.
- Halaman pengaturan: pemetaan sumbu (surge, sway, heave, yaw), inversi, deadzone, ekspo/gain. Simpan di `localStorage`.
- **Aman:** tidak ada yang dikirim ke robot. Bisa dites di mode DEV memakai joystick sungguhan.

**Tahap 2: Saluran perintah di backend**
- Backend memakai satu koneksi MAVLink dua arah (saat ini koneksi dibuat di dalam `_run_mavlink_once()` dan hanya dipakai membaca; harus dibagikan dengan kunci/lock).
- Kirim **HEARTBEAT GCS** 1 Hz (dengan `system id` GCS yang tidak bentrok dengan QGC).
- Endpoint kontrol (disarankan WebSocket; alternatifnya POST ~20 Hz) menerima nilai sumbu, lalu **backend** mengirim `MANUAL_CONTROL` pada laju tetap.
- **Watchdog:** kalau tidak ada paket kontrol selama ±300–500 ms, backend langsung mengirim netral.
- Endpoint **arm/disarm** dan **ganti mode** (Manual, Stabilize, Depth Hold) dengan konfirmasi di UI.
- Bendera `ENABLE_CONTROL` (bawaan **mati**) di konfigurasi backend, dan token sederhana supaya tidak sembarang klien bisa mengirim.
- Uji **di bangku**: robot di atas penyangga, **baling-baling dilepas**, belum di air.

**Tahap 3: Pengaturan thruster**
- Baca parameter motor (arah, dan jumlah motor sesuai frame) dari Pixhawk.
- Tombol **balik arah** per motor: tulis parameter, **baca ulang untuk memastikan nilainya berubah**, tampilkan hasilnya.
- **Uji motor** per thruster (perintah uji motor MAVLink, seperti halaman Motor Setup di QGC) dengan batas kecepatan dan waktu singkat, dan peringatan jelas bahwa baling-baling berputar.
- Cadangkan nilai lama sebelum menulis; sediakan tombol **kembalikan**.

**Tahap 4: Pelengkap**
- Tombol fungsi (lampu, gripper, kemiringan kamera) lewat tombol joystick.
- Indikator status kontrol di header (terhubung/terputus, armed/disarmed, mode aktif).
- Fitur dari bagian 3.

### 2.4 Aturan keselamatan (wajib)

1. **Default mati.** Kontrol dari web harus butuh tindakan sadar (mis. tombol "AKTIFKAN KONTROL").
2. **Watchdog di backend**, bukan di browser. Browser menghentikan atau memperlambat skrip saat tab disembunyikan atau jendela tidak fokus, dan Gamepad API hanya aktif untuk halaman yang sedang fokus.
3. **Netral saat putus:** joystick dicabut, tab ditutup, WebSocket putus, jaringan putus → kirim netral.
4. **Satu sumber kontrol saja.** Jangan menjalankan joystick QGC dan joystick web bersamaan. Dua GCS yang sama-sama mengirim `MANUAL_CONTROL` akan saling berebut.
5. **Pembatasan laju dan nilai:** backend membatasi nilai ke rentang yang valid dan membatasi laju kirim. Jangan percaya angka dari browser begitu saja.
6. **Arm dan mode butuh konfirmasi**, dan tampilkan status sesungguhnya dari robot, bukan status yang "diharapkan".
7. **Setiap penulisan parameter dicatat** di panel log, dengan nilai lama dan baru.
8. **Uji tanpa baling-baling dulu**, lalu di bangku, baru di air.
9. **Jangan mengunci diri dari QGC.** Simpan QGC sebagai cadangan sampai fitur web terbukti stabil, terutama menjelang lomba.
10. Autentikasi minimal pada endpoint kontrol (token), dan batasi akses ke jaringan lokal.

### 2.5 Yang tetap dikerjakan di QGC (jangan ditiru di web)

Kalibrasi sensor (kompas, akselerometer), pemasangan firmware, pengaturan ESC/radio, dan pengaturan frame awal berisiko tinggi kalau salah dan jarang dilakukan. Biarkan di QGC.

---

## 3. Rekomendasi fitur dari QGroundControl / ArduSub

Disusun berdasarkan **manfaat untuk robot kalian** dibanding **usaha** pengerjaan. Semua diperiksa ulang terhadap dokumentasi ArduSub sebelum dibuat.

| Fitur | Manfaat | Usaha | Catatan |
|---|---|---|---|
| **Arm / Disarm + pilih mode** (Manual, Stabilize, Depth Hold) | Tinggi | Sedang | Masuk tahap 2 joystick. |
| **Pesan dari autopilot** (`STATUSTEXT`) di panel log | Tinggi | Rendah | Pesan seperti kegagalan pra-arm atau peringatan langsung terlihat tanpa QGC. |
| **Tegangan dan arus baterai** (`SYS_STATUS`) | Tinggi (keselamatan) | Rendah | Contoh langkah lengkap ada di [DEVELOPER.md, Resep A](DEVELOPER.md#resep-a--menambah-data-baru-dari-pixhawk-contoh-tegangan-baterai). |
| **Indikator kebocoran (leak)** | Tinggi (keselamatan) | Rendah–sedang | Periksa dulu bagaimana firmware kalian melaporkannya. |
| **Fungsi tombol joystick** (lampu, gripper, kemiringan kamera) | Tinggi | Rendah setelah joystick ada | Diatur di parameter firmware; web hanya mengirim status tombol. |
| **Editor parameter** (cari, baca, ubah) | Sedang–tinggi | Sedang | Dasar untuk pengaturan thruster. Perlu pengaman tulis (konfirmasi, catatan, cadangan). |
| **Nol-kan kedalaman** | Tinggi | Rendah | Resep B di DEVELOPER.md. |
| **Gain / sensitivitas pilot** | Sedang | Rendah | Skala di web, atau lewat parameter gain di firmware. |
| **Tampilan HUD** (garis horizon, kompas, kedalaman) di atas video | Sedang | Sedang | Membantu operator melihat orientasi tanpa pindah panel. |
| **Rekam video dengan overlay telemetri** | Sedang | Sedang–tinggi | Setelah rekaman dasar beres. |
| **Unduh log penerbangan** dari Pixhawk | Rendah–sedang | Sedang | Berguna untuk analisis setelah lomba. |
| **Misi otomatis / waypoint** | Rendah sekarang | Tinggi | Butuh posisi yang andal (lihat [1.4](#14-trajectory-2d-dan-posisi-robot)). |
| **Kalibrasi sensor, firmware, ESC** | Tidak disarankan | — | Tetap di QGC. |

Urutan yang disarankan setelah joystick dan thruster: pesan autopilot → baterai → leak → nol-kan kedalaman → HUD.

---

## 4. Perbaikan lain (prioritas lebih rendah)

| Pekerjaan | Keterangan |
|---|---|
| Perbaiki record / replay / snapshot / simpan | Lihat [1.1](#11-record-replay-snapshot-dan-simpan-file). |
| Selidiki dan perbaiki kedalaman | Lihat [1.2](#12-kedalaman-depth). |
| Putuskan nasib model 3D dan jejak | Lihat [1.3](#13-model-3d-dan-jejak-3d). |
| Jadikan frontend jalan offline | Lihat [1.5](#15-ketergantungan-cdn-saat-offline), cara A. |
| Perbaiki `get_local_ip()` | Lihat [1.6](#16-alamat-rtsp-127001). |
| Rapikan `rov3d.js` dan `rovTopIcon.js` | Pakai `import` dari `config.js`, hilangkan duplikat dan ketergantungan urutan `<script>`. |
| Isi tombol menu | Halaman pengaturan robot (bisa menampung pengaturan thruster dari bagian 2). |
| Kartu GRIPPER | Backend mengirim field `gripper`; frontend sudah siap menampilkannya (`updateSpecs()` di `telemetry.js`). |
| Samakan label kamera backend (0-based) dengan UI (1-based) | Kosmetik. |
| Tentukan satu sistem jejak | Gabungkan jejak 2D dan 3D (lihat [1.3](#13-model-3d-dan-jejak-3d)). |

---

## 5. Jangka panjang

- **Refactor kode inti robot** milik angkatan sebelumnya (jalur MAVLink antara laptop dan robot, dan berkas inti lain). Pendekatan yang sama dengan GCS: pahami dulu perilakunya, tulis ulang rapi tanpa mengubah perilaku, baru tambah fitur. Mulai dengan menuliskan *apa yang dikerjakan tiap file* sebelum mengubah apa pun.
- **Pengujian otomatis** untuk logika yang tidak bergantung pada perangkat keras (mis. parser pesan, `resolvePosition`, perhitungan dead reckoning), supaya perubahan tidak merusak diam-diam.
- **Server produksi** menggantikan server pengembangan Flask (peringatan yang muncul di log Jetson) kalau backend mulai melayani banyak klien atau fitur kontrol.
- **Satu pintu konfigurasi** untuk backend (berkas atau variabel lingkungan), seperti `config.js` di frontend.
- **Proses rilis**: tandai versi (tag) di GitHub sebelum lomba, supaya selalu ada versi yang terbukti jalan untuk dikembalikan.

---

## 6. Pertanyaan yang masih terbuka

Jawabannya menentukan arah pekerjaan. Isi di sini begitu sudah diketahui.

1. **Bagaimana QGC tersambung ke Pixhawk sekarang?** (lewat Jetson, MAVProxy, BlueOS, kabel langsung?) Menentukan cara backend mengirim perintah.
2. **Versi firmware ArduSub dan frame yang dipakai** (jumlah dan tata letak thruster).
3. **Joystick apa yang dipakai** (merek/tipe, jumlah sumbu dan tombol). Menentukan pemetaan awal.
4. **Gejala tepat masalah kedalaman** (lihat [1.2](#12-kedalaman-depth)).
5. **Model 3D dan jejak: digabung atau dipisah?** (lihat [1.3](#13-model-3d-dan-jejak-3d)).
6. **Apakah dashboard akan dipakai di tempat tanpa internet?** Kalau ya, naikkan prioritas [1.5](#15-ketergantungan-cdn-saat-offline).
7. **Siapa yang boleh mengendalikan robot?** Menentukan seberapa ketat autentikasi di bagian 2.