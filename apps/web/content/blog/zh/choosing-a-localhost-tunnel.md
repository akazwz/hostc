---
title: 内网穿透工具怎么选：ngrok、Cloudflare、frp 等对比
description: 内网穿透工具到底有什么区别，该问哪些问题，分享开发服务、Webhook、自建和生产环境分别适合用哪个。
date: 2026-11-06
---

内网穿透工具很多，核心做的是同一件事，区别在于它们要你付出什么、额外给你什么。问四个问题，很快就能缩小范围。

## 1. 谁要打开这个链接？

如果是任何人，而且不用登录，你要的是公开隧道：[hostc](/zh)、[ngrok](/zh/alternatives/ngrok) 或 [Cloudflare Quick Tunnel](/zh/alternatives/cloudflare-tunnel)。

如果只给自己或团队看，就选有访问控制的工具。[微软 dev tunnels](/zh/alternatives/dev-tunnels) 默认私有；[Tailscale](/zh/alternatives/tailscale-funnel) 适合已经在用它的团队。

## 2. 地址需要固定吗？

免费工具通常每次运行都换地址。hostc 在断网重连时地址不变，但重启后会换。如果你注册了一次 Webhook 就不想再改，就选有固定地址的：ngrok 免费版的开发域名、Tailscale Funnel，或者 Cloudflare 的命名隧道。

## 3. 是 HTTP 吗？

这些工具大多是为网站和接口设计的。SSH、数据库、游戏服务器这类走 TCP 或 UDP 的，看 [frp](/zh/alternatives/frp) 或 ngrok 的 TCP 隧道。

## 4. 服务端由谁来运行？

托管工具开箱即用，但你要信任运营方，流量会经过它。如果流量必须留在自己控制的机器上，就自己部署：frp 需要一台有公网 IP 的服务器，[hostc 可以部署到你自己的 Cloudflare 账号](https://github.com/akazwz/hostc#self-hosting)。

## 快速选择

| 你想做的                     | 可以试试                                                  |
| ---------------------------- | --------------------------------------------------------- |
| 现在就分享开发服务，不想注册 | [hostc](/zh)                                              |
| 在面板里查看请求             | [ngrok](/zh/alternatives/ngrok)                           |
| 承载生产流量                 | Cloudflare [命名隧道](/zh/alternatives/cloudflare-tunnel) |
| 暴露 SSH 或游戏服务器        | [frp](/zh/alternatives/frp)                               |
| 留在现有的 tailnet 里        | [Tailscale Funnel](/zh/alternatives/tailscale-funnel)     |
| 链接只在组织内部可用         | [微软 dev tunnels](/zh/alternatives/dev-tunnels)          |

hostc 也是其中之一，所以请看[完整对比](/zh/alternatives)，里面也写了什么时候别的工具更合适。
