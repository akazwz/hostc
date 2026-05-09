# Server 重构规格

本文定义新的 `apps/server`，包名 `@hostc/server`。

## 目标

`apps/server` 是唯一服务端部署单元，运行在 Cloudflare Workers 上。

它负责：

- host 路由。
- tunnel API。
- token 签发与校验。
- control/data WebSocket 接入。
- public tunnel proxy。
- Durable Object tunnel 状态机。

它不负责：

- web/static assets。
- waitlist API。
- cli-error API。
- D1。
- Hono。
- Node.js compatibility。

## 技术约束

必须使用：

- Cloudflare Workers。
- Durable Objects。
- Web Crypto `crypto.subtle`。
- Web 标准 `Request`、`Response`、`ReadableStream`、`WebSocketPair`。
- `@hostc/protocol`。

禁止：

- `nodejs_compat`。
- `node:*` imports。
- `Buffer`。
- Hono。
- D1。
- Static Assets binding。

Wrangler 配置不应包含：

```jsonc
"compatibility_flags": ["nodejs_compat"]
```

## Host 路由

先按 host 分类，再按 path 路由。

```text
hostc.dev
  production app/API host

*.hostc.dev
  production public tunnel host

envoq.dev
  staging app/API host

*.envoq.dev
  staging public tunnel host

localhost / 127.0.0.1 / ::1 / *.localhost
  local app/API host

其他 host
  404
```

只接受一级 subdomain：

```text
abc.hostc.dev       -> tunnelId = abc
foo.bar.hostc.dev   -> 404
```

host 分类函数建议返回：

```ts
type HostRoute =
  | { kind: "app" }
  | { kind: "tunnel"; tunnelId: string }
  | { kind: "unknown" };
```

`tunnelId` 必须校验：

- DNS label 合法。
- 小写。
- 不包含点。
- 长度合法。
- 不是保留词，例如 `api`、`www`。

## API 路由

App host 下只保留 tunnel API：

```text
POST /api/tunnels
POST /api/tunnels/:tunnelId/refresh
GET  /api/tunnels/:tunnelId/control
GET  /api/tunnels/:tunnelId/data?channel=0&connectionId=...
GET  /health
```

`/health` 可选，但建议保留，用于部署和 staging 检查。

错误行为：

- unknown host -> 404。
- unknown API path -> 404。
- method mismatch -> 405 + `Allow`。
- non-WebSocket request to control/data -> 426。
- invalid tunnel id -> 400。
- missing/invalid token -> 403。
- invalid channel -> 400。

不要用模糊 `startsWith` 直接切业务逻辑。建议写独立 path parser。

## Create tunnel

`POST /api/tunnels`

职责：

- 生成 `tunnelId`。
- 生成 `connectionId`。
- 生成 `connectToken` 和 `refreshToken`。
- 返回 control/data URL、public URL、limits。

返回类型使用 `@hostc/protocol` 的 `CreateTunnelResponse`。

默认：

```text
dataChannels = 2
maxFrameBytes = 1 MiB
maxWebSocketMessageBytes = 1 MiB
streamCreditBytes = 1 MiB
connectionCreditBytes = 4 MiB
```

## Refresh tunnel

`POST /api/tunnels/:tunnelId/refresh`

职责：

- 校验 `refreshToken`。
- 为同一个 `tunnelId` 生成新的 `connectionId`。
- 签发新的 `connectToken` 和 `refreshToken`。
- 返回新的连接参数。

CLI 重连时必须走 refresh，不复用旧 `connectionId`。

## Token

使用自定义 HMAC-SHA-256 signed token，不使用 JWT 库。

格式：

```text
base64url(jsonPayload).base64url(hmacSha256(encodedPayload))
```

payload：

```ts
type TokenPayload = {
  v: 1;
  aud: "connect" | "refresh";
  tunnelId: string;
  connectionId?: string;
  exp: number;
  nonce: string;
};
```

规则：

- `TOKEN_SECRET` 来自 Wrangler secret。
- local dev 使用 `.dev.vars`。
- staging 使用 `wrangler secret put TOKEN_SECRET --env staging`。
- production 使用 `wrangler secret put TOKEN_SECRET`。
- secret 至少 32 bytes 随机值。
- token payload 不放敏感数据。
- verify 使用 `crypto.subtle.verify("HMAC", ...)`。
- key import 可以在 module global 缓存。
- 对外错误统一 403，内部结构化记录失败原因。

建议 TTL：

```text
connectToken: 60s
refreshToken: 10min
```

control/data WebSocket 必须优先使用：

```text
Authorization: Bearer <connectToken>
```

是否保留 query token fallback 由实现阶段决定。新协议默认不需要。

## Durable Object

一个 `tunnelId` 对应一个 named Durable Object。

```ts
env.HOSTC_TUNNEL.getByName(tunnelId)
```

DO 负责：

- 当前 `connectionId`。
- control socket。
- N 条 dataChannel。
- ready 判断。
- public HTTP/WebSocket stream 状态。
- credit 状态。
- pending data buffer。
- abort/close/reset。

## WebSocket tags

socket 身份以 tags + attachment 为权威。

control tags：

```text
control
conn:<connectionId>
```

data tags：

```text
data
conn:<connectionId>
ch:<channelId>
```

不要依赖内存 Map 作为 socket 身份事实来源。

## WebSocket attachment

control：

```ts
type ControlAttachment = {
  kind: "control";
  connectionId: string;
  dataChannels: number;
  createdAt: number;
};
```

data：

```ts
type DataAttachment = {
  kind: "data";
  connectionId: string;
  channelId: number;
  createdAt: number;
};
```

attachment 必须小于 Cloudflare 限制。Cloudflare 文档说明 WebSocket serialized attachment 最大为 2,048 bytes，并可跨 hibernation 保留，只要 WebSocket 仍健康。

## Durable storage

DO storage 只保存最小 durable state：

```text
currentConnectionId
expectedDataChannels
```

active stream 不要求跨 hibernation 恢复，因为 `ReadableStream` controller、pending Promise、public fetch resolver 都不是 durable state。

如果 DO 从 hibernation 恢复后发现 active stream runtime 丢失，应 abort/reset 相关 stream，不能假装仍可继续。

## Ready 判断

tunnel ready 必须同时满足：

```text
currentConnectionId 存在
存在 1 条 control socket
存在 N 条 data socket
channelId 覆盖 0..N-1
所有 socket attachment.connectionId 都等于 currentConnectionId
```

只有 ready 后才代理公网请求。

ready 不能只依赖 Map。应能通过：

```ts
this.ctx.getWebSockets("control")
this.ctx.getWebSockets(`conn:${connectionId}`)
```

和 attachment 重建。

## Connection 生命周期

### 新 control 接入

```text
校验 token 已在 Worker 完成
读取 currentConnectionId
关闭旧 connection 的所有 sockets
abort 所有 active streams
清空 pending data / credit
保存新的 currentConnectionId
accept control socket
serialize control attachment
等待 dataChannels 全部接入
```

### dataChannel 接入

```text
校验 connectionId === currentConnectionId
校验 channelId 合法
如果同 channel 已有 socket，关闭旧 socket
accept data socket
serialize data attachment
重新计算 ready
```

### control 断开

```text
如果不是 currentConnectionId，忽略
关闭同 connectionId 的所有 data sockets
清空 currentConnectionId
abort 所有 active streams
清空 pending data / credit
```

### dataChannel 断开

第一版使用严格策略：

```text
任意 dataChannel 断开
=> 当前 connection 失效
=> 关闭 control + 其他 dataChannels
=> abort active streams
=> 等待 CLI refresh/reconnect
```

不做单条 dataChannel 热恢复。

## Public HTTP 流程

```text
public request -> *.domain
Worker 提取 tunnelId
Worker 转发 request 到 DO
DO 检查 ready
DO 分配 streamId
DO 选择 channelId = streamId % dataChannels
DO control 发送 request.start
DO 读取 public request.body
DO 根据 credit 发送 dataFrame(request.body)
DO control 发送 request.end(lastSeq)
DO 等待 response.start
DO 创建 Response
DO 接收 dataFrame(response.body)
DO 将 payload enqueue 给 public response stream
DO 消费后发送 credit(response.body)
DO 收 response.end(lastSeq)
DO 关闭 public response stream
```

如果 public client 取消：

```text
DO control 发送 request.abort
DO abort stream
DO 清理 credit/pending data
```

## Public WebSocket 流程

```text
public WebSocket upgrade
DO 检查 ready
DO 分配 streamId
DO control 发送 request.start(kind="websocket")
DO 等待 response.start(status=101)
DO validate selected protocol
DO accept public WebSocket
public client frame -> dataFrame(ws.client) -> CLI
CLI frame -> dataFrame(ws.server) -> public WebSocket
client close -> request.end(kind=ws.client, code, reason, lastSeq)
server close -> response.end(kind=ws.server, code, reason, lastSeq)
```

WebSocket subprotocol 规则：

- DO 从 public request 读取 requested protocols。
- CLI 的 `response.start.protocol` 必须是 requested protocols 之一。
- 不合法则 reject upgrade。

## Control/data 乱序

唯一需要处理的乱序：

```text
control WS 消息
vs
dataChannel WS dataFrame
```

DO 和 CLI 都必须支持：

- data 先于 start 到达，进入有限 pendingData。
- end 先于最后 data 到达，根据 `lastSeq` 等待。
- 超时或超限 abort stream。
- start 未到时 pendingData 按 `streamId + dataKind` 记录。

## Credit

DO 侧既是发送方也是接收方。

发送方：

- `request.body`：DO -> CLI，消耗 CLI 给的 stream/connection credit。
- `ws.client`：DO -> CLI，消耗 CLI 给的 stream/connection credit。

接收方：

- `response.body`：CLI -> DO，DO 消费 public response stream 后给 CLI credit。
- `ws.server`：CLI -> DO，DO 成功写入 public WebSocket 后给 CLI credit。

所有 dataFrame 发送前检查：

```text
stream credit
connection credit
data socket readyState
data socket bufferedAmount
payload length <= maxFrameBytes
```

WebSocket message：

- public WebSocket message 大小必须 `<= maxWebSocketMessageBytes`。
- server 不做 WebSocket message fragment；一条 WS message 对应一个 `ws.client` dataFrame。
- 超过限制时关闭 public WebSocket stream，close code 使用 `1009 Message Too Big`，并通知 CLI 关闭本地 WebSocket。
- HTTP body 仍可按 `maxFrameBytes` chunk。

## 错误模型

对外：

- tunnel not ready：浏览器返回简单 HTML，非浏览器返回 JSON 502。
- invalid token：403。
- invalid tunnel id：400。
- not found：404。
- method mismatch：405。
- expected WebSocket upgrade：426。

内部：

- protocol error：关闭当前 connection。
- old connectionId data/control：关闭对应 socket。
- invalid dataFrame：关闭当前 connection。
- credit violation：关闭当前 connection。
- stream abort：只清理该 stream，除非是协议级错误。

## 日志

使用结构化 JSON：

```ts
{
  event: string;
  tunnelId?: string;
  connectionId?: string;
  streamId?: number;
  channelId?: number;
  dataKind?: string;
  status?: number;
  durationMs?: number;
  bytesIn?: number;
  bytesOut?: number;
  closeCode?: number;
  error?: string;
}
```

推荐事件：

- `server.request`
- `tunnel.created`
- `connection.control.connected`
- `connection.data.connected`
- `connection.ready`
- `connection.closed`
- `stream.request.start`
- `stream.response.start`
- `stream.end`
- `stream.abort`
- `protocol.error`
- `credit.grant`
- `credit.violation`

不要记录 token。

## Wrangler

要求：

- `compatibility_date` 使用实现当天或接近实现日期。
- `durable_objects.bindings` 声明 `HOSTC_TUNNEL`。
- migrations 使用 SQLite-backed Durable Objects。
- `observability.enabled = true`。
- staging 用 `env.staging`。
- 不使用 assets、D1、nodejs_compat。

详见 [deployment.md](./deployment.md)。

## 测试要求

详见 [testing.md](./testing.md)。server 必须至少覆盖：

- host 分类。
- API path parser。
- token verify。
- control/data connect。
- tags/attachment restore。
- ready 判断。
- control close。
- data close。
- HTTP tunnel。
- WebSocket tunnel。
- protocol error。
- credit violation。
