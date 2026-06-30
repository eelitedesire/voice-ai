# Deploying AI Co-Therapist to a server

Target: **Ubuntu/Debian** server at **84.200.6.109**, served at **https://buyafraction.com**
via **systemd** (app) + **Caddy** (auto-HTTPS reverse proxy).

> Why HTTPS is mandatory: the browser only grants microphone access in a
> "secure context". Without TLS the live session will never start. Caddy obtains
> and renews a Let's Encrypt certificate automatically.

---

## 0. DNS (do this first — cert issuance depends on it)

At your domain registrar / DNS host for `buyafraction.com`, create:

| Type | Name | Value          |
|------|------|----------------|
| A    | `@`  | `84.200.6.109` |
| A    | `www`| `84.200.6.109` |

Wait until `dig +short buyafraction.com` returns `84.200.6.109` before requesting
the certificate (step 5).

---

## 1. Base packages (run as root / sudo)

```bash
sudo apt update
sudo apt install -y git curl ca-certificates bzip2 build-essential

# Node.js 24 (matches the version this project was built with)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs

# Caddy (official repo)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

## 2. App user + code

```bash
sudo useradd -r -m -d /opt/voice-ai -s /bin/bash deploy || true
sudo mkdir -p /opt/voice-ai
sudo chown deploy:deploy /opt/voice-ai

sudo -u deploy git clone https://github.com/eelitedesire/voice-ai.git /opt/voice-ai
cd /opt/voice-ai
sudo -u deploy npm ci
sudo -u deploy npm run download-models     # ~hundreds of MB; downloads ASR+speaker+VAD
sudo -u deploy npm run build
```

## 3. Secrets

```bash
sudo -u deploy cp /opt/voice-ai/.env.production.example /opt/voice-ai/.env.production
sudo -u deploy nano /opt/voice-ai/.env.production
#   GROQ_API_KEY=...                (from https://console.groq.com/keys)
#   VAULT_SECRET=<openssl rand -hex 32>
sudo chmod 600 /opt/voice-ai/.env.production
```

## 4. systemd service

```bash
sudo cp /opt/voice-ai/deploy/ai-cotherapist.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ai-cotherapist
journalctl -u ai-cotherapist -f          # watch for "> Ready on http://127.0.0.1:3000"
```

## 5. Caddy reverse proxy + HTTPS

```bash
sudo cp /opt/voice-ai/deploy/Caddyfile /etc/caddy/Caddyfile
sudo mkdir -p /var/log/caddy && sudo chown caddy:caddy /var/log/caddy
sudo systemctl reload caddy
sudo journalctl -u caddy -f              # confirm certificate obtained, no errors
```

## 6. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw enable
```

(Also open ports 22/80/443 in any cloud-provider security group.)

## 7. Enroll the two speakers (one-time, app-specific)

Speaker ID needs voiceprints before live sessions work. From the UI's
"Enroll Speakers" tab, or via CLI on the server:

```bash
cd /opt/voice-ai
sudo -u deploy npm run enroll
```

---

## Verify

1. Visit **https://buyafraction.com** — padlock should be valid.
2. Browser console: the WebSocket should connect to `wss://buyafraction.com/ws/transcribe`.
3. Start a live session; grant the mic prompt; confirm transcription + speaker labels.

## Updating after a code change

```bash
sudo -u deploy bash /opt/voice-ai/deploy/deploy.sh
```

## Troubleshooting

| Symptom | Check |
|---|---|
| App won't start | `journalctl -u ai-cotherapist -e` — usually missing `node` in PATH, addon lib path, or models not downloaded |
| `sherpa-onnx` load error | Ensure `npm ci` installed `sherpa-onnx-linux-x64`; `run-with-addon.sh` must set `LD_LIBRARY_PATH` |
| No HTTPS / cert fails | DNS not yet pointing at `84.200.6.109`; re-check `dig buyafraction.com`, then `sudo systemctl reload caddy` |
| Mic blocked | Page must be HTTPS; check the padlock and browser site permissions |
| WebSocket won't upgrade | `journalctl -u caddy` for proxy errors; confirm app is listening on 127.0.0.1:3000 |
