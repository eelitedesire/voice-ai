#!/usr/bin/env bash
# Pull latest code and (re)deploy the AI Co-Therapist app.
# Run on the server as the "deploy" user:  bash deploy/deploy.sh
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/voice-ai}"
cd "$APP_DIR"

echo "==> Pulling latest code"
git pull --ff-only

echo "==> Installing dependencies (npm ci)"
npm ci

echo "==> Downloading models (idempotent — skips files already present)"
npm run download-models

echo "==> Building Next.js"
npm run build

echo "==> Restarting via PM2"
pm2 restart voice-ai

echo "==> Status"
sleep 2
pm2 status voice-ai
echo "==> Done. Tail logs with:  pm2 logs voice-ai"
