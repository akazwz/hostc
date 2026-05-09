# @hostc/server

Cloudflare Worker and Durable Object tunnel server for hostc.

This package owns:

- host routing for app hosts and wildcard tunnel hosts
- tunnel create/refresh APIs
- signed connect and refresh tokens
- one JSON control WebSocket plus N binary data channel WebSockets per connection
- Durable Object connection, stream, credit, and public proxy state

It intentionally does not include web/static assets, waitlist APIs, CLI error APIs, D1 bindings, Hono, or `nodejs_compat`.

## Commands

```sh
pnpm -F @hostc/server build
pnpm -F @hostc/server test
pnpm -F @hostc/server dev
pnpm -F @hostc/server test:e2e:local
pnpm -F @hostc/server deploy:staging
pnpm -F @hostc/server preflight:staging
pnpm -F @hostc/server test:e2e:staging
pnpm -F @hostc/server load:staging
```

Load defaults to a temporary staging tunnel and writes
`artifacts/load/staging-YYYYMMDDTHHMM.json`. It can be made reproducible with:

```sh
HOSTC_LOAD_TUNNELS=2 \
HOSTC_LOAD_CONCURRENCY=10 \
HOSTC_LOAD_REQUESTS=100 \
HOSTC_LOAD_SCENARIOS=http-get,large-download,large-upload,websocket-long,websocket-burst,idle-websocket,reconnect-storm \
pnpm -F @hostc/server load:staging
```

## Staging

Staging uses `envoq.dev` and `*.envoq.dev`.

```sh
pnpm -F @hostc/server deploy:staging
pnpm -F @hostc/server exec wrangler secret put TOKEN_SECRET --env staging
pnpm -F @hostc/server preflight:staging
pnpm -F @hostc/server test:e2e:staging
pnpm -F @hostc/server load:staging
```

Successful staging E2E writes `artifacts/e2e/staging-YYYYMMDDTHHMM.json`.
Successful staging load writes `artifacts/load/staging-YYYYMMDDTHHMM.json`.
Both artifacts must point at `https://envoq.dev` / `https://*.envoq.dev` for
the final refactor audit to pass.

`preflight:staging` is read-only: it runs `wrangler secret list --env staging`
and checks `https://envoq.dev/health`; it does not deploy or write secrets.

`TOKEN_SECRET` must be at least 32 random bytes and must differ between staging and production.
