#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
bunny_data="${BUNNY_HOST_DATA_DIRECTORY:-${LOCALAPPDATA:-${XDG_STATE_HOME:-$HOME/.local/state}}/Bunny-A/development}"
export BUNNY_HOST_DATA_DIRECTORY="$bunny_data"
export BUNNY_HOST_PORT="${BUNNY_HOST_PORT:-43139}"
if ! curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:$BUNNY_HOST_PORT/health"; then
  mkdir -p "$bunny_data/logs"
  nohup npm run host >>"$bunny_data/logs/host.log" 2>&1 </dev/null &
fi
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
nohup npm run dev >>.grok/dev.log 2>&1 </dev/null &
