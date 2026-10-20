@echo off
setlocal
set "ROOT=%~dp0"
cd /d "%ROOT%"
title GCS ROV - Run Frontend untuk Jetson

rem ===================== PENGATURAN (boleh diubah) =====================
set "JETSON_IP=192.168.1.10"
set "BACKEND_PORT=8080"
set "FRONTEND_PORT=5500"
rem =====================================================================

set "VENV_PY=%ROOT%.venv\Scripts\python.exe"

echo ============================================================
echo   GCS ROV - FRONTEND UNTUK JETSON
echo   Backend harus sudah berjalan di Jetson.
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

rem --- Tanya IP Jetson -------------------------------------------------
echo Alamat IP Jetson saat ini: %JETSON_IP%
set "INPUT_IP="
set /p INPUT_IP=Tekan ENTER untuk memakai IP itu, atau ketik IP lain: 
if defined INPUT_IP set "JETSON_IP=%INPUT_IP%"
set "URL=http://localhost:%FRONTEND_PORT%/?backend=http://%JETSON_IP%:%BACKEND_PORT%"

rem --- Cek backend di Jetson -------------------------------------------
echo.
echo Mengecek backend di Jetson %JETSON_IP% ...
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing 'http://%JETSON_IP%:%BACKEND_PORT%/status' -TimeoutSec 4 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 goto jetson_unreachable
echo Backend Jetson merespons. Bagus.
goto start_frontend

:jetson_unreachable
echo.
echo [PERHATIAN] Backend di Jetson TIDAK merespons. Cek urutan ini:
echo   1. Di Jetson, backend sudah dijalankan:  python3 gcs_server.py
echo      Jangan tekan Ctrl+Z atau Ctrl+C di jendela itu, biarkan berjalan.
echo   2. IP benar. Di Jetson ketik:  hostname -I
echo   3. Laptop satu jaringan dengan Jetson, misalnya IP laptop 192.168.1.x
echo      Cek di laptop dengan:  ipconfig
echo.
echo Tekan tombol apa saja untuk tetap membuka dashboard.
echo Dashboard akan menampilkan OFFLINE sampai backend Jetson menyala.
pause >nul

:start_frontend
echo.
netstat -ano | findstr /R /C:":%FRONTEND_PORT% .*LISTENING" >nul
if not errorlevel 1 (
    echo Frontend sudah berjalan di port %FRONTEND_PORT%, dipakai ulang.
) else (
    echo Menjalankan frontend ...
    start "GCS Frontend" /D "%ROOT%frontend" cmd /k ""%VENV_PY%" -m http.server %FRONTEND_PORT% --bind 127.0.0.1"
    timeout /t 2 /nobreak >nul
)

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
echo   Dashboard terbuka di browser, terhubung ke Jetson %JETSON_IP%
echo   Ada 1 jendela hitam untuk frontend. Biarkan terbuka.
echo   Untuk berhenti: tutup jendela hitam itu dengan klik tombol X.
echo ============================================================
pause
exit /b 0