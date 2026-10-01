# Releasing

| What                         | How it ships                                                 |
| ---------------------------- | ------------------------------------------------------------ |
| tunnel server `hostc-tunnel` | Cloudflare Workers Builds deploys it on every push to `main` |
| website `hostc-web`          | Cloudflare Workers Builds deploys it on every push to `main` |
| CLI `hostc` on npm           | GitHub Actions → "Release CLI" (manual), trusted publishing  |

Users run `npx hostc@latest`, so a published CLI reaches most of them immediately. Every API call
carries `hostc-protocol: <PROTOCOL_VERSION>`; the server answers any other version (including CLIs
from before protocol 5) with `426` and "Run `npx hostc@latest` to upgrade". There is no
multi-version support, by design: hostc is free and may break older CLIs (see the README).

## One-time setup

### Workers Builds (Cloudflare dashboard → Worker → Settings → Build)

Connect the repository `akazwz/hostc`, production branch `main`, and turn off builds for
non-production branches. The Worker name on the dashboard must equal `worker.name` in `cloudflare.config.ts`.

Where things live: `hostc.dev` is the website (`hostc-web`), `hostc.dev/api/*` is the tunnel API
(`hostc-tunnel`; the more specific route wins), `<id>.hostc.app` are the tunnels (`hostc-tunnel`),
and the apex `hostc.app` redirects to `hostc.dev`.

| Setting           | `hostc-tunnel`                                                         | `hostc-web`                                  |
| ----------------- | ---------------------------------------------------------------------- | -------------------------------------------- |
| Root directory    | `apps/server`                                                          | `apps/web`                                   |
| Build command     | `pnpm install --frozen-lockfile`                                       | `pnpm install --frozen-lockfile`             |
| Deploy command    | `pnpm run deploy`                                                      | `pnpm run deploy`                            |
| Build variables   | `PNPM_VERSION=12.6.0` `API_DOMAIN=hostc.dev` `TUNNEL_DOMAIN=hostc.app` | `PNPM_VERSION=12.6.0` `WEB_DOMAIN=hostc.dev` |
| Build watch paths | `apps/server/*`, `packages/protocol/*`, `pnpm-lock.yaml`               | `apps/web/*`, `pnpm-lock.yaml`               |

Workers Builds defaults to an older pnpm and does not read `packageManager`, hence `PNPM_VERSION`.
The TypeScript configurations name each route's zone explicitly (this account has SSL for SaaS, which rejects
inferred zones). The zone defaults to the domain; set `API_ZONE`, `TUNNEL_ZONE` or `WEB_ZONE` when a
domain is a subdomain of its zone.
Build variables exist only during the build; `cloudflare.config.ts` turns them into routes and runtime
vars in production mode. Deploy scripts run `cf deploy --mode production`; build settings live in
`wrangler.config.ts`. The token secret is a runtime secret: set it once with
`pnpm -F @hostc/server exec wrangler secret put TOKEN_SECRET --name hostc-tunnel`
(e.g. `openssl rand -base64 48`). Wrangler requires the explicit name for this command because it
does not read `cloudflare.config.ts`.

### npm trusted publishing

npmjs.com → `hostc` → Settings → Trusted publishing → GitHub Actions: repository `akazwz/hostc`,
workflow `release.yml`. No npm token is stored in GitHub.

## Routine releases

- **Server / website**: merge to `main`. A server deploy restarts every tunnel's Durable Object;
  connected CLIs reconnect within a second and keep their URLs, requests in flight at that moment
  fail. Roll back from the dashboard (Deployments) or
  `pnpm -F @hostc/server exec wrangler rollback --name hostc-tunnel`.
- **CLI**: bump `version` in `apps/cli/package.json` (and `CHANGELOG.md`), merge, then run
  "Release CLI" with dist-tag `latest`.

## Protocol changes

Bump `PROTOCOL_VERSION`, merge to `main` (the server deploys), then run "Release CLI" right away.
Between the two, CLIs see the upgrade prompt; that is expected. Never publish the CLI before the
server is live: a new CLI against an old server fails with confusing errors.

## Domains and DNS

Protocol 5 went live on 2026-09-27, replacing the v4 Worker `hostc-server`; 1.x CLIs now get the
upgrade prompt.

- `hostc.dev` and `hostc.app` use DNS-only CNAMEs to preferred Cloudflare hosts, which route
  mainland China (most users) better than the default addresses: `hostc.dev` and `hostc.app` →
  `akazwz.cf.090227.xyz`, `*.hostc.app` → `store.ubi.com`. Cloudflare still applies each zone's
  Worker routes and rules, which match by Host. Self-hosters use proxied records instead (README).
- A Redirect Rule on `hostc.app` sends the apex to `https://hostc.dev` (301).
- `hostc.app` publishes `v=spf1 -all` and a `p=reject` DMARC record: it never sends mail, and a
  tunnel domain is an obvious target for spoofing.

## npm dist-tags

Moving a dist-tag (`npm dist-tag add`) needs interactive two-factor authentication and is not
covered by trusted publishing. To change what `latest` points to, publish a new version with
"Release CLI" instead. Never tag 2.0.0: it was published without its executable.
