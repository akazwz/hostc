<div align="center">
  <img src="./apps/workers/public/favicon.svg" alt="hostc logo" width="80" height="80" />
  <h1>hostc</h1>
  <p><strong>Localhost to the edge.</strong></p>
  <p>Secure, fast, and frictionless edge tunnels. Powered by Cloudflare Workers.</p>
</div>

---

**hostc** is a modern, lightweight, and zero-configuration tool to instantly expose your local HTTP and WebSocket services to the public internet. Built entirely on top of Cloudflare Workers and Durable Objects for global low-latency edge networking.

## ✨ Features

- **Zero Config**: Just run one command and get a public HTTPS URL.
- **WebSocket Support**: Seamlessly proxies WebSocket upgrades (`ws://` -> `wss://`) out of the box.
- **Edge Powered**: Traffic is routed through Cloudflare's massive global network network.
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

## 🏗️ Architecture & Monorepo

This project is a Monorepo managed by `pnpm`.

| Package / App | Description |
| --- | --- |
| [`apps/cli`](./apps/cli) | The Node.js command-line interface tool. |
| [`apps/workers`](./apps/workers) | The Cloudflare Worker and Durable Object handling the tunnel connections. |
| [`packages/tunnel-protocol`](./packages/tunnel-protocol) | Shared protocol and WebSocket message types. |

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
   pnpm dev:workers
   ```

3. **Run the CLI locally against your local worker**
   ```bash
   cd apps/cli
   pnpm dev
   
   # Or using the environment variable with the built CLI:
   HOSTC_SERVER_URL=http://127.0.0.1:8787 hostc 3000
   ```

## 📖 License

Apache License 2.0. Made with ❤️ by [akazwz](https://github.com/akazwz).
