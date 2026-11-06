---
title: "ngrok vs Cloudflare Tunnel vs frp: which tunnel to use"
description: How tunnel tools differ, and which one fits sharing a dev server, webhooks, self-hosting or production.
date: 2026-11-06
---

There are many tunnel tools, and the basics are similar. These four questions cover most of the choice.

## 1. Who needs to open the link?

If it is anyone, with no login, you want a public tunnel: [hostc](/), [ngrok](/alternatives/ngrok) or a [Cloudflare Quick Tunnel](/alternatives/cloudflare-tunnel).

If it should only be you or your team, pick a tool with access control. [Microsoft dev tunnels](/alternatives/dev-tunnels) are private by default. [Tailscale](/alternatives/tailscale-funnel) suits a team that already uses it.

## 2. Do you need the URL to stay the same?

Free tools usually give a new URL for each run. hostc keeps it across network drops, not across restarts. If you've registered a webhook once and want to leave it, take something with a fixed address: ngrok's free dev domain, Tailscale Funnel, or a named Cloudflare Tunnel.

## 3. Is it HTTP?

Most of these tools are built for websites and APIs. For SSH, databases, game servers or anything else on raw TCP or UDP, look at [frp](/alternatives/frp) or ngrok's TCP tunnels.

## 4. Who runs the server?

A hosted tool works right away, and you trust its operator with the traffic passing through. If traffic has to stay on machines you control, run your own. frp needs a server with a public IP, and [hostc can run on your own Cloudflare account](https://github.com/akazwz/hostc#self-hosting).

## Quick picks

| You want to                                   | Try                                                          |
| --------------------------------------------- | ------------------------------------------------------------ |
| Share a dev server right now, with no sign-up | [hostc](/)                                                   |
| Inspect requests in a dashboard               | [ngrok](/alternatives/ngrok)                                 |
| Serve production traffic                      | A named [Cloudflare Tunnel](/alternatives/cloudflare-tunnel) |
| Expose SSH or a game server                   | [frp](/alternatives/frp)                                     |
| Stay inside your existing tailnet             | [Tailscale Funnel](/alternatives/tailscale-funnel)           |
| Keep links private to your organization       | [Microsoft dev tunnels](/alternatives/dev-tunnels)           |

We make hostc, so take this with that in mind. See the [detailed comparisons](/alternatives) for each tool.
