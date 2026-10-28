#!/usr/bin/env bash
set -u

# VirtOffice-OpenCode Development Server Launcher
# Stops any instance already listening on the port, then starts a fresh one.
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${1:-5199}"

cd "$PROJECT_DIR" || {
  echo "Cannot cd to $PROJECT_DIR"
  exit 1
}

stop_port() {
  local port="$1" pids pid
  pids="$(netstat -ano | tr -d '\r' | grep -E ":${port}[[:space:]]+.*LISTENING" | awk '{print $NF}' | sort -u)"
  [ -z "$pids" ] && return 0
  for pid in $pids; do
    echo "Stopping existing process PID $pid on port $port ..."
    taskkill //PID "$pid" //T //F >/dev/null 2>&1 || true
  done
  sleep 1
}

stop_port "$PORT"

echo "Starting VirtOffice dev server on port $PORT ..."
echo "Project folder: $PROJECT_DIR"
echo ""
exec npm run dev -- --port "$PORT"
