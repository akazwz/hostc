---
title: Why a Vite page with 2,000 modules failed through our tunnel
description: Dev servers serve every file separately, so one page can open thousands of requests. Why a stream limit stopped pages from loading, and how a queue fixed it.
date: 2026-11-06
---

A production site bundles its JavaScript into a few files. A dev server doesn't. Vite serves each module on its own, so a large app can make a couple of thousand requests to load one page. Through a tunnel, every one of those is a stream on a single connection.

## How it broke

hostc allows 256 streams at once per tunnel, which bounds memory on the server. Browsers send up to about 256 requests at once over one HTTP/2 connection, so a page with many modules fills the limit.

The dev server also keeps a WebSocket open for hot reload, which holds a stream while the page is open. That makes one too many.

We reproduced it with a page importing 2,000 modules and one WebSocket. Five requests got `503 Tunnel busy`. When a module fails to load, the code importing it fails too, so the page didn't load.

## Why not raise the limit?

Two pages at once would hit a higher limit too. And each stream can hold a window of data in memory, which is what the limit controls.

## Queueing

These bursts finish quickly, so new requests now queue: when all 256 streams are in use, a request waits for a free one. The queue has limits too:

- At most 1024 requests wait. Beyond that the tunnel returns `503`.
- A request waits no longer than its existing 2-minute limit.
- If the visitor closes the tab, the request leaves the queue.
- If the CLI disconnects, waiting requests get `502` right away. A request also checks the connection when it wakes.

## The result

The same page, with 2,000 modules and one WebSocket, returned 200 for every request and loaded.
