#!/usr/bin/env bash
set -euo pipefail

# VirtOffice-OpenCode Development Server Launcher
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

cd "$PROJECT_DIR" || {
  echo "❌ Cannot cd to $PROJECT_DIR"
  exit 1
}

echo "🏁 Starting VirtOffice dev server..."
echo "Project folder: $PROJECT_DIR"
echo ""

npm run dev -- --port 5199