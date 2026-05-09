# hostc 重构总规格

最后更新：2026-05-08

本目录是 hostc 重构的唯一规格来源。后续实现、测试、bench、staging 验收和部署配置都必须以这里的文档为准。

## 文档地图

- [protocol.md](./protocol.md)：`@hostc/protocol` 的 wire protocol、control JSON、data frame、credit、limits、codec 和测试要求。
- [server.md](./server.md)：`apps/server` 的 Cloudflare Workers / Durable Objects 后端设计。
- [cli.md](./cli.md)：`apps/cli` 的配置、连接管理、本地 HTTP/WebSocket 代理和重连设计。
- [testing.md](./testing.md)：单测、状态机测试、集成测试、E2E、bench、load test 和 staging 验收。
- [deployment.md](./deployment.md)：local/staging/production 环境、`envoq.dev`、Wrangler 配置、secret、DNS 和发布流程。

## 最终目标

完成 hostc tunnel 核心重构：

- `packages/tunnel-protocol` 重写为 `packages/protocol`，包名为 `@hostc/protocol`。
- `apps/workers` 重写为 `apps/server`，包名为 `@hostc/server`。
- 新协议使用 `1 条 control WebSocket + N 条 dataChannel WebSocket`。
- control WebSocket 只传 JSON 流程事件。
- dataChannel WebSocket 只传 packed binary data frame。
- request body、response body、WebSocket client frame、WebSocket server frame 都使用 credit-based flow control。
- credit 同时支持 stream-level 和 connection-level。
- protocol package 必须 runtime-agnostic、low-copy、零 Node 依赖。
- server 必须使用 Cloudflare Workers + Durable Objects 原生能力，无 `nodejs_compat`。
- server 不再包含 web/static assets、waitlist API、cli-error API、D1 依赖。
- staging 使用 `envoq.dev` 和 `*.envoq.dev`。
- CLI 支持 `~/.hostc/config.json` 持久化非敏感配置。
- HTTP tunnel 和 WebSocket tunnel 在 local 与 staging 都能通过验收。

## 非目标

本轮重构不实现：

- 用户账号体系。
- reserved/custom subdomain ownership。
- billing。
- Cloudflare Access 集成。
- dataChannel 局部热恢复。
- body compression 或 WebSocket permessage-deflate。
- 多语言 CLI。
- web UI、waitlist、静态官网。
- CLI token 落盘。

## 目标目录结构

```text
apps/
  cli/
  server/
  web/              # 本轮 server 重构不依赖它
packages/
  protocol/
docs/
  refactor/
```

`apps/server` 只做 tunnel server。`apps/cli` 只做本地代理 runtime。`packages/protocol` 只定义线上协议格式、codec、校验、常量和纯 helper。

## 核心决策

协议：

- `tunnelId` 表示一个公网 tunnel。
- `connectionId` 表示 CLI 本次连接的一组 WebSocket。
- `control` 是一条 JSON WebSocket。
- `dataChannel` 是 N 条 binary WebSocket。
- `streamId` 由 server 分配，表示一次公网 HTTP 请求或一次公网 WebSocket 连接。
- `dataFrame` 自描述，包含 `kind/id/seq/flags/length/payload`。
- `seq` 只做连续性校验和 debug，不做重排。
- `request.end` / `response.end` 必须带 `lastSeq`。
- 唯一需要处理的乱序是 control 和 dataChannel 跨连接乱序。
- 同一个 `streamId` 固定到 `streamId % dataChannels` 的 dataChannel。

server：

- Worker 负责 host 路由、API 路由、token 校验和 Durable Object 转发。
- Durable Object 负责每个 tunnel 的 control/data 连接组、stream 状态、credit、pending data 和 public proxy。
- WebSocket 身份以 Durable Object tags + attachment 为权威。
- Map 只能作为热路径 cache 或 active stream 内存状态，不能作为 socket 身份的唯一事实来源。
- control 断开则当前 `connectionId` 作废，所有 dataChannel 关闭，active streams abort。
- 任意 dataChannel 断开，当前 connection 失效，CLI 通过 refresh 重连。

CLI：

- 启动后创建 tunnel，建立 1 条 control 和 N 条 dataChannel。
- 任意 control/dataChannel 断开，关闭当前 connection，abort active streams，refresh 后重建。
- CLI 配置保存在 `~/.hostc/config.json`。
- 配置优先级：CLI 参数 > 环境变量 > 配置文件 > 默认值。
- token 不落盘，只保存在进程内存。

部署：

- local 使用 Wrangler dev 和 `.dev.vars`。
- staging 使用 `envoq.dev`、`*.envoq.dev`、`wrangler deploy --env staging`。
- production 使用 `hostc.dev`、`*.hostc.dev`。
- `TOKEN_SECRET` 通过 Wrangler secret 管理，不进入源码和非 secret vars。

## 验收标准

重构完成必须满足：

- `pnpm install` 后 workspace 依赖正确。
- `pnpm build` 通过。
- `pnpm test` 通过。
- `pnpm lint` 通过。
- `pnpm -F @hostc/protocol test` 通过。
- `pnpm -F @hostc/protocol bench` 能输出 protocol codec baseline。
- `pnpm -F @hostc/server test` 通过。
- `pnpm -F hostc test` 或 CLI 对应测试命令通过。
- local E2E 能验证 HTTP GET、HTTP POST body、streaming response、WebSocket text echo、WebSocket binary echo。
- staging E2E 能在 `envoq.dev` 上验证真实 wildcard host、TLS、WebSocket upgrade 和 tunnel proxy。
- load test 能输出基本指标，不要求达到最终性能目标，但必须可运行、可复现。
- server 不包含 `nodejs_compat`、Node built-ins、D1、static assets、waitlist API、cli-error API。
- protocol package 不依赖 Node、Cloudflare、WebSocket、fetch、Hono 或 CLI runtime。
- 文档中的 one-shot prompt 可以作为后续 AI/code agent 的完整执行指令。

## 建议命令

最终实现应提供或等价支持这些命令：

```sh
pnpm build
pnpm test
pnpm lint
pnpm -F @hostc/protocol test
pnpm -F @hostc/protocol bench
pnpm -F @hostc/server test
pnpm -F @hostc/server dev
pnpm -F @hostc/server deploy:staging
pnpm -F @hostc/server test:e2e:staging
pnpm -F @hostc/server load:staging
pnpm -F hostc build
pnpm -F hostc test
```

命令名称可以在实现时微调，但必须在 README 或 package scripts 中明确。

## Agent 执行约定

本重构允许并建议 code agent 在边界清晰时使用 subagents。

主 agent 必须负责：

- 维护 `docs/refactor/` 与实现的一致性。
- 固定 `@hostc/protocol` 的 contract，避免 server 和 CLI 各自理解不同。
- 拆分任务并分配不重叠的写入范围。
- 集成 subagent 结果。
- 运行最终测试、bench、E2E 和验收命令。
- 总结完成项、未完成项和风险。

适合 subagent 的任务：

- `@hostc/protocol` codec、validator、unit tests、bench。
- `apps/server` host/API router、token、Wrangler env。
- Durable Object connection state machine、tags/attachment、credit。
- `apps/cli` config subsystem。
- `apps/cli` control/data client。
- HTTP/WebSocket proxy adapters。
- testing/bench/load harness。
- 文档与验收清单复核。

不适合并行的任务：

- 协议 schema 未冻结时，让多个 agent 同时改 protocol。
- 让多个 agent 同时改同一批 server state machine 文件。
- 让 CLI 和 server 各自发明 control message 字段。
- 在没有主 agent 集成的情况下分别修改 package scripts 和 workspace 结构。

subagent 最终必须报告：

- 修改了哪些文件。
- 实现了什么。
- 运行了哪些命令。
- 哪些测试通过或失败。
- 仍然存在的风险。

## 推荐 one-shot prompt

后续可以直接给 AI/code agent 这段指令：

```text
请把 docs/refactor/ 作为唯一重构规格来源，完整重构 hostc。你需要实现文档中定义的 @hostc/protocol、@hostc/server、CLI control/data 协议、staging 配置、测试、bench 和压测脚本；可以使用 subagents 拆分独立任务，但主 agent 必须负责协议一致性、集成和最终验收。未通过 docs/refactor/README.md 的验收标准前，不要停止。
```

## 实施阶段

1. 协议阶段：创建 `packages/protocol`，完成 control/data codec、validator、limits、credit helper、unit tests、bench。
2. server 骨架阶段：重命名/重写 `apps/server`，完成 host router、API router、token、Wrangler staging env。
3. DO 连接阶段：实现 control/data WebSocket 连接组、tags、attachments、ready 判断、断线策略。
4. HTTP tunnel 阶段：实现 HTTP request/response body、双向 credit、abort。
5. WebSocket tunnel 阶段：实现 public WebSocket upgrade、text/binary frame、close propagation。
6. CLI 阶段：实现 config、create/refresh、control/data client、本地 HTTP/WebSocket proxy、reconnect。
7. 测试与 bench 阶段：补齐单测、状态机测试、Worker/DO 集成测试、CLI 测试、bench。
8. staging 阶段：配置 `envoq.dev`，跑 E2E 和 load test。
9. 收敛阶段：删除旧代码、更新 README、运行最终验收。

## 官方参考

- [Cloudflare Workers Best Practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [Cloudflare Durable Objects WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Cloudflare Workers WebSockets API](https://developers.cloudflare.com/workers/runtime-apis/websockets/)
- [Cloudflare Durable Objects Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
