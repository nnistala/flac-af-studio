#!/usr/bin/env bash
set -e

# Change to script directory
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "=========================================================="
echo "          Flac AF · Hi-Res Lossless Studio                "
echo "        Bit-Perfect Lossless Stream & DAP Studio          "
echo "=========================================================="

# Find Python 3 binary
if command -v python3 &>/dev/null; then
    PY_BIN="python3"
elif command -v python &>/dev/null; then
    PY_BIN="python"
else
    echo "[ERROR] Python 3 is required but could not be found."
    echo "Please install Python 3.10+ from https://www.python.org/downloads/"
    exit 1
fi

# Ensure ffmpeg exists
if ! command -v ffmpeg &>/dev/null; then
    echo "[!] Warning: ffmpeg was not detected in PATH."
    echo "    On macOS: brew install ffmpeg"
    echo "    On Ubuntu/Debian: sudo apt install ffmpeg"
fi

# Create virtual environment if needed
if [ ! -d ".venv" ]; then
    echo "[*] Creating virtual environment (.venv)..."
    "$PY_BIN" -m venv .venv
    echo "[*] Installing dependencies..."
    .venv/bin/pip install --upgrade pip
    .venv/bin/pip install -r requirements.txt
fi

# Export required environment paths
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export SPOTIFLAC_REGISTRIES="https://raw.githubusercontent.com/spotiflacapp/spotiflac-extension/main/registry.json"

PORT=8484
URL="http://127.0.0.1:$PORT"

echo "[✓] Environment initialized."
echo "[✓] Launching Flac AF Studio on $URL ..."

# Automatically open browser based on OS
(
    sleep 2
    if [[ "$OSTYPE" == "darwin"* ]]; then
        open "$URL" 2>/dev/null || true
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        xdg-open "$URL" 2>/dev/null || true
    fi
) &

# Run server
exec .venv/bin/python3 -m uvicorn server:app --host 127.0.0.1 --port $PORT --log-level info
