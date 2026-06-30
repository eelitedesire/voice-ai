// PM2 process definition for the Voice AI app (matches the solarautopilotnginx
// convention — runs alongside lixi/solarautopilot under PM2).
//
// Setup on the server:
//   cp ecosystem.config.example.cjs ecosystem.config.cjs
//   nano ecosystem.config.cjs        # fill GROQ_API_KEY + VAULT_SECRET
//   pm2 start ecosystem.config.cjs && pm2 save
//
// ecosystem.config.cjs holds secrets and is gitignored — never commit it.
//
// `interpreter: 'bash'` + the run-with-addon wrapper sets LD_LIBRARY_PATH for the
// sherpa-onnx native addon before launching the server (same as `npm run start`).

module.exports = {
  apps: [
    {
      name: 'voice-ai',
      cwd: '/home/localadmin/voice-ai',
      script: 'scripts/run-with-addon.sh',
      args: 'tsx server.ts',
      interpreter: 'bash',
      env: {
        NODE_ENV: 'production',
        PORT: '3004',          // 3000/3002/3003 are taken on this host
        HOSTNAME: '127.0.0.1', // internal only; Nginx fronts it on :443
        GROQ_API_KEY: 'REPLACE_ME',
        VAULT_SECRET: 'REPLACE_ME', // openssl rand -hex 32
      },
    },
  ],
};
