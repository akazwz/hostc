<div align="center">
  <img src="./apps/web/public/favicon.svg" alt="hostc logo" width="80" height="80" />
  <h1>hostc</h1>
  <p><strong>Localhost, anywhere.</strong></p>
  <p>A public URL for your local HTTP and WebSocket server, running on Cloudflare Workers and Durable Objects.</p>
  <p><a href="./README.zh-CN.md">简体中文</a></p>
</div>

---

```sh
npx hostc@latest 3000
```

```text
  https://k7m2xq9pa4dn.hostc.app  → http://localhost:3000
```

Share a dev server, test webhooks, or open your app on a phone. No account, nothing to install.

## Features

- HTTP and WebSocket, including dev servers with hot reload (Vite, Next.js, …) and Server-Sent Events.
- The URL survives network drops and server restarts: hostc reconnects to the same tunnel.
- Bodies are streamed with flow control and passed through byte for byte, compressed ones included.
- Idle tunnels cost nothing: the server hibernates while nothing is flowing.

## CLI

```text
hostc <target> [options]

  3000                     http://localhost:3000
  127.0.0.1:8080           http://127.0.0.1:8080
  https://localhost:5173   any http(s) origin

  --server <url>   tunnel server (env HOSTC_SERVER)
  --qr             print a QR code of the public URL
```

Press Ctrl+C to stop; the URL is released immediately. Restarting hostc gives a new URL.

## Updates

hostc is free and has no accounts, so it moves fast: server updates can be incompatible with older
CLIs. Always run `npx hostc@latest` and you get the matching version.

Don't install it globally (`npm i -g hostc`) or pin it in a project: an installed copy stays on its
version and stops working when the server moves on. If you run an older one, it fails at startup
with a message telling you to upgrade.

## How it works

```
browser ──▶ Worker ──▶ Durable Object (one per tunnel) ◀── one WebSocket ── hostc ──▶ localhost
```

Each public request becomes a stream multiplexed over the client's WebSocket. The protocol is five
bytes of header per frame, seven frame types, and a per-stream window for HTTP bodies. See
[docs/protocol.md](./docs/protocol.md).

| Path                | What                                                      |
| ------------------- | --------------------------------------------------------- |
| `packages/protocol` | frame format, messages and constants shared by both sides |
| `packages/client`   | Node.js client: connection, streams, reconnects           |
| `apps/server`       | Cloudflare Worker + Durable Object tunnel server          |
| `apps/cli`          | the `hostc` command                                       |
| `apps/web`          | hostc.dev website (one static page) and llms.txt          |

## Development

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

## Self-hosting

1. Add your domains to Cloudflare: one for the API and one for tunnels, for example `example.com`
   and `example.app`. They can be the same domain, but a separate tunnel domain keeps tunnel cookies
   and abuse reports away from your main site. Add a proxied wildcard DNS record on the tunnel
   domain (`*` → `192.0.2.1`); Cloudflare's Universal SSL covers `*.example.app`.
2. Set the token secret once: `pnpm -F @hostc/server exec wrangler secret put TOKEN_SECRET`
   (at least 32 random bytes, e.g. `openssl rand -base64 48`).
3. Deploy:

   ```sh
   API_DOMAIN=example.com TUNNEL_DOMAIN=example.app pnpm deploy:server
   ```

4. Use it: `npx hostc@latest 3000 --server https://example.com`, or build the CLI with
   `HOSTC_DEFAULT_SERVER=https://example.com pnpm build`.

## License

Apache-2.0
