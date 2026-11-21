# ROV WEB CONSOLE — Ground Control Station

Dashboard web untuk memantau dan mengendalikan ROV **Seadiver Team (Universitas Negeri Surabaya)**.
Dari satu halaman browser kamu bisa melihat kamera, data sensor (kedalaman, roll/pitch/yaw, PWM), hasil scan QR, model 3D ROV, dan jejak pergerakan ROV. Kamu juga bisa **mengemudikan ROV dengan joystick (Drive Control)**, **ARM/DISARM**, **mengganti mode**, **mengatur fungsi tombol joystick**, serta **membalik arah dan menguji motor thruster**, tanpa membuka QGroundControl.

> **Panduan ini untuk pemula** dan memakai file `.bat` (klik dua kali, selesai).
> Kalau kamu ingin menjalankan lewat terminal / perlu pengecekan mendalam, baca **[docs/MANUAL.md](docs/MANUAL.md)**.
>
> | Dokumen | Untuk apa |
> |---|---|
> | [docs/MANUAL.md](docs/MANUAL.md) | Menjalankan manual lewat terminal, memperbarui Jetson, Joystick Bridge, prosedur tes, diagnosa jaringan. |
> | [docs/DEVELOPER.md](docs/DEVELOPER.md) | **Memahami cara kerja kode** dan **menambah fitur** (arsitektur, alur data, kontrak antar-file, resep). |
> | [docs/ROADMAP.md](docs/ROADMAP.md) | Masalah yang diketahui dan rencana pengembangan. |

---

## Daftar isi

1. [Gambaran sederhana: cara kerjanya](#1-gambaran-sederhana-cara-kerjanya)
2. [Isi folder proyek](#2-isi-folder-proyek)
3. [Yang harus disiapkan dulu](#3-yang-harus-disiapkan-dulu)
4. [Cara A — Mode DEV di laptop (tanpa Jetson)](#4-cara-a--mode-dev-di-laptop-tanpa-jetson)
5. [Cara B — Dengan Jetson (robot / Jetson asli)](#5-cara-b--dengan-jetson-robot--jetson-asli)
6. [Joystick dan Drive Control](#6-joystick-dan-drive-control)
7. [Cara menghentikan](#7-cara-menghentikan)
8. [Kalau ada masalah](#8-kalau-ada-masalah)
9. [Fitur yang sudah dan belum berfungsi](#9-fitur-yang-sudah-dan-belum-berfungsi)
10. [Istilah yang sering muncul](#10-istilah-yang-sering-muncul)

---

## 1. Gambaran sederhana: cara kerjanya

Sistem ini terdiri dari **tiga bagian**:

```
   ROBOT / JETSON                           LAPTOP
 ┌──────────────────────┐   jaringan    ┌─────────────────────────┐
 │  BACKEND             │ ◄───────────► │  FRONTEND (browser)     │
 │  gcs_server.py       │  kabel LAN /  │  - kamera, telemetri    │
 │  rov_control.py      │  Wi-Fi        │  - Drive Control        │
 │  - baca/kirim Pixhawk│               │  - Settings             │
 │  - baca kamera, QR   │ ◄──────────── │                         │
 └──────────────────────┘   joystick    │  JOYSTICK BRIDGE        │
                                        │  (joystick_bridge.py)   │
                                        │  - baca joystick USB    │
                                        └─────────────────────────┘
```

- **Backend** berjalan di **Jetson** (komputer kecil di robot). Tugasnya mengambil data dari Pixhawk dan kamera, dan **meneruskan perintah** (joystick, ARM, mode) ke Pixhawk.
- **Frontend** adalah **halaman web** di **laptop**. Tugasnya menampilkan data dan menjadi panel kendali.
- **Joystick Bridge** adalah program kecil di **laptop** yang membaca joystick dan mengirimnya ke backend. Dengan Bridge, joystick tetap bekerja walaupun kamu berpindah tab atau jendela (browser biasa tidak bisa begitu).

Karena Jetson tidak selalu ada, ada **Mode DEV**: backend dijalankan di laptop dengan **data palsu (simulasi)**, termasuk simulasi ARM dan fungsi tombol. Kamu bisa mengembangkan dan mencoba semua tampilan tanpa Jetson dan tanpa robot.

| Kamu mau... | Pakai |
|---|---|
| Mencoba / mengembangkan tanpa Jetson | **Cara A** (mode DEV) |
| Melihat data asli dan mengemudikan robot | **Cara B** (dengan Jetson) |
| Memakai joystick | **2C_RUN_JOYSTICK_BRIDGE.bat** (lihat [bagian 6](#6-joystick-dan-drive-control)) |

---

## 2. Isi folder proyek

```
gcs-rov/
├── 1_INSTALL.bat               ← klik ini PERTAMA (sekali saja)
├── 2A_RUN_DEV_LAPTOP.bat       ← jalankan mode DEV (tanpa Jetson)
├── 2B_RUN_WITH_JETSON.bat      ← buka dashboard yang tersambung ke Jetson
├── 2C_RUN_JOYSTICK_BRIDGE.bat  ← jalankan Joystick Bridge (lokal / Jetson / IP lain)
├── README.md                   ← panduan ini
├── docs/
│   ├── MANUAL.md               ← menjalankan manual, update Jetson, prosedur tes
│   ├── DEVELOPER.md            ← cara kerja kode dan cara menambah fitur
│   └── ROADMAP.md              ← masalah yang diketahui dan rencana
├── backend/
│   ├── gcs_server.py           ← program backend (jalan di Jetson / mode DEV)
│   ├── rov_control.py          ← modul Drive Control (joystick, ARM, mode, tombol)
│   ├── joystick_config.json    ← dibuat otomatis (pengaturan joystick); jangan di-commit
│   ├── requirements-dev.txt    ← daftar package untuk mode DEV di laptop
│   └── models/
│       └── assembly_rov_80.glb ← model 3D ROV (taruh di sini)
├── tools/
│   └── joystick_bridge.py      ← Joystick Bridge (jalan di laptop)
├── frontend/                   ← halaman web (index.html, css/, js/)
└── .venv/                      ← dibuat otomatis oleh 1_INSTALL.bat (jangan diubah)
```

> **Penting:** file model 3D `assembly_rov_80.glb` **tidak ikut** kalau belum kamu salin. Ambil dari folder `backend/models/` di Jetson, lalu taruh di `backend/models/` di laptop. Tanpa file ini dashboard tetap jalan, hanya panel **ROV DESIGN** yang kosong.
>
> **Penting:** `gcs_server.py` dan `rov_control.py` harus selalu berada di **folder yang sama** (di laptop maupun di Jetson).

---

## 3. Yang harus disiapkan dulu

> **Pengguna Linux / macOS:** file `.bat` hanya untuk Windows. Tidak ada skrip pengganti, cukup ikuti jalur **Linux / macOS** di **[docs/MANUAL.md](docs/MANUAL.md#3-mode-dev-di-laptop-manual)**. Bagian Cara B (menjalankan backend di Jetson) berlaku untuk semua sistem. Joystick Bridge versi XInput hanya untuk Windows; di Linux/macOS pakai `--input sdl` (butuh `pygame-ce`).

Dibutuhkan **sekali** di laptop (Windows):

| Kebutuhan | Keterangan |
|---|---|
| **Python 3.10 – 3.12** | Download di <https://www.python.org/downloads/>. Saat install, **centang kotak "Add python.exe to PATH"**. |
| **Google Chrome atau Microsoft Edge** | Browser lain (Firefox, Safari) bisa membuka dashboard, tapi fitur pilih folder simpan tidak jalan. |
| **Internet** | Dipakai untuk (1) `1_INSTALL.bat` mengunduh package, dan (2) **dashboard memuat ikon dan library 3D dari internet**. Lihat catatan di bawah. |
| **Joystick** (opsional) | Controller USB. Tipe XInput (Xbox, Logitech F310 mode X) langsung bisa tanpa package tambahan. |

> ### Catatan penting soal internet
> Dashboard memuat ikon (Font Awesome) dan library 3D (three.js) dari internet (CDN).
> Jadi **laptop harus punya internet saat membuka dashboard**, kalau tidak ikon hilang dan model 3D tidak muncul.
> Kalau laptop tersambung ke Jetson lewat **kabel LAN** (yang tidak punya internet), pastikan laptop **juga** tersambung ke Wi-Fi yang ada internetnya.

Untuk **Cara B** kamu juga butuh: Jetson menyala, satu jaringan dengan laptop, dan backend sudah dijalankan di Jetson (langkah ada di bagian 5).

---

## 4. Cara A — Mode DEV di laptop (tanpa Jetson)

Cocok untuk belajar, mengembangkan tampilan, dan mencoba tanpa robot. Data yang tampil adalah **simulasi** (bukan data robot sungguhan), dan **tidak ada perintah yang dikirim ke robot**.

### Langkah 1 — Install (cukup sekali)

1. Buka folder `gcs-rov`.
2. **Klik dua kali `1_INSTALL.bat`**.
3. Jendela hitam terbuka dan mengunduh package. **Tunggu sampai tertulis `INSTALL SELESAI`** (bisa beberapa menit).
4. Di tengah proses ada pertanyaan **"Pasang pygame-ce sekarang? (Y/N)"**. Jawab **N** kalau joystick-mu tipe Xbox/XInput; jawab **Y** kalau controller-mu tipe lain atau kamu belum yakin.
5. Tekan tombol apa saja untuk menutup.

Kalau tertulis **`[GAGAL]`**, baca pesan di bawahnya, lihat [bagian 8](#8-kalau-ada-masalah).

### Langkah 2 — Jalankan

1. **Klik dua kali `2A_RUN_DEV_LAPTOP.bat`**.
2. Dua jendela hitam akan terbuka (satu **backend**, satu **frontend**). **Biarkan keduanya terbuka.**
3. Setelah beberapa detik, **Chrome terbuka otomatis** ke dashboard.
4. Di akhir ada pertanyaan **"Jalankan Joystick Bridge juga? (Y/N)"** (otomatis N dalam 10 detik). Jawab **Y** kalau joystick sudah dicolok.

> Kalau Windows menampilkan peringatan **"Windows protected your PC"** saat membuka file `.bat`, klik **More info → Run anyway**. Itu normal untuk file `.bat` hasil unduhan.
> Kalau muncul **Windows Firewall** meminta izin untuk Python, klik **Allow**.

### Langkah 3 — Cek apakah berhasil

Dashboard dianggap **berhasil** kalau kamu melihat ini:

- [ ] Di pojok kiri atas tertulis **`GCS SYSTEM ONLINE`** dengan tulisan kecil oranye **`DEV MODE`**.
- [ ] Di pojok kanan atas, **SYSTEM STATUS** berwarna hijau: **`OPERATIONAL`**.
- [ ] Ada chip **`DRIVE OFF · DISARMED`** dan ikon gear (Settings) di header.
- [ ] Jam berjalan.
- [ ] Panel **TELEMETRY**: angka kedalaman, PWM, roll/pitch/yaw berubah-ubah.
- [ ] Panel **TRAJECTORY**: garis lingkaran mulai tergambar.
- [ ] Nyalakan toggle **CAM 1** (geser ke ON): muncul gambar simulasi dengan kotak QR, lalu panel **QR SCANNER** terisi `A`.

Kalau semuanya sesuai, mode DEV beres. Untuk mencoba joystick, lanjut ke [bagian 6](#6-joystick-dan-drive-control).

### Mengubah pengaturan mode DEV (opsional)

Buka `2A_RUN_DEV_LAPTOP.bat` dengan **Notepad** (klik kanan → Edit). Bagian paling atas berisi pengaturan:

| Pengaturan | Isi | Artinya |
|---|---|---|
| `ROV_DEV_POS` | `dr` (bawaan) | Posisi simulasi memakai *dead reckoning* (label **DR** di peta). |
| | `ned` | Posisi simulasi seperti dari Pixhawk (label **PIXHAWK** di peta). |
| `ROV_DEV_WEBCAM` | `0` (bawaan) | Kamera berupa gambar simulasi. |
| | `1` | Pakai webcam laptop sebagai kamera. |
| `OFFER_BRIDGE` | `1` (bawaan) / `0` | Tawarkan menjalankan Joystick Bridge di akhir. |
| `BACKEND_PORT` / `FRONTEND_PORT` | `8080` / `5500` | Ubah hanya kalau port bentrok dengan program lain. |

Simpan file, lalu jalankan lagi.

---

## 5. Cara B — Dengan Jetson (robot / Jetson asli)

Di sini backend berjalan di **Jetson**, dan laptop hanya membuka dashboard-nya. Ada **dua sisi** yang harus dilakukan: Jetson dulu, baru laptop.

### Bagian 0 — Pastikan Jetson memakai versi terbaru

Fitur Drive Control membutuhkan **dua file backend** di Jetson: `gcs_server.py` **dan** `rov_control.py`, serta library **pymavlink**. Cara menyalin file dan memeriksanya ada di **[docs/MANUAL.md, bagian 4](docs/MANUAL.md#4-menjalankan-di-jetson-manual)**. `2B_RUN_WITH_JETSON.bat` akan memberi tahu kalau backend di Jetson belum versi terbaru.

### Bagian 1 — Di Jetson: jalankan backend

> Kamu butuh akses ke Jetson, biasanya lewat **SSH** dari laptop (di PowerShell: `ssh seadiver@192.168.1.10`, sesuaikan nama pengguna dan IP).

1. Masuk ke folder tempat `gcs_server.py` berada di Jetson, contoh:
   ```bash
   cd ~/Documents/ROV-KKI26/GCS
   ```
2. Jalankan backend. Pilih salah satu:
   ```bash
   # hanya memantau (Drive Control MATI)
   python3 gcs_server.py

   # dengan Drive Control (joystick, ARM, mode, Test/Reverse motor)
   ROV_ENABLE_CONTROL=1 python3 gcs_server.py

   # uji pertama di air: batasi kekuatan maksimal 50%
   ROV_ENABLE_CONTROL=1 ROV_CONTROL_LIMIT=0.5 python3 gcs_server.py
   ```
3. **Biarkan jendela ini terbuka.** Jangan tekan `Ctrl+C` (menghentikan) atau `Ctrl+Z` (membekukan!). Dua-duanya membuat dashboard tidak bisa tersambung.

Yang normal muncul di jendela Jetson:

```
[MAVLink] Menghubungkan ke port udpin:0.0.0.0:14560...
[CTRL] Siap. Kontrol AKTIF (boleh dinyalakan operator), limit 100%, watchdog 400 ms, system id 255.
[RTSP] Server aktif di port 8554 ...
 * Running on all addresses.
```

Kalau Pixhawk belum tersambung, baris `[MAVLink] Heartbeat timeout. Mencoba kembali...` akan **berulang terus**. Itu **normal**, bukan error.

> **Cek dulu IP Jetson.** Di Jetson ketik `hostname -I`. Angka pertama itu IP Jetson (contoh: `192.168.1.10`).
>
> **Pastikan `MAVProxy2.py` (mavlink-routerd) juga berjalan** di Jetson. Program inilah yang menyambungkan Pixhawk ke backend, QGroundControl, dan program lain.

### Bagian 2 — Di laptop: buka dashboard

1. **Klik dua kali `2B_RUN_WITH_JETSON.bat`**.
2. Muncul pertanyaan IP Jetson. **Tekan ENTER** kalau IP-nya `192.168.1.10`, atau **ketik IP Jetson-mu** lalu ENTER.
3. File ini otomatis **mengecek backend di Jetson**:
   - **`Backend Jetson merespons. Bagus.`** → lanjut.
   - **`Drive Control: AKTIF`** → siap dipakai. Kalau **DIMATIKAN**, jalankan ulang backend dengan `ROV_ENABLE_CONTROL=1`. Kalau **TIDAK TERSEDIA**, file backend di Jetson belum versi terbaru.
   - **`[PERHATIAN] Backend di Jetson TIDAK merespons`** → ikuti checklist yang muncul di layar (dan [bagian 8](#8-kalau-ada-masalah)).
4. Chrome terbuka ke dashboard.
5. Akan ada pertanyaan **"Jalankan Joystick Bridge ke Jetson?"** (lihat [bagian 6](#6-joystick-dan-drive-control)).

### Yang harus terlihat di dashboard

| Kondisi | Tampilan SYSTEM STATUS | Artinya |
|---|---|---|
| Backend nyala + Pixhawk tersambung | 🟢 **OPERATIONAL** | Semuanya normal, data robot masuk. |
| Backend nyala, Pixhawk belum tersambung | 🟡 **NO PIXHAWK** | Dashboard sudah tersambung ke Jetson. Tinggal Pixhawk yang belum mengirim data. Telemetri akan nol. |
| Backend tidak terjangkau | 🔴 **OFFLINE** | Dashboard tidak bisa menghubungi Jetson (cek jaringan / IP / backend sudah jalan). |

> Tampilan **`NO PIXHAWK`** saat tes tanpa robot itu **normal dan berarti koneksi laptop–Jetson berhasil.**

### Kamera

Geser toggle **CAM 1 / CAM 2** ke ON. Kalau kamera USB tertancap di Jetson, gambar muncul. Kalau tidak ada gambar, lihat jendela Jetson dan cari baris yang diawali `[CAM ...]` untuk tahu penyebabnya.

---

## 6. Joystick dan Drive Control

### 6.1 Menjalankan Joystick Bridge

Colok joystick ke **laptop**, lalu **klik dua kali `2C_RUN_JOYSTICK_BRIDGE.bat`**. Akan muncul menu:

| Pilihan | Artinya |
|---|---|
| **1** Laptop ini (mode DEV) | Backend di `127.0.0.1`. Dipakai bersama `2A_RUN_DEV_LAPTOP.bat`. |
| **2** Jetson | Backend di IP Jetson (bawaan `192.168.1.10`, bisa diubah di bagian atas file). |
| **3** IP lain | Ketik IP backend sendiri. |
| **4** Diagnosa | Menampilkan joystick yang terdeteksi lalu kembali ke menu. |

Bridge **tidak menggerakkan robot sendiri**. Robot baru bergerak setelah kamu menekan **Enable Control** di dashboard.

Di terminal Bridge kamu akan melihat, misalnya:

```
[bridge] 21:10:05  joystick 'XInput controller 1' [XInput]  |  backend OK | control OFF
[bridge] 21:10:12  tombol 6 (Start) ditekan
```

Mencabut dan mencolok joystick terdeteksi otomatis (baris pertama berubah menjadi `joystick TIDAK ada` dan kembali lagi).

### 6.2 Memakai Drive Control

1. Klik chip **`DRIVE`** di header untuk membuka panel **DRIVE CONTROL**.
2. Pastikan baris **Bridge ●** berwarna hijau dengan laju sekitar 20 Hz. Gerakkan stick: bar **Lateral / Forward / Yaw / Throttle** bergerak, dan tombol yang ditekan menyala hijau.
3. **Lepas semua stick dan tombol**, lalu tekan **Enable Control**. (Kalau stick belum di tengah, Enable ditolak.)
4. **ARM** lewat tombol di panel atau tombol joystick yang diatur untuk `arm` (bawaan: Start).
5. Mengemudi dengan stick. **`Space`** (spasi) = **STOP darurat**.
6. Selesai: **Disable Control**, lalu **DISARM**.

Pengaman otomatis: kalau joystick dicabut, Bridge ditutup, atau data berhenti lebih dari ±2 detik, output langsung dinetralkan dan Drive Control dimatikan sendiri.

> ⚠️ **Hanya satu aplikasi yang boleh mengirim kontrol joystick.** Tutup QGroundControl atau matikan joystick di QGroundControl saat mengemudi dari web. Dua aplikasi yang sama-sama mengirim akan berebut.
>
> ⚠️ **Mulai dari baling-baling dilepas.** Urutan tes yang aman ada di [MANUAL.md](docs/MANUAL.md#5-prosedur-tes-drive-control).

### 6.3 Settings (ikon gear di header)

| Tab | Fungsi |
|---|---|
| **Joystick** | Pemetaan axis (Forward, Lateral, Yaw, Throttle), invert, deadband, exponential, gain. Monitor otomatis mengikuti sumber yang aktif (Bridge atau Browser). Pengaturan disimpan lewat tombol **Save**, bisa di-Export / Import. |
| **Button Assignment** | Menentukan fungsi tiap tombol joystick (arm, disarm, mode, gain, shift, …). Di robot sungguhan nilainya **disimpan di Pixhawk** (sama dengan halaman Joystick di QGroundControl), di mode DEV hanya tabel simulasi. Hanya bisa diubah saat **DISARMED** dan Drive Control **OFF**. |
| **Thruster** | **Reverse** (membalik arah motor, saat DISARMED) dan **Test** (memutar satu motor sebentar, saat ARMED). Uji motor dibatasi daya dan durasinya. |

---

## 7. Cara menghentikan

- **Di laptop:** tutup jendela hitam **backend**, **frontend**, dan **Joystick Bridge** dengan klik tombol **X** (atau klik jendelanya lalu tekan `Ctrl+C`). Tab dashboard di Chrome boleh ditutup sendiri.
- **Di Jetson:** di jendela SSH tempat backend berjalan, tekan **`Ctrl+C`** satu kali.

> Selalu **tutup jendelanya** setelah selesai. Kalau dibiarkan, program lama masih berjalan dan bisa bentrok saat dijalankan lagi (lihat tabel masalah di bawah).
>
> Sebelum menghentikan backend saat robot masih **ARMED**, lakukan **DISARM** dulu.

---

## 8. Kalau ada masalah

Cari gejalamu di tabel ini.

| Gejala | Kemungkinan penyebab | Solusi |
|---|---|---|
| `1_INSTALL.bat` tertulis **"Python belum terpasang"** | Python belum diinstall, atau tidak masuk PATH | Install dari python.org dan **centang "Add python.exe to PATH"**, lalu jalankan lagi. |
| `1_INSTALL.bat` gagal saat **memasang package** | Tidak ada internet | Hubungkan internet, jalankan lagi. |
| Jendela hitam langsung tertutup | Terjadi error cepat | Jalankan file `.bat` lewat terminal (lihat MANUAL) supaya pesan errornya terbaca, atau foto/salin pesannya. |
| `2A` tertulis **"File backend\rov_control.py tidak ditemukan"** | File modul Drive Control belum disalin | Taruh `rov_control.py` di folder `backend/`, sejajar `gcs_server.py`. |
| `2A` tertulis **"Backend tidak berjalan: port 8080 tidak terbuka setelah 60 detik"** | Backend error saat start | Lihat jendela hitam **"GCS Backend DEV"**, baca baris merah/error di sana. |
| `2A` berhenti lama di **"Menunggu backend siap"** | Start pertama memang lebih lambat (antivirus memeriksa file) | Tunggu. Maksimal 60 detik, lalu muncul pesan jelas. |
| Dashboard **stuck di CONNECTING** (tidak berubah jadi OPERATIONAL/OFFLINE) | Satu file JavaScript gagal dimuat, biasanya file baru belum disalin ke `frontend/js/` | Tekan `F12` → **Console**, lihat pesan merah pertama. Cek tab **Network** untuk file bertanda **404**. Lalu `Ctrl+Shift+R`. |
| Dashboard terbuka tapi tertulis **OFFLINE** (merah) | Alamat backend salah, atau backend belum jalan | Cara A: pastikan jendela backend masih terbuka. Cara B: cek IP dan backend di Jetson (lihat checklist di bawah). |
| Setelah mengubah kode, tampilan tidak berubah | Browser menyimpan file lama | Tekan `Ctrl+Shift+R` (muat ulang tanpa cache). |
| **Ikon tidak muncul** / **panel ROV DESIGN kosong** padahal sudah ada model | Laptop tidak punya internet (library 3D dan ikon dimuat dari CDN) | Hubungkan laptop ke internet lalu muat ulang halaman (`F5`). |
| Panel **ROV DESIGN** kosong, ada pesan merah "Model 3D gagal dimuat" | File `assembly_rov_80.glb` tidak ada di `backend/models/` | Salin file model ke folder itu, lalu muat ulang. |
| Kamera tidak menampilkan gambar | Toggle masih OFF, atau kamera tidak terpasang di Jetson | Geser toggle ke ON. Di mode DEV, kamera simulasi seharusnya selalu muncul. |
| Chip **`DRIVE LOCKED`** / pesan "Control is disabled on the backend" | Backend Jetson dijalankan tanpa `ROV_ENABLE_CONTROL=1` | Jalankan ulang backend dengan `ROV_ENABLE_CONTROL=1`. |
| Panel Drive: **"Bridge: not connected"** | Joystick Bridge belum jalan, atau alamat backend-nya salah | Jalankan `2C_RUN_JOYSTICK_BRIDGE.bat`, pilih tujuan yang sama dengan dashboard. |
| Bridge: **"joystick TIDAK ada"** padahal sudah dicolok | Controller bukan tipe XInput, atau belum terdeteksi Windows | Jalankan 2C → pilihan **4 Diagnosa**. Kalau bukan XInput, pasang `pygame-ce` (jalankan `1_INSTALL.bat` dan jawab **Y**). |
| **Enable Control ditolak** ("Sticks are not centered" / "button is still pressed") | Ada stick atau tombol yang masih tergeser/ditekan saat Enable | Lepas semua stick dan tombol, coba lagi. |
| **ARM ditolak** oleh Pixhawk | Pra-arm gagal (kompas, sensor, safety switch, dll.) | Baca pesan di panel Drive dan jendela backend (`[Pixhawk] ...`). Cek lewat QGC kalau perlu. |
| Control tiba-tiba **OFF sendiri** | Bridge/joystick terputus, Pixhawk terputus, atau data berhenti > 2 detik | Normal sebagai pengaman. Lihat alasan di panel Drive, lalu Enable lagi. |
| Robot tidak merespons joystick padahal Control **ON** | QGC masih mengirim joystick, atau mode/ARM belum benar | Tutup QGC / matikan joystick-nya. Cek **Armed: YES** dan mode **Manual**. |
| Pop-up Windows Firewall muncul | Normal | Klik **Allow** / **Izinkan**. |
| Port sudah dipakai (`Address already in use`) | Backend/frontend lama masih berjalan | Cari dan tutup jendela hitam lama (cek juga di taskbar). Kalau jendelanya sudah tidak ada tapi port masih terpakai, lihat **"Port masih dipakai"** di [MANUAL](docs/MANUAL.md#port-masih-dipakai-padahal-jendelanya-sudah-ditutup). |

### Checklist kalau Jetson tidak merespons (Cara B)

Cek **berurutan**, berhenti di langkah yang gagal:

1. **Backend di Jetson benar-benar jalan?**
   Di jendela SSH harus masih tampil teks `[MAVLink] ...`, tanpa `^C` atau `^Z`.
   Kalau kamu pernah menekan `Ctrl+Z`, backend **membeku**. Di Jetson ketik `kill %1`, lalu jalankan lagi.
2. **IP-nya benar?**
   Di Jetson ketik `hostname -I`, bandingkan dengan IP yang kamu masukkan.
3. **Laptop satu jaringan dengan Jetson?**
   Di laptop buka PowerShell, ketik `ipconfig`. Cari IP **Ethernet** laptop. Angkanya harus mirip Jetson di tiga bagian pertama. Contoh: Jetson `192.168.1.10`, laptop `192.168.1.3` → sama-sama `192.168.1.x`. ✅
4. **Jetson bisa dijangkau?**
   Di PowerShell: `ping 192.168.1.10` (ganti dengan IP Jetson). Harus ada balasan.
5. **Port 8080 terbuka?**
   Di PowerShell: `Test-NetConnection 192.168.1.10 -Port 8080`. Harus tertulis `TcpTestSucceeded : True`.
6. **Coba buka langsung di browser:** `http://192.168.1.10:8080/status`.
   Kalau muncul teks JSON (`{"backend":"online", ...}`) berarti backend sehat.

Panduan lebih rinci untuk tiap langkah ada di **[docs/MANUAL.md](docs/MANUAL.md)**.

---

## 9. Fitur yang sudah dan belum berfungsi

| Fitur | Status |
|---|---|
| Telemetri (kedalaman, roll/pitch/yaw, PWM) | ✅ Berfungsi |
| Kamera (nyala/mati, zoom, fullscreen) | ✅ Berfungsi (di Jetson butuh kamera USB terpasang) |
| Deteksi QR | ✅ Berfungsi |
| Model 3D ROV dan peta trajectory | ✅ Berfungsi |
| Status koneksi (OPERATIONAL / NO PIXHAWK / OFFLINE) | ✅ Berfungsi |
| Alarm kedalaman (tombol **Depth**) | ✅ Berfungsi (sorotan merah di kartu kedalaman; hanya tampilan) |
| **Settings → Thruster**: Reverse dan Test motor | ✅ Berfungsi di robot (Test teruji; motor 4 belum bersuara, lihat ROADMAP) |
| **Joystick Bridge** (XInput + SDL, hot-plug) | ✅ Teruji di mode DEV; ⚠️ pembaca XInput perlu dicoba dengan joystick fisik |
| **Drive Control**: Enable/STOP, ARM/DISARM, mode, joystick → MANUAL_CONTROL | ✅ Teruji di mode DEV · ⚠️ **belum dites dengan robot** (ikuti [prosedur tes](docs/MANUAL.md#5-prosedur-tes-drive-control)) |
| **Settings → Joystick** (mapping, deadband, exponential, gain) | ✅ Berfungsi |
| **Settings → Button Assignment** | ✅ Teruji di mode DEV · ⚠️ pembacaan/penulisan parameter di Pixhawk belum dicoba |
| **Record, Snapshot, Replay, simpan file ke laptop** | ⚠️ **Belum teruji / belum berfungsi** — akan diperbaiki |
| Mode **MANUAL / AUTONOMOUS** (di panel Controls bawah) | ⚠️ Tampilan saja, belum mengirim perintah ke robot (mode terbang diganti lewat panel Drive Control) |
| Kartu **GRIPPER** | ⚠️ Menampilkan `N/A` (belum ada datanya) |
| Tes bersama robot sungguhan di air | ⚠️ Belum dilakukan |

---

## 10. Istilah yang sering muncul

| Istilah | Artinya |
|---|---|
| **Backend** | Program di Jetson yang mengambil data robot, meneruskan perintah, dan melayani dashboard. |
| **Frontend** | Halaman web (dashboard) yang dilihat di browser laptop. |
| **Joystick Bridge** | Program kecil di laptop yang membaca joystick dan mengirimnya ke backend. |
| **Drive Control** | Panel di dashboard untuk mengemudikan robot (Enable, STOP, ARM, mode). |
| **Jetson** | Komputer kecil di robot yang menjalankan backend dan membaca kamera. |
| **Pixhawk** | Pengendali penerbangan/penyelaman robot; sumber data sensor dan penerima perintah. |
| **ArduSub** | Firmware di Pixhawk untuk ROV. |
| **QGroundControl (QGC)** | Aplikasi GCS standar. Dulu dipakai untuk joystick dan pengaturan motor; sekarang bisa dilakukan dari dashboard ini. |
| **mavlink-routerd / MAVProxy2.py** | Perantara di Jetson yang membagi data Pixhawk ke backend, QGC, dan program lain. |
| **MANUAL_CONTROL** | Pesan MAVLink berisi posisi stick dan tombol; Pixhawk mengubahnya menjadi PWM thruster. |
| **ARM / DISARM** | Mengaktifkan / mematikan motor. Robot hanya bisa bergerak saat ARMED. |
| **Watchdog** | Pengaman: kalau data joystick berhenti, output otomatis dinetralkan. |
| **Mode DEV** | Mode pengembangan: backend jalan di laptop dengan data simulasi, tanpa Jetson. |
| **IP / Port** | Alamat perangkat di jaringan, dan "pintu" pada alamat itu (backend `8080`, frontend `5500`). |
| **Telemetri** | Data sensor yang dikirim robot (kedalaman, sudut, PWM, dll). |
| **PWM** | Sinyal yang mengatur kecepatan tiap thruster (nilai sekitar 1500 = diam). |
| **Trajectory / DR** | Jejak pergerakan ROV di peta / perkiraan posisi dari sensor gerak (*dead reckoning*). |
| **QR** | Kode QR yang dibaca kamera robot. |

---

Ada kendala atau saran? Catat pesan errornya (salin teks dari jendela hitam atau tab **Console** browser lewat `F12`) dan sampaikan ke tim pengembang.