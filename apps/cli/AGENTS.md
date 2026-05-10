# AGENT INSTRUCTIONS: apps/cli

`apps/cli` is the Node.js command-line product layer for hostc. Keep protocol and transport orchestration inside `@hostc/protocol` and `@hostc/client`.

## Structure

- `src/index.ts`: CLI entrypoint and command dispatch.
- `src/config.ts`: config path, read/write, env/argument precedence, and validation.
- `src/doctor.ts`: local diagnostics.
- `src/redact.ts`: token-safe error output.
- `src/update.ts`: update checking helpers.
- Tests live in `test/` and should focus on CLI behavior, not SDK internals.

## Rules

- Do not reintroduce CLI-owned tunnel API clients or protocol runtimes.
- Do not duplicate frame, stream, credit, limit, or close-code logic from `@hostc/protocol`.
- Use `HostcClient` and `localOriginAdapter` from `@hostc/client` for tunnel execution.
- Keep CLI output concise, professional, and token-safe.
- Preserve private config file permissions and never persist connect tokens.

## Naming

- Use `clientConnection` for the SDK/server attachment created on start or reconnect.
- Use `dataChannel` for tunnel WebSockets.
- Use `stream` for one proxied HTTP/WebSocket request.
- Use `upstream` or `upstreamWebSocket` for the local app side.
- Use `createEphemeralTunnel` for anonymous tunnel creation.
