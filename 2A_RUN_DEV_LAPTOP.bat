@echo off
setlocal
set "ROOT=%~dp0"
cd /d "%ROOT%"
title GCS ROV - Run DEV Laptop

rem ===================== PENGATURAN (boleh diubah) =====================
set "BACKEND_FILE=gcs_server.py"
set "BACKEND_PORT=8080"
set "FRONTEND_PORT=5500"
rem Sumber posisi simulasi:  dr = dead reckoning (mode DR)
rem                          ned = seperti Pixhawk (mode PIXHAWK)
set "ROV_DEV_POS=dr"
rem Pakai webcam laptop sebagai kamera?  1 = ya, 0 = tidak (kamera sintetis)
set "ROV_DEV_WEBCAM=0"
rem =====================================================================

set "VENV_PY=%ROOT%.venv\Scripts\python.exe"
set "URL=http://localhost:%FRONTEND_PORT%/?backend=http://localhost:%BACKEND_PORT%"

echo ============================================================
echo   GCS ROV - MODE DEV DI LAPTOP (tanpa Jetson)
echo ============================================================
echo.

rem --- Pastikan package sudah terpasang -------------------------------
if not exist "%VENV_PY%" (
    echo Package belum terpasang. Menjalankan INSTALL dulu ...
    echo.
    call "%ROOT%1_INSTALL.bat" nopause
)
if not exist "%VENV_PY%" (
    echo.
    echo Instalasi belum berhasil. Jalankan 1_INSTALL.bat dan baca pesan errornya.
    pause
    exit /b 1
)

if not exist "%ROOT%backend\%BACKEND_FILE%" (
    echo [GAGAL] File backend\%BACKEND_FILE% tidak ditemukan.
    pause
    exit /b 1
)

if not exist "%ROOT%backend\models\assembly_rov_80.glb" (
    echo [PERHATIAN] Model 3D belum ada: backend\models\assembly_rov_80.glb
    echo             Dashboard tetap jalan, tapi panel ROV DESIGN akan kosong.
    echo.
)

rem --- Jalankan backend (jendela baru) --------------------------------
netstat -ano | findstr /R /C:":%BACKEND_PORT% .*LISTENING" >nul
if not errorlevel 1 (
    echo Backend sudah berjalan di port %BACKEND_PORT%, dipakai ulang.
) else (
    echo Menjalankan backend mode DEV ...
    start "GCS Backend DEV" /D "%ROOT%backend" cmd /k ""%VENV_PY%" "%BACKEND_FILE%" --dev"
)

rem --- Jalankan frontend (jendela baru) -------------------------------
netstat -ano | findstr /R /C:":%FRONTEND_PORT% .*LISTENING" >nul
if not errorlevel 1 (
    echo Frontend sudah berjalan di port %FRONTEND_PORT%, dipakai ulang.
) else (
    echo Menjalankan frontend ...
    start "GCS Frontend" /D "%ROOT%frontend" cmd /k ""%VENV_PY%" -m http.server %FRONTEND_PORT% --bind 127.0.0.1"
)

rem --- Tunggu backend siap -------------------------------------------
rem Tahap 1: tunggu port terbuka (dicek lewat netstat, instan dan andal).
rem          Maksimal 60 detik. Tiap 2 detik muncul tulisan supaya
rem          tidak terlihat macet.
echo.
echo Menunggu backend siap. Biasanya 5 sampai 15 detik, lebih lama kalau
echo ini pertama kali dijalankan atau antivirus sedang memeriksa ...
set /a TRIES=0
:wait_backend
netstat -ano | findstr /R /C:":%BACKEND_PORT% .*LISTENING" >nul
if not errorlevel 1 goto port_open
set /a TRIES+=1
if %TRIES% GEQ 60 goto backend_missing
set /a MOD=TRIES %% 2
if %MOD%==0 echo   ... masih menunggu backend, %TRIES% detik
timeout /t 1 /nobreak >nul
goto wait_backend

:backend_missing
echo.
echo [GAGAL] Backend tidak berjalan: port %BACKEND_PORT% tidak terbuka setelah 60 detik.
echo.
echo Lihat jendela hitam "GCS Backend DEV", pesan errornya biasanya ada di sana.
echo Kalau jendela itu sudah tertutup sendiri, jalankan file ini sekali lagi,
echo atau kirim pesan errornya ke tim pengembang.
pause
exit /b 1

rem Tahap 2: port sudah terbuka, coba pastikan backend menjawab.
rem          Hanya konfirmasi: kalau tidak berhasil, dashboard TETAP dibuka.
:port_open
echo Port %BACKEND_PORT% sudah terbuka. Memastikan backend menjawab ...
set /a TRIES=0
:wait_http
curl.exe -s -f -o nul --max-time 2 "http://127.0.0.1:%BACKEND_PORT%/status" >nul 2>&1
if not errorlevel 1 goto backend_ok
set /a TRIES+=1
if %TRIES% GEQ 10 goto backend_unconfirmed
timeout /t 1 /nobreak >nul
goto wait_http

:backend_ok
echo Backend siap.
goto open_browser

:backend_unconfirmed
echo Backend belum bisa dikonfirmasi, tapi port sudah terbuka. Dashboard tetap dibuka.
echo Kalau dashboard menampilkan OFFLINE, tunggu beberapa detik lalu tekan F5.
goto open_browser

:open_browser
echo.
echo Membuka dashboard: %URL%

set "HAS_CHROME="
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" >nul 2>&1
if not errorlevel 1 set "HAS_CHROME=1"
reg query "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" >nul 2>&1
if not errorlevel 1 set "HAS_CHROME=1"

if defined HAS_CHROME (
    start "" chrome "%URL%"
) else (
    echo Chrome tidak ditemukan, membuka browser bawaan. Disarankan Chrome atau Edge.
    start "" "%URL%"
)

echo.
echo ============================================================
echo   Dashboard terbuka di browser.
echo   Ada 2 jendela hitam: backend dan frontend. Biarkan terbuka.
echo   Untuk berhenti: tutup kedua jendela hitam itu dengan klik tombol X.
echo ============================================================
pause
exit /b 0