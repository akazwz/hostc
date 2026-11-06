---
title: Test webhooks on localhost
lead: Stripe, GitHub and Slack can only call a public URL. hostc gives the server on your machine one, so webhooks reach the code you are editing.
description: Receive Stripe, GitHub and Slack webhooks on your local server with one command. Free, with no account.
---
## How to do it

1. Start your server, then point hostc at its port:

   ```sh
   npx hostc@latest 3000
   ```

2. Add the printed URL plus your route to the provider, for example `https://k7m2xq9pa4dn.hostc.app/webhooks/stripe`.
3. Trigger an event. Each request shows up in your terminal with its status and duration.

## Good to know

- Signature checks work: the body and headers such as Stripe-Signature reach your server as they were sent.
- Every start of hostc gives a new URL, so update the provider when you restart it. After a network drop, the URL stays for up to 10 minutes.
- hostc waits up to 2 minutes for your server, but providers often give up sooner and retry.
- Anyone with the URL can call it, so verify signatures as you would in production.
