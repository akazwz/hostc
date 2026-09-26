# hostc protocol (version 5)

The wire protocol between the hostc client (`@hostc/client`, used by the CLI) and the tunnel server
(`apps/server`). Constants and codecs live in `@hostc/protocol`; this document explains them.

## Overview

```
public client ──HTTPS/WSS──▶ Worker ──▶ Durable Object "Tunnel" ◀──one WebSocket── hostc client ──▶ local server
```

- A **tunnel** is one Durable Object and one public URL: `https://<id>.<TUNNEL_DOMAIN>`.
- The client holds **one WebSocket** to the tunnel. Every public HTTP request or WebSocket becomes a
  **stream** multiplexed over it.
- Everything needed to route WebSocket traffic lives in socket attachments and tags, so the Durable
  Object hibernates whenever no HTTP request is in flight, including while public WebSockets stay open.

## Tunnel API

All API calls carry `hostc-protocol: 5`. A mismatch returns `426` with a message telling the user to
upgrade; there is no fallback to older versions.

| Request                                  | Result                                                        |
| ---------------------------------------- | ------------------------------------------------------------- |
| `POST /api/tunnels`                      | `201 { id, url, connectUrl, token }`, `429` when rate limited |
| `GET /api/tunnels/:id/connect` (upgrade) | `101`; `401` bad token; `404` tunnel expired                  |
| `GET /api/health`                        | `200 { ok: true }`                                            |

The token is `HMAC-SHA256(TOKEN_SECRET, "connect:<id>")`, sent as `Authorization: Bearer <token>`.
It never expires on its own; it stops working when the tunnel expires. The client keeps it in memory
only, so restarting the CLI creates a new tunnel.

## Tunnel lifetime

| Event                                 | Effect                                                |
| ------------------------------------- | ----------------------------------------------------- |
| created                               | must connect within 2 minutes                         |
| client connects                       | replaces any previous connection (closed with `4001`) |
| connection drops (network, deploy, …) | tunnel waits 10 minutes; reconnecting keeps the URL   |
| client closes with `4000`             | tunnel is released immediately                        |
| grace period passes                   | tunnel storage is deleted; URL and token stop working |

When the connection drops, all streams end: in-flight requests fail with `502` and public WebSockets
close with `1001`. Streams never survive a reconnect.

## Heartbeat

The client sends the text message `hostc:ping` every 15 s. The runtime answers `hostc:pong` without
waking the Durable Object. The client reconnects if a pong does not arrive within 10 s. The server
treats a client whose last ping is older than 45 s as gone. `hostc:ping` and `hostc:pong` are the
only text messages; everything else is a binary frame.

The auto-response applies to every WebSocket of the Durable Object, public ones included, so a
visitor's message that is exactly `hostc:ping` is answered by the runtime instead of reaching the
local server. That is why the heartbeat is not a plain `ping`, which many apps send themselves.

## Frames

```
u8 type | u32 streamId (big endian) | payload
```

Stream ids are allocated by the server, start at 1 and only increase.
Public WebSocket subprotocol headers must be unique tokens; malformed ones are rejected with `400`
before reaching the client. The transport is ordered and
reliable, so there are no sequence numbers.

| Type | Name     | Direction       | Payload                                                |
| ---- | -------- | --------------- | ------------------------------------------------------ |
| 1    | `OPEN`   | server → client | JSON `{ method, path, headers, body, websocket? }`     |
| 2    | `HEAD`   | client → server | JSON `{ status, headers, body, protocol? }`            |
| 3    | `DATA`   | both            | HTTP body chunk (≤ 64 KiB) or binary WebSocket message |
| 4    | `TEXT`   | both            | text WebSocket message (UTF-8)                         |
| 5    | `END`    | both            | HTTP: empty. WebSocket: `u16 code                      | UTF-8 reason` |
| 6    | `RESET`  | both            | UTF-8 reason; aborts the stream in both directions     |
| 7    | `WINDOW` | both            | `u32` bytes granted                                    |

- `headers` is a list of `[name, value]` pairs. Hop-by-hop headers are removed on both sides.
- `OPEN.body` / `HEAD.body` say whether `DATA` frames and an `END` follow.
- `OPEN.websocket` lists the offered subprotocols and marks the stream as a WebSocket upgrade.
  `HEAD` with status `101` accepts it (`protocol` must be one of the offered ones); any other status
  rejects it and is passed to the public client.
- Frames for a stream the receiver does not know are ignored: the stream already ended.
- A `HEAD` the server cannot accept (for example a status outside 100–599) fails only that stream.
- Other malformed frames, `OPEN` from the client, or exceeding a window are protocol errors: the
  connection is closed with `1002` and the client reconnects.
- Stream ids never repeat within a tunnel, even across hibernation: the server reserves them in blocks
  of 1024 in storage.

## Flow control

Only HTTP bodies are flow controlled, because only there can one side be slower than the other for
long. Each stream has a 256 KiB window per direction. A sender may have at most the granted bytes in
flight; the receiver grants them back with `WINDOW` once the next hop has accepted them (the public
response stream pulled the chunk, or the local socket flushed it).

WebSocket messages are forwarded whole (up to 1 MiB, larger ones close the socket with `1009`) and
without windows.

Memory on the server is bounded by `256 streams × 256 KiB`.

## Requests as the local server sees them

The server drops `cf-*`, `cdn-loop` and hop-by-hop headers. The client
then makes the request look local: `Host` becomes the local host, and `Origin`/`Referer` pointing at
the public URL are rewritten to the local origin, so dev servers that validate them (Vite, Next.js)
accept the request. `Location` headers pointing at the local server are rewritten to the public URL.

Response bodies are passed through byte for byte, including compressed ones. `Set-Cookie` loses its
`Domain` attribute, so a tunnel can only set cookies for its own host.
