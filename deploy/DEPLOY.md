# Deploying AI Co-Therapist

## Topology

```
Browser → edge (terminates real TLS for buyafraction.com, e.g. Cloudflare)
        → origin nginx on solarautopilotnginx (192.168.160.98:443, snakeoil cert)
        → Node Voice AI app  (127.0.0.1:3004, PM2)
```

- Public IP **84.200.6.109** exposes **only port 443**. SSH is restricted —
  reach the box internally over **Tailscale**.
- The app host is **solarautopilotnginx** (internal **192.168.160.98**), an
  existing **Nginx** reverse proxy already serving other domains. Port **3000 is
  in use**, so the app listens on **3004**, bound to **127.0.0.1** (never exposed).
- **TLS:** a front edge terminates real HTTPS and connects back to this origin,
  which presents the self-signed **snakeoil** cert (same pattern as the
  `solarautopilot.com` vhost). So **no Let's Encrypt cert is needed on this box** —
  `deploy/nginx-buyafraction.conf` uses the snakeoil cert. (`deploy/Caddyfile` and
  the certbot DNS-01 notes below are kept only as alternatives for a setup where
  this box faces clients directly.)
- **HTTPS is mandatory** end-to-end: browsers only grant microphone access in a
  secure context, so the live session won't start over plain HTTP.

DNS is already confirmed: `buyafraction.com` → `84.200.6.109`.

---

## 1. Base packages (run as root / sudo)

```bash
sudo apt update
sudo apt install -y git curl ca-certificates bzip2 build-essential

# Node.js 24 (matches the version this project was built with)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs

# Nginx is already installed on this host. ONLY if you chose the Caddy option
# (see step 5) install Caddy instead:
#   sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
#   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
#     | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
#   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
#     | sudo tee /etc/apt/sources.list.d/caddy-stable.list
#   sudo apt update && sudo apt install -y caddy
```

## 2. App user + code

On this host the apps live in `~` (localadmin) under PM2, so clone there:

```bash
cd ~
git clone https://github.com/eelitedesire/voice-ai.git
cd voice-ai
npm ci
npm run download-models     # ~hundreds of MB; downloads ASR+speaker+VAD
npm run build
```

## 3. Run under PM2 (secrets live in the PM2 config)

```bash
cd ~/voice-ai
cp ecosystem.config.example.cjs ecosystem.config.cjs
nano ecosystem.config.cjs    # set GROQ_API_KEY (console.groq.com/keys) + VAULT_SECRET (openssl rand -hex 32)
pm2 start ecosystem.config.cjs
pm2 save                     # persist across reboots
pm2 logs voice-ai            # watch for: > Ready on http://127.0.0.1:3004
```

`ecosystem.config.cjs` holds secrets and is gitignored — never commit it.

> **Alternative — systemd** (if you'd rather not use PM2): use
> `deploy/ai-cotherapist.service` + `.env.production`; adjust `User=` and
> `WorkingDirectory=` to your clone path. See the unit file for details.

## 5. Nginx reverse proxy

The vhost uses the host's snakeoil cert (real TLS is at the edge — see Topology),
so there's no cert step. Add the server block:

```bash
sudo cp ~/voice-ai/deploy/nginx-buyafraction.conf /etc/nginx/sites-available/buyafraction
sudo ln -s /etc/nginx/sites-available/buyafraction /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Verify the origin routes the domain to the app:

```bash
curl -kI https://localhost -H 'Host: buyafraction.com'   # expect HTTP/2 200, X-Powered-By: Next.js
```

> If `map $http_upgrade` is already defined elsewhere in nginx, delete that block
> from the conf first (`sudo grep -rn 'map \$http_upgrade' /etc/nginx/`).
>
> **Alternative (this box faces clients directly, no edge):** the snakeoil cert
> would trigger browser warnings, so issue a real cert. Only `:443` is public, so
> HTTP-01 (`:80`) can't validate — use certbot **DNS-01**
> (`sudo certbot certonly --manual --preferred-challenges dns -d buyafraction.com`)
> and point `ssl_certificate*` at `/etc/letsencrypt/live/buyafraction.com/`.

## 6. Firewall

The public edge already exposes only `:443`. On the internal host, allow Tailscale
plus the proxy port:

```bash
sudo ufw allow in on tailscale0
sudo ufw allow 443/tcp
sudo ufw enable
```

The app port **3004 stays internal** (bound to 127.0.0.1) — do not open it.

## 7. Enroll the two speakers (one-time, app-specific)

Speaker ID needs voiceprints before live sessions work. From the UI's
"Enroll Speakers" tab, or via CLI on the server:

```bash
cd ~/voice-ai
npm run enroll
```

---

## Verify

1. Visit **https://buyafraction.com** — padlock should be valid.
2. Browser console: the WebSocket should connect to `wss://buyafraction.com/ws/transcribe`.
3. Start a live session; grant the mic prompt; confirm transcription + speaker labels.

## Updating after a code change

```bash
bash ~/voice-ai/deploy/deploy.sh     # pull → build → pm2 restart
```

## Troubleshooting

| Symptom | Check |
|---|---|
| App won't start | `pm2 logs voice-ai` — usually missing env, addon lib path, or models not downloaded |
| `sherpa-onnx` load error | Ensure `npm ci` installed `sherpa-onnx-linux-x64`; the PM2 `interpreter: bash` + `run-with-addon.sh` must set `LD_LIBRARY_PATH` |
| No HTTPS / cert fails | Only `:443` is public, so HTTP-01 (`:80`) won't validate — use DNS-01. Check `sudo journalctl -u nginx` and `sudo nginx -t` |
| Mic blocked | Page must be HTTPS; check the padlock and browser site permissions |
| WebSocket won't upgrade | Confirm the `map $http_upgrade` block + `Upgrade`/`Connection` headers are present. Confirm the app listens on 127.0.0.1:3004 (`ss -ltnp | grep 3004`) |
| Port 3004 in use too | Pick another free port; update it in `ecosystem.config.cjs` (`PORT`) and the Nginx `proxy_pass` together, then `pm2 restart voice-ai` + `nginx -s reload` |
