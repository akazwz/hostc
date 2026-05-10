# v4 server design

`apps/server` is the Cloudflare Worker + Durable Object implementation for the v4 tunnel protocol.

## Responsibilities

- Expose `POST /api/tunnels/ephemeral` to create anonymous ephemeral tunnels.
- Return `CreateEphemeralTunnelResponse` from `@hostc/protocol`.
- Upgrade `GET /api/tunnels/:id/channels/:channelId` to v4 data-channel WebSockets.
- Route public tunnel traffic into the tunnel Durable Object.
- Maintain stream state, credits, limits, and data-channel ownership inside the Durable Object.
- Close only the affected stream for stream-level failures when possible.
- Invalidate the current `clientConnection` for data-channel/protocol-level failures.
- Expire unconnected ephemeral tunnels with Durable Object alarms.

## Non-goals

- No web/static assets in `apps/server`.
- No waitlist, CLI error collection, D1, or unrelated product APIs.
- No v3 control-channel compatibility or fallback.
- No duplicated protocol constants outside `@hostc/protocol`.

## Durable Object model

- One tunnel maps to one Durable Object instance.
- A new SDK/CLI start creates a new `clientConnectionId`.
- Data channels must authenticate with the current connect token.
- Old data channels from older client connections are ignored or closed.
- Each incoming request becomes one stream and stays pinned to its assigned data channel.

## API surface

- `POST /api/tunnels/ephemeral`: create a temporary anonymous tunnel.
- `GET /api/tunnels/:id/channels/:channelId`: connect one v4 data channel.
- `dataUrl` in `CreateEphemeralTunnelResponse` is the channel base URL; SDK helpers append `:channelId`.
- Public tunnel hostnames route to the matching tunnel Durable Object.
- `GET /health`: lightweight deployment health check.

All protocol payloads, limits, metadata schemas, close codes, and create-response validation must be imported from `@hostc/protocol`.
