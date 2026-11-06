---
title: The pong that arrived too late
description: Widening upload windows made hostc faster, then uploads started failing when a link slowed down. Why a heartbeat can wait behind your own data.
date: 2026-11-06
---

We made uploads faster, and some of them started to fail. The cause is a trap worth knowing about if you multiplex streams over one connection.

## The change

hostc carries every request over one WebSocket, with flow control per stream. Uploads had a fixed window of 256 KiB, so they moved at most one window per round trip. On a long path that is a hard ceiling. So we let the window grow, up to 4 MiB per request, while it was what held the upload back.

Uploads got faster. Then a small share of them failed with "Tunnel offline".

## The failure

The CLI sends a ping every 15 seconds and drops the connection if no pong arrives within 10. We reproduced the failure by slowing the link for 20 seconds in the middle of an upload.

A WebSocket is one ordered stream of bytes. The pong sits behind everything already sent on that connection. With a small window that is never much. With 4 MiB in flight and a link that has just slowed down, the pong can wait longer than 10 seconds.

The connection was fine. It was busy delivering our own data, and the data was what delayed the proof that it worked.

## The fix

The heartbeat was asking the wrong question. It asked "did the pong arrive?" when it wanted to know "is the connection alive?"

Any message that arrives answers that. So the timeout is now cleared by anything arriving on the connection, not only the pong. A dead connection still delivers nothing, so it is still dropped. A busy one is left alone.

With the fix, the same 20-second slowdown completes without a reconnect.

## The takeaway

When you put a heartbeat in the same ordered stream as your data, its delay measures your queue as well as your connection. Widening a window moves that delay, so check what else sits behind it. The fix shipped in [hostc 2.1.2](/changelog).
