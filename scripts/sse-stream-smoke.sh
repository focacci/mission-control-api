#!/usr/bin/env bash
# Manual smoke for POST /api/chat/stream. Requires the API to be running and
# the OpenClaw Gateway to be reachable. Holds each connection open until the
# server emits `done` (or `error{fatal:true}`) and prints frames as they land.
set -euo pipefail

PORT="${PORT:-3737}"
URL="http://localhost:${PORT}/api/chat/stream"

echo "→ no-tool prompt ($URL)"
curl -N -sS -H 'Content-Type: application/json' \
  -d '{"message":"Say hi in five words."}' \
  "$URL"
echo
echo

echo "→ tool prompt ($URL)"
curl -N -sS -H 'Content-Type: application/json' \
  -d '{"message":"Show me my board."}' \
  "$URL"
echo
