# Contributing

[简体中文](./CONTRIBUTING.zh-CN.md)

Requires Node.js 22.23+ and pnpm.

```sh
pnpm install
cp apps/server/.env.example apps/server/.env
pnpm dev                       # tunnel server on http://localhost:8787
pnpm build                     # build the CLI
node apps/cli/dist/hostc.mjs 3000 --server http://localhost:8787
```

Tunnels are served on `http://<id>.localhost:8787`; Chrome and Firefox resolve `*.localhost` to your machine.

```sh
pnpm check      # format check, lint, typecheck, unit and integration tests
pnpm test:e2e   # cf dev + CLI + a local origin, end to end
```

| Path                | What                                                      |
| ------------------- | --------------------------------------------------------- |
| `packages/protocol` | frame format, messages and constants shared by both sides |
| `packages/client`   | Node.js client: connection, streams, reconnects           |
| `apps/server`       | Cloudflare Worker + Durable Object tunnel server          |
| `apps/cli`          | the `hostc` command                                       |
| `apps/web`          | hostc.dev website and llms.txt                            |

The wire format is in [docs/protocol.md](./docs/protocol.md). Deploying and publishing are in
[docs/release.md](./docs/release.md).
