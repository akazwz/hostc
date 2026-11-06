---
title: 在本地调试 Webhook
lead: Stripe、GitHub、Slack 只能调用公网地址。hostc 给你电脑上的服务一个公网地址，让 Webhook 直接打到你正在改的代码上。
description: 一条命令，在本地服务上接收 Stripe、GitHub、Slack 的 Webhook。免费，不用注册。
---
## 怎么做

1. 启动你的服务，再让 hostc 指向它的端口：

   ```sh
   npx hostc@latest 3000
   ```

2. 把打印出来的地址加上你的路由，填到服务商的后台，例如 `https://k7m2xq9pa4dn.hostc.app/webhooks/stripe`。
3. 触发一个事件。每个请求都会出现在终端里，带状态码和耗时。

## 需要知道的

- 签名校验可以正常工作：请求体和 Stripe-Signature 这类请求头会原样到达你的服务。
- 每次启动 hostc 都会换新地址，重启后要去服务商后台更新。断网时地址最多保留 10 分钟。
- hostc 最多等你的服务 2 分钟，但服务商通常更早放弃并重试。
- 拿到地址的人都能调用它，所以要像生产环境一样校验签名。
