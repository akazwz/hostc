---
title: 在 workerd 里测试 Durable Object，还不写出不稳定的测试
description: hostc 如何在真实运行时里测试 Cloudflare Durable Object，为什么依赖时间的测试会失败，以及依赖时钟的逻辑该怎么处理。
date: 2026-11-06
---

hostc 的隧道服务是一个带 WebSocket、休眠和流控的 Durable Object。Mock 证明不了什么，因为最难的行为都取决于运行时怎么处理这些东西。所以测试通过 `@cloudflare/vitest-plugin` 跑在真实的 Workers 运行时 workerd 里。

这样能得到真实的行为，也包括一个人人都会中招的地方：时钟。

## 真实运行时带来了什么

测试可以像客户端一样访问 Worker，需要时也能深入对象内部：

```ts
import { env, evictDurableObject, runInDurableObject, SELF } from "cloudflare:test";

const response = await SELF.fetch("https://k7m2xq9pa4dn.tunnel.test/");

const waiting = await runInDurableObject(
	env.TUNNEL.getByName(id),
	(instance) => Reflect.get(instance, "waiting").length,
);
```

最有价值的是 `evictDurableObject`，它能模拟休眠，这本来几乎没法测。下面这段检查流 ID 跨休眠也不重复：

```ts
const first = await request();
await evictDurableObject(env.TUNNEL.getByName(tunnel.id), { webSockets: "hibernate" });
expect(await request()).toBeGreaterThan(first);
```

`runDurableObjectAlarm` 对 Alarm 也是一样，测隧道过期不用真等 10 分钟。

## 时钟不走

在 Workers 里，`Date.now()` 在代码运行时是[锁定的](https://developers.cloudflare.com/workers/reference/security-model/)，只有发生 I/O 才会前进。这是防御时序攻击的手段，测试里也一样。

所以任何计算耗时的逻辑看到的都是跳变的时间。我们有个测试验证“链路成为瓶颈后窗口不再变宽”，用 20 ms 的定时器模拟慢链路，之前一直通过。然后在一台很忙的机器上，它开始偶尔失败：

```text
AssertionError: expected 1048576 to be less than or equal to 524288
```

代码没错。只是机器负载高时，定时器和时钟对不上测试假设的情节了。

## 把依赖时间的逻辑移出去，注入时钟

解决办法不是把超时调长。依赖时间的逻辑应该是普通代码，把时间作为参数传进来：

```ts
delivered(bytes: number, caughtUp: boolean, now = Date.now()): number {
```

生产环境用默认值。测试传入自己的时钟，精确描述发生了什么：

```ts
// 一条每 80 ms 传 256 KiB 的链路：窗口翻倍，耗时也翻倍。
run(window, 20, (size) => (size / STREAM_WINDOW_BYTES) * 80);
expect(window.size).toBeLessThanOrEqual(2 * STREAM_WINDOW_BYTES);
```

这段在普通 Node 里一毫秒跑完，也不可能时好时坏。有了它，我们就把那个依赖时间的测试删了，不再伺候它。

## 最后形成的规则

- **运行时行为用运行时测。** 休眠、WebSocket 握手和 Alarm 都在 workerd 里测。
- **决策逻辑用普通测试。** 有数字和阈值的东西放进独立的包，注入时钟。
- **等条件，不等时长。** 我们的假客户端 `waitUntil` 每收到一帧就检查一次，条件满足立刻继续，超时只用来防止测试挂死。
- **不要假设顺序。** 并发请求到达对象的顺序是任意的。有个测试因此时好时坏，直到改成按路径匹配请求。
- **看着新测试失败一次。** 我们给窗口 bug 写的第一个测试，在有 bug 的代码上也能通过，等于什么都没证明。先失败过的版本才值得留下。

不稳定的测试比没有测试更糟，因为它教会所有人点重试。我们这个还会卡住发版，因为发布时跑的是同一套检查。
