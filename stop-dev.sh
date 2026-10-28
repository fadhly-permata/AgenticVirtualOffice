#!/usr/bin/env bash
set -u

# VirtOffice-OpenCode Development Server Stopper
# Kills only the process listening on the given port (default 5199) and its children.
PORT="${1:-5199}"

pids="$(netstat -ano | tr -d '\r' | grep -E ":${PORT}[[:space:]]+.*LISTENING" | awk '{print $NF}' | sort -u)"

if [ -z "$pids" ]; then
  echo "No process is listening on port $PORT."
  exit 0
fi

for pid in $pids; do
  echo "Stopping process PID $pid on port $PORT ..."
  taskkill //PID "$pid" //T //F >/dev/null 2>&1 || echo "Failed to stop PID $pid."
done

sleep 1
echo "Stopped."
