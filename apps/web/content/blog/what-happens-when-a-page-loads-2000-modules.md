---
title: What happens when a page loads 2,000 modules through a tunnel
description: Dev servers serve every file separately, so one page can open thousands of requests. Why a stream limit broke big apps, and why queueing beat returning 503.
date: 2026-11-06
---

A production site bundles its JavaScript into a few files. A dev server doesn't. Vite serves each module on its own, so a large app can make a couple of thousand requests to load one page. Through a tunnel, every one of those is a stream on a single connection.

## How it broke

hostc allows 256 streams at once per tunnel, which bounds memory on the server. That sounds generous, and it nearly is. Browsers send up to about 256 requests at once over one HTTP/2 connection, so a page full of modules fills the limit exactly.

Then add one more thing: the WebSocket a dev server keeps open for hot reload. It holds a stream for as long as the page is open. Now there are 257 things wanting 256 slots.

We reproduced it with a page importing 2,000 modules and one WebSocket. Five requests got `503 Tunnel busy`. Five failed scripts out of 2,000 is enough: a module that fails to load takes down everything that imports it, and the page stays blank.

## Why not raise the limit?

Raising it moves the failure rather than fixing it. Two pages at once would hit the new limit. And the limit exists for a reason: each stream can hold a window of data in memory, and a Durable Object has to stay within its memory.

## Waiting instead of failing

The right behavior for a burst is a queue. The streams finish quickly, so a request that waits a moment gets served. When all 256 are in use, a new request now waits for a free one.

An unbounded queue is its own bug, so this one has limits on every side:

- **Size.** At most 1024 requests wait. Beyond that the tunnel returns `503`, so a real flood still gets a fast answer.
- **Time.** A request waits no longer than the 2 minutes it has to get a response anyway.
- **The visitor.** If they close the tab, their request leaves the queue instead of taking a stream nobody will read.
- **The connection.** If the CLI disconnects, everyone waiting gets `502` right away. Each waiter also checks the connection when it wakes, because it may have gone during the wait.

## The result

The same page, with 2,000 modules and one WebSocket, returned 200 for every request and loaded.

The lesson generalizes: a hard limit under a bursty workload needs a short, bounded queue in front of it. Rejecting is right for overload. For a burst that will be over in a second, it turns a slow moment into a broken page.
