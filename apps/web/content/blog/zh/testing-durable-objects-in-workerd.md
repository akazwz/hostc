---
title: 用 Vitest 和 workerd 测试 Durable Object
description: hostc 如何在真实运行时里测试 Cloudflare Durable Object，为什么依赖时间的测试会失败，以及依赖时钟的逻辑该怎么处理。
date: 2026-11-06
---

hostc 的隧道服务是一个带 WebSocket、休眠和流控的 Durable Object。这些行为都取决于运行时，用 Mock 测不出来，所以测试通过 `@cloudflare/vitest-plugin` 跑在真实的 Workers 运行时 workerd 里。

不过 workerd 里的时钟和 Node 不一样，这给我们带来过麻烦。

## 真实运行时带来了什么

测试可以像客户端一样访问 Worker，需要时也能读取对象内部的状态：

```ts
import { env, evictDurableObject, runInDurableObject, SELF } from "cloudflare:test";

const response = await SELF.fetch("https://k7m2xq9pa4dn.tunnel.test/");

const waiting = await runInDurableObject(
	env.TUNNEL.getByName(id),
	(instance) => Reflect.get(instance, "waiting").length,
);
```

最有用的是 `evictDurableObject`，它能模拟休眠。下面这段检查流 ID 跨休眠也不重复：

```ts
const first = await request();
await evictDurableObject(env.TUNNEL.getByName(tunnel.id), { webSockets: "hibernate" });
expect(await request()).toBeGreaterThan(first);
```

`runDurableObjectAlarm` 对 Alarm 也是一样，测隧道过期不用真等 10 分钟。

## 时钟只在 I/O 时前进

在 Workers 里，`Date.now()` 在代码运行时是[锁定的](https://developers.cloudflare.com/workers/reference/security-model/)，只有发生 I/O 才会前进。这是防御时序攻击的手段，测试里也一样。

所以计算耗时的逻辑看到的时间是跳变的。我们有个测试验证“链路成为瓶颈后窗口不再变宽”，用 20 ms 的定时器模拟慢链路，之前一直通过。然后在一台很忙的机器上，它开始偶尔失败：

```text
AssertionError: expected 1048576 to be less than or equal to 524288
```

代码是对的，只是机器负载高时，定时器和时钟对不上测试的假设。

## 把依赖时间的逻辑移出去，注入时钟

把超时调长解决不了问题。我们把依赖时间的逻辑写成普通代码，时间作为参数传进来：

```ts
delivered(bytes: number, caughtUp: boolean, now = Date.now()): number {
```

生产环境用默认值，测试传入自己的时钟：

```ts
// 一条每 80 ms 传 256 KiB 的链路：窗口翻倍，耗时也翻倍。
run(window, 20, (size) => (size / STREAM_WINDOW_BYTES) * 80);
expect(window.size).toBeLessThanOrEqual(2 * STREAM_WINDOW_BYTES);
```

这段在普通 Node 里很快跑完，结果也是确定的。有了它，我们就把那个依赖时间的测试删了。

## 我们现在的做法

- 休眠、WebSocket 握手和 Alarm 在 workerd 里测。
- 有数字和阈值的逻辑放进独立的包，注入时钟来测。
- 等条件，不用固定延时。假客户端的 `waitUntil` 每收到一帧检查一次，超时只用来防止测试卡死。
- 不假设并发请求的顺序。有个测试因此不稳定，后来改成按路径匹配请求。
- 新测试要先失败一次。我们给窗口 bug 写的第一个测试，在有 bug 的代码上也能通过，后来重写了。

那个不稳定的测试还会卡住发版，因为发布时跑的是同一套检查。
