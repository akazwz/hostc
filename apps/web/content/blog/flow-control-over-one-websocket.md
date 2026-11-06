---
title: How hostc does flow control over one WebSocket
description: How hostc carries hundreds of streams over one WebSocket, why each needs its own window, and how a window grows without bloating the queue.
date: 2026-11-06
---

hostc carries every request over one WebSocket. Like HTTP/2, it runs many streams over one connection, so it needs flow control.

## The frame format

Each message is a binary frame:

```text
u8 type | u32 streamId | payload
```

There are seven types: `OPEN`, `HEAD`, `DATA`, `TEXT`, `END`, `RESET` and `WINDOW`. WebSocket keeps messages ordered and reliable, so there are no sequence numbers or checksums.

## Why TCP's flow control isn't enough

TCP slows a sender down when the receiver falls behind, but it sees one connection. If one visitor reads a large download slowly and hostc kept sending, its data would fill the buffers, and other streams would queue behind it.

So each stream has its own window. A sender may have 256 KiB in flight on a stream, and the receiver grants those bytes back with `WINDOW` once the next hop has taken them: the visitor's stream pulled the chunk, or the local socket flushed it. A slow reader stops getting grants, so only its own stream stops.

## The window limits speed

A stream moves at most one window per round trip. At 256 KiB over a 200 ms path, that is about 1.3 MB/s, no matter how fast the link is. A fixed window is either too small for fast paths or too large for memory.

## Growing a window, and when to stop

A receiver may grant more than it got back, which widens the window. To decide when that helps, hostc times each full window:

- While the window is the limit, a window takes one round trip whatever its size. Double it, and it still takes one round trip.
- Once the link is the limit, doubling the window doubles the time. Growing further only queues data ahead of other streams.

So after each window, hostc doubles it if the window took no longer than the fastest so far, plus half, and the next hop kept up. It stops at 4 MiB per stream and a 16 MiB budget shared by a tunnel.

## The bug in "kept up"

The first version checked whether anything was queued when the window ended, and that was wrong. Wide windows arrive in clumps, so a window's end often lands inside a clump with chunks still queued, even though the next hop is keeping up. Windows stopped growing, which we found in the logs: `queued=3`, on windows that each took exactly one round trip.

The fix was to check the whole window: did the next hop catch up at any point during it?

The test is a simulation with a 270 ms round trip, data arriving in clumps and an injected clock, so it needs no real network. Under the old rule the window stalled at 512 KiB, and under the new one it reaches 4 MiB.

## WebSocket messages

WebSocket messages have no windows, because Workers expose no `bufferedAmount` to see how much is waiting. The CLI limits them instead: it stops reading a local socket that sends too fast, and closes a stream with `1013` when over 4 MiB queues up. The full design is in the [protocol document](https://github.com/akazwz/hostc/blob/main/docs/protocol.md).
