---
title: Next.js 报错 Blocked cross-origin request 怎么解决
description: 通过隧道或其他域名打开 Next.js 时，为什么开发资源会被拦截，以及如何用 allowedDevOrigins 解决。
date: 2026-11-06
---

你通过隧道或局域网地址打开 Next.js 开发服务，页面可能能加载，但改代码后不再自动更新，终端里出现类似这样的提示：

```text
Blocked cross-origin request to Next.js dev resource /_next/...
Cross-origin access to Next.js dev resources is blocked by default for safety.
```

## 为什么会这样

开发服务暴露了一些只在开发时存在的资源和接口。Next.js 不希望别的网站通过你的浏览器访问它们，所以默认拦截跨域请求。

它默认放行 `localhost`、它的子域名，以及启动服务时用的主机名。其他名字都要手动列出来。

## 解决方法：allowedDevOrigins

把主机名加到 `next.config.js`：

```js
// next.config.js
module.exports = {
	allowedDevOrigins: ["my-tunnel.example.dev"],
};
```

有三个细节容易出错：

- **只写主机名。** 不要带 `https://` 和端口。Next.js 匹配的是 `Origin` 请求头的主机名，没有 `Origin` 的请求看 `Referer`。
- **`*` 只匹配一段。** `*.example.dev` 能匹配 `team.example.dev`，但不匹配 `example.dev` 和 `team.eu.example.dev`。任意层级要用 `**.example.dev`。
- **改完配置要重启开发服务。**

如果隧道的子域名每次都变，就用通配符：

```js
module.exports = {
	allowedDevOrigins: ["*.example.dev"],
};
```

## 或者让请求看起来就是本地的

这个检查读的是 `Origin` 和 `Referer`。[hostc](/zh/share-vite-nextjs-dev-server) 会把它们连同 `Host` 一起改写成本地地址，在 Next.js 看来请求就来自 localhost，什么都不用配：

```sh
npx hostc@latest 3000
```

WebSocket 也是直接透传的，所以页面改完保存后照样自动更新。

要注意一点：你的应用看到的 host 是 `localhost`，所以它根据请求拼出来的地址（比如 OAuth 回调）会指向 localhost。分享期间请用环境变量来设置这些地址。
