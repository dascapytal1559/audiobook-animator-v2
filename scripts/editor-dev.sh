#!/bin/sh
# Start, stop, or show the local editor dev servers. Both bind to loopback only.
#   API server:  http://127.0.0.1:63620  (node dist/editor-server.js, serves the built client at /)
#   Vite client: http://127.0.0.1:5173   (live reload, proxies /api to 63620)
# Logs: .dev/api.log and .dev/vite.log. PID files are informational only;
# shutdown verifies the live command, working directory, and start time.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$ROOT"
mkdir -p .dev
stop() {
  node scripts/editor-processes.mjs stop
  rm -f .dev/api.pid .dev/vite.pid
}
start() {
  stop
  pnpm run build >/dev/null
  pnpm --filter editor build >/dev/null
  node scripts/editor-processes.mjs launch
  sleep 2
  status
}
status() {
  node scripts/editor-processes.mjs status
  echo "API   http://127.0.0.1:63620/"
  echo "Vite  http://127.0.0.1:5173/"
}
case "${1:-status}" in
  start|restart) start ;;
  stop) stop; echo stopped ;;
  status) status ;;
  *) echo "usage: scripts/editor-dev.sh start|restart|stop|status" >&2; exit 2 ;;
esac
