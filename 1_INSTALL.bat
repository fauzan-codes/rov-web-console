@echo off
setlocal
cd /d "%~dp0"
title GCS ROV - Install
echo ============================================================
echo   GCS ROV - INSTALL  (cukup dijalankan satu kali)
echo ============================================================
echo.

rem --- 1. Cari Python -------------------------------------------------
set "PY="
py -3 --version >nul 2>&1
if not errorlevel 1 set "PY=py -3"
if not defined PY (
    python --version >nul 2>&1
    if not errorlevel 1 set "PY=python"
)
if not defined PY goto no_python

echo Python ditemukan:
%PY% --version
echo.

rem --- 2. Buat virtual environment (.venv) ------------------------------
if exist ".venv\Scripts\python.exe" (
    echo Folder .venv sudah ada, dipakai ulang.
) else (
    echo Membuat folder .venv ...
    %PY% -m venv .venv
    if errorlevel 1 goto venv_failed
)

rem --- 3. Pasang package ------------------------------------------------
echo.
echo Memasang package. Butuh internet, bisa beberapa menit ...
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r "backend\requirements-dev.txt"
if errorlevel 1 goto pip_failed

rem --- 4. Cek hasil -----------------------------------------------------
echo.
echo Mengecek hasil instalasi ...
".venv\Scripts\python.exe" -c "import flask, flask_cors, cv2, numpy; print('OK - opencv', cv2.__version__)"
if errorlevel 1 goto check_failed

echo.
echo ============================================================
echo   INSTALL SELESAI.
echo   Langkah berikutnya: jalankan 2A_RUN_DEV_LAPTOP.bat
echo ============================================================
if /i not "%~1"=="nopause" pause
exit /b 0

:no_python
echo [GAGAL] Python belum terpasang.
echo.
echo Download di: https://www.python.org/downloads/
echo Saat install, CENTANG kotak "Add python.exe to PATH".
echo Disarankan Python 3.10 sampai 3.12. Setelah itu jalankan file ini lagi.
if /i not "%~1"=="nopause" pause
exit /b 1

:venv_failed
echo [GAGAL] Tidak bisa membuat folder .venv.
echo Coba pasang ulang Python dari python.org lalu jalankan file ini lagi.
if /i not "%~1"=="nopause" pause
exit /b 1

:pip_failed
echo [GAGAL] Pemasangan package gagal. Biasanya karena tidak ada internet.
echo Cek koneksi internet lalu jalankan file ini lagi. Pesan error ada di atas.
if /i not "%~1"=="nopause" pause
exit /b 1

:check_failed
echo [GAGAL] Package terpasang tapi tidak bisa di-import. Pesan error ada di atas.
echo Coba hapus folder .venv lalu jalankan file ini lagi.
if /i not "%~1"=="nopause" pause
exit /b 1
