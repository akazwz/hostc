---
title: hostc 为什么能免费：会休眠的隧道
description: 每条 hostc 隧道是一个 Cloudflare Durable Object，只持有一条 WebSocket。没事时它会休眠，这就是服务能免费的原因。
date: 2026-11-06
---

隧道大部分时间什么都不做。你启动它，打开页面，看一会儿代码，一小时过去也只走了几百个请求。hostc 就是围绕这一点设计的，这也是它能免费的原因。

## 每条隧道一个对象

每条隧道是一个 Cloudflare [Durable Object](https://developers.cloudflare.com/durable-objects/)。运行 hostc 时，CLI 向这个对象建立一条向外的 WebSocket，每个公网请求或 WebSocket 都是这条连接上的一个 stream。

```text
浏览器 ──▶ Worker ──▶ Durable Object（每个隧道一个）◀── WebSocket ── hostc ──▶ localhost
```

## 连接开着也能休眠

Durable Object 可以在 WebSocket 保持连接时休眠：对象离开内存，Cloudflare 继续维持连接，下一条消息到来时再唤醒它。

前提是没有东西无缘无故地唤醒它，这决定了几个设计：

- **没有长期定时器。** 比请求活得更久的定时器会让对象一直醒着，或者白白唤醒。
- **心跳不唤醒对象。** CLI 每 15 秒发一次 ping，由运行时直接回复，不会唤醒对象。
- **需要保留的状态放在连接上。** 唤醒后要用的东西都存在连接的附件里，不放在内存里。

## 代价是什么

没有控制台、请求历史和访问控制，因为这些都需要在隧道空闲时保存状态或做事。hostc 只做一件事：临时分享开发服务。如果你需要更多功能，[别的工具做得很好](/zh/alternatives)。

服务端是开源的，你也可以[自己部署](https://github.com/akazwz/hostc#self-hosting)。
