#!/bin/sh
# One-time setup: a Python environment in .venv with numpy, scipy, pillow and yt-dlp.
# Also needs ffmpeg (brew install ffmpeg). exiftool is optional (brew install exiftool) for reading camera metadata.
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
command -v ffmpeg >/dev/null || { echo "ffmpeg not found: brew install ffmpeg" >&2; exit 1; }
if command -v uv >/dev/null; then uv venv --quiet "$DIR/.venv" && uv pip install --quiet --python "$DIR/.venv/bin/python" -r "$DIR/requirements.txt"
else python3 -m venv "$DIR/.venv" && "$DIR/.venv/bin/python" -m pip install -q --upgrade pip && "$DIR/.venv/bin/python" -m pip install -q -r "$DIR/requirements.txt"; fi
echo "Ready. Try: $DIR/lm build olive-teal"
