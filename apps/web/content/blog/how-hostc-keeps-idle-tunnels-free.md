---
title: How hostc stays free: tunnels that sleep
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

## What that costs in features

There is no dashboard, request history or access control, because each of those needs state or work while a tunnel is idle. hostc does one job: sharing a dev server for a while. If you need more, [other tools do it well](/alternatives).

The server is open source, and you can [run your own](https://github.com/akazwz/hostc#self-hosting).
