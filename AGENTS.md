# hostc

A tunnel that gives a local HTTP/WebSocket server a public URL. pnpm monorepo, Node.js 22.22+.

| Path                | Package           | What                                                                        |
| ------------------- | ----------------- | --------------------------------------------------------------------------- |
| `packages/protocol` | `@hostc/protocol` | wire format, messages, constants. Platform neutral: no Node or Workers APIs |
| `packages/client`   | `@hostc/client`   | Node.js client (internal, not published)                                    |
| `apps/server`       | `@hostc/server`   | Cloudflare Worker + Durable Object `Tunnel`                                 |
| `apps/cli`          | `hostc`           | the published CLI, bundled with tsdown                                      |
| `apps/web`          | `web`             | hostc.dev: one static HTML page and llms.txt                                |

`docs/protocol.md` is the specification; `docs/release.md` describes deploying and publishing. Change it together with `@hostc/protocol` and bump
`PROTOCOL_VERSION` on any incompatible wire change; there is no backward compatibility.

## Commands (repository root)

| Command              | What                                                          |
| -------------------- | ------------------------------------------------------------- |
| `pnpm dev`           | tunnel server on http://localhost:8787 (`wrangler dev`)       |
| `pnpm build`         | build the CLI to `apps/cli/dist/hostc.mjs`                    |
| `pnpm check`         | `fmt:check`, `lint`, `typecheck`, `test`                      |
| `pnpm test:e2e`      | real `wrangler dev` + built CLI + local origin                |
| `pnpm fmt`           | format with oxfmt                                             |
| `pnpm lint`          | lint with oxlint                                              |
| `pnpm deploy:server` | deploy the tunnel server; needs `API_DOMAIN`, `TUNNEL_DOMAIN` |
| `pnpm deploy:web`    | deploy hostc.dev; needs `WEB_DOMAIN`                          |

Server tests run inside workerd via `@cloudflare/vitest-plugin`; `evictDurableObject(stub)`
simulates hibernation.

## Rules

- Internal packages export TypeScript source (`exports: ./src/index.ts`) and use `.ts` import
  extensions; there is no build step except the CLI bundle.
- The Durable Object must stay hibernation-safe: anything a WebSocket needs after waking goes into
  its attachment or tags. Only in-flight HTTP requests may live purely in memory.
- Domains and deployment settings come from environment variables or deploy-time flags
  (`apps/server/scripts/deploy.ts`), never hardcoded. `wrangler.jsonc` holds local defaults only.
- `TOKEN_SECRET` is a Worker secret; locally it comes from `apps/server/.dev.vars` (not committed).
- Before using a library or platform API, read its docs, type definitions or source in
  `node_modules`, including defaults of options you do not set. Cloudflare APIs change often.
- Every mechanism must prevent a concrete failure. Do not add ones that do not.

## Lessons

- pnpm 12 refuses packages published less than a day ago (`minimumReleaseAge`). Keep that policy;
  when a brand-new release is rejected, depend on the previous version instead. Build scripts are
  allowed per package with `allowBuilds` in `pnpm-workspace.yaml` (`onlyBuiltDependencies` is gone).
- Internal workspace packages need a `version` field, or `pnpm publish` of the CLI cannot replace
  their `workspace:*` ranges.
- `pnpm deploy` is a built-in pnpm command; package scripts named `deploy` must be run with
  `pnpm run deploy` (the root `deploy:*` scripts do this).
- With compatibility dates after 2026-03, WebSocket `binaryType` defaults to `"blob"`; set
  `"arraybuffer"` on sockets you read binary data from (hibernation handlers still get `ArrayBuffer`).
- Hibernatable sockets are left in `CLOSING` in `webSocketClose`; call `ws.close()` there to finish
  the handshake.
- `@cloudflare/vitest-pool-workers` is superseded by `@cloudflare/vitest-plugin`.
