---
title: 'Fix the Vite "Blocked request. This host is not allowed" error'
description: Why Vite blocks requests from tunnels, Docker and custom domains, how to fix it with server.allowedHosts, and how to avoid the error entirely.
date: 2026-11-06
---

You open your Vite dev server through a tunnel, a custom domain or a container, and instead of your app you see:

```text
Blocked request. This host ("abc123.example.dev") is not allowed.
To allow this host, add "abc123.example.dev" to `server.allowedHosts` in vite.config.js.
```

The error is doing its job. Here is why it exists and how to deal with it safely.

## Why Vite blocks the request

Your dev server has no login, and it will hand your source code to anyone who asks. Without a check, a malicious website could use a [DNS rebinding](https://en.wikipedia.org/wiki/DNS_rebinding) attack to point its own domain at your machine and read that code from your browser.

So Vite only answers requests for hostnames it trusts. By default that means `localhost`, domains under `.localhost`, and IP addresses. Any other name in the `Host` header gets this error.

## Fix 1: allow that one host

Add the hostname to `server.allowedHosts`:

```js
// vite.config.js
import { defineConfig } from "vite";

export default defineConfig({
	server: {
		allowedHosts: ["abc123.example.dev"],
	},
});
```

## Fix 2: allow a domain and its subdomains

If the subdomain changes on every run, start the entry with a dot. `.example.dev` allows `example.dev` and everything under it:

```js
export default defineConfig({
	server: {
		allowedHosts: [".example.dev"],
	},
});
```

Only add domains whose DNS you trust, and never a top-level domain like `.com`.

You can also set the `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` environment variable, which is useful when you don't want a host in the committed config. Separate several hosts with commas.

## What not to do

You will find this suggested everywhere:

```js
server: {
	allowedHosts: true;
}
```

It makes the error go away by turning the protection off. Vite's documentation warns that any website can then send requests to your dev server and download your source code. Use an explicit list.

## The other way: keep the host as localhost

Vite checks the `Host` header, so a tunnel that sends `Host: localhost` never triggers the error. [hostc](/share-vite-nextjs-dev-server) rewrites `Host`, `Origin` and `Referer` before a request reaches your server, so nothing in your config changes:

```sh
npx hostc@latest 5173
```

The protection stays on too, because your config is untouched. Keep in mind that anyone with the public URL can reach your server, so share it only with people you mean to.
