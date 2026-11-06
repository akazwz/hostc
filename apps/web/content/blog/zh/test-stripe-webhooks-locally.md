---
title: 本地怎么测试 Stripe Webhook
description: 一个可运行的 Express 示例，在自己的电脑上接收 Stripe Webhook，并解释签名校验为什么会失败、怎么解决。
date: 2026-11-06
---

Stripe 通过调用一个 URL 告诉你的应用发生了什么。你的笔记本没有公网地址，事件就到不了。下面是能跑通、并且开着签名校验的最短配置。

## 1. 写接口

唯一要注意的是原始请求体。Stripe 签名的是它发出的原始字节，所以要先校验，再解析 JSON：

```js
import express from "express";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const app = express();

// 这个路由要放在 express.json() 之前，读取原始请求体。
app.post("/webhooks/stripe", express.raw({ type: "application/json" }), (request, response) => {
	let event;
	try {
		event = stripe.webhooks.constructEvent(
			request.body,
			request.headers["stripe-signature"],
			process.env.STRIPE_WEBHOOK_SECRET,
		);
	} catch (error) {
		return response.status(400).send(`Webhook error: ${error.message}`);
	}

	console.log("Received", event.type);
	response.json({ received: true });
});

app.use(express.json());
app.listen(3000);
```

## 2. 拿到公网地址

```sh
npx hostc@latest 3000
```

hostc 会打印一个地址，比如 `https://k7m2xq9pa4dn.hostc.app`，不用注册。

## 3. 在 Stripe 添加接口

在 Stripe 后台添加一个 Webhook 接口，填上地址加路由：

```text
https://k7m2xq9pa4dn.hostc.app/webhooks/stripe
```

查看这个接口的签名密钥（以 `whsec_` 开头），启动服务时设为 `STRIPE_WEBHOOK_SECRET`。

## 4. 触发事件

发一个测试事件，或者做一笔测试支付。终端会实时显示收到的请求、状态码和耗时。

## 签名校验失败怎么办

- **请求体被提前解析了。** 如果 `express.json()` 跑在你的路由之前，原始字节就没了。把 Webhook 路由放到前面。
- **密钥用错了。** 后台接口和 `stripe listen` 各有各的 `whsec_` 密钥，要用和事件来源匹配的那个。
- **密钥过期了。** 每个接口有自己的密钥，新建接口就要换新密钥。

hostc 会原样传递请求体和 `Stripe-Signature` 请求头，所以问题不会出在它身上。

## 用 Stripe CLI 还是隧道？

日常开发时，`stripe listen --forward-to localhost:3000/webhooks/stripe` 很好用，也不需要公网地址。隧道适合这些情况：测试真实的后台接口，在同一个地址上接收其他服务商的 Webhook，或者让别人在你的机器上走一遍支付流程。

每次启动 hostc 都会换新地址，重启后要去 Stripe 更新接口。更多内容见[在本地调试 Webhook](/zh/test-webhooks-locally)。
