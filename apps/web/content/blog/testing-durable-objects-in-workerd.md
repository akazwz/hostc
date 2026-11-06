---
title: Testing Durable Objects with Vitest and workerd
description: How hostc tests a Cloudflare Durable Object in the real runtime, why timing tests fail there, and what to do with logic that depends on the clock.
date: 2026-11-06
---

hostc's tunnel server is one Durable Object with WebSockets, hibernation and flow control. That behavior depends on the runtime and a mock can't show it, so the tests run in workerd, the real Workers runtime, through `@cloudflare/vitest-plugin`.

The clock works differently there, which caused us some trouble.

## What the real runtime gives you

A test can talk to the Worker as a client would, and reach inside the object when it needs to:

```ts
import { env, evictDurableObject, runInDurableObject, SELF } from "cloudflare:test";

const response = await SELF.fetch("https://k7m2xq9pa4dn.tunnel.test/");

const waiting = await runInDurableObject(
	env.TUNNEL.getByName(id),
	(instance) => Reflect.get(instance, "waiting").length,
);
```

The most useful helper is `evictDurableObject`. It simulates hibernation, which is otherwise close to impossible to test. Here is how we check that stream ids never repeat across sleep:

```ts
const first = await request();
await evictDurableObject(env.TUNNEL.getByName(tunnel.id), { webSockets: "hibernate" });
expect(await request()).toBeGreaterThan(first);
```

`runDurableObjectAlarm` does the same for alarms, so a test of tunnel expiry doesn't wait 10 minutes.

## The clock only moves on I/O

In Workers, `Date.now()` is [locked while code runs](https://developers.cloudflare.com/workers/reference/security-model/) and only moves on I/O. It is a defense against timing attacks, and it applies in your tests as well.

So code that measures elapsed time sees the clock jump. Our test for "stop widening a window once the link is the limit" simulated a slow link with 20 ms timers, and it passed for weeks. Then, on a busy machine, it started to fail now and then:

```text
AssertionError: expected 1048576 to be less than or equal to 524288
```

The code was right. On a loaded machine, the timers and the clock didn't match what the test assumed.

## Move time-based logic out, and inject the clock

A longer timeout wouldn't fix this. We made the logic plain code that takes the time as an argument:

```ts
delivered(bytes: number, caughtUp: boolean, now = Date.now()): number {
```

Production uses the default, and a test passes its own clock:

```ts
// A link that carries 256 KiB per 80 ms: a doubled window takes twice as long.
run(window, 20, (size) => (size / STREAM_WINDOW_BYTES) * 80);
expect(window.size).toBeLessThanOrEqual(2 * STREAM_WINDOW_BYTES);
```

This runs quickly in plain Node and gives the same result every time. With that in place, we deleted the timing test.

## What we do now

- Hibernation, WebSocket handshakes and alarms are tested in workerd.
- Logic with numbers and thresholds goes in a package and is tested with an injected clock.
- Tests wait for conditions rather than fixed delays. Our fake client's `waitUntil` checks on every frame, and the timeout only stops a hung test.
- Tests don't assume the order of concurrent requests. One did and was flaky until it matched requests by path.
- New tests have to fail once first. Our first test for a window bug also passed on the broken code, so we rewrote it.

The flaky test would also have blocked releases, since publishing runs the same checks.
