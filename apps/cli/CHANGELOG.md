# Changelog

## 2.0.5

- Creating a tunnel now times out after 15 seconds if the API stops responding, including while
  reading its response body. The same deadline applies when reconnecting needs a new tunnel.

## 2.0.4

No code changes. The npm page shows the current description and README.

## 2.0.3

- Reconnects back off properly when connections keep dropping right after they open, instead of
  retrying every 250 ms. The delay starts over only after a connection has been up for 30 seconds.

## 2.0.2

Same as 2.0.1, published through the release workflow to become `latest`.

## 2.0.1

2.0.0 was published without its executable; 2.0.1 is the same release, packaged correctly.

## 2.0.0

Rewritten from scratch on protocol 5. Older CLIs are told to upgrade by the server.

- Public URLs are now on `hostc.app` (`https://<id>.hostc.app`); the API stays on `hostc.dev`.

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
