# Changelog

## 2.1.2

- A tunnel no longer drops during an upload when the link slows down. 2.1.1 lets an upload have up to
  4 MiB in flight; the heartbeat's reply waits behind it, and when the link slowed down it came too late
  and the CLI reconnected, failing the upload. Any data that arrives now shows the connection is alive.
- Upload windows widen as intended on long paths. A window stopped growing whenever its end fell
  in the middle of a clump of arrivals, which is common once windows are wide, so uploads took many
  round trips to speed up. Downloads had the same problem on the server, fixed there for every
  version. Over a simulated 270 ms round trip, a 32 MB download went from 3.4 to 9.0 MB/s.

## 2.1.1

- Uploads are no longer capped at one 256 KiB window per round trip, about 1.3 MB/s over a 200 ms
  path. Like downloads, a request body's window now doubles while it holds the upload back, up to
  4 MiB per request and 16 MiB per tunnel, and stops growing once the link is the limit.

## 2.1.0

- New, experimental: `hostc codex` uses the Codex CLI on your machine from any browser, including your
  phone, through a private link. `--qr` prints a QR code, and `--here` shows only the current directory.
  The link can read any file and run any command as you, so keep it private. Its address starts with `codex-`.

## 2.0.7

- WebSockets can no longer grow the CLI's memory without limit. While the tunnel is congested the
  CLI stops reading from local WebSockets, so a fast local server waits and no message is lost. A
  local server that stops reading what visitors send has that stream closed with `1013` once 4 MiB
  is queued.
- Redirects to the local server are recognized in every form, including `http://localhost:3000#token`
  and `//localhost:3000/login`. Those used to send visitors to their own machine.

## 2.0.6

- Headers the local server sends when it accepts a WebSocket, such as `Set-Cookie`, now reach the
  visitor. They used to be dropped, so apps that set a session cookie on connect lost it.

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
