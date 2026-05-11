# @hostc/client

Embeddable Node.js SDK for creating hostc tunnels from your own app.

`@hostc/client` is the public SDK boundary. It bundles hostc protocol internals, so application code only needs this package and should not depend on `@hostc/protocol` directly.

## Install

```bash
npm install @hostc/client
```

## Usage

```ts
import { HostcClient, localOriginAdapter } from "@hostc/client";

const client = new HostcClient({
	serverUrl: "https://your-hostc-server.example.com",
	upstream: localOriginAdapter({ origin: "http://127.0.0.1:3000" }),
});

client.on("ready", ({ publicUrl }) => {
	console.log(`Tunnel ready: ${publicUrl}`);
});

client.on("reconnecting", ({ reason }) => {
	console.log(`Reconnecting: ${reason}`);
});

await client.start();
```

## Public API

- `HostcClient`: manages tunnel lifecycle, reconnects, and data channels.
- `createEphemeralTunnel`: creates a temporary tunnel using a hostc server.
- `localOriginAdapter`: forwards tunnel traffic to a local HTTP/WebSocket origin.
- `UpstreamAdapter`: implement this to integrate hostc with custom runtimes.

## Protocol boundary

The SDK uses the hostc v4 protocol internally. Protocol frames, stream state, limits, credits, and close codes are intentionally not part of the public SDK surface.
