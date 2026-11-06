---
title: 为什么网站在 localhost 正常，到手机上就坏了
description: 摄像头、Service Worker 等浏览器功能要求安全上下文。localhost 有例外，局域网地址没有。本文讲原因和解决办法。
date: 2026-11-06
---

在电脑上一切正常。你用手机打开 `http://192.168.1.20:3000`，摄像头按钮没反应，Service Worker 注册不上，复制到剪贴板也失败。代码没问题，问题出在地址上。

## 安全上下文

浏览器只把强大的功能开放给[安全上下文](https://developer.mozilla.org/zh-CN/docs/Web/Security/Secure_Contexts)中的页面。实际上就是 HTTPS，只有一个例外：`http://localhost` 也算，所以本地开发时感觉一切顺利。

`192.168.1.20` 这样的局域网地址没有这个例外，它就是在网络上走明文 HTTP。

## 哪些功能会失效

在局域网的明文 HTTP 下，这些功能不可用或受限：

- `navigator.mediaDevices`（摄像头和麦克风）
- Service Worker，以及依赖它的离线和推送
- `navigator.clipboard`
- 大多数浏览器里的定位
- 标记了 `Secure` 的 Cookie

失败往往悄无声息。`navigator.mediaDevices` 直接是 `undefined`，表现为一个让人摸不着头脑的 `TypeError`。可以在控制台检查：

```js
console.log(window.isSecureContext);
```

## 怎么解决

**用隧道。** 你会得到一个任何手机都信任的真 HTTPS 地址，不限网络，也不用管证书：

```sh
npx hostc@latest 3000 --qr
```

扫码就能打开。详见[在手机上调试 localhost](/zh/test-localhost-on-phone)。

**用本地证书。** [mkcert](https://github.com/FiloSottile/mkcert) 这样的工具能生成电脑信任的证书。适合在一台机器上工作，但每部手机也要信任它的根证书，在 iOS 和 Android 上都比较麻烦。

**用框架自带的选项。** Vite 有 `server.https` 和基础 SSL 插件，Next.js 有 `next dev --experimental-https`。自签名证书在其他设备上会有浏览器警告，有些功能可能还是用不了。

如果只是想在真机上试一下，隧道最快。如果每天都要在本地用 HTTPS，配一次本地证书也值得。
