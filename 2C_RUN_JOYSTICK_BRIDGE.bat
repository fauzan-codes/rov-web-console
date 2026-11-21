@echo off
setlocal
set "ROOT=%~dp0"
cd /d "%ROOT%"
title GCS ROV - Joystick Bridge

rem ===================== PENGATURAN (boleh diubah) =====================
set "JETSON_IP=192.168.1.10"
set "BACKEND_PORT=8080"
rem Cara membaca joystick:  auto = XInput dulu, lalu SDL ^(pygame-ce^)
rem                         xinput = hanya XInput    sdl = hanya SDL
set "BRIDGE_INPUT=auto"
rem =====================================================================
rem Cara pakai:
rem   2C_RUN_JOYSTICK_BRIDGE.bat                  tampilkan menu pilihan
rem   2C_RUN_JOYSTICK_BRIDGE.bat local            backend di laptop ini (mode DEV)
rem   2C_RUN_JOYSTICK_BRIDGE.bat jetson           backend di Jetson (IP bawaan di atas)
rem   2C_RUN_JOYSTICK_BRIDGE.bat ip 192.168.1.20  backend di IP lain
rem   2C_RUN_JOYSTICK_BRIDGE.bat 192.168.1.20     sama dengan baris di atas

set "VENV_PY=%ROOT%.venv\Scripts\python.exe"
set "TARGET=%~1"
set "EXTRA_IP=%~2"
set "BACKEND_IP="

echo ============================================================
echo   GCS ROV - JOYSTICK BRIDGE
echo   Membaca joystick di laptop ini lalu mengirimnya ke backend.
echo   Robot baru bergerak setelah Enable Control di dashboard.
echo ============================================================
echo.

rem --- Pastikan package dan skrip tersedia ----------------------------
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
if not exist "%ROOT%tools\joystick_bridge.py" (
    echo [GAGAL] File tools\joystick_bridge.py tidak ditemukan.
    pause
    exit /b 1
)

rem --- Tentukan backend tujuan ----------------------------------------
if /i "%TARGET%"=="local" goto target_local
if /i "%TARGET%"=="jetson" goto target_jetson
if /i "%TARGET%"=="ip" goto target_ip
if defined TARGET goto target_custom
goto menu

:menu
echo Pilih backend tujuan:
echo   [1] Laptop ini, mode DEV            ^(127.0.0.1^)
echo   [2] Jetson                          ^(%JETSON_IP%^)
echo   [3] IP lain                         ^(ketik sendiri^)
echo   [4] Diagnosa: tampilkan joystick yang terdeteksi
echo.
choice /c 1234 /n /m "Pilih 1-4: "
if errorlevel 4 goto diagnose
if errorlevel 3 goto target_ip
if errorlevel 2 goto target_jetson
if errorlevel 1 goto target_local
goto menu

:target_local
set "BACKEND_IP=127.0.0.1"
goto have_target

:target_jetson
set "BACKEND_IP=%JETSON_IP%"
goto have_target

:target_custom
set "BACKEND_IP=%TARGET%"
goto have_target

:target_ip
set "BACKEND_IP=%EXTRA_IP%"
if defined BACKEND_IP goto have_target
set /p BACKEND_IP=Ketik IP backend ^(contoh 192.168.1.10^): 
if defined BACKEND_IP goto have_target
echo IP tidak boleh kosong.
echo.
goto menu

:diagnose
echo.
"%VENV_PY%" "%ROOT%tools\joystick_bridge.py" --list --input %BRIDGE_INPUT%
echo.
echo Kalau tertulis "slot terhubung = [0]" berarti controller XInput terbaca.
echo Kalau tidak ada yang terdeteksi: colok joystick, lalu coba lagi.
echo Untuk controller non-XInput pasang pygame-ce ^(lihat 1_INSTALL.bat^).
echo.
pause
echo.
goto menu

rem --- Jalankan bridge -------------------------------------------------
:have_target
set "BACKEND_URL=http://%BACKEND_IP%:%BACKEND_PORT%"

echo Backend tujuan: %BACKEND_URL%
echo Mengecek backend ...
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing '%BACKEND_URL%/status' -TimeoutSec 4 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
    echo [PERHATIAN] Backend belum merespons. Bridge tetap dijalankan dan akan
    echo             mencoba terus; pastikan backend sudah menyala.
) else (
    echo Backend merespons. Bagus.
)

echo.
echo ------------------------------------------------------------
echo   Sebelum mengemudi:
echo     - Tutup QGroundControl, atau matikan joystick di QGroundControl.
echo     - Di dashboard buka DRIVE, lepas semua stick, lalu Enable Control.
echo   Tekan Ctrl+C di jendela ini untuk menghentikan Bridge.
echo ------------------------------------------------------------
echo.

"%VENV_PY%" "%ROOT%tools\joystick_bridge.py" --backend "%BACKEND_URL%" --input %BRIDGE_INPUT%

echo.
echo Bridge berhenti.
pause
exit /b 0
