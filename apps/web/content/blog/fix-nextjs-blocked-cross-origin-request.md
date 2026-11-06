---
title: 'Fix Next.js "Blocked cross-origin request to Next.js dev resource"'
description: Why Next.js blocks dev resources when you open it through a tunnel or another hostname, and how to fix it with allowedDevOrigins.
date: 2026-11-06
---

You open your Next.js dev server through a tunnel or a LAN address. The page may load, but updates stop working, and the terminal shows something like:

```text
Blocked cross-origin request to Next.js dev resource /_next/...
Cross-origin access to Next.js dev resources is blocked by default for safety.
```

## Why it happens

The dev server exposes assets and endpoints that only exist during development. Next.js doesn't want other websites to reach them from your browser, so it blocks cross-origin requests to them by default.

It allows `localhost`, its subdomains, and the hostname the server started with. Anything else needs to be listed.

## The fix: allowedDevOrigins

Add the hostname to `next.config.js`:

```js
// next.config.js
module.exports = {
	allowedDevOrigins: ["my-tunnel.example.dev"],
};
```

Three details trip people up:

- **Write the hostname only.** No `https://` and no port. Next.js matches the hostname of the `Origin` header, or of `Referer` for requests that send no `Origin`.
- **A `*` matches exactly one label.** `*.example.dev` matches `team.example.dev`, but not `example.dev` and not `team.eu.example.dev`. Use `**.example.dev` for any depth.
- **Restart the dev server** after changing the config.

For a tunnel whose subdomain changes on every run, use a wildcard:

```js
module.exports = {
	allowedDevOrigins: ["*.example.dev"],
};
```

## Or send requests that already look local

The check reads `Origin` and `Referer`. [hostc](/share-vite-nextjs-dev-server) rewrites both, plus `Host`, to your local address, so to Next.js the request comes from localhost and there is nothing to configure:

```sh
npx hostc@latest 3000
```

WebSockets pass straight through as well, so the page keeps updating as you save.

One thing to watch: your app sees `localhost` as its host, so URLs it builds from the request, like an OAuth callback, point at localhost. Set those from an environment variable while you share.
