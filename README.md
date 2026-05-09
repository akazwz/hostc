<div align="center">
  <img src="./apps/web/public/favicon.svg" alt="hostc logo" width="80" height="80" />
  <h1>hostc</h1>
  <p><strong>Localhost to the edge.</strong></p>
  <p>Secure, fast, and frictionless edge tunnels. Powered by Cloudflare Workers.</p>
</div>

---

**hostc** is a modern, lightweight, and zero-configuration tool to instantly expose your local HTTP and WebSocket services to the public internet. Built entirely on top of Cloudflare Workers and Durable Objects for global low-latency edge networking.

## ✨ Features

- **Zero Config**: Just run one command and get a public HTTPS URL.
- **WebSocket Support**: Seamlessly proxies WebSocket upgrades (`ws://` -> `wss://`) out of the box.
- **Edge Powered**: Traffic is routed through Cloudflare's massive global network.
- **Self-Hostable**: You can easily deploy the worker to your own Cloudflare account.

## 🚀 Quick Start

You don't even need to install anything if you have Node.js. Just run:

```bash
npx hostc 3000
```

Or, install it globally for frequent use:

```bash
npm install -g hostc

hostc 3000
```

> **Public URL**: You'll instantly get a URL like `https://t-a1b2c3d4.hostc.dev` that routes traffic directly to your `http://127.0.0.1:3000`.

## 🗺️ Roadmap

hostc is still early, and the focus right now is making the core tunnel experience solid before adding more surface area.

### Near term

- Harden tunnel routing, connection lifecycle, and error-page behavior.
- Polish the CLI UX around reconnects, local server failures, and terminal output.
- Improve self-hosting and local development docs.
- Add better operational visibility for the Worker and Durable Object path.

### Later

- Reserved or custom subdomains.
- Basic access control for shared tunnels.
- Hosted onboarding and account features after the tunnel core is stable.

## 🏗️ Architecture & Monorepo

This project is a Monorepo managed by `pnpm`.

| Package / App | Description |
| --- | --- |
| [`apps/cli`](./apps/cli) | The Node.js command-line interface tool. |
| [`apps/server`](./apps/server) | The Cloudflare Worker and Durable Object handling tunnel API, control/data sockets, and public proxying. |
| [`packages/protocol`](./packages/protocol) | Runtime-agnostic protocol package shared by CLI and server. |
| [`apps/web`](./apps/web) | Web UI package; the tunnel server does not depend on it. |

## 🛠️ Local Development

### Requirements
- Node.js 18+
- `pnpm` v8+
- A Cloudflare account (if you want to deploy the worker yourself)

### Setup

1. **Install dependencies**
   ```bash
   pnpm install
   ```

2. **Run the Cloudflare Worker locally**
   ```bash
   pnpm dev:server
   ```

3. **Run the CLI locally against your local worker**
   ```bash
   pnpm build:cli
   HOSTC_SERVER_URL=http://127.0.0.1:8787 node apps/cli/dist/index.js 3000
   ```

### Refactor Acceptance Commands

```sh
pnpm build
pnpm test
pnpm lint
pnpm -F @hostc/protocol test
pnpm -F @hostc/protocol bench
pnpm -F @hostc/server test
pnpm -F @hostc/server dev
pnpm -F @hostc/server test:e2e:local
pnpm -F @hostc/server deploy:staging
pnpm -F @hostc/server preflight:staging
pnpm -F @hostc/server test:e2e:staging
pnpm -F @hostc/server load:staging
pnpm -F hostc build
pnpm -F hostc test
pnpm test:e2e:local
pnpm test:stress:local
pnpm preflight:staging
pnpm run audit:refactor
```

Staging uses `https://envoq.dev` and wildcard `*.envoq.dev`. For first-time staging setup, deploy the Worker once, set `TOKEN_SECRET` with Wrangler secrets, then run `pnpm preflight:staging`.
`pnpm preflight:staging` is read-only and checks whether the staging Worker, `TOKEN_SECRET`, and `/health` are ready before running staging E2E/load.
Preview legacy cleanup with `pnpm run cleanup:legacy -- --dry-run`. After explicit approval for destructive local cleanup, run `pnpm run cleanup:legacy -- --yes` to remove the old Worker/protocol directories, including untracked leftovers, and their temporary Biome exclusions.

## 📖 License

Apache License 2.0. Made by [akazwz](https://github.com/akazwz).
