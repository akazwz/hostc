---
title: Testing Durable Objects with Vitest and workerd
description: How hostc tests a Cloudflare Durable Object in the real runtime, why timing tests fail there, and what to do with logic that depends on the clock.
date: 2026-11-06
---

hostc's tunnel server is one Durable Object with WebSockets, hibernation and flow control. A mock wouldn't prove much, because most of the hard behavior lives in how the runtime treats those things. So the tests run in workerd, the real Workers runtime, through `@cloudflare/vitest-plugin`.

The behavior is real, including one that surprised us: the clock.

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

The most valuable helper is `evictDurableObject`. It simulates hibernation, which is otherwise close to impossible to test. Here is how we check that stream ids never repeat across sleep:

```ts
const first = await request();
await evictDurableObject(env.TUNNEL.getByName(tunnel.id), { webSockets: "hibernate" });
expect(await request()).toBeGreaterThan(first);
```

`runDurableObjectAlarm` does the same for alarms, so a test of tunnel expiry doesn't wait 10 minutes.

## The clock only moves on I/O

In Workers, `Date.now()` is [locked while code runs](https://developers.cloudflare.com/workers/reference/security-model/) and only moves on I/O. It is a defense against timing attacks, and it applies in your tests as well.

So anything that measures elapsed time sees coarse jumps. Our test for "stop widening a window once the link is the limit" simulated a slow link with 20 ms timers, and it passed for weeks. Then, on a busy machine, it started to fail now and then:

```text
AssertionError: expected 1048576 to be less than or equal to 524288
```

The code was right. On a loaded machine, the timers and the clock didn't line up with the story the test was telling.

## Move time-based logic out, and inject the clock

The fix isn't a longer timeout. Logic that depends on time should be plain code that takes the time as an argument:

```ts
delivered(bytes: number, caughtUp: boolean, now = Date.now()): number {
```

Production uses the default. A test passes its own clock and describes exactly what happened:

```ts
// A link that carries 256 KiB per 80 ms: a doubled window takes twice as long.
run(window, 20, (size) => (size / STREAM_WINDOW_BYTES) * 80);
expect(window.size).toBeLessThanOrEqual(2 * STREAM_WINDOW_BYTES);
```

This runs in plain Node in a millisecond, and it can't flake. With that in place, we deleted the timing test.

## Rules we ended up with

- **Use the runtime for runtime behavior.** Hibernation, WebSocket handshakes and alarms get tested in workerd.
- **Use plain tests for decisions.** Anything with numbers and thresholds goes in a package with an injected clock.
- **Wait for conditions, not durations.** Our fake client's `waitUntil` wakes on every frame, so a test proceeds as soon as the condition holds. The timeout only stops a hung test.
- **Don't assume order.** Concurrent requests reach the object in any order. A test that assumed otherwise flaked until it matched each request by its path.
- **Watch a new test fail.** We wrote a test for a window bug that passed on the broken code too, so it proved nothing. The version that failed first was the one worth keeping.

The flaky test would also have blocked releases, since publishing runs the same checks.
