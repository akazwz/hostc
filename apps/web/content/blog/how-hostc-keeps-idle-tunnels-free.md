---
title: Using Durable Object hibernation to keep WebSockets cheap
description: Each hostc tunnel is one Cloudflare Durable Object holding one WebSocket. It sleeps while nothing happens, which is why the service can be free.
date: 2026-11-06
---

A tunnel spends most of its life doing nothing. You start it, open a page, read some code, and an hour later it has carried a few hundred requests. hostc is built around that fact, and it is why the service can be free.

## One object per tunnel

Each tunnel is a Cloudflare [Durable Object](https://developers.cloudflare.com/durable-objects/). When you run hostc, the CLI opens one outgoing WebSocket to that object. Every public request or WebSocket becomes a stream on that connection.

```text
browser ──▶ Worker ──▶ Durable Object (one per tunnel) ◀── WebSocket ── hostc ──▶ localhost
```

## Sleeping with a connection open

Durable Objects can hibernate while WebSockets stay connected. The object leaves memory, and Cloudflare keeps the socket open. The next message wakes it.

That only works if nothing wakes it for no reason, which shapes the design:

- **No long-lived timers.** A timer that outlives its request would keep the object awake, or wake it for nothing.
- **Heartbeats don't wake anything.** The CLI pings every 15 seconds, and the runtime answers by itself without waking the object.
- **State that must survive lives on the socket.** Anything a connection needs after waking is stored in its attachment, not in memory.

## Details that caused problems

**A plain `ping` would never reach apps.** The runtime's auto-response applies to every WebSocket on the object, visitors' included. If the heartbeat were the word `ping`, an app's own `ping` message would be answered by Cloudflare and never reach the local server. So the heartbeat is `hostc:ping`, a string no app sends by accident.

**Stream ids must survive sleep.** An id must never repeat within a tunnel, or a late frame could land on the wrong stream. A counter in memory disappears when the object hibernates, and writing to storage for each request costs money. So the server reserves ids in blocks of 1024 and writes only when a block runs out.

**Alarms are billed too.** Each alarm wakes the object, so a connected tunnel sets at most one every 10 minutes. That is the same window a tunnel gets to reconnect before it expires, so one timer does both jobs.

**Closing takes a step.** A hibernatable socket is left in `CLOSING` when `webSocketClose` runs, so the handler has to call `ws.close()` itself to finish the handshake.

## What hostc leaves out

There is no dashboard, request history or access control, because each of those needs state or work while a tunnel is idle. hostc does one job: sharing a dev server for a while. If you need more, [other tools do it well](/alternatives).

The server is open source, and you can [run your own](https://github.com/akazwz/hostc#self-hosting).
