#!/bin/bash
# Starts Cutroom's MCP server. Adds Homebrew to PATH first: Claude Code opened from
# the Dock doesn't get your shell's PATH, and Node, ffmpeg and uv live there.
for d in /usr/local/bin /opt/homebrew/bin; do [[ -d "$d" ]] && PATH="$d:$PATH"; done
export PATH
here="$(cd "$(dirname "$0")/.." && pwd)"
if ! command -v node >/dev/null; then
  echo "Cutroom needs Node.js 22+. Run: bash \"$here/setup.sh\"" >&2
  exit 1
fi
exec node "$here/mcp.mjs"
