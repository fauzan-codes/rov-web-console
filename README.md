# ROV WEB CONSOLE — Ground Control Station

Dashboard web untuk memantau dan mengendalikan ROV **Seadiver Team (Universitas Negeri Surabaya)**.
Dari satu halaman browser kamu bisa melihat kamera, data sensor (kedalaman, roll/pitch/yaw, PWM), hasil scan QR, model 3D ROV, dan jejak pergerakan ROV.

> **Panduan ini untuk pemula** dan memakai file `.bat` (klik dua kali, selesai).
> Kalau kamu ingin menjalankan lewat terminal / perlu pengecekan mendalam, baca **[docs/MANUAL.md](docs/MANUAL.md)**.
>
> Dokumentasi lain:
>
> | Dokumen | Untuk apa |
> |---|---|
> | [docs/MANUAL.md](docs/MANUAL.md) | Menjalankan manual lewat terminal, pengecekan, dan diagnosa jaringan. |
> | [docs/DEVELOPER.md](docs/DEVELOPER.md) | **Memahami cara kerja kode** dan **menambah fitur** (arsitektur, alur data, resep). |
> | [docs/ROADMAP.md](docs/ROADMAP.md) | Masalah yang diketahui dan rencana pengembangan. |

---

## Daftar isi

1. [Gambaran sederhana: cara kerjanya](#1-gambaran-sederhana-cara-kerjanya)
2. [Isi folder proyek](#2-isi-folder-proyek)
3. [Yang harus disiapkan dulu](#3-yang-harus-disiapkan-dulu)
4. [Cara A — Mode DEV di laptop (tanpa Jetson)](#4-cara-a--mode-dev-di-laptop-tanpa-jetson)
5. [Cara B — Dengan Jetson (robot / Jetson asli)](#5-cara-b--dengan-jetson-robot--jetson-asli)
6. [Cara menghentikan](#6-cara-menghentikan)
7. [Kalau ada masalah](#7-kalau-ada-masalah)
8. [Fitur yang sudah dan belum berfungsi](#8-fitur-yang-sudah-dan-belum-berfungsi)
9. [Istilah yang sering muncul](#9-istilah-yang-sering-muncul)

---

## 1. Gambaran sederhana: cara kerjanya

Sistem ini terdiri dari **dua bagian** yang berjalan di tempat berbeda:

```
   ROBOT / JETSON                         LAPTOP
 ┌────────────────────┐              ┌──────────────────────┐
 │  BACKEND           │   jaringan   │  FRONTEND            │
 │  gcs_server.py     │ ───────────► │  (halaman web di     │
 │  - baca Pixhawk    │   kabel LAN  │   browser Chrome)    │
 │  - baca kamera     │   / Wi-Fi    │  - tampilkan kamera  │
 │  - deteksi QR      │              │  - tampilkan data    │
 └────────────────────┘              └──────────────────────┘
```

- **Backend** = program yang berjalan di **Jetson** (komputer kecil di robot). Tugasnya mengambil data dari Pixhawk dan kamera, lalu mengirimkannya.
- **Frontend** = **halaman web** yang dibuka di **laptop**. Tugasnya menampilkan data dari backend.

Karena Jetson tidak selalu ada, ada **Mode DEV**: backend dijalankan di laptop dengan **data palsu (simulasi)**, jadi kamu bisa mengembangkan dan mencoba tampilan tanpa Jetson dan tanpa robot.

| Kamu mau... | Pakai |
|---|---|
| Mencoba / mengembangkan tanpa Jetson | **Cara A** (mode DEV) |
| Melihat data asli dari Jetson / robot | **Cara B** (dengan Jetson) |

---

## 2. Isi folder proyek

```
gcs-rov/
├── 1_INSTALL.bat            ← klik ini PERTAMA (sekali saja)
├── 2A_RUN_DEV_LAPTOP.bat    ← jalankan mode DEV (tanpa Jetson)
├── 2B_RUN_WITH_JETSON.bat   ← buka dashboard yang tersambung ke Jetson
├── README.md                ← panduan ini
├── docs/
│   ├── MANUAL.md            ← cara menjalankan manual + pengecekan
│   ├── DEVELOPER.md         ← cara kerja kode dan cara menambah fitur
│   └── ROADMAP.md           ← masalah yang diketahui dan rencana
├── backend/
│   ├── gcs_server.py        ← program backend (jalan di Jetson / mode DEV)
│   ├── requirements-dev.txt ← daftar package untuk mode DEV di laptop
│   └── models/
│       └── assembly_rov_80.glb   ← model 3D ROV (taruh di sini)
├── frontend/                ← halaman web (index.html, css/, js/)
└── .venv/                   ← dibuat otomatis oleh 1_INSTALL.bat (jangan diubah)
```

> **Penting:** file model 3D `assembly_rov_80.glb` **tidak ikut** kalau belum kamu salin. Ambil dari folder `backend/models/` di Jetson, lalu taruh di `backend/models/` di laptop. Tanpa file ini dashboard tetap jalan, hanya panel **ROV DESIGN** yang kosong.

---

## 3. Yang harus disiapkan dulu

> **Pengguna Linux / macOS:** file `.bat` hanya untuk Windows. Tidak ada skrip pengganti, cukup ikuti jalur **Linux / macOS** di **[docs/MANUAL.md](docs/MANUAL.md#3-mode-dev-di-laptop-manual)** (ada ringkasan cepat di bagian atasnya). Bagian Cara B di bawah (menjalankan backend di Jetson) berlaku untuk semua sistem.

Dibutuhkan **sekali** di laptop (Windows):

| Kebutuhan | Keterangan |
|---|---|
| **Python 3.10 – 3.12** | Download di <https://www.python.org/downloads/>. Saat install, **centang kotak "Add python.exe to PATH"**. |
| **Google Chrome atau Microsoft Edge** | Browser lain (Firefox, Safari) bisa membuka dashboard, tapi fitur pilih folder simpan tidak jalan. |
| **Internet** | Dipakai untuk (1) `1_INSTALL.bat` mengunduh package, dan (2) **dashboard memuat ikon dan library 3D dari internet**. Lihat catatan di bawah. |

> ### Catatan penting soal internet
> Dashboard memuat ikon (Font Awesome) dan library 3D (three.js) dari internet (CDN).
> Jadi **laptop harus punya internet saat membuka dashboard**, kalau tidak ikon hilang dan model 3D tidak muncul.
> Kalau laptop tersambung ke Jetson lewat **kabel LAN** (yang tidak punya internet), pastikan laptop **juga** tersambung ke Wi-Fi yang ada internetnya.

Untuk **Cara B** kamu juga butuh: Jetson menyala, satu jaringan dengan laptop, dan backend sudah dijalankan di Jetson (langkah ada di bagian 5).

---

## 4. Cara A — Mode DEV di laptop (tanpa Jetson)

Cocok untuk belajar, mengembangkan tampilan, dan mencoba tanpa robot. Data yang tampil adalah **simulasi** (bukan data robot sungguhan).

### Langkah 1 — Install (cukup sekali)

1. Buka folder `gcs-rov`.
2. **Klik dua kali `1_INSTALL.bat`**.
3. Jendela hitam terbuka dan mengunduh package. **Tunggu sampai tertulis `INSTALL SELESAI`** (bisa beberapa menit).
4. Tekan tombol apa saja untuk menutup.

Kalau tertulis **`[GAGAL]`**, baca pesan di bawahnya, lihat [bagian 7](#7-kalau-ada-masalah).

### Langkah 2 — Jalankan

1. **Klik dua kali `2A_RUN_DEV_LAPTOP.bat`**.
2. Dua jendela hitam akan terbuka (satu **backend**, satu **frontend**). **Biarkan keduanya terbuka.**
3. Setelah beberapa detik, **Chrome terbuka otomatis** ke dashboard.

> Kalau Windows menampilkan peringatan **"Windows protected your PC"** saat membuka file `.bat`, klik **More info → Run anyway**. Itu normal untuk file `.bat` hasil unduhan.
> Kalau muncul **Windows Firewall** meminta izin untuk Python, klik **Allow**.

### Langkah 3 — Cek apakah berhasil

Dashboard dianggap **berhasil** kalau kamu melihat ini:

- [ ] Di pojok kiri atas tertulis **`GCS SYSTEM ONLINE`** dengan tulisan kecil oranye **`DEV MODE`**.
- [ ] Di pojok kanan atas, **SYSTEM STATUS** berwarna hijau: **`OPERATIONAL`**.
- [ ] Jam berjalan.
- [ ] Panel **TELEMETRY**: angka kedalaman, PWM, roll/pitch/yaw berubah-ubah.
- [ ] Panel **TRAJECTORY**: garis lingkaran mulai tergambar.
- [ ] Nyalakan toggle **CAM 1** (geser ke ON): muncul gambar simulasi dengan kotak QR, lalu panel **QR SCANNER** terisi `A`.

Kalau semuanya sesuai, mode DEV beres.

### Mengubah pengaturan mode DEV (opsional)

Buka `2A_RUN_DEV_LAPTOP.bat` dengan **Notepad** (klik kanan → Edit). Bagian paling atas berisi pengaturan:

| Pengaturan | Isi | Artinya |
|---|---|---|
| `ROV_DEV_POS` | `dr` (bawaan) | Posisi simulasi memakai *dead reckoning* (label **DR** di peta). |
| | `ned` | Posisi simulasi seperti dari Pixhawk (label **PIXHAWK** di peta). |
| `ROV_DEV_WEBCAM` | `0` (bawaan) | Kamera berupa gambar simulasi. |
| | `1` | Pakai webcam laptop sebagai kamera. |
| `BACKEND_PORT` / `FRONTEND_PORT` | `8080` / `5500` | Ubah hanya kalau port bentrok dengan program lain. |

Simpan file, lalu jalankan lagi.

---

## 5. Cara B — Dengan Jetson (robot / Jetson asli)

Di sini backend berjalan di **Jetson**, dan laptop hanya membuka dashboard-nya. Ada **dua sisi** yang harus dilakukan: Jetson dulu, baru laptop.

### Bagian 1 — Di Jetson: jalankan backend

> Kamu butuh akses ke Jetson, biasanya lewat **SSH** dari laptop (di PowerShell: `ssh seadiver@192.168.1.10`, sesuaikan nama pengguna dan IP).

1. Masuk ke folder tempat `gcs_server.py` berada di Jetson, contoh:
   ```bash
   cd ~/Documents/ROV-KKI26/GCS
   ```
2. Jalankan backend:
   ```bash
   python3 gcs_server.py
   ```
3. **Biarkan jendela ini terbuka.** Jangan tekan `Ctrl+C` (menghentikan) atau `Ctrl+Z` (membekukan!). Dua-duanya membuat dashboard tidak bisa tersambung.

Yang normal muncul di jendela Jetson:

```
[MAVLink] Menghubungkan ke port udpin:0.0.0.0:14560...
[RTSP] Server aktif di port 8554 ...
 * Running on all addresses.
```

Kalau Pixhawk belum tersambung, baris `[MAVLink] Heartbeat timeout. Mencoba kembali...` akan **berulang terus**. Itu **normal**, bukan error.

> **Cek dulu IP Jetson.** Di Jetson ketik `hostname -I`. Angka pertama itu IP Jetson (contoh: `192.168.1.10`). IP ini dipakai di langkah berikutnya.

### Bagian 2 — Di laptop: buka dashboard

1. **Klik dua kali `2B_RUN_WITH_JETSON.bat`**.
2. Muncul pertanyaan IP Jetson. **Tekan ENTER** kalau IP-nya `192.168.1.10`, atau **ketik IP Jetson-mu** lalu ENTER.
3. File ini otomatis **mengecek backend di Jetson**:
   - Kalau tertulis **`Backend Jetson merespons. Bagus.`** → lanjut, Chrome terbuka.
   - Kalau tertulis **`[PERHATIAN] Backend di Jetson TIDAK merespons`** → ikuti checklist yang muncul di layar (dan [bagian 7](#7-kalau-ada-masalah)).
4. Chrome terbuka ke dashboard.

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

## 6. Cara menghentikan

- **Di laptop:** tutup jendela hitam **backend** dan **frontend** dengan klik tombol **X** (atau klik jendelanya lalu tekan `Ctrl+C`). Menutup jendela itu otomatis menghentikan programnya. Tab dashboard di Chrome boleh ditutup sendiri.
- **Di Jetson:** di jendela SSH tempat backend berjalan, tekan **`Ctrl+C`** satu kali.

> Selalu **tutup jendelanya** setelah selesai. Kalau dibiarkan, program lama masih berjalan dan bisa bentrok saat dijalankan lagi (lihat tabel masalah di bawah).

---

## 7. Kalau ada masalah

Cari gejalamu di tabel ini.

| Gejala | Kemungkinan penyebab | Solusi |
|---|---|---|
| `1_INSTALL.bat` tertulis **"Python belum terpasang"** | Python belum diinstall, atau tidak masuk PATH | Install dari python.org dan **centang "Add python.exe to PATH"**, lalu jalankan lagi. |
| `1_INSTALL.bat` gagal saat **memasang package** | Tidak ada internet | Hubungkan internet, jalankan lagi. |
| Jendela hitam langsung tertutup | Terjadi error cepat | Jalankan file `.bat` lewat terminal (lihat MANUAL) supaya pesan errornya terbaca, atau foto/salin pesannya. |
| `2A` tertulis **"Backend tidak berjalan: port 8080 tidak terbuka setelah 60 detik"** | Backend error saat start | Lihat jendela hitam **"GCS Backend DEV"**, baca baris merah/error di sana. |
| `2A` berhenti lama di **"Menunggu backend siap"** | Start pertama memang lebih lambat (antivirus memeriksa file) | Tunggu. Tiap 2 detik muncul tulisan "masih menunggu". Maksimal 60 detik, lalu muncul pesan jelas. |
| Dashboard terbuka tapi tertulis **OFFLINE** (merah) | Alamat backend salah, atau backend belum jalan | Cara A: pastikan jendela backend masih terbuka. Cara B: cek IP dan backend di Jetson (lihat checklist di bawah). |
| **Ikon tidak muncul** / **panel ROV DESIGN kosong** padahal sudah ada model | Laptop tidak punya internet (library 3D dan ikon dimuat dari CDN) | Hubungkan laptop ke internet lalu muat ulang halaman (`F5`). |
| Panel **ROV DESIGN** kosong, ada pesan merah "Model 3D gagal dimuat" | File `assembly_rov_80.glb` tidak ada di `backend/models/` | Salin file model ke folder itu, lalu muat ulang. |
| Kamera tidak menampilkan gambar | Toggle masih OFF, atau kamera tidak terpasang di Jetson | Geser toggle ke ON. Di mode DEV, kamera simulasi seharusnya selalu muncul. |
| `2B` tertulis **"Backend di Jetson TIDAK merespons"** | Lihat checklist di bawah | — |
| Pop-up Windows Firewall muncul | Normal | Klik **Allow** / **Izinkan**. |
| Port sudah dipakai (`Address already in use`) | Backend/frontend lama masih berjalan | Cari dan tutup jendela hitam lama (cek juga di taskbar). Kalau jendelanya sudah tidak ada tapi port masih terpakai, lihat **"Port masih dipakai"** di [MANUAL](docs/MANUAL.md#port-masih-dipakai-padahal-jendelanya-sudah-ditutup). |

### Checklist kalau Jetson tidak merespons (Cara B)

Cek **berurutan**, berhenti di langkah yang gagal:

1. **Backend di Jetson benar-benar jalan?**
   Di jendela SSH harus masih tampil teks `[MAVLink] ...`, tanpa `^C` atau `^Z`.
   Kalau kamu pernah menekan `Ctrl+Z`, backend **membeku**. Di Jetson ketik `kill %1`, lalu jalankan lagi `python3 gcs_server.py`.
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

## 8. Fitur yang sudah dan belum berfungsi

| Fitur | Status |
|---|---|
| Telemetri (kedalaman, roll/pitch/yaw, PWM) | ✅ Berfungsi |
| Kamera (nyala/mati, zoom, fullscreen) | ✅ Berfungsi (di Jetson butuh kamera USB terpasang) |
| Deteksi QR | ✅ Berfungsi |
| Model 3D ROV dan peta trajectory | ✅ Berfungsi |
| Status koneksi (OPERATIONAL / NO PIXHAWK / OFFLINE) | ✅ Berfungsi |
| Alarm kedalaman (tombol **Depth**) | ✅ Berfungsi (sorotan merah di kartu kedalaman; hanya tampilan) |
| **Record, Snapshot, Replay, simpan file ke laptop** | ⚠️ **Belum teruji / belum berfungsi** — akan diperbaiki |
| Mode **MANUAL / AUTONOMOUS** | ⚠️ Tampilan saja, belum mengirim perintah ke robot |
| Tombol **menu** (pojok kanan atas) | ⚠️ Belum ada isinya |
| Tes bersama robot sungguhan | ⚠️ Belum dilakukan (baru Jetson + Pixhawk di meja) |

---

## 9. Istilah yang sering muncul

| Istilah | Artinya |
|---|---|
| **Backend** | Program di Jetson yang mengambil data robot dan mengirimkannya ke dashboard. |
| **Frontend** | Halaman web (dashboard) yang dilihat di browser laptop. |
| **Jetson** | Komputer kecil di robot yang menjalankan backend dan membaca kamera. |
| **Pixhawk** | Pengendali penerbangan/penyelaman robot; sumber data sensor (orientasi, tekanan, PWM). |
| **Mode DEV** | Mode pengembangan: backend jalan di laptop dengan data simulasi, tanpa Jetson. |
| **IP** | Alamat perangkat di jaringan, contoh `192.168.1.10`. |
| **Port** | "Pintu" pada IP. Backend memakai port `8080`, frontend memakai `5500`. |
| **Telemetri** | Data sensor yang dikirim robot (kedalaman, sudut, PWM, dll). |
| **PWM** | Sinyal yang mengatur kecepatan tiap thruster (nilai sekitar 1500 = diam). |
| **Trajectory** | Jejak pergerakan ROV yang digambar di peta. |
| **DR (Dead Reckoning)** | Perkiraan posisi dari sensor gerak, dipakai kalau tidak ada GPS/DVL. |
| **QR** | Kode QR yang dibaca kamera robot. |

---

Ada kendala atau saran? Catat pesan errornya (salin teks dari jendela hitam atau tab **Console** browser lewat `F12`) dan sampaikan ke tim pengembang.