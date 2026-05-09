# 测试、Bench 与压测规格

本重构必须同时覆盖 correctness、performance baseline 和真实 staging 行为。

## 三类验证

测试：

```text
证明协议、状态机和业务行为正确。
```

bench：

```text
证明 codec、parser、credit helper 等局部代码够快，并防止性能回退。
```

压测：

```text
证明真实部署在并发和流量下能跑，并输出可比较指标。
```

不要用压测代替测试，也不要用 bench 证明真实网络性能。

## Protocol 单测

包：`@hostc/protocol`

必须覆盖：

- control JSON encode/decode。
- 每一种 control message 的 validator。
- invalid control type。
- control message size limit。
- header count/name/value limit。
- URL/reason limit。
- dataFrame encode/decode。
- invalid magic。
- invalid version。
- invalid kind。
- invalid flags。
- invalid id。
- invalid seq。
- invalid length。
- payload length > maxFrameBytes。
- low-copy decode，payload 必须是原始 buffer 的 `subarray`。
- random payload roundtrip。
- `selectDataChannel(streamId, dataChannels)`。
- credit grant/consume helper。
- close code/reason normalization。
- header filters。

建议命令：

```sh
pnpm -F @hostc/protocol test
```

## 协议状态机测试

写一个纯 TypeScript state machine model，不依赖 Cloudflare 和 Node WebSocket。

必须覆盖：

- control connected。
- N 条 dataChannel connected。
- ready 前 public request 不应转发。
- data 先于 `request.start` 到达。
- `request.end` 先于最后 data 到达。
- `response.end` 先于最后 data 到达。
- no credit 时不能发送 data。
- stream credit 消耗和归还。
- connection credit 消耗和归还。
- abort 后后续同 stream data 被忽略或触发协议错误。
- old connectionId data 到达。
- dataChannel close 导致 connection failed。
- control close 导致 connection failed。
- seq 跳号。
- lastSeq 与实际 seq 不匹配。

核心不变量：

```text
没有 credit 不能发送 data。
同 streamId + dataKind 的 seq 必须连续。
end 后不能继续接收同方向 data。
abort 后必须释放 stream 状态。
旧 connectionId 永远无效。
ready 前不能代理 public request。
```

## Server 单元与集成测试

包：`@hostc/server`

建议使用 Cloudflare Workers 官方测试工具链，例如 Workers Vitest integration 或 Miniflare 相关测试能力。实现时以当前 Cloudflare 推荐工具为准。

必须覆盖：

- host 分类：
  - `hostc.dev`
  - `envoq.dev`
  - `abc.envoq.dev`
  - `foo.bar.envoq.dev`
  - `localhost`
  - unknown host
- API path parser：
  - create
  - refresh
  - control
  - data
  - method mismatch
  - invalid channel
- token sign/verify：
  - expired
  - wrong audience
  - wrong tunnelId
  - wrong connectionId
  - bad signature
- WebSocket upgrade validation。
- control connect。
- dataChannel connect。
- ready 判断。
- tags/attachment restore。
- control close。
- data close。
- old connection rejection。
- public HTTP GET。
- public HTTP POST body。
- streaming response。
- public request cancel。
- public WebSocket text echo。
- public WebSocket binary echo。
- WebSocket close both directions。
- credit violation。
- invalid dataFrame。

建议命令：

```sh
pnpm -F @hostc/server test
```

## CLI 测试

包：`hostc`

必须覆盖：

- config path。
- config get/set/unset。
- `~/.hostc/config.json` 读写。
- config priority：
  - CLI 参数
  - env
  - config file
  - default
- server URL normalization。
- local host validation。
- dataChannels validation。
- createTunnel response parsing。
- refresh response parsing。
- reconnect backoff。
- control dispatch。
- dataFrame dispatch。
- HTTP local fetch proxy。
- WebSocket local proxy text。
- WebSocket local proxy binary。
- credit send/consume。
- token redaction。
- debug output 不泄漏 token。

建议命令：

```sh
pnpm -F hostc test
```

## E2E Local

local E2E 目标：证明 CLI + server + local service 能在本地跑通。

场景：

- HTTP GET。
- HTTP POST body。
- large upload。
- streaming response。
- slow response start。
- public client cancel。
- local server down。
- WebSocket text echo。
- WebSocket binary echo。
- WebSocket subprotocol selection。
- CLI reconnect。

建议命令：

```sh
pnpm test:e2e:local
```

或拆分到对应 package scripts。

## E2E Staging

staging 域名：

```text
envoq.dev
*.envoq.dev
```

目标：验证真实 Cloudflare edge、DNS、TLS、routes、Durable Objects、WebSocket upgrade。

必须覆盖：

- `POST https://envoq.dev/api/tunnels`。
- CLI 连接 staging。
- public URL 是 `https://<tunnelId>.envoq.dev`。
- HTTP GET。
- HTTP POST body。
- streaming response。
- WebSocket text echo。
- WebSocket binary echo。
- public WebSocket close。
- CLI reconnect。
- tunnel not ready error。

建议命令：

```sh
HOSTC_SERVER_URL=https://envoq.dev pnpm test:e2e:staging
```

或：

```sh
pnpm -F @hostc/server test:e2e:staging
```

## Bench

bench 不打真实网络，只测局部性能。

`@hostc/protocol` 必须提供：

- dataFrame encode 1 KiB。
- dataFrame encode 64 KiB。
- dataFrame decode 1 KiB。
- dataFrame decode 64 KiB。
- decode low-copy allocation check。
- control JSON parse/validate。
- selectDataChannel。
- credit helper。
- header filter。

建议命令：

```sh
pnpm -F @hostc/protocol bench
```

bench 输出至少包含：

```text
name
ops/sec 或 duration
payload size
memory/allocation note
node version
date
```

目标不是追求漂亮数字，而是建立 baseline，防止重构后退化。

## 本地压力测试

目标：不依赖 Cloudflare，压状态机和内存。

建议 fake server + fake CLI：

- 1000 streams。
- 每个 stream 64 KiB response。
- 随机 abort。
- 随机 data before start。
- 随机 end before last data。
- 小 credit window。
- dataChannel close。
- reconnect。

检查：

- 状态最终收敛。
- streams 清空。
- pendingData 不泄漏。
- credit 不为负。
- 内存增长可控。

## Staging Load Test

真实压测只打 staging，不打 production。

工具：

- HTTP 可用 `autocannon`、`k6`、`wrk`。
- WebSocket/tunnel 协议建议写自定义 Node load runner，因为需要模拟 CLI control/data。

场景：

- 1 CLI tunnel，HTTP 并发请求。
- 多 CLI tunnels，每个 tunnel 少量并发。
- large response download。
- large upload。
- WebSocket echo long-lived。
- WebSocket burst frames。
- reconnect storm。
- idle long connection。

指标：

- p50/p95/p99 latency。
- throughput bytes/sec。
- active tunnels。
- active streams。
- active WebSockets。
- reconnect rate。
- protocol error rate。
- 429/502/1011/1012 数量。
- DO logs 中的 stream abort rate。
- dataChannel bufferedAmount wait 次数。

建议命令：

```sh
pnpm -F @hostc/server load:staging
```

load test 输出要保存到可读文件，例如：

```text
artifacts/load/staging-YYYYMMDD-HHMM.json
```

## 验收顺序

推荐顺序：

```text
1. protocol unit tests
2. protocol state machine tests
3. protocol bench
4. server unit/integration tests
5. CLI unit tests
6. local E2E
7. staging deploy
8. staging E2E
9. staging load test
10. final pnpm build/test/lint
```

## Agent 注意事项

测试和 bench harness 可以交给 subagent，但必须遵守：

- 不修改已冻结协议 schema，除非主 agent 同意。
- load runner 不应依赖 production。
- staging token/secret 不进入 repo。
- 测试失败时必须保留失败输出摘要。
- 最终报告必须列出未覆盖风险。
