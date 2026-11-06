<div align="center">
  <img src="./apps/web/public/favicon.svg" alt="hostc logo" width="80" height="80" />
  <h1>hostc</h1>
  <p><strong>Localhost, anywhere.</strong></p>
  <p>One command gives your dev server a public HTTPS URL. WebSockets and hot reload included.<br />Free, open source, no account.</p>
  <p>
    <a href="https://www.npmjs.com/package/hostc"><img src="https://img.shields.io/npm/v/hostc?color=ea580c&label=npm" alt="npm version" /></a>
    <a href="./LICENSE"><img src="https://img.shields.io/github/license/akazwz/hostc?color=52525b" alt="Apache-2.0 license" /></a>
    <a href="https://github.com/akazwz/hostc/stargazers"><img src="https://img.shields.io/github/stars/akazwz/hostc?style=flat&color=52525b" alt="GitHub stars" /></a>
  </p>
  <p><a href="https://hostc.dev">hostc.dev</a> · <a href="./README.zh-CN.md">简体中文</a></p>
</div>

## Quick start

Start your app, then point hostc at its port:

```sh
npx hostc@latest 3000
```

```text
  https://k7m2xq9pa4dn.hostc.app  → http://localhost:3000

  Anyone with this URL can reach your local server. Press Ctrl+C to stop.
```

Open the URL on any device. Every request shows up in your terminal as it arrives. Needs Node.js
22.1 or later.

**The URL is public:** anyone who has it reaches your server, so only expose what you mean to share.

hostc is free and open source. If it helps you, [a star on GitHub](https://github.com/akazwz/hostc) helps
other developers find it, and it's the best encouragement for the project.

## Why hostc

- **Nothing to set up.** No sign-up, no auth token, no binary to download. If you have Node.js,
  you have hostc.
- **Visitors see your app.** No warning page to click through before they reach it.
- **Hot reload works.** WebSockets pass straight through, so Vite, Next.js and friends update
  every open device the moment you save. Server-Sent Events stream as they are produced.
- **Dev servers accept it as is.** Requests arrive addressed to localhost and redirects point back
  to the public URL, so there is no allowed-hosts setting to change.
- **The link survives.** After a network drop or a server restart, hostc reconnects on its own and
  the URL stays the same, as long as it gets back within 10 minutes.

## Use it to

- share something you built with an AI coding tool before you deploy it anywhere,
- show work in progress to a teammate or a client,
- test webhooks from Stripe, GitHub or Slack against the code on your machine,
- try your site on a real phone, with hot reload (`--qr` prints a QR code to scan),
- let a coding agent share what it built. Point the agent at
  [hostc.dev/llms.txt](https://hostc.dev/llms.txt) and it knows how to run hostc and read the URL.

## Usage

```text
hostc <target> [options]
hostc codex [options]

  3000                     http://localhost:3000
  127.0.0.1:8080           http://127.0.0.1:8080
  https://localhost:5173   any http(s) origin

  --server <url>   tunnel server (env HOSTC_SERVER)
  --qr             print a QR code of the public URL
  --here           hostc codex: show only this directory (commands still reach
                   the whole machine)
  -h, --help       show this help
  -v, --version    show the version
```

Press Ctrl+C to stop; the URL is released immediately. Restarting hostc gives a new URL.

### Limits

- 256 requests and WebSockets at once per tunnel. Up to 1024 more wait for a free one; beyond
  that, requests get `503`.
- WebSocket messages up to 1 MiB. A stream also closes if your local server stops reading and over
  4 MiB is waiting for it.
- Your local server has 2 minutes to start responding to a request.

### Always run `@latest`

Server updates can be incompatible with older CLIs, so run `npx hostc@latest` to always get the
matching version. Don't install hostc globally (`npm i -g hostc`) or add it to a project: an installed
copy stays on its version, and an outdated CLI stops at startup and tells you to upgrade.

## Troubleshooting

What visitors see when a request can't reach your app:

| Error                          | Meaning                                              | What to do                                         |
| ------------------------------ | ---------------------------------------------------- | -------------------------------------------------- |
| `404` Tunnel not found         | The tunnel was stopped or has expired                | Run hostc again for a new URL                      |
| `502` Tunnel offline           | hostc isn't connected, usually while it reconnects   | Try again in a moment; check that hostc is running |
| `502` Local server unavailable | The tunnel is up but your local server didn't answer | Check that it's running on the port you gave hostc |
| `503` Tunnel busy              | Too many requests at once                            | Try again in a moment                              |
| `504` Local server timed out   | No response started within 2 minutes                 | Check what your local server is stuck on           |

## hostc codex (experimental)

Use the Codex CLI on your machine from any browser, including your phone:

```sh
npx hostc@latest codex --qr
```

This is experimental, and it depends on a Codex protocol that is also marked experimental. Read this first:

- **The link controls your machine.** Anyone who has it can read any file and run any command as
  you. Treat it like a password: don't paste it into chats or show the QR code on a shared screen.
- **Asking for approval doesn't protect you from a leaked link.** New threads ask before acting, but
  whoever has the link can approve. `--here` shows only the current directory, and commands can
  still reach the whole machine.
- **The link lasts until you stop it.** The token is random, kept in memory, and replaced on every
  start. Press Ctrl+C to end access; there is no other way to revoke it.

hostc is open source, so you can also [host it yourself](#self-hosting) and use `--server`.

## hostc vs Cloudflare Tunnel

hostc runs on Cloudflare too. It does one narrower job than Cloudflare's own tunnels: sharing a dev
server for a while.

|                    | hostc                | Quick Tunnel              | Cloudflare Tunnel |
| ------------------ | -------------------- | ------------------------- | ----------------- |
| Install            | Node.js only         | `cloudflared`             | `cloudflared`     |
| Account            | None                 | None                      | Required          |
| URL                | Random               | Random                    | Your hostname     |
| Server-Sent Events | Yes                  | No                        | Yes               |
| Dev servers        | Work as is           | May need the host allowed | Configurable      |
| Access control     | None                 | Email allowlist           | Cloudflare Access |
| Made for           | Sharing a dev server | Quick tests               | Production        |

## How it works

```
browser ──▶ Worker ──▶ Durable Object (one per tunnel) ◀── WebSocket ── hostc ──▶ localhost
```

hostc opens a single outgoing WebSocket, so nothing on your machine has to be reachable from the
internet. Each public request or WebSocket becomes a stream on that connection, with flow control
for bodies. Idle tunnels sleep on the server, which is what keeps hostc free. The wire format is in
[docs/protocol.md](./docs/protocol.md).

## Self-hosting

The server is a Cloudflare Worker you can run on your own domain, then point the CLI at it with
`--server`. See [docs/self-hosting.md](./docs/self-hosting.md).

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[Apache-2.0](./LICENSE)
