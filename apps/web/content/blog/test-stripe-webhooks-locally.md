---
title: How to test Stripe webhooks on localhost
description: A working Express example for receiving Stripe webhooks on your own machine, why signature checks fail, and how to fix them.
date: 2026-11-06
---

Stripe tells your app what happened by calling a URL. On your laptop there is no public URL, so the events never arrive. Here is the shortest setup that works, with signature checks on.

## 1. Write the endpoint

The one thing to get right is the raw body. Stripe signs the exact bytes it sent, so parse the JSON only after you verify it:

```js
import express from "express";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const app = express();

// This route comes before express.json(), and reads the raw body.
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

## 2. Give it a public URL

```sh
npx hostc@latest 3000
```

hostc prints a URL such as `https://k7m2xq9pa4dn.hostc.app`. No account is needed.

## 3. Add the endpoint in Stripe

In the Stripe Dashboard, add a webhook endpoint with your URL plus the route:

```text
https://k7m2xq9pa4dn.hostc.app/webhooks/stripe
```

Reveal the endpoint's signing secret, which starts with `whsec_`, and start your server with it as `STRIPE_WEBHOOK_SECRET`.

## 4. Trigger an event

Send a test event or make a test payment. Your terminal shows the request as it arrives, with its status and how long it took.

## When the signature check fails

- **The body was parsed first.** If `express.json()` runs before your route, the bytes are gone. Put the webhook route first.
- **The wrong secret.** The Dashboard endpoint and `stripe listen` each have their own `whsec_` secret. Use the one that matches where the event came from.
- **An old secret.** Each endpoint has its own, so a new endpoint means a new secret.

hostc passes the body and the `Stripe-Signature` header through unchanged, so it won't be the cause.

## Stripe CLI or a tunnel?

For quick work, `stripe listen --forward-to localhost:3000/webhooks/stripe` is excellent, and needs no public URL. A tunnel helps when you want to test a real Dashboard endpoint, receive webhooks from other providers on the same URL, or let someone else go through the payment flow on your machine.

Each start of hostc gives a new URL, so update the endpoint in Stripe when you restart it. More on this in [testing webhooks on localhost](/test-webhooks-locally).
