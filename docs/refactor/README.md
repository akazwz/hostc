# hostc v4 tunnel architecture

`docs/refactor/` is the active source of truth for the current tunnel implementation. The old v3 control-channel design has been removed from this directory to avoid ambiguous guidance.

## Active documents

- `protocol-v4.md`: v4 wire protocol, naming, frame types, stream lifecycle, limits, credits, and close/error rules.
- `client-sdk.md`: SDK package shape and the responsibilities shared by CLI, desktop clients, daemon clients, and custom Node integrations.
- `server.md`: Cloudflare Worker and Durable Object responsibilities for the v4 tunnel server.
- `cli.md`: CLI product layer responsibilities on top of `@hostc/client`.
- `testing.md`: unit, integration, E2E, bench, stress, and staging test plan.
- `staging.md`: staging Worker environment, deployment, secrets, and staging validation.
- `deployment.md`: deployment checklist for the Worker server.
- `acceptance.md`: final refactor acceptance checklist.

## Core concepts

- `tunnel`: the public tunnel resource hosted by one Durable Object.
- `clientConnection`: one live client attachment to a tunnel. When the CLI or SDK reconnects, the server creates a new `clientConnectionId` and ignores old channels.
- `dataChannel`: a WebSocket transport between client and server. A tunnel can use multiple data channels.
- `stream`: one proxied HTTP request or WebSocket request. A stream is assigned to exactly one data channel for its lifetime.
- `frame`: one binary protocol message on a data channel.

## Current package responsibilities

- `packages/protocol`: the only source for protocol constants, frame codec, metadata validation, limits, credits, close codes, and tunnel API response parsing.
- `packages/client`: embeddable SDK. It creates ephemeral tunnels, opens data channels, multiplexes streams, proxies to an upstream adapter, and emits client lifecycle events.
- `apps/server`: Cloudflare Worker + Durable Object implementation of the tunnel server.
- `apps/cli`: thin command-line product layer. It resolves config, creates an upstream local adapter, starts `@hostc/client`, and renders status/log output.

## Naming rules

Use these terms consistently in code and docs:

- Prefer `clientConnection`, not `connectionId`, `session`, or `runtime`.
- Prefer `dataChannel`, not generic `socket` for the tunnel transport.
- Prefer `stream` for one proxied request.
- Prefer `upstreamWebSocket` for the local app WebSocket object used by the SDK adapter.
- Prefer `createEphemeralTunnel` for anonymous tunnel creation.

Do not reintroduce a v3-style control channel or CLI-owned protocol runtime. The CLI must call `@hostc/client`; protocol logic belongs in `@hostc/protocol` and transport/client orchestration belongs in `@hostc/client`.
