# Changelog

## 2.0.0

Rewritten from scratch on protocol 5. Older CLIs are told to upgrade by the server.

- The public URL now survives network drops and server restarts (reconnects to the same tunnel for
  up to 10 minutes offline).
- Heartbeats detect dead connections (sleep, network change) and reconnect automatically.
- Public WebSockets (HMR) stay open while the tunnel is idle.
- Compressed responses and Server-Sent Events are passed through untouched.
- Local redirects to `localhost` are rewritten to the public URL.
- The target can be a port, `host:port` or an http(s) URL: `hostc 3000`, `hostc https://localhost:5173`.
- Removed: `config`, `doctor`, `--local-host`, `--data-channels`, the update notice. Use
  `HOSTC_SERVER` or `--server` for a self-hosted server.
- Requires Node.js 22 or later.
