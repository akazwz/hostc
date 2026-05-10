# Staging 部署与验证流程

本流程只针对 Cloudflare Worker staging 环境：`hostc-server-staging`，域名为 `envoq.dev` 和 `*.envoq.dev`。所有命令都在仓库根目录执行。

## 固定原则

- staging 必须使用 `--env staging`，不能省略。
- staging 和 production 是两个 Worker：`hostc-server-staging` 与 `hostc-server`。
- `PUBLIC_BASE_DOMAIN=envoq.dev` 放在 `apps/server/wrangler.jsonc` 的 `env.staging.vars`。
- staging secrets 放在本地文件 `apps/server/.env.staging`，该文件被 git ignore。
- `TOKEN_SECRET` 不进入 `vars`、源码、文档真实值或 git。
- 本地开发使用 `apps/server/.env`，staging 使用 `apps/server/.env.staging` + Wrangler secret bulk。

## 准备 staging secret 文件

复制示例文件：

```sh
cp apps/server/.env.staging.example apps/server/.env.staging
```

填入至少 32 bytes 的随机 secret，且不要和 production 共用：

```env
TOKEN_SECRET=replace-with-staging-secret-at-least-32-bytes
```

## 推荐首次初始化 staging

首次创建/刷新 staging Worker 时，推荐直接把代码和 secrets 一起部署：

```sh
pnpm staging:deploy:secrets
pnpm staging:preflight
pnpm staging:test
```

`staging:deploy:secrets` 等价于：

```sh
pnpm -F @hostc/server exec wrangler deploy --env staging --secrets-file .env.staging
```

这个流程可以避免先部署后缺 secret 导致 create tunnel 500。

## 只更新 staging secrets

如果 Worker 已经存在，只想批量更新 secrets：

```sh
pnpm staging:secret
```

等价于：

```sh
pnpm -F @hostc/server exec wrangler secret bulk .env.staging --env staging
```

`secret bulk` 接受 JSON 或 `.env` 格式。这里统一使用 `.env.staging`。

## 日常 staging 发布

代码变更后，完整 staging 验证使用：

```sh
pnpm staging:verify
```

这个命令会依次执行：

```sh
pnpm staging:deploy
pnpm staging:preflight
pnpm staging:test
```

如果本次也要同步 staging secrets，用：

```sh
pnpm staging:deploy:secrets
pnpm staging:preflight
pnpm staging:test
```

## 只跑 staging 测试/bench/压测

如果 staging 已经部署且 secret 已经存在，可以跳过 deploy，只跑：

```sh
pnpm staging:test
```

`staging:test` 会固定使用 `https://envoq.dev` 跑：

```sh
HOSTC_SERVER_URL=https://envoq.dev pnpm test:e2e:staging
HOSTC_SERVER_URL=https://envoq.dev pnpm bench:remote
HOSTC_SERVER_URL=https://envoq.dev pnpm stress:remote
```

## 调整 remote bench/stress 规模

```sh
HOSTC_SERVER_URL=https://envoq.dev HOSTC_BENCH_ITERATIONS=1000 HOSTC_BENCH_CONCURRENCY=32 pnpm bench:remote
HOSTC_SERVER_URL=https://envoq.dev HOSTC_STRESS_STREAMS=2000 HOSTC_STRESS_CONCURRENCY=64 HOSTC_STRESS_WS=20 pnpm stress:remote
```

## 常见问题

`create tunnel failed (500)`：优先检查 staging `TOKEN_SECRET` 是否存在，并确认长度至少 32 bytes。

```sh
pnpm staging:preflight
pnpm staging:secret
```

CLI 连到了 production：检查 CLI 配置或命令参数，staging 测试必须使用 `https://envoq.dev`。

```sh
hostc config get server-url
hostc config set server-url https://envoq.dev
```

误把 secret 写到 production：staging secret 命令必须带 `--env staging`。production 命令没有这个参数，所以不要混用。
