# 部署与环境规格

本文定义 local、staging、production 的部署方式。

## 环境

```text
local
  Wrangler dev
  localhost / 127.0.0.1

staging
  envoq.dev
  *.envoq.dev

production
  hostc.dev
  *.hostc.dev
```

staging 必须与 production 隔离。

## Wrangler 结构

推荐使用一个 `apps/server/wrangler.jsonc`，通过 `env.staging` 区分 staging。

不推荐维护两个独立 wrangler 文件，除非未来环境差异巨大。

要求：

- no assets。
- no D1。
- no `nodejs_compat`。
- Durable Object binding。
- Durable Object migrations。
- observability enabled。
- staging routes 使用 `envoq.dev`。

示意：

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "hostc-server",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-08",
  "vars": {
    "PUBLIC_BASE_DOMAIN": "hostc.dev"
  },
  "durable_objects": {
    "bindings": [
      {
        "name": "HOSTC_TUNNEL",
        "class_name": "HostcTunnel"
      }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["HostcTunnel"]
    }
  ],
  "observability": {
    "enabled": true,
    "head_sampling_rate": 0.1
  },
  "routes": [
    { "pattern": "hostc.dev/*", "zone_name": "hostc.dev" },
    { "pattern": "*.hostc.dev/*", "zone_name": "hostc.dev" }
  ],
  "env": {
    "staging": {
      "name": "hostc-server-staging",
      "vars": {
        "PUBLIC_BASE_DOMAIN": "envoq.dev"
      },
      "routes": [
        { "pattern": "envoq.dev/*", "zone_name": "envoq.dev" },
        { "pattern": "*.envoq.dev/*", "zone_name": "envoq.dev" }
      ]
    }
  }
}
```

实际 `compatibility_date` 应使用实现当天或接近日期。

## Secret

server 使用：

```text
TOKEN_SECRET
```

用途：

- signed connect token。

local：

```text
apps/server/.env
```

示例：

```env
TOKEN_SECRET=dev-only-change-me-at-least-32-random-bytes
```

staging：

```sh
pnpm -F @hostc/server wrangler secret bulk .env.staging --env staging
```

production：

```sh
pnpm -F @hostc/server wrangler secret put TOKEN_SECRET
```

要求：

- secret 至少 32 bytes 随机值。
- staging 和 production 使用不同 secret。
- `.env` 不提交真实 secret。
- `.gitignore` 覆盖 `.env`、`.env.local`。

## DNS 与 Routes

staging 需要：

```text
envoq.dev
*.envoq.dev
```

production 需要：

```text
hostc.dev
*.hostc.dev
```

必须验证：

- apex host 能访问 API。
- wildcard host 能访问 public tunnel。
- TLS 覆盖 wildcard。
- `foo.bar.envoq.dev` 不被当作合法 tunnel。
- Worker routes 命中正确 service。

## Scripts

root package 建议：

```json
{
  "scripts": {
    "dev:server": "pnpm -F @hostc/server dev",
    "deploy:server": "pnpm -F @hostc/server deploy",
    "deploy:server:staging": "pnpm -F @hostc/server deploy:staging"
  }
}
```

server package 建议：

```json
{
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "deploy:staging": "wrangler deploy --env staging",
    "cf-typegen": "wrangler types",
    "test": "vitest run",
    "test:e2e:staging": "node ./scripts/e2e-staging.mjs",
    "load:staging": "node ./scripts/load-staging.mjs"
  }
}
```

具体 test runner 可根据实现调整。

## Local 开发

启动 server：

```sh
pnpm dev:server
```

CLI 指向 local：

```sh
HOSTC_SERVER_URL=http://127.0.0.1:8787 hostc 3000
```

或配置：

```sh
hostc config set server-url http://127.0.0.1:8787
```

注意：

- local 的 wildcard host 行为和真实 DNS 不完全一致。
- local 可覆盖 API、dataChannel、基础 proxy。
- wildcard/TLS/WebSocket edge 行为必须在 staging 验证。

## Staging 部署

部署：

```sh
pnpm deploy:server:staging
```

设置 CLI：

```sh
hostc config set server-url https://envoq.dev
```

运行：

```sh
hostc 3000
```

验证：

```sh
curl https://envoq.dev/health
curl https://<tunnelId>.envoq.dev/
```

WebSocket 验证使用 E2E 脚本，不建议手动。

## Production 部署

production 部署前必须满足：

- local E2E 通过。
- staging E2E 通过。
- staging load test 输出。
- `pnpm build` 通过。
- `pnpm test` 通过。
- `pnpm lint` 通过。
- `TOKEN_SECRET` production 已设置。
- routes 指向 `hostc.dev` 和 `*.hostc.dev`。

部署：

```sh
pnpm deploy:server
```

## Rollback

必须保留回滚能力：

- 使用 Cloudflare Workers deployments 回滚到上一个版本。
- CLI npm 发布前先确认 server backward compatibility。
- protocol 重大变化使用 `PROTOCOL_VERSION`。
- production 切换前保留 staging 验证记录。

如果 production 出现 protocol error spike：

```text
1. 停止发布 CLI。
2. 回滚 server Worker。
3. 检查 logs 中 protocol.error。
4. 用 staging 复现。
```

## Observability

staging 和 production 都开启 observability。

建议采样：

```text
staging: 1.0
production: 0.1 起步
```

根据成本和流量调整。

日志必须隐藏：

- connectToken。
- Authorization header。
- TOKEN_SECRET。

## 官方参考

- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare Workers Best Practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [Durable Objects WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Durable Objects Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)

## Staging 一键流程

v4 重构后，staging 的标准入口固定在根目录脚本：

```sh
pnpm staging:deploy
pnpm staging:secret
pnpm staging:preflight
pnpm staging:test
```

日常完整验收使用：

```sh
pnpm staging:verify
```

`staging:secret` 只写入 `hostc-server-staging`：

```sh
pnpm -F @hostc/server exec wrangler secret bulk .env.staging --env staging
```

remote bench 和 remote stress 默认使用：

```sh
HOSTC_SERVER_URL=https://envoq.dev
```

详细步骤见 `docs/refactor/staging.md`。

### Staging secrets bulk

staging secrets 统一放在未提交的 `apps/server/.env.staging`：

```sh
cp apps/server/.env.staging.example apps/server/.env.staging
pnpm staging:secret
```

首次创建或需要代码和 secret 同步部署时，使用：

```sh
pnpm staging:deploy:secrets
```
