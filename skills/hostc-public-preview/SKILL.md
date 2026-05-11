---
name: hostc-public-preview
description: Use hostc when an agent needs to expose a local development server as a temporary public preview URL, share localhost with another device or teammate, test webhooks against a local app, or create a public tunnel for localhost. Trigger on public preview, share local app, expose localhost, tunnel localhost, webhook preview, remote preview, or similar requests.
metadata:
  short-description: Expose localhost as a temporary public URL with hostc
---

# Hostc Public Preview

Use `hostc` when the user or task needs a temporary public URL for a local development server.

## Quick start

If the local app is running on port `3000`:

```bash
npx hostc@latest 3000
```

Use the printed public URL for previews, webhook callbacks, mobile-device testing, or sharing the local app with another person.

## Self-hosted server

If the user has their own hostc server:

```bash
HOSTC_SERVER_URL=https://hostc.example.com npx hostc@latest 3000
```

For persistent config:

```bash
npx hostc@latest config set server-url https://hostc.example.com
npx hostc@latest 3000
```

## Agent workflow

1. Confirm or infer the local port from the dev server output.
2. Prefer `npx hostc@latest <port>` so the CLI stays compatible with the current protocol.
3. Wait for hostc to print the public URL.
4. Give the user the public URL and keep the command running while the preview is needed.
5. If the tunnel fails, first check that the local server is reachable on the requested port.
6. To stop the preview, terminate the running hostc process. In an interactive terminal this is usually Ctrl+C. If the agent started hostc as a background process, stop or kill that process.

## Safety notes

- Do not expose sensitive admin panels, database consoles, credential dashboards, or private internal services unless the user explicitly asks and understands the risk.
- Treat the public URL as temporary. Do not use it as a permanent production endpoint.
- If hostc reports a protocol mismatch, ask the user to run `npx hostc@latest <port>` or upgrade their installed CLI.
- If the local service is unavailable, fix the local server first; hostc cannot proxy a port that is not serving traffic.
