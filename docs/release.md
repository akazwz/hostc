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
non-production branches. The Worker name on the dashboard must equal `name` in the Wrangler config.

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
The deploy scripts name each route's zone explicitly (this account has SSL for SaaS, which rejects
inferred zones). The zone defaults to the domain; set `API_ZONE`, `TUNNEL_ZONE` or `WEB_ZONE` when a
domain is a subdomain of its zone.
Build variables exist only during the build; the deploy scripts turn them into routes and runtime
vars. The token secret is a runtime secret: set it once with
`pnpm -F @hostc/server exec wrangler secret put TOKEN_SECRET` (e.g. `openssl rand -base64 48`).

### npm trusted publishing

npmjs.com → `hostc` → Settings → Trusted publishing → GitHub Actions: repository `akazwz/hostc`,
workflow `release.yml`. No npm token is stored in GitHub.

## Routine releases

- **Server / website**: merge to `main`. A server deploy restarts every tunnel's Durable Object;
  connected CLIs reconnect within a second and keep their URLs, requests in flight at that moment
  fail. Roll back from the dashboard (Deployments) or `pnpm -F @hostc/server exec wrangler rollback`.
- **CLI**: bump `version` in `apps/cli/package.json` (and `CHANGELOG.md`), merge, then run
  "Release CLI" with dist-tag `latest`.

## Protocol changes

Bump `PROTOCOL_VERSION`, merge to `main` (the server deploys), then run "Release CLI" right away.
Between the two, CLIs see the upgrade prompt; that is expected. Never publish the CLI before the
server is live: a new CLI against an old server fails with confusing errors.

## First launch of protocol 5 (replacing the v4 `hostc-server` Worker)

The old Worker `hostc-server` owns `hostc.dev/api/*`, `hostc.dev/health` and `*.hostc.dev/*`. The
new Worker is `hostc-tunnel`, so both can exist side by side until the switch.

Prepare (no user impact):

1. Buy `hostc.app` and add it to Cloudflare. Like `hostc.dev`, its records are DNS-only CNAMEs to
   preferred Cloudflare hosts, which give mainland China (most users) better routes: `*` →
   `store.ubi.com`, `@` → `akazwz.cf.090227.xyz`. Cloudflare still applies the zone's Worker
   routes and rules, which match by Host. (Self-hosters use proxied records to `192.0.2.1`
   instead.) Tunnel routes (`*.hostc.app/*`) do not match the apex, so add a Redirect
   Rule: `hostc.app/*` → `https://hostc.dev`, 301. Redirect Rules run before Workers, so exclude
   `/api/` while the API lives on `hostc.app` (steps 2–6):
   `(http.host eq "hostc.app" and not starts_with(http.request.uri.path, "/api/"))`.
   Also publish `v=spf1 -all` and a `p=reject` DMARC record: the domain never sends mail.
2. Create `hostc-tunnel`: from `apps/server`, run
   `API_DOMAIN=hostc.app TUNNEL_DOMAIN=hostc.app pnpm run deploy` once, then set `TOKEN_SECRET`.
3. Connect Workers Builds as above, but with `API_DOMAIN=hostc.app` for now.
4. Set up trusted publishing, merge `rewrite` into `main`, run "Release CLI" with dist-tag `next`,
   and test for real: `npx hostc@next 3000 --server https://hostc.app`.

Switch (a few minutes):

5. `pnpm -F @hostc/server exec wrangler delete hostc-server` — frees the old routes and ends the old
   v4 tunnels.
6. Change the build variable to `API_DOMAIN=hostc.dev` and retry the latest `hostc-tunnel` build.
   The new Worker takes `hostc.dev/api/*`; from now on 1.x CLIs get the upgrade prompt.
7. `npm dist-tag add hostc@2.0.0 latest` (run locally while logged in to npm; trusted publishing
   only covers `npm publish`).
8. Connect Workers Builds for `hostc-web` and retry its build; the site documents the new CLI.
9. Delete the old `*.hostc.dev` DNS record, a DNS-only CNAME to a preferred Cloudflare host that
   served the v4 tunnels. Until step 5 it carries every 1.x tunnel, so never delete it earlier.
   `cf dns records list --zone hostc.dev` shows its id; then `cf dns records delete <id> --zone hostc.dev`.
   Keep the apex `hostc.dev` record: the website and `/api/*` are served through it.

Between steps 5 and 6, 1.x CLIs get errors for a minute.
