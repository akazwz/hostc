---
title: What is a localhost tunnel, and when do you need one?
description: A localhost tunnel gives a server on your machine a public URL. How tunnels work, what they are good for, and what to watch out for.
date: 2026-11-06
---

Your dev server listens on `localhost`, so only your computer can reach it. A tunnel gives it a public URL, so a phone, a teammate or a service like Stripe can reach it too, without you deploying anything.

## How a tunnel works

Your computer usually can't accept connections from the internet: it sits behind a router or a firewall. So a tunnel works the other way round.

1. A small program on your machine opens an **outgoing** connection to a public server.
2. That server gives you a URL.
3. When someone opens the URL, the server sends the request down the connection that is already open.
4. The program passes it to `localhost` and sends the response back.

Nothing on your machine has to be reachable from the internet, and you don't change your router or firewall.

## When you need one

- **Webhooks.** Stripe, GitHub and Slack can only call a public URL. See [how to test webhooks on localhost](/test-webhooks-locally).
- **Testing on a real phone,** over HTTPS and on any network. See [how to test localhost on a phone](/test-localhost-on-phone).
- **Showing work in progress** to a teammate or a client before it is deployed.
- **OAuth callbacks** and other flows where another service has to reach you.

## What to watch out for

**The URL is public.** Unless the tunnel has access control, anyone who has the link reaches your server. Don't expose databases, admin panels or anything holding secrets, and stop the tunnel when you are done.

**A dev server is not a production server.** Tunnels are for sharing work for a while. Use a real deployment for anything people depend on.

**Dev servers can refuse tunnels.** Vite and Next.js block requests from hostnames they don't know. Some tunnels make you add their domain to the config. [hostc rewrites the headers instead](/share-vite-nextjs-dev-server).

## Try one

```sh
npx hostc@latest 3000
```

hostc is free and open source, with no account. If you are choosing between tools, [compare the alternatives](/alternatives).
