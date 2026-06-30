#!/usr/bin/env bash
# Pull latest code and (re)deploy the AI Co-Therapist app.
# Run on the server as the "deploy" user:  bash deploy/deploy.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/voice-ai}"
cd "$APP_DIR"

echo "==> Pulling latest code"
git pull --ff-only

echo "==> Installing dependencies (npm ci)"
npm ci

echo "==> Downloading models (idempotent — skips files already present)"
npm run download-models

echo "==> Building Next.js"
npm run build

echo "==> Restarting service"
sudo systemctl restart ai-cotherapist

echo "==> Status"
sleep 2
systemctl --no-pager --full status ai-cotherapist | head -n 20
echo "==> Done. Tail logs with:  journalctl -u ai-cotherapist -f"
