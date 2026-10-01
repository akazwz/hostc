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

Open the URL on any device. Every request shows up in your terminal as it arrives.

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
- **The link survives.** Network drops and server restarts don't change the URL; hostc reconnects
  on its own.
- **Free and open source.** The server is a Cloudflare Worker you can also run on your own domain.

## Use it to

- share something you built with an AI coding tool before you deploy it anywhere,
- show work in progress to a teammate or a client,
- test webhooks from Stripe, GitHub or Slack against the code on your machine,
- try your site on a real phone, with hot reload,
- let a coding agent share what it built. Point the agent at
  [hostc.dev/llms.txt](https://hostc.dev/llms.txt) and it knows how to run hostc and read the URL.

## Usage

```text
hostc <target> [options]

  3000                     http://localhost:3000
  127.0.0.1:8080           http://127.0.0.1:8080
  https://localhost:5173   any http(s) origin

  --server <url>   tunnel server (env HOSTC_SERVER)
  --qr             print a QR code of the public URL
  -h, --help       show this help
  -v, --version    show the version
```

Press Ctrl+C to stop; the URL is released immediately. Restarting hostc gives a new URL.

The URL is public: anyone who has it reaches your server. Only expose what you mean to share.

### Always run `@latest`

hostc is free and moves fast, so server updates can be incompatible with older CLIs. Run it with
`npx hostc@latest` and you always get the matching version.

Don't install it globally (`npm i -g hostc`) or add it to a project: an installed copy stays on its
version and stops working when the server moves on. An outdated CLI stops at startup and tells
you to upgrade.

## How it works

```
browser ──▶ Worker ──▶ Durable Object (one per tunnel) ◀── WebSocket ── hostc ──▶ localhost
```

hostc opens a single outgoing WebSocket, so nothing on your machine has to be reachable from the
internet. Each public request or WebSocket becomes a stream on that connection, with flow control
for bodies. Idle tunnels sleep on the server, which is what keeps hostc free. The wire format is in
[docs/protocol.md](./docs/protocol.md).

## Self-hosting

1. Add your domains to Cloudflare: one for the API and one for tunnels, for example `example.com`
   and `example.app`. They can be the same domain, but a separate tunnel domain keeps tunnel cookies
   and abuse reports away from your main site. Add a proxied wildcard DNS record on the tunnel
   domain (`*` → `192.0.2.1`); Cloudflare's Universal SSL covers `*.example.app`.
2. Set the token secret once: `pnpm -F @hostc/server exec wrangler secret put TOKEN_SECRET --name hostc-tunnel`
   (at least 32 random bytes, e.g. `openssl rand -base64 48`).
3. Deploy:

   ```sh
   API_DOMAIN=example.com TUNNEL_DOMAIN=example.app pnpm deploy:server
   ```

4. Use it: `npx hostc@latest 3000 --server https://example.com`, or build the CLI with
   `HOSTC_DEFAULT_SERVER=https://example.com pnpm build`.

## Contributing

Requires Node.js 22.22+ and pnpm.

```sh
pnpm install
cp apps/server/.dev.vars.example apps/server/.dev.vars
pnpm dev                       # tunnel server on http://localhost:8787
pnpm build                     # build the CLI
node apps/cli/dist/hostc.mjs 3000 --server http://localhost:8787
```

Tunnels are served on `http://<id>.localhost:8787`; Chrome and Firefox resolve `*.localhost` to your machine.

```sh
pnpm check      # format check, lint, typecheck, unit and integration tests
pnpm test:e2e   # wrangler dev + CLI + a local origin, end to end
```

| Path                | What                                                      |
| ------------------- | --------------------------------------------------------- |
| `packages/protocol` | frame format, messages and constants shared by both sides |
| `packages/client`   | Node.js client: connection, streams, reconnects           |
| `apps/server`       | Cloudflare Worker + Durable Object tunnel server          |
| `apps/cli`          | the `hostc` command                                       |
| `apps/web`          | hostc.dev website (one static page) and llms.txt          |

Issues and pull requests are welcome.

If hostc is useful to you, [star it on GitHub](https://github.com/akazwz/hostc).

## License

[Apache-2.0](./LICENSE)
