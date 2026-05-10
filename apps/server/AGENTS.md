# AGENT INSTRUCTIONS: apps/server

`apps/server` is the Cloudflare Worker + Durable Object tunnel server for the v4 protocol.

## Scope

- Implement anonymous ephemeral tunnel creation.
- Implement v4 data-channel WebSocket handling.
- Route public tunnel traffic through the Durable Object.
- Enforce protocol limits, credits, metadata validation, close codes, and stream lifecycle rules from `@hostc/protocol`.

## Rules

- Do not reintroduce web/static assets, waitlist APIs, CLI error APIs, D1, or `nodejs_compat`.
- Do not add v3 compatibility, fallback protocol modes, or control-channel APIs.
- Do not duplicate protocol constants or metadata schemas in server code.
- Keep Durable Object state explicit: tunnel, current `clientConnectionId`, data channels, streams, credits, and expiry alarms.
- Stream-level errors should close only the affected stream when possible.
- Channel-level protocol errors should close the affected data channel.

## Naming

- `tunnel`: one public tunnel resource and its Durable Object.
- `clientConnection`: one live SDK/CLI attachment to a tunnel.
- `dataChannel`: one WebSocket transport for multiplexed frames.
- `stream`: one proxied HTTP request or WebSocket request.
- `frame`: one v4 binary protocol message.
