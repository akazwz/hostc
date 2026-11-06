---
title: 用 Durable Object 休眠降低 WebSocket 成本
description: 每条 hostc 隧道是一个 Cloudflare Durable Object，只持有一条 WebSocket。没事时它会休眠，这就是服务能免费的原因。
date: 2026-11-06
---

隧道大部分时间是空闲的。Durable Object 可以在空闲时休眠，hostc 能免费靠的就是这一点。

## 每条隧道一个对象

每条隧道是一个 Cloudflare [Durable Object](https://developers.cloudflare.com/durable-objects/)。运行 hostc 时，CLI 向这个对象建立一条向外的 WebSocket，每个公网请求或 WebSocket 都是这条连接上的一个 stream。

```text
浏览器 ──▶ Worker ──▶ Durable Object（每个隧道一个）◀── WebSocket ── hostc ──▶ localhost
```

## 休眠时连接不断

Durable Object 可以在 WebSocket 保持连接时休眠：对象离开内存，Cloudflare 继续维持连接，下一条消息到来时再唤醒它。

要让它真正休眠，有几点要注意：

- 不用长期定时器，它们会让对象一直醒着或被白白唤醒。
- CLI 每 15 秒发一次 ping，由运行时直接回复，不会唤醒对象。
- 唤醒后要用的状态存在连接的附件里，不放在内存里。

## 踩过的坑

运行时的自动回复对这个对象上的所有 WebSocket 都生效，包括访客的。如果心跳就是 `ping` 这个词，应用自己发的 `ping` 会被 Cloudflare 直接回复，到不了本地服务。所以心跳是 `hostc:ping`，这个字符串不会被应用无意中发出。

同一条隧道里流 ID 不能重复，否则迟到的帧可能落到别的流上。内存里的计数器在休眠时就没了，而每个请求都写存储又要花钱。所以服务端按每 1024 个一块预留 ID，用完一块才写一次。

Alarm 也要计费，每次都会唤醒对象，所以连接中的隧道最多每 10 分钟设一次。这个时间也是隧道过期前的重连时限。

`webSocketClose` 运行时，可休眠的连接停在 `CLOSING` 状态，处理函数要自己调用 `ws.close()` 才能完成握手。

## hostc 没做什么

没有控制台、请求历史和访问控制，因为这些都需要在隧道空闲时保存状态或做事。如果需要这些功能，可以看看[其他工具](/zh/alternatives)。

服务端是开源的，你也可以[自己部署](https://github.com/akazwz/hostc#self-hosting)。
