# Masalah yang Diketahui dan Rencana Pengembangan

Dokumen ini mencatat **apa yang belum beres** dan **apa yang direncanakan**, supaya siapa pun yang melanjutkan proyek tahu posisinya.

> Dokumen ini hidup. Kalau sebuah masalah selesai, **pindahkan atau hapus barisnya**. Kalau menemukan masalah baru, **tambahkan** dengan format yang sama.

Dokumen terkait: [DEVELOPER.md](DEVELOPER.md) (cara menambah fitur), [MANUAL.md](MANUAL.md) (cara menjalankan).

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