# v4 CLI design

`apps/cli` is a thin product layer over `@hostc/client`.

## Responsibilities

- Parse command-line arguments and config.
- Resolve server URL, local host, local port, data-channel count, debug mode, and QR display options.
- Build a `localOriginAdapter` from `@hostc/client`.
- Start `HostcClient` and render concise status output.
- Surface reconnect, ready, error, and close events in user-friendly language.
- Provide config, doctor, update, and version commands.

## Non-goals

- No v4 frame codec in CLI.
- No tunnel protocol state machine in CLI.
- No CLI-owned `api.ts` create tunnel client.
- No CLI-owned `runtime.ts` transport runtime.
- No v3 control-channel compatibility.

## Runtime flow

1. CLI resolves config and local target.
2. CLI creates `localOriginAdapter({ origin })`.
3. CLI constructs `HostcClient` from `@hostc/client`.
4. SDK calls `createEphemeralTunnel`.
5. SDK opens data channels and multiplexes streams.
6. CLI renders `ready`, `reconnecting`, `closed`, and `log` events.

## SDK adapter shape

The local adapter owns communication with the user app:

```ts
const adapter = localOriginAdapter({ origin: "http://127.0.0.1:5173" });
const client = new HostcClient({ serverUrl, upstream: adapter });
await client.start();
```

Custom integrations should implement `UpstreamAdapter` in `@hostc/client` instead of copying CLI internals.
