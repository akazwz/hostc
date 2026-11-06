---
title: How to share localhost with someone
description: Four ways to let someone else open the site running on your computer, from a local network address to a tunnel, and which to pick.
date: 2026-11-06
---

Your site works on `localhost:3000`. You want a teammate, a client or your phone to see it. `localhost` always means "this machine", so sending that link shows them nothing. You have four real options.

## 1. Your local IP address

If the other device is on the same network, use your computer's address, such as `http://192.168.1.20:3000`.

- **Good for:** a phone on your desk.
- **Catches:** both devices must share a network, many dev servers only listen on localhost until you tell them otherwise (`vite --host`, `next dev -H 0.0.0.0`), and it isn't HTTPS, so [features like the camera won't work](/blog/https-on-localhost).

## 2. A tunnel

A small program opens an outgoing connection to a public server, which gives you a URL. [Here is how that works](/blog/what-is-a-localhost-tunnel).

```sh
npx hostc@latest 3000
```

- **Good for:** sharing with anyone, anywhere, in seconds. Receiving webhooks.
- **Catches:** the link only works while your computer is on and the tunnel is running, and anyone with it can reach your server.

## 3. Port forwarding on your router

You tell your router to send outside traffic to your computer.

- **Good for:** almost nothing today.
- **Catches:** many home networks sit behind carrier-grade NAT, so it may not work at all. It exposes your machine directly, and you would still need HTTPS.

## 4. Deploy a preview

Push to a host such as Vercel, Netlify or Cloudflare and share the preview URL.

- **Good for:** something people need to look at tomorrow, or next week.
- **Catches:** it takes setup, and every change means another build. Local databases and services aren't there.

## Which to pick

| You want to                        | Use                        |
| ---------------------------------- | -------------------------- |
| Check your site on your own phone  | A tunnel, or your local IP |
| Show a teammate for five minutes   | A tunnel                   |
| Receive webhooks                   | A tunnel                   |
| Share with a client for a few days | A deploy                   |
| Run something real                 | A deploy                   |

Before sharing anything, check what your server exposes. A tunnel makes it public, so keep admin panels, databases and secrets out of it, and stop it when you are done.
