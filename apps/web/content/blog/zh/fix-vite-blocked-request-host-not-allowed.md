---
title: Vite 报错 Blocked request. This host is not allowed 怎么解决
description: Vite 为什么拦截隧道、Docker 和自定义域名的请求，如何用 server.allowedHosts 解决，以及怎样完全避开这个报错。
date: 2026-11-06
---

你通过隧道、自定义域名或容器打开 Vite 开发服务，看到的不是应用，而是这段报错：

```text
Blocked request. This host ("abc123.example.dev") is not allowed.
To allow this host, add "abc123.example.dev" to `server.allowedHosts` in vite.config.js.
```

这个报错本身是在保护你。下面讲它为什么存在，以及怎么安全地解决。

## Vite 为什么要拦截

开发服务没有登录，谁来要源码它都给。如果不做检查，恶意网站可以用 [DNS 重绑定](https://zh.wikipedia.org/wiki/DNS%E9%87%8D%E6%96%B0%E7%BB%91%E5%AE%9A%E6%94%BB%E5%87%BB)攻击，把自己的域名指向你的电脑，再通过你的浏览器读取这些代码。

所以 Vite 只响应它信任的域名。默认包括 `localhost`、`.localhost` 下的域名和所有 IP 地址。`Host` 请求头里出现其他名字，就会得到这个报错。

## 方法一：放行这一个域名

把域名加到 `server.allowedHosts`：

```js
// vite.config.js
import { defineConfig } from "vite";

export default defineConfig({
	server: {
		allowedHosts: ["abc123.example.dev"],
	},
});
```

## 方法二：放行一个域名及其子域名

如果子域名每次都变，就在前面加一个点。`.example.dev` 会放行 `example.dev` 和它下面的所有子域名：

```js
export default defineConfig({
	server: {
		allowedHosts: [".example.dev"],
	},
});
```

只添加你信任其 DNS 的域名，绝对不要加 `.com` 这样的顶级域名。

也可以设置环境变量 `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS`，适合不想把域名提交进配置的情况，多个域名用逗号分隔。

## 不建议这样做

网上到处都有人推荐这个写法：

```js
server: {
	allowedHosts: true;
}
```

报错确实没了，但保护也关了。Vite 文档明确警告：这样任何网站都能向你的开发服务发请求，并下载你的源码。请用明确的列表。

## 另一个办法：让 Host 保持 localhost

Vite 检查的是 `Host` 请求头，所以只要隧道发来的是 `Host: localhost`，就不会触发报错。[hostc](/zh/share-vite-nextjs-dev-server) 会在请求到达你的服务之前改写 `Host`、`Origin` 和 `Referer`，配置一行都不用动：

```sh
npx hostc@latest 5173
```

因为配置没改，保护也还在。不过拿到公网地址的人都能访问你的服务，只分享给你想分享的人。
