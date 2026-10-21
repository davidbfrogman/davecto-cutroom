#!/bin/bash
# Cutroom setup for macOS. Installs what Cutroom needs with Homebrew (Node, ffmpeg, uv),
# then hands over to setup.mjs for the rest (npm packages, Python, browsers).
# Safe to run again. Claude runs this for you; you can also run it yourself:
#   bash "<cutroom folder>/setup.sh"
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"

if [[ "$(uname)" != "Darwin" ]]; then echo "Cutroom runs on macOS only."; exit 1; fi

# Homebrew: Apple silicon and Intel locations, in case this shell hasn't loaded it.
for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [[ -x "$b" ]] && eval "$("$b" shellenv)" && break; done
if ! command -v brew >/dev/null; then
  echo "✗ Homebrew isn't installed. Cutroom uses it to install ffmpeg, Node and uv."
  echo "  Install it in Terminal (it asks for your Mac password), then run setup again:"
  echo '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
  exit 2
fi

need=()
node_ok() { command -v node >/dev/null && [[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]]; }
node_ok || need+=(node)
command -v ffmpeg >/dev/null || need+=(ffmpeg)
command -v uv >/dev/null || need+=(uv)
if (( ${#need[@]} )); then
  echo "… brew install ${need[*]}"
  brew install "${need[@]}"
fi
node_ok || { echo "✗ Node 22 or newer is needed (found $(node -v 2>/dev/null || echo none)). Try: brew upgrade node"; exit 1; }

exec node "$here/setup.mjs" "$@"
