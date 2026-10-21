# Panduan Manual GCS ROV

Panduan ini menjelaskan cara menjalankan GCS **tanpa file `.bat`**, lewat terminal, lengkap dengan **pengecekan di setiap langkah** supaya masalah ketahuan lebih awal.

Kalau kamu pemula dan hanya ingin cepat jalan, pakai **[README.md](../README.md)** (klik dua kali `.bat`). Panduan ini cocok kalau:

- `.bat` bermasalah dan kamu perlu melihat pesan error lengkap,
- kamu memakai **Linux atau macOS** (file `.bat` hanya untuk Windows, tidak ada skrip pengganti, cukup ikuti panduan ini),
- kamu perlu mengubah konfigurasi atau mengembangkan kodenya.

**Panduan ini punya dua jalur.** Di setiap langkah ada dua blok perintah, ambil yang sesuai sistemmu:

| Sistemmu | Pakai blok berlabel |
|---|---|
| Windows | **Windows (PowerShell)** |
| Linux (Ubuntu, Debian, Mint, Fedora, Arch, dll.) atau macOS | **Linux / macOS (terminal)** |

Bagian Jetson (bagian 4) sudah berbasis Linux, jadi berlaku untuk semua orang.

Untuk memahami cara kerja kode dan menambah fitur, baca **[DEVELOPER.md](DEVELOPER.md)**. Untuk masalah yang diketahui dan rencana ke depan, baca **[ROADMAP.md](ROADMAP.md)**.

---

## Daftar isi

1. [Memahami komponennya](#1-memahami-komponennya)
2. [Konfigurasi penting](#2-konfigurasi-penting)
3. [Mode DEV di laptop (manual)](#3-mode-dev-di-laptop-manual)
4. [Menjalankan di Jetson (manual)](#4-menjalankan-di-jetson-manual)
5. [Menjalankan frontend untuk Jetson (manual)](#5-menjalankan-frontend-untuk-jetson-manual)
6. [Alur diagnosa: "dashboard tidak tersambung"](#6-alur-diagnosa-dashboard-tidak-tersambung)
7. [Referensi endpoint backend](#7-referensi-endpoint-backend)
8. [Struktur kode frontend](#8-struktur-kode-frontend)
9. [Perintah berguna](#9-perintah-berguna)

---

## 1. Memahami komponennya

| Komponen | Berjalan di | Port | Dijalankan dengan |
|---|---|---|---|
| **Backend** (`backend/gcs_server.py`) | Jetson (atau laptop di mode DEV) | `8080` (HTTP), `8554` (RTSP, hanya Jetson) | `python3 gcs_server.py` |
| **Frontend** (folder `frontend/`) | Laptop | `5500` | `python -m http.server 5500` |

Dua hal yang sering membingungkan:

1. **Frontend tidak boleh dibuka dengan klik dua kali `index.html`** (alamat `file://...`). Browser memblokir modul JavaScript dari `file://`. Frontend harus dilayani lewat server kecil (`http.server`) dan dibuka lewat `http://localhost:5500`.
2. **Frontend harus tahu alamat backend.** Alamat ini diberikan lewat parameter `?backend=` di URL (lihat [bagian 5](#5-menjalankan-frontend-untuk-jetson-manual)).

### Kebutuhan internet

| Kapan | Untuk apa |
|---|---|
| Saat `pip install` | Mengunduh package Python. |
| Saat membuka dashboard | Ikon (Font Awesome dari `cdnjs.cloudflare.com`) dan library 3D (three.js dari `cdn.jsdelivr.net`). **Laptop harus online.** |

Tanpa internet saat membuka dashboard: ikon hilang dan panel ROV DESIGN / ikon ROV di peta tidak muncul. Data telemetri dan kamera tetap jalan. Kalau laptop tersambung ke Jetson lewat kabel LAN tanpa internet, sambungkan laptop **juga** ke Wi-Fi.

---

## 2. Konfigurasi penting

### 2.1 Backend (`backend/gcs_server.py`)

Bagian **"2. KONFIGURASI"** di bagian atas file.

| Variabel | Bawaan | Fungsi |
|---|---|---|
| `SERIAL_PORT` | `udpin:0.0.0.0:14560` | Sumber MAVLink. Backend **mendengarkan UDP port 14560**, jadi Pixhawk/perantara (MAVProxy, BlueOS, dsb.) harus mengirim data MAVLink ke Jetson di port itu. |
| `CAM_MAPPING` | `0: /dev/video0`, `1: /dev/video1` | Nomor kamera → perangkat kamera di Jetson. |
| `CAM_CONFIG` | per kamera | Resolusi, FPS, dan kontrol V4L2 untuk tiap kamera. |
| `QR_SCAN_EVERY_N_FRAMES` | `2` | Seberapa sering QR dicek. |
| `QR_SCAN_DOWNSCALE` | `0.5` | QR dibaca di gambar yang diperkecil agar lebih cepat. |
| `RTSP_*` | — | Pengaturan stream video RTSP (NVENC). |

Opsi dari luar (environment variable):

| Variabel | Nilai | Fungsi |
|---|---|---|
| `ROV_DEV` | `1` | Sama dengan menjalankan dengan `--dev`. |
| `ROV_DEV_POS` | `dr` (bawaan) / `ned` | Sumber posisi simulasi: dead reckoning atau seperti Pixhawk. |
| `ROV_DEV_WEBCAM` | `1` | Pakai webcam laptop (jatuh ke kamera simulasi kalau tidak ada). |
| `ROV_PORT` | angka | Mengganti port HTTP backend (bawaan `8080`). |

### 2.2 Frontend (`frontend/js/config.js`)

Semua pengaturan frontend ada di satu file. Yang paling sering diubah:

| Variabel | Fungsi |
|---|---|
| `DEFAULT_BACKEND_URL` | Alamat backend bawaan (IP Jetson). |
| `TELEMETRY_POLL_MS` | Seberapa sering data diambil (bawaan 100 ms). |
| `LOG_TELEMETRY_EVERY_MS` | Seberapa sering telemetri ditulis ke panel log (bawaan 1000 ms). |
| `DEPTH_WARN_M` | Batas peringatan kedalaman (bawaan 2.5 m). |
| `STREAM_CROSS_ORIGIN` | Ubah ke `true` kalau hasil rekaman video hitam (lihat catatan di file). |

Ukuran tampilan diatur di `frontend/css/style.css`: `html { font-size: clamp(...) }` (skala keseluruhan) dan `--video-fit` (`cover` atau `contain` untuk gambar kamera).

---

## 3. Mode DEV di laptop (manual)

Di mode ini backend berjalan **di laptopmu** dengan data simulasi, tanpa Jetson. Ambil blok perintah sesuai sistemmu (lihat tabel di bagian atas dokumen).

### Ringkasan cepat untuk pengguna Linux / macOS

Kalau sudah terbiasa dengan terminal, ini seluruh langkahnya. Penjelasan dan pengecekan per langkah ada di bawahnya.

```bash
cd gcs-rov
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements-dev.txt

# terminal 1: backend
cd backend && ../.venv/bin/python gcs_server.py --dev

# terminal 2: frontend
cd frontend && ../.venv/bin/python -m http.server 5500 --bind 127.0.0.1

# browser
xdg-open "http://localhost:5500/?backend=http://localhost:8080"     # macOS: open "..."
```

### 3.1 Pengecekan awal dan prasyarat

**Windows (PowerShell)**

```powershell
py -3 --version
```

Harus tampil **Python 3.10 – 3.12** (versi lain biasanya tetap bisa, tapi ini yang diuji). Kalau tidak dikenali, install dari <https://www.python.org/downloads/> dan **centang "Add python.exe to PATH"**.

> Di Windows perintah `python` kadang membuka Microsoft Store. Pakai `py -3` sebagai gantinya.

**Linux / macOS (terminal)**

```bash
python3 --version
```

Harus tampil **Python 3.10 atau lebih baru** (3.10 – 3.12 yang diuji). Kalau belum ada atau modul `venv` belum ada:

```bash
# Debian / Ubuntu / Linux Mint
sudo apt update
sudo apt install python3 python3-venv python3-pip

# Fedora
sudo dnf install python3 python3-pip

# Arch / Manjaro
sudo pacman -S python python-pip

# macOS (Homebrew)
brew install python
```

> Di Debian/Ubuntu, paket `python3-venv` **terpisah** dari `python3`. Tanpa itu, `python3 -m venv` gagal.

**Browser:** Chrome, Chromium, atau Edge. Firefox bisa membuka dashboard, tapi tombol **Folder** (pilih folder simpan) tidak berfungsi di Firefox.

### 3.2 Membuat virtual environment dan memasang package

Jalankan dari folder utama proyek (`gcs-rov/`). Virtual environment (`.venv`) menyimpan package khusus proyek ini supaya tidak mengganggu Python sistem.

**Windows (PowerShell)**

```powershell
py -3 -m venv .venv
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
```

**Linux / macOS (terminal)**

```bash
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r backend/requirements-dev.txt
```

Boleh juga mengaktifkan venv supaya cukup mengetik `python` dan `pip`:

```bash
source .venv/bin/activate        # setelah ini: python, pip, memakai .venv
deactivate                       # keluar dari venv
```

Contoh-contoh di dokumen ini memanggil `.venv/bin/python` langsung, jadi **tidak perlu aktivasi**.

**Cek hasilnya**

Windows (PowerShell):
```powershell
.venv\Scripts\python.exe -c "import flask, flask_cors, cv2, numpy; print('OK', cv2.__version__)"
```

Linux / macOS:
```bash
.venv/bin/python -c "import flask, flask_cors, cv2, numpy; print('OK', cv2.__version__)"
```

Harus tampil `OK` dan nomor versi OpenCV. Kalau `ModuleNotFoundError`, ulangi `pip install` dan baca pesan error-nya.

> Windows: kalau PowerShell menolak mengaktifkan venv karena *execution policy*, **tidak perlu** mengaktifkan venv. Contoh di atas langsung memanggil `python.exe` di dalam `.venv`.

**Error yang sering muncul di Linux**

| Pesan | Penyebab | Solusi |
|---|---|---|
| `The virtual environment was not created successfully because ensurepip is not available` / `No module named venv` | Paket `venv` belum terpasang (Debian/Ubuntu) | `sudo apt install python3-venv` |
| `error: externally-managed-environment` | Banyak distro baru memblokir `pip install` ke Python sistem | Pakai venv seperti di atas. Jangan memakai `--break-system-packages`. |
| `ImportError: libGL.so.1: cannot open shared object file` (atau `libgthread`/`libglib`) | OpenCV butuh pustaka grafis yang tidak ada di sistem minimal, server, atau WSL | `sudo apt install libgl1 libglib2.0-0`, **atau** ganti ke OpenCV tanpa GUI: `.venv/bin/python -m pip uninstall -y opencv-python` lalu `.venv/bin/python -m pip install opencv-python-headless` |
| `Permission denied: '/dev/video0'` | Akunmu belum masuk grup `video` | `sudo usermod -aG video $USER`, lalu **logout dan login lagi** |

### 3.3 Menjalankan backend mode DEV

Buka **terminal pertama**.

**Windows (PowerShell)**

```powershell
cd backend
..\.venv\Scripts\python.exe gcs_server.py --dev
```

**Linux / macOS (terminal)**

```bash
cd backend
../.venv/bin/python gcs_server.py --dev
```

Yang harus muncul:

```
==================================================
  ROV GCS Backend System
  MODE DEV (laptop) — kamera: kamera sintetis, posisi: DR
  http://localhost:8080  (RTSP nonaktif)
==================================================
[DEV] Telemetri simulasi aktif (posisi: DR).
 * Running on ...
```

**Mengubah opsi DEV** (sebelum menjalankan):

| Opsi | Nilai | Fungsi |
|---|---|---|
| `ROV_DEV_POS` | `dr` (bawaan) / `ned` | Posisi simulasi: dead reckoning (label DR) atau seperti Pixhawk (label PIXHAWK). |
| `ROV_DEV_WEBCAM` | `1` | Pakai webcam laptop (jatuh ke kamera simulasi kalau tidak ada). |
| `ROV_PORT` | angka | Mengganti port backend (bawaan 8080). |

Windows (PowerShell), di terminal yang sama sebelum menjalankan:
```powershell
$env:ROV_DEV_POS = "ned"
$env:ROV_DEV_WEBCAM = "1"
```

Linux / macOS, bisa langsung di depan perintah (hanya berlaku untuk satu kali jalan):
```bash
ROV_DEV_POS=ned ROV_DEV_WEBCAM=1 ../.venv/bin/python gcs_server.py --dev
```
atau dengan `export` (berlaku sampai terminal ditutup):
```bash
export ROV_DEV_POS=ned
export ROV_DEV_WEBCAM=1
```

**Webcam di Linux:** lihat perangkat dengan `ls /dev/video*`. Nomor kamera di dashboard (CAM 1 = indeks 0, CAM 2 = indeks 1) mengikuti urutan itu. Di **WSL** webcam tidak tersedia, pakai kamera simulasi bawaan.

### 3.4 Cek backend sebelum membuka dashboard

Buka di browser: **<http://localhost:8080/status>**. Atau dari terminal:

Windows: `curl.exe http://localhost:8080/status`

Linux / macOS:
```bash
curl http://localhost:8080/status
curl -s http://localhost:8080/telemetry | python3 -m json.tool    # versi rapi
```

Harus muncul JSON yang memuat `"backend":"online"` dan `"dev_mode":true`. Cek juga `/telemetry`: angka `yaw`, `depth`, dll. harus berubah tiap kali diminta ulang.

Kalau tidak muncul, **jangan lanjut**: periksa terminal backend untuk pesan error.

### 3.5 Menjalankan frontend

Buka **terminal kedua**.

**Windows (PowerShell)**

```powershell
cd frontend
..\.venv\Scripts\python.exe -m http.server 5500 --bind 127.0.0.1
```

**Linux / macOS (terminal)**

```bash
cd frontend
../.venv/bin/python -m http.server 5500 --bind 127.0.0.1
```

Buka di Chrome atau Edge:

```
http://localhost:5500/?backend=http://localhost:8080
```

Dari terminal (Linux), alternatifnya:

```bash
xdg-open "http://localhost:5500/?backend=http://localhost:8080"          # browser bawaan
google-chrome "http://localhost:5500/?backend=http://localhost:8080"     # atau: chromium
```
(macOS: `open "http://localhost:5500/?backend=http://localhost:8080"`)

**Cek:** header menampilkan `DEV MODE`, status `OPERATIONAL` (hijau), dan angka telemetri bergerak.

### 3.6 Berhenti, atau menjalankan keduanya dari satu terminal

**Berhenti:** di setiap terminal tekan `Ctrl+C` (jangan `Ctrl+Z`, itu hanya membekukan program).

**Linux / macOS: satu terminal dengan `tmux`** (backend di kiri, frontend di kanan). Jalankan dari folder `gcs-rov/`:

```bash
ROOT="$PWD"
tmux new-session -d -s gcs -c "$ROOT/backend" "$ROOT/.venv/bin/python gcs_server.py --dev"
tmux split-window -t gcs -h -c "$ROOT/frontend" "$ROOT/.venv/bin/python -m http.server 5500 --bind 127.0.0.1"
tmux attach -t gcs
```

| Tujuan | Perintah |
|---|---|
| Keluar tanpa menghentikan program | `Ctrl+B`, lepas, lalu `D` |
| Masuk lagi | `tmux attach -t gcs` |
| Hentikan semuanya | `tmux kill-session -t gcs` |

Kalau panel tmux langsung hilang begitu program berjalan, ada error saat start: jalankan perintahnya manual di terminal biasa (bagian 3.3 dan 3.5) supaya pesan errornya terbaca.

**Linux / macOS: latar belakang tanpa tmux** (log dua program bercampur di satu terminal, jadi cocok kalau sudah yakin semuanya jalan):

```bash
ROOT="$PWD"
(cd "$ROOT/backend"  && exec "$ROOT/.venv/bin/python" gcs_server.py --dev) &
(cd "$ROOT/frontend" && exec "$ROOT/.venv/bin/python" -m http.server 5500 --bind 127.0.0.1) &
sleep 5
xdg-open "http://localhost:5500/?backend=http://localhost:8080"

# berhenti (jalankan di terminal biasa):
pkill -f gcs_server.py
pkill -f "http.server 5500"
```

---

## 4. Menjalankan di Jetson (manual)

### 4.1 Masuk ke Jetson

Dari laptop (PowerShell):

```powershell
ssh seadiver@192.168.1.10
```
Sesuaikan nama pengguna dan IP.

### 4.2 Pengecekan sebelum menjalankan backend

Jalankan satu per satu di Jetson:

```bash
hostname -I
```
→ IP Jetson (angka pertama). Catat untuk langkah berikutnya.

```bash
python3 -c "import flask, flask_cors, cv2, numpy; print('paket dasar OK')"
```
→ harus tampil `paket dasar OK`.

```bash
python3 -c "import gi; gi.require_version('Gst','1.0'); gi.require_version('GstRtspServer','1.0'); print('GStreamer + RTSP OK')"
```
→ harus tampil `GStreamer + RTSP OK`. Kalau gagal, backend tetap bisa jalan, tapi **RTSP nonaktif** (peringatan `[WARN] GStreamer/RTSP tidak tersedia` muncul).

```bash
python3 -c "import cv2; print([l.strip() for l in cv2.getBuildInformation().splitlines() if 'GStreamer' in l])"
```
→ harus berisi `YES`. Kalau `NO`, OpenCV tidak punya dukungan GStreamer dan jalur kamera hardware tidak bekerja.

```bash
python3 -c "import pymavlink; print('pymavlink OK')"
python3 -c "from pyzbar import pyzbar; print('pyzbar OK')"
```
→ keduanya opsional. Tanpa `pymavlink`, backend memakai **simulasi sederhana** (data palsu!). Tanpa `pyzbar`, QR dibaca dengan OpenCV.

> ⚠️ **Jangan jalankan `pip install opencv-python` di Jetson.** Itu menimpa OpenCV bawaan JetPack yang mendukung GStreamer/NVENC. File `requirements-dev.txt` hanya untuk laptop.

Cek kamera (kalau terpasang):

```bash
ls /dev/video*
v4l2-ctl --device=/dev/video0 --list-formats-ext
```
→ cocokkan resolusi/FPS MJPEG yang didukung dengan `CAM_CONFIG` di `gcs_server.py`.

Cek file model 3D:

```bash
ls models/assembly_rov_80.glb
```
(dijalankan dari folder tempat `gcs_server.py` berada)

### 4.3 Menjalankan backend

```bash
cd ~/Documents/ROV-KKI26/GCS      # folder tempat gcs_server.py berada
python3 gcs_server.py
```

**Biarkan terbuka.** Jangan tekan `Ctrl+Z` (membekukan program: port tetap terbuka tapi tidak melayani siapa pun, `curl` akan menggantung). `Ctrl+C` menghentikan program.

**Lebih aman: pakai `tmux`** supaya backend tetap hidup walaupun SSH terputus:

```bash
sudo apt install tmux           # sekali saja, kalau belum ada
tmux new -s gcs
python3 gcs_server.py
# keluar tanpa menghentikan: tekan Ctrl+B, lepas, lalu tekan D
# masuk lagi nanti:          tmux attach -t gcs
# hentikan backend:          masuk lagi, lalu Ctrl+C
```

Yang normal muncul:

| Pesan | Artinya |
|---|---|
| `[MAVLink] Menghubungkan ke port udpin:0.0.0.0:14560...` | Backend menunggu data Pixhawk. |
| `[MAVLink] Heartbeat timeout. Mencoba kembali...` (berulang) | Pixhawk belum mengirim data. **Normal** kalau Pixhawk belum tersambung. |
| `[MAVLink] Terhubung! System ID: ...` | Pixhawk tersambung. |
| `[RTSP] Server aktif di port 8554 -> rtsp://127.0.0.1:8554/...` | RTSP jalan. Alamat `127.0.0.1` muncul kalau Jetson tidak punya gateway; hanya kosmetik, dashboard tidak memakainya. |
| `[CAM ...] Hardware MJPEG decode aktif` | Kamera berjalan lewat decoder hardware (bagus). |
| `[CAM ...] Pipeline hardware decode gagal ... Fallback ...` | Kamera tidak cocok dengan mode di `CAM_CONFIG`; jalan lewat decode software (lebih berat). |

### 4.4 Cek backend dari Jetson sendiri

Buka **jendela SSH kedua** (jangan di jendela backend):

```bash
curl http://127.0.0.1:8080/status
ss -ltnp | grep 8080
```

- `curl` harus mengembalikan JSON `{"backend":"online", ...}`.
- `ss` harus menunjukkan `0.0.0.0:8080` (artinya backend bisa dijangkau dari luar, bukan hanya dari Jetson sendiri).

Kalau `curl` **menggantung** → backend terbeku (`Ctrl+Z`). Matikan: `kill %1` (di jendela asalnya) atau `pkill -f gcs_server.py`, lalu jalankan lagi.

### 4.5 Cek dari laptop

**Windows (PowerShell)**

```powershell
ping 192.168.1.10
Test-NetConnection 192.168.1.10 -Port 8080
```
Harus `TcpTestSucceeded : True`.

**Linux / macOS (terminal)**

```bash
ping -c 3 192.168.1.10
nc -zv 192.168.1.10 8080                              # harus tertulis "succeeded" / "open"
curl -v --max-time 5 http://192.168.1.10:8080/status  # harus mengembalikan JSON
```

Lalu buka di browser: `http://192.168.1.10:8080/status`.

Gunakan **IP Jetson yang sebenarnya** (hasil `hostname -I`), bukan tulisan contoh.

---

## 5. Menjalankan frontend untuk Jetson (manual)

Backend sudah jalan di Jetson dan lolos pengecekan di 4.5. Di laptop, dari folder `gcs-rov/`:

**Windows (PowerShell)**

```powershell
cd frontend
..\.venv\Scripts\python.exe -m http.server 5500 --bind 127.0.0.1
```

**Linux / macOS (terminal)**

```bash
cd frontend
python3 -m http.server 5500 --bind 127.0.0.1
```

Frontend tidak butuh package tambahan, jadi `python3` biasa sudah cukup (tidak perlu venv). Kalau `.venv` sudah ada, `../.venv/bin/python` juga boleh.

Buka di Chrome atau Edge:

```
http://localhost:5500/?backend=http://192.168.1.10:8080
```

Dari terminal Linux: `xdg-open "http://localhost:5500/?backend=http://192.168.1.10:8080"` (macOS: `open ...`).

### Cara kerja `?backend=...`

- Alamat di parameter itu **disimpan otomatis** di browser, jadi kunjungan berikutnya tanpa parameter tetap memakainya.
- Itu sebabnya setelah berpindah dari mode DEV ke Jetson (atau sebaliknya), **buka lagi dengan parameter baru**. Kalau tidak, dashboard masih menembak alamat lama dan terlihat `OFFLINE`.
- Mengembalikan ke alamat bawaan di `config.js`: buka `http://localhost:5500/?backend=reset`.
- Kalau dashboard OFFLINE padahal backend sehat: cek alamat yang dipakai dengan melihat baris pertama panel **DATA LOG** (`GCS online — backend: ...`).

### Yang harus terlihat

| Tampilan SYSTEM STATUS | Artinya |
|---|---|
| 🟢 OPERATIONAL | Backend jalan dan Pixhawk mengirim data. |
| 🟡 NO PIXHAWK | Backend jalan, Pixhawk belum mengirim data (telemetri nol). **Koneksi laptop–Jetson sudah benar.** |
| 🔴 OFFLINE | Browser tidak bisa menghubungi backend. Ikuti [bagian 6](#6-alur-diagnosa-dashboard-tidak-tersambung). |

### Simpan file ke laptop

Fitur rekam/snapshot memakai dialog pilih folder (tombol **Downloads/Folder** di panel Controls). Dialog ini hanya ada di **Chrome/Edge** dan hanya di alamat `http://localhost` atau HTTPS. Kalau dashboard dibuka lewat `http://192.168.x.x`, dialognya tidak tersedia dan file masuk ke folder Downloads.

---

## 6. Alur diagnosa: "dashboard tidak tersambung"

Ikuti **berurutan**. Berhenti di langkah pertama yang gagal.

| # | Pengecekan | Di mana | Hasil yang benar | Kalau gagal |
|---|---|---|---|---|
| 1 | Backend masih berjalan? Jendela backend masih menampilkan log, tanpa `^C` / `^Z` | Jetson | Log `[MAVLink]` berjalan | Jalankan ulang. Kalau tadi `Ctrl+Z`: `kill %1`, jalankan lagi. |
| 2 | `curl http://127.0.0.1:8080/status` | Jetson (SSH kedua) | JSON `"backend":"online"` | Backend error: baca pesan di jendela backend. |
| 3 | `ss -ltnp \| grep 8080` | Jetson | `0.0.0.0:8080` | Kalau `127.0.0.1:8080`, cek `app.run(host='0.0.0.0', ...)` di akhir `gcs_server.py`. |
| 4 | `hostname -I` | Jetson | IP Jetson | Pastikan IP ini yang dipakai di laptop. |
| 5 | Windows: `ipconfig`<br>Linux: `ip -br a` | Laptop | IP kabel/Ethernet satu subnet dengan Jetson (`192.168.1.x`) | Atur IP laptop/Jetson supaya satu subnet (lihat catatan Linux di bawah). |
| 6 | `ping IP_JETSON`<br>(Linux: `ping -c 3 IP_JETSON`) | Laptop | Ada balasan | Kabel/Wi-Fi/subnet bermasalah. |
| 7 | Windows: `Test-NetConnection IP_JETSON -Port 8080`<br>Linux: `nc -zv IP_JETSON 8080` | Laptop | `TcpTestSucceeded : True` / `succeeded` | Ada firewall di Jetson (`sudo iptables -S`), atau backend tidak berjalan. |
| 8 | Buka `http://IP_JETSON:8080/status` di browser | Laptop | JSON tampil | Ulangi langkah 5–7. |
| 9 | Buka frontend dengan `?backend=http://IP_JETSON:8080` | Laptop | Status bukan OFFLINE | Tekan `F12`, tab **Console**, salin pesan merahnya. |

Catatan:
- Ganti `IP_JETSON` dengan IP asli (misalnya `192.168.1.10`). **Jangan mengetik tulisan `IP_JETSON` apa adanya.**
- Backend yang sudah ditemukan sehat di langkah 2–3 tapi gagal di 6–7 hampir selalu masalah jaringan, bukan kode.
- Kalau SSH-mu lewat kabel USB ke Jetson (biasanya `192.168.55.1`), IP itu juga yang dipakai di browser.

### Catatan jaringan untuk laptop Linux

Lihat IP semua antarmuka dan rute:

```bash
ip -br a          # cari antarmuka kabel (mis. enp3s0 / eth0) yang punya 192.168.1.x
ip route          # baris "default via ..." = gateway; tidak ada = tidak ada rute keluar
```

Kalau Jetson dikabel **langsung** ke laptop dan IP-nya statis, laptop harus punya IP di subnet yang sama.

Sementara (hilang saat reboot atau kabel dicabut):

```bash
sudo ip addr add 192.168.1.3/24 dev enp3s0      # ganti enp3s0 dengan nama antarmuka kabelmu dari 'ip -br a'
```

Permanen dengan NetworkManager (cek nama koneksi dengan `nmcli con show`):

```bash
nmcli con mod "Wired connection 1" ipv4.method manual ipv4.addresses 192.168.1.3/24 ipv4.never-default yes
nmcli con up "Wired connection 1"
# kembali ke otomatis (DHCP):
nmcli con mod "Wired connection 1" ipv4.method auto ipv4.addresses "" ipv4.never-default no
```

`ipv4.never-default yes` menjaga lalu lintas internet tetap lewat Wi-Fi, supaya laptop tetap online (dashboard butuh internet untuk ikon dan library 3D, lihat [Kebutuhan internet](#kebutuhan-internet)) sementara kabel dipakai khusus untuk Jetson.

### Masalah umum lainnya

| Gejala | Penyebab | Solusi |
|---|---|---|
| Browser tidak mau memuat modul / layar kosong | Dibuka lewat `file://` | Buka lewat `http://localhost:5500` (server `http.server`). |
| Ikon hilang, ROV DESIGN kosong | Laptop tanpa internet | Online-kan laptop, tekan `F5`. |
| Pesan "Model 3D gagal dimuat" | `assembly_rov_80.glb` tidak ada di `models/` sebelah `gcs_server.py` | Salin file ke sana. |
| Pesan `Address already in use` | Port 8080/5500 sudah dipakai proses lama | Tutup jendela hitam lama, atau hentikan prosesnya (lihat [Port masih dipakai](#port-masih-dipakai-padahal-jendelanya-sudah-ditutup)). |
| Rekaman video hitam | Canvas terkena pembatasan lintas-origin | Set `STREAM_CROSS_ORIGIN = true` di `config.js`, lalu cek preview kamera masih tampil. |
| Gambar kamera terpotong di sisi kiri/kanan | `object-fit: cover` | Ubah `--video-fit: contain` di `style.css`. |
| Telemetri tidak berubah (Jetson) | `pymavlink` tidak terpasang → simulasi, atau Pixhawk tidak mengirim ke port 14560 | Jalankan cek `import pymavlink`; pastikan Pixhawk/perantara mengirim MAVLink ke Jetson port UDP 14560. |
| Linux: `python3 -m venv` gagal / `libGL.so.1` hilang / `externally-managed-environment` | Paket sistem belum ada atau pip global diblokir | Lihat tabel "Error yang sering muncul di Linux" di [bagian 3.2](#32-membuat-virtual-environment-dan-memasang-package). |
| Linux: webcam tidak terbaca (`Permission denied`) | Belum masuk grup `video` | `sudo usermod -aG video $USER`, lalu logout dan login lagi. |

### Port masih dipakai padahal jendelanya sudah ditutup

Kadang program lama masih berjalan di latar belakang. Cari tahu siapa yang memakai port, lalu hentikan.

**Windows (PowerShell):**
```powershell
netstat -ano | findstr :8080          # ganti 8080 dengan 5500 untuk frontend
# kolom paling kanan adalah PID, misalnya 12345
taskkill /PID 12345 /F
```

**Jetson / Linux:**
```bash
ss -ltnp | grep 8080                  # lihat pid=... di ujung baris
pkill -f gcs_server.py                # atau: kill PID
```

Setelah itu jalankan lagi seperti biasa.

---

## 7. Referensi endpoint backend

Semua di `http://ALAMAT_BACKEND:8080`.

| Endpoint | Metode | Fungsi |
|---|---|---|
| `/status` | GET | Status backend: koneksi MAVLink, kamera, FPS terukur, zoom, mode DEV. |
| `/telemetry` | GET | Data sensor terbaru (x, y, z, roll, pitch, yaw, depth, PWM, QR, status link). |
| `/start_cameras` | POST | Mengaktifkan kamera. |
| `/stop_cameras` | POST | Mematikan kamera. |
| `/video_feed/<id>` | GET | Stream MJPEG untuk preview (id = 0 atau 1). |
| `/snapshot/<id>` | GET | Satu gambar JPEG terbaru dari kamera `<id>`. |
| `/zoom/in/<id>` | POST | Zoom in kamera `<id>`. |
| `/zoom/out/<id>` | POST | Zoom out kamera `<id>`. |
| `/zoom/in`, `/zoom/out` | POST | Alias untuk kamera 0. |
| `/models/<file>` | GET | File model 3D (`.glb`). |

Untuk mencoba sendiri dari terminal (Windows PowerShell memakai `curl.exe`):

```bash
curl http://localhost:8080/status
curl -X POST http://localhost:8080/start_cameras
curl -o tes.jpg http://localhost:8080/snapshot/0
```

---

## 8. Struktur kode frontend

Folder `frontend/js/` dipecah per tanggung jawab. `main.js` adalah titik masuk yang menyambungkan semuanya.

| File | Tanggung jawab |
|---|---|
| `config.js` | **Semua pengaturan**: alamat backend, interval, batas. |
| `main.js` | Menyambungkan modul dan tombol panel Controls. |
| `telemetry.js` | Mengambil `/telemetry` lalu mengisi panel TELEMETRY, QR, status sistem, spesifikasi ROV, alarm kedalaman. |
| `camera.js` | Toggle kamera, stream, zoom, snapshot, fullscreen. |
| `trajectory.js` | Menggambar peta jejak ROV. |
| `recorder.js` | Rekam video dan CSV. |
| `replay.js` | Modal Replay. |
| `storage.js` | Pilih folder dan simpan file. |
| `status.js` | Mengambil `/status` (resolusi, FPS, zoom). |
| `logger.js`, `clock.js`, `session.js`, `util.js` | Panel log, jam header, ID sesi, fungsi kecil. |
| `rov3d.js`, `rovTopIcon.js` | Model 3D dan ikon ROV di peta (script terpisah). |

Aturan penting:
- **Urutan `<script>` di `index.html` tidak boleh diubah**: `main.js` harus dimuat sebelum `rov3d.js` dan `rovTopIcon.js` (supaya alamat backend sudah terisi).
- Elemen HTML yang dipakai JavaScript dicari lewat `id` / `data-*`. Jangan mengganti nama `id` tanpa mengubah file JS yang memakainya.
- Angka dan URL taruh di `config.js`, jangan ditulis langsung di modul lain.

Cek sintaks cepat (butuh Node.js, opsional) setelah mengedit JS:

```bash
node --check frontend/js/telemetry.js
```
(Untuk modul ES, kadang perlu menyalin dulu ke nama berekstensi `.mjs`.)

---

## 9. Perintah berguna

| Tujuan | Windows (PowerShell) | Linux / macOS |
|---|---|---|
| IP Jetson | (jalankan di Jetson) `hostname -I` | (jalankan di Jetson) `hostname -I` |
| IP laptop | `ipconfig` | `ip -br a` (macOS: `ifconfig`) |
| Siapa yang memakai port 8080 | `netstat -ano \| findstr :8080` | `ss -ltnp \| grep 8080` (macOS: `lsof -i :8080`) |
| Hentikan program yang memakai port | `taskkill /PID <angka> /F` | `kill <pid>` atau `pkill -f gcs_server.py` |
| Cek jaringan ke Jetson | `ping IP` lalu `Test-NetConnection IP -Port 8080` | `ping -c 3 IP` lalu `nc -zv IP 8080` |
| Cek backend dari terminal | `curl.exe http://IP:8080/status` | `curl http://IP:8080/status` |
| Lihat kamera yang terpasang | (di Jetson/Linux) `ls /dev/video*` | `ls /dev/video*` |
| Mode kamera yang didukung | (di Jetson/Linux) `v4l2-ctl --device=/dev/video0 --list-formats-ext` | sama |
| Buka dashboard dari terminal | `start chrome "URL"` | `xdg-open "URL"` (macOS: `open "URL"`) |
| Buka log browser | `F12` → tab **Console** | `F12` → tab **Console** |