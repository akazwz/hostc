---
title: Share a Vite or Next.js dev server
lead: Send someone a link to your running dev server, with no config changes. Hot reload reaches them too.
description: Share a Vite or Next.js dev server through a public URL, with hot reload and no allowedHosts or allowedDevOrigins changes.
---
## How to do it

```sh
npx hostc@latest 5173
```

Use your dev server's port: Vite defaults to 5173, Next.js to 3000. Then send the printed URL.

## Why it needs no configuration

Dev servers refuse requests from names they don't know. Vite has `server.allowedHosts` and Next.js has `allowedDevOrigins`, and many tunnels make you add their domain to one of them.

hostc rewrites the `Host`, `Origin` and `Referer` headers on the way in, so to your dev server each request looks local. Redirects to localhost are rewritten back to the public URL. WebSockets pass straight through, which is what hot reload runs on.

## Good to know

- Your app sees localhost as its host. Links it builds from the request, such as OAuth callback URLs, point at localhost.
- Anyone with the URL reaches your server, so stop hostc with Ctrl+C when you are done.
