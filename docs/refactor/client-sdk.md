# v4 client SDK design

`packages/client` is the embeddable client SDK used by the CLI and future desktop, daemon, or custom Node integrations.

## Public surface

- `HostcClient`: lifecycle manager for one tunnel client.
- `createEphemeralTunnel`: creates an anonymous temporary tunnel through the server API.
- `localOriginAdapter`: adapter for forwarding streams to a local HTTP/WebSocket origin.
- `UpstreamAdapter`: interface for custom integrations.
- `HostcUpstreamWebSocket`: interface for custom upstream WebSocket implementations.

## Responsibilities

- Create ephemeral tunnels with the v4 API.
- Open and maintain v4 data channels.
- Multiplex server-side streams over data channels.
- Enforce protocol limits, credits, sequence validation, and stream lifecycle rules.
- Proxy HTTP and WebSocket streams to an upstream adapter.
- Reconnect by creating a new tunnel/client connection instead of refreshing anonymous tokens.
- Emit lifecycle events for CLI and GUI clients.

## Non-goals

- No CLI output or config persistence.
- No Cloudflare Worker or Durable Object logic.
- No protocol constants duplicated outside `@hostc/protocol`.
- No v3 compatibility or control-channel fallback.

## Naming

- SDK transport ownership is `ClientConnection`.
- Local app sockets are `HostcUpstreamWebSocket`.
- Tunnel WebSockets are `dataChannel`s.
- Proxied requests are `stream`s.
