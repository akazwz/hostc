---
title: 手机上摄像头、Service Worker 用不了？要用 HTTPS
description: 摄像头、Service Worker 等浏览器功能要求安全上下文。localhost 有例外，局域网地址没有。本文讲原因和解决办法。
date: 2026-11-06
---

网站在电脑上正常，用手机打开 `http://192.168.1.20:3000` 后，摄像头按钮没反应，Service Worker 注册不上，复制到剪贴板也失败。这通常是因为页面不是 HTTPS。

## 安全上下文

摄像头这类功能只在[安全上下文](https://developer.mozilla.org/zh-CN/docs/Web/Security/Secure_Contexts)中可用。安全上下文基本就是 HTTPS，例外是 `http://localhost` 也算，所以在电脑上不会遇到这个问题。

`192.168.1.20` 这样的局域网地址不算。

## 哪些功能会失效

在局域网的明文 HTTP 下，这些功能不可用或受限：

- `navigator.mediaDevices`（摄像头和麦克风）
- Service Worker，以及依赖它的离线和推送
- `navigator.clipboard`
- 大多数浏览器里的定位
- 标记了 `Secure` 的 Cookie

这时往往没有明确的报错，比如 `navigator.mediaDevices` 是 `undefined`，代码抛出 `TypeError`。可以在控制台检查：

```js
console.log(window.isSecureContext);
```

## 怎么解决

用隧道最简单。你会得到一个正常的 HTTPS 地址，不限网络，也不用管证书：

```sh
npx hostc@latest 3000 --qr
```

扫码就能打开。详见[在手机上调试 localhost](/zh/test-localhost-on-phone)。

也可以用本地证书。[mkcert](https://github.com/FiloSottile/mkcert) 这样的工具能生成电脑信任的证书。适合在一台机器上工作，但每部手机也要信任它的根证书，在 iOS 和 Android 上都比较麻烦。

框架也有自带的选项：Vite 有 `server.https` 和基础 SSL 插件，Next.js 有 `next dev --experimental-https`。自签名证书在其他设备上会有浏览器警告，有些功能可能还是用不了。

如果只是想在真机上试一下，隧道最快。如果每天都要在本地用 HTTPS，配一次本地证书也值得。
