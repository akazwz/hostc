---
title: Using Durable Object hibernation to keep WebSockets cheap
description: Each hostc tunnel is one Cloudflare Durable Object holding one WebSocket. It sleeps while nothing happens, which is why the service can be free.
date: 2026-11-06
---

A tunnel is idle most of the time. Durable Objects can hibernate while idle, and that is what lets hostc be free.

## One object per tunnel

Each tunnel is a Cloudflare [Durable Object](https://developers.cloudflare.com/durable-objects/). When you run hostc, the CLI opens one outgoing WebSocket to that object. Every public request or WebSocket becomes a stream on that connection.

```text
browser ──▶ Worker ──▶ Durable Object (one per tunnel) ◀── WebSocket ── hostc ──▶ localhost
```

## Hibernating with the connection open

Durable Objects can hibernate while WebSockets stay connected. The object leaves memory, and Cloudflare keeps the socket open. The next message wakes it.

For that to work, nothing should wake it unnecessarily:

- We don't use long-lived timers, which would keep the object awake or wake it for nothing.
- The CLI pings every 15 seconds, and the runtime answers by itself without waking the object.
- State a connection needs after waking is stored in its attachment, not in memory.

## Problems we ran into

The runtime's auto-response applies to every WebSocket on the object, visitors' included. If the heartbeat were the word `ping`, an app's own `ping` message would be answered by Cloudflare and never reach the local server. So the heartbeat is `hostc:ping`, a string no app sends by accident.

A stream id must never repeat within a tunnel, or a late frame could land on the wrong stream. A counter in memory disappears when the object hibernates, and writing to storage for each request costs money. So the server reserves ids in blocks of 1024 and writes only when a block runs out.

Alarms are billed too, and each one wakes the object, so a connected tunnel sets at most one every 10 minutes. That is also how long a tunnel has to reconnect before it expires.

A hibernatable socket is left in `CLOSING` when `webSocketClose` runs, so the handler has to call `ws.close()` itself to finish the handshake.

## What hostc leaves out

There is no dashboard, request history or access control, because each of those needs state or work while a tunnel is idle. If you need those, see the [other tools](/alternatives).

The server is open source, and you can [run your own](https://github.com/akazwz/hostc#self-hosting).
