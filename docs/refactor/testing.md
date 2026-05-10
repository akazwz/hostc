# Hostc v4 测试、Bench、压测矩阵

本文件是 v4 tunnel 重构后的验证入口。目标是把协议正确性、SDK 行为、server 行为、CLI UX、性能和 staging 可用性分开验证，避免把所有问题都混在 CLI E2E 里。

## 分层原则

| 层级 | 目标 | 依赖 | 入口 |
|---|---|---|---|
| Protocol unit | 验证 v4 frame、metadata、limits、credit、channel 选择等纯协议逻辑 | `@hostc/protocol` | `pnpm -F @hostc/protocol test` |
| Client SDK unit/integration | 验证 `HostcClient` 创建 ephemeral tunnel、连接 data channels、stream 转发、重连和事件 | `@hostc/client` + 模拟 v4 server | `pnpm -F @hostc/client test` |
| Server unit/integration | 验证 Worker 路由、token、Durable Object stream/channel 状态机、错误语义 | `@hostc/server` | `pnpm -F @hostc/server test` |
| CLI unit | 验证配置、参数解析、终端输出、错误展示和进程级行为，不重新测试协议细节 | `hostc` + `@hostc/client` | `pnpm -F hostc test` |
| Local E2E | 验证本地 Wrangler server + CLI + 本地 origin 的完整链路 | 本地 Worker、CLI、origin | `pnpm test:e2e:local` |
| Staging E2E | 验证已部署 Worker + Client SDK + 本地 origin 的完整链路 | staging Worker、`@hostc/client`、origin | `pnpm test:e2e:staging` |
| Local bench | 用 SDK + 模拟 v4 server 测 SDK 协议路径吞吐和延迟，不经过 CLI | `@hostc/client` + simulated v4 server | `pnpm bench:local` |
| Remote bench | 用 SDK + staging server 测真实边缘链路吞吐和延迟，不经过 CLI | staging Worker、`@hostc/client` | `pnpm bench:remote` |
| Local stress | 用 SDK + 模拟 v4 server 高并发打 stream/channel，不经过 CLI | `@hostc/client` + simulated v4 server | `pnpm stress:local` |
| Remote stress | 用 SDK + staging server 高并发打 HTTP/WS，不经过 CLI | staging Worker、`@hostc/client` | `pnpm stress:remote` |

## 根目录命令

| 命令 | 用途 |
|---|---|
| `pnpm build` | 构建 protocol、client SDK、server、CLI |
| `pnpm test` | 跑 protocol、client SDK、server、CLI 单测 |
| `pnpm test:unit` | `pnpm test` 的显式别名 |
| `pnpm test:integration` | 跑 client SDK 和 server 的集成类测试 |
| `pnpm test:e2e:local` | 本地 Wrangler + CLI + origin 完整链路 |
| `pnpm test:e2e:staging` | staging Worker + Client SDK + origin 完整链路 |
| `pnpm bench:protocol` | protocol 纯 codec/credit 微基准 |
| `pnpm bench:local` | SDK + 模拟 v4 server 本地 bench |
| `pnpm bench:remote` | SDK + staging server remote bench |
| `pnpm stress:protocol` | protocol 纯状态机压力测试 |
| `pnpm stress:local` | SDK + 模拟 v4 server 本地压测 |
| `pnpm stress:remote` | SDK + staging server remote 压测 |
| `pnpm verify:local` | build、lint、unit test、local bench、local stress |
| `pnpm verify:staging` | deploy staging、preflight、staging E2E、remote bench、remote stress |

## Bench 和 Stress 环境变量

| 变量 | 默认值 | 说明 |
|---|---:|---|
| `HOSTC_SERVER_URL` | `https://envoq.dev` | remote bench/stress 使用的 server URL |
| `HOSTC_DATA_CHANNELS` | local bench `2`，local stress `4` | SDK 建立的 data channel 数量 |
| `HOSTC_BENCH_ITERATIONS` | local `1000`，remote `200` | bench 请求总数 |
| `HOSTC_BENCH_CONCURRENCY` | local `32`，remote `16` | bench 并发数 |
| `HOSTC_BENCH_BODY_BYTES` | `0` | local bench POST body 大小；`0` 表示 GET |
| `HOSTC_STRESS_STREAMS` | local `5000`，remote `1000` | stress HTTP stream 总数 |
| `HOSTC_STRESS_CONCURRENCY` | local `128`，remote `64` | stress 并发数 |
| `HOSTC_STRESS_BODY_BYTES` | `1024` | stress POST body 大小 |
| `HOSTC_STRESS_WS` | `20` | remote stress WebSocket echo 会话数 |

示例：

```sh
HOSTC_BENCH_ITERATIONS=2000 HOSTC_BENCH_CONCURRENCY=64 pnpm bench:local
HOSTC_SERVER_URL=https://envoq.dev HOSTC_STRESS_STREAMS=2000 pnpm stress:remote
```

## 推荐验收顺序

1. `pnpm build`
2. `pnpm lint`
3. `pnpm test`
4. `pnpm bench:protocol`
5. `pnpm stress:protocol`
6. `pnpm bench:local`
7. `pnpm stress:local`
8. `pnpm test:e2e:local`
9. `pnpm deploy:server:staging`
10. `pnpm preflight:staging`
11. `pnpm test:e2e:staging`
12. `pnpm bench:remote`
13. `pnpm stress:remote`

## 设计约束

- 协议字段、frame type、limits、credit、codec 只允许来自 `@hostc/protocol`。
- Client SDK 是 CLI、未来 GUI 客户端和测试 harness 的共同底座。
- CLI 测试只验证 CLI 自己的配置、参数、输出和错误展示，不重复覆盖 SDK 内部状态机。
- Local bench/stress 必须使用 SDK + 模拟 v4 server，避免受 Wrangler、Cloudflare 网络和 CLI 输出影响。
- Remote bench/stress 必须使用 SDK + staging server，验证真实 Worker/Durable Object/WebSocket 路径。
- 如果 v4 协议升级，protocol、SDK、server、CLI 和本文档必须同一次提交同步更新；不保留旧协议 fallback。

## Staging 测试入口

staging 已部署且 secret 已配置后，可以直接跑：

```sh
pnpm staging:test
```

完整 staging 发布验收使用：

```sh
pnpm staging:verify
```

`staging:test` 会固定使用 `https://envoq.dev` 跑 staging E2E、remote bench 和 remote stress。详细部署顺序见 `docs/refactor/staging.md`。

## CLI E2E

CLI 进程级 E2E 独立于 staging 主验收，使用本地模拟 v4 server + 真实 CLI 进程 + 本地 origin：

```sh
pnpm test:e2e:cli
```

覆盖 CLI ready 输出、参数传递、HTTP GET/POST proxy、stdin 触发 reconnect、SIGTERM 退出。协议/server/SDK 的 staging gate 仍然使用 SDK 直连 staging server。
