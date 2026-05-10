# @hostc/server

Cloudflare Worker and Durable Object tunnel server for hostc.

This package owns:

- host routing for app hosts and wildcard tunnel hosts
- ephemeral tunnel create API
- signed connect tokens
- active client connection and data channel WebSocket lifecycle
- Durable Object stream, credit, timeout, and public proxy state

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
```

## Staging

Staging uses the `staging` Wrangler environment and its own `TOKEN_SECRET` secret.

```sh
pnpm staging:deploy
pnpm staging:secret
pnpm staging:preflight
pnpm staging:test
```

`preflight:staging` is read-only: it checks Wrangler secrets and `/health`; it does not deploy or write secrets.

`TOKEN_SECRET` must be at least 32 random bytes and must differ between staging and production.

Use `pnpm staging:verify` for the full staging deploy + preflight + E2E + remote bench + remote stress flow.
