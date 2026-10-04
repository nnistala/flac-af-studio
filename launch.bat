@echo off
setlocal

echo ==========================================================
echo           Flac AF - Hi-Res Lossless Studio
echo         Bit-Perfect Lossless Stream & DAP Studio
echo ==========================================================

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python 3 is not installed or not in PATH.
    echo Please install Python 3.10+ from https://www.python.org/downloads/
    pause
    exit /b 1
)

REM Setup virtual environment if not present
if not exist ".venv" (
    echo [*] Creating virtual environment (.venv)...
    python -m venv .venv
    echo [*] Installing dependencies from requirements.txt...
    call .venv\Scripts\activate.bat
    python -m pip install --upgrade pip
    pip install -r requirements.txt
) else (
    call .venv\Scripts\activate.bat
)

set SPOTIFLAC_REGISTRIES=https://raw.githubusercontent.com/spotiflacapp/spotiflac-extension/main/registry.json
set PORT=8484
set URL=http://127.0.0.1:%PORT%

echo [✓] Environment initialized.
echo [✓] Starting Flac AF Studio on %URL% ...

start "" %URL%
python -m uvicorn server:app --host 127.0.0.1 --port %PORT% --log-level info

pause
