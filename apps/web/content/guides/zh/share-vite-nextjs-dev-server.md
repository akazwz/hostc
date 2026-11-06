---
title: 分享 Vite 或 Next.js 开发服务
lead: 给别人发一个链接，打开就是你正在跑的开发服务，不用改配置。你一保存，对方的页面也会自动更新。
description: 通过公网地址分享 Vite、Next.js 开发服务，支持热更新，不用改 allowedHosts 或 allowedDevOrigins。
---
## 怎么做

```sh
npx hostc@latest 5173
```

换成你的开发服务端口：Vite 默认 5173，Next.js 默认 3000。然后把打印出来的地址发给对方。

## 为什么不用配置

开发服务会拒绝来自陌生域名的请求。Vite 有 `server.allowedHosts`，Next.js 有 `allowedDevOrigins`，很多隧道都要你把它们的域名加进去。

hostc 会改写进来的 `Host`、`Origin` 和 `Referer` 请求头，在开发服务看来，每个请求都来自本地。指向 localhost 的跳转会改写回公网地址。WebSocket 直接透传，页面自动更新（热更新）靠的就是它。

## 需要知道的

- 你的应用看到的 host 是 localhost。它根据请求拼出来的链接（比如 OAuth 回调地址）会指向 localhost。
- 拿到地址的人都能访问你的服务，用完按 Ctrl+C 停掉。
