# AGENT INSTRUCTIONS: @hostc/server

本说明专为 `apps/server` Cloudflare Worker / Durable Object tunnel server 设计。

## 规格来源

- `docs/refactor/` 是本轮重构的唯一规格来源。
- 协议类型、control message、data frame、limits、credit helper 和 header/close 处理必须来自 `@hostc/protocol`。
- 不要在 server 中复制或另行定义线上协议字段。

## 目录结构

- `src/index.ts`：Worker fetch 入口，负责 host/API 路由和 DO 转发。
- `src/durable/tunnel.ts`：Durable Object，负责 control/data socket、stream、credit、pending data 和 public proxy。
- `src/router.ts`：host/API path/WebSocket upgrade 解析。
- `src/token.ts`：connect/refresh token 签发、校验和日志脱敏。
- `wrangler.jsonc`：production/staging Worker、Durable Object、routes 和 observability 配置。
- `scripts/e2e-staging.mjs`：真实 staging E2E。
- `scripts/load-staging.mjs`：真实 staging load runner。

## 常用命令

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

## 约定

- Worker 代码必须保持 runtime-native：无 Node built-ins、无 Hono、无 `nodejs_compat`。
- server 只做 tunnel；不要加入 static assets、waitlist、cli-error、D1 或账号/billing 功能。
- WebSocket 身份以 Durable Object tags + attachment 为准，内存 Map 只能作为热路径状态。
- control 断开或任意 dataChannel 断开都必须使当前 `connectionId` 失效。
- 发送 data frame 前必须同时满足 stream credit、connection credit、socket ready、`bufferedAmount` 阈值和 `maxFrameBytes`。
- `TOKEN_SECRET` 不进入源码或 non-secret vars；local 用 `.dev.vars`，staging/production 用 Wrangler secret。
