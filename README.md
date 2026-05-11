<div align="center">
  <img src="./apps/web/public/favicon.svg" alt="hostc logo" width="80" height="80" />
  <h1>hostc</h1>
  <p><strong>Expose localhost from the edge.</strong></p>
  <p>A lightweight tunnel for local HTTP and WebSocket services, powered by Cloudflare Workers and Durable Objects.</p>
  <p>
    <a href="./README.zh-CN.md">简体中文</a>
  </p>
</div>

---

> hostc is currently in preview. The core tunnel path is usable, but early versions may require CLI upgrades when the protocol changes.

## What is hostc?

hostc gives your local development server a public URL.

It is useful for sharing local web apps, testing webhooks, previewing Vite or Next.js projects, and exposing temporary HTTP/WebSocket services without configuring a reverse proxy.

```sh
npx hostc@latest 3000
```

You will get a public URL that forwards traffic to `http://localhost:3000`.

## Features

- Zero-config CLI for temporary public tunnels.
- HTTP and WebSocket proxying, including local dev servers with HMR.
- Cloudflare Worker + Durable Object server architecture.
- v4 protocol with streams, data channels, frame metadata, credit-based flow control, and explicit close codes.
- Embeddable client SDK for CLIs, desktop apps, daemons, and custom Node.js integrations.
- Local, staging, E2E, stress, and benchmark workflows.

## Quick start

Run without installing:

```sh
npx hostc@latest 5173
```

Using `@latest` is recommended so the CLI matches the current server protocol.

Or install globally:

```sh
npm install -g hostc
hostc 5173
```

If you install globally, keep hostc updated:

```sh
npm install -g hostc@latest
```

Example output:

```text
Success  Tunnel ready
  Public URL: https://t-example.hostc.example.com/
  Local:      http://localhost:5173/
  Tunnel:     t-example
  Channels:   4
```

## Agent skill

hostc includes a lightweight agent skill for public preview workflows.

Install it with the Skills CLI:

```sh
npx skills add akazwz/hostc@hostc-public-preview -g
```

Or ask Codex to install it from GitHub:

```text
Install the hostc public preview skill from akazwz/hostc, path skills/hostc-public-preview.
```

Restart your agent after installing the skill. Then ask it to expose a local app as a public preview. The skill tells the agent to prefer `npx hostc@latest <port>` so the CLI stays compatible with the current server protocol.

To stop the preview, terminate the running hostc process. In an interactive terminal this is usually Ctrl+C. If the agent started hostc in the background, ask it to stop or kill that process.

## CLI usage

```sh
hostc <port>
```

Examples:

```sh
hostc 3000
hostc 5173 --data-channels 4
hostc 8080 --local-host 127.0.0.1
hostc 3000 --server https://hostc.example.com
```

Configuration:

```sh
hostc config get
hostc config set server-url https://hostc.example.com
hostc config unset server-url
hostc config path
```

Diagnostics:

```sh
hostc doctor 5173
```

## Architecture

hostc is split into four main parts:

| Package / App | Responsibility |
| --- | --- |
| `packages/protocol` | The protocol source of truth. Defines frames, streams, metadata, limits, credits, close codes, validation, and helpers shared by client and server. |
| `packages/client` | The embeddable client SDK. Creates ephemeral tunnels, opens data channels, multiplexes streams, proxies HTTP/WebSocket traffic, handles flow control, and reconnects when a channel is lost. |
| `apps/server` | The Cloudflare Worker + Durable Object tunnel server. Creates tunnels, receives public HTTP/WebSocket traffic, assigns streams to data channels, and forwards v4 frames. |
| `apps/cli` | The user-facing CLI. Handles arguments, config, doctor checks, terminal output, spinners, and calls the client SDK. It does not own protocol logic. |

The important separation is that protocol logic does not live in the CLI. The CLI is a thin product layer on top of the SDK, and both the SDK and server are driven by the shared protocol package.

## Protocol model

- `tunnel`: the public tunnel managed by a Durable Object.
- `client connection`: the current SDK/CLI connection to that tunnel.
- `data channel`: a WebSocket between the SDK and server.
- `stream`: one public HTTP request or WebSocket connection.
- `frame`: the protocol unit carried over a data channel.

Streams are assigned to a data channel once and stay pinned to that channel. Stream-level failures should close only that stream; channel-level failures cause the client to create a new ephemeral tunnel.

## Client SDK

The client SDK is the public integration surface for Electron apps, desktop GUIs, background daemons, custom CLIs, and Node.js tooling.

Install it from npm:

```sh
npm install @hostc/client
```

Example:

```ts
import { HostcClient, localOriginAdapter } from "@hostc/client";

const client = new HostcClient({
	serverUrl: "https://hostc.example.com",
	upstream: localOriginAdapter({
		origin: "http://localhost:5173/",
	}),
});

client.on("ready", (event) => {
  console.log(event.publicUrl);
});

client.on("reconnecting", (event) => {
  console.error(`reconnecting: ${event.reason}`);
});

await client.start();
```

Application code should import `@hostc/client`, not `@hostc/protocol`. The protocol package remains the internal wire-contract source of truth and is bundled into the SDK.

## Current behavior and limitations

- Anonymous tunnels are temporary.
- If the client connection is lost, the CLI creates a new ephemeral tunnel.
- A reconnect may produce a new tunnel id and public URL.
- There is no account system, reserved domain, dashboard, or long-running daemon yet.
- Early protocol versions are intentionally not backward compatible. If the protocol changes, update the CLI/SDK.

This keeps the preview product simple while the core tunnel path is hardened.

## Local development

Requirements:

- Node.js 18+
- pnpm
- A Cloudflare account for deployment

Install dependencies:

```sh
pnpm install
```

Build everything:

```sh
pnpm build
```

Run the server locally:

```sh
pnpm dev:server
```

Run the CLI against the local server:

```sh
pnpm build:cli
HOSTC_SERVER_URL=http://127.0.0.1:8787 node apps/cli/dist/index.js 5173
```

## Testing and benchmarks

Common checks:

```sh
pnpm build
pnpm test
pnpm lint
pnpm test:e2e:cli
pnpm test:e2e:local
pnpm bench:local
pnpm stress:local
```

Staging checks:

```sh
pnpm deploy:server:staging
pnpm preflight:staging
HOSTC_SERVER_URL=https://hostc.example.com pnpm test:e2e:staging
HOSTC_SERVER_URL=https://hostc.example.com pnpm bench:remote
HOSTC_SERVER_URL=https://hostc.example.com pnpm stress:remote
```

Staging uses `https://hostc.example.com` and `*.hostc.example.com`.

## Roadmap

- Harden tunnel lifecycle behavior under real browser, HMR, and WebSocket workloads.
- Improve Worker and Durable Object observability.
- Add reserved tunnels, stable domains, accounts, and access control.
- Explore daemon and desktop GUI workflows.

## License

Apache License 2.0. Made by [akazwz](https://github.com/akazwz).
