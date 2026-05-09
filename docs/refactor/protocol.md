# Protocol 规格

本文定义 `@hostc/protocol`。该包是 CLI 和 server 的共同线上契约。

## 包边界

`@hostc/protocol` 只负责：

- control JSON 类型、编码、解码、运行时校验。
- dataFrame binary layout、编码、解码、运行时校验。
- 协议常量、limits、close code、data kind、flags。
- credit 纯 helper。
- stream id、channel 选择、seq 校验等纯 helper。
- HTTP API response/request 的共享类型。
- header entries 与 WebSocket close reason 的平台无关工具。

它不负责：

- 创建 WebSocket。
- 发起 fetch。
- 访问 Cloudflare `Env`。
- 访问 Node `fs/path/http/crypto/Buffer`。
- 处理 Durable Object state。
- 处理 CLI spinner、日志、配置文件。

## Runtime 要求

必须满足：

- 纯 TypeScript。
- 纯 ESM。
- 零 Node built-in 依赖。
- 零 Cloudflare runtime 依赖。
- 不依赖 Hono、ws、fetch polyfill。
- 使用 Web 标准能力：`Uint8Array`、`ArrayBuffer`、`DataView`、`TextEncoder`、`TextDecoder`、`URL`。
- codec 以 low-copy 为目标。

禁止：

```ts
import { Buffer } from "node:buffer";
import crypto from "node:crypto";
```

## 核心名词

`tunnelId`  
一个公网 tunnel 的 ID，例如 `t-abc123`。

`publicUrl`  
公网访问 URL，例如 `https://t-abc123.hostc.dev`。

`connectionId`  
CLI 本次连接的一组 WebSocket 的 ID。它绑定 1 条 control 和 N 条 dataChannel。CLI 重连后必须换新的 `connectionId`。

`control`  
一条 WebSocket，只传 JSON text message。

`dataChannel`  
一条 WebSocket，只传 binary dataFrame。CLI 启动时建立 N 条。

`channelId`  
dataChannel 编号，从 `0` 到 `N - 1`。

`streamId`  
一次公网 HTTP 请求或一次公网 WebSocket 连接的 ID。只由 server 分配。

`dataFrame`  
dataChannel 上发送的一个二进制消息，只搬 payload 字节。

`dataKind`  
dataFrame 的方向和用途。

`credit`  
接收方允许发送方继续发送的字节额度。

## 默认常量

建议默认值：

```ts
export const PROTOCOL_VERSION = 3;
export const DEFAULT_DATA_CHANNELS = 2;
export const MAX_DATA_CHANNELS = 8;
export const DEFAULT_MAX_WEBSOCKET_MESSAGE_BYTES = 1024 * 1024;
export const DEFAULT_MAX_FRAME_BYTES = DEFAULT_MAX_WEBSOCKET_MESSAGE_BYTES;
export const DEFAULT_MAX_CONTROL_BYTES = 64 * 1024;
export const DEFAULT_STREAM_CREDIT_BYTES = DEFAULT_MAX_WEBSOCKET_MESSAGE_BYTES;
export const DEFAULT_CONNECTION_CREDIT_BYTES = 4 * 1024 * 1024;
export const DEFAULT_PENDING_DATA_BYTES = DEFAULT_CONNECTION_CREDIT_BYTES;
export const DEFAULT_PENDING_DATA_TIMEOUT_MS = 120_000;
```

具体值可以在实现和压测后调整，但协议必须支持这些概念。

## HTTP API 类型

创建 tunnel 返回：

```ts
export type CreateTunnelResponse = {
  tunnelId: string;
  publicUrl: string;
  connectionId: string;
  controlUrl: string;
  dataUrl: string;
  connectToken: string;
  refreshToken: string;
  dataChannels: number;
  limits: TunnelLimits;
};
```

刷新 tunnel 返回：

```ts
export type RefreshTunnelResponse = {
  connectionId: string;
  controlUrl: string;
  dataUrl: string;
  connectToken: string;
  refreshToken: string;
  dataChannels: number;
  limits: TunnelLimits;
};
```

limits：

```ts
export type TunnelLimits = {
  maxFrameBytes: number;
  maxWebSocketMessageBytes: number;
  maxControlBytes: number;
  streamCreditBytes: number;
  connectionCreditBytes: number;
  pendingDataBytes: number;
  pendingDataTimeoutMs: number;
};
```

## Control JSON

control message 只表达流程，不传 body。

```ts
export type ControlMessage =
  | RequestStartMessage
  | RequestEndMessage
  | RequestAbortMessage
  | ResponseStartMessage
  | ResponseEndMessage
  | ResponseAbortMessage
  | CreditMessage;
```

### `request.start`

server -> CLI。表示公网请求开始。

```ts
export type RequestStartMessage = {
  type: "request.start";
  id: number;
  kind: "http" | "websocket";
  method: string;
  url: string;
  headers: HeaderEntry[];
  body: boolean;
  protocols?: string[];
};
```

HTTP 请求：

```json
{
  "type": "request.start",
  "id": 101,
  "kind": "http",
  "method": "POST",
  "url": "/upload",
  "headers": [["content-type", "application/octet-stream"]],
  "body": true
}
```

WebSocket upgrade：

```json
{
  "type": "request.start",
  "id": 102,
  "kind": "websocket",
  "method": "GET",
  "url": "/socket",
  "headers": [],
  "body": false,
  "protocols": ["chat"]
}
```

### `request.end`

server -> CLI。表示公网 request body 结束，或 public WebSocket client 侧关闭。

```ts
export type RequestEndMessage = {
  type: "request.end";
  id: number;
  kind: "request.body" | "ws.client";
  lastSeq: number;
  code?: number;
  reason?: string;
};
```

HTTP request body 结束：

```json
{
  "type": "request.end",
  "id": 101,
  "kind": "request.body",
  "lastSeq": 7
}
```

WebSocket client 关闭：

```json
{
  "type": "request.end",
  "id": 102,
  "kind": "ws.client",
  "lastSeq": 12,
  "code": 1000,
  "reason": "done"
}
```

### `request.abort`

server -> CLI。表示公网请求取消或失败。

```ts
export type RequestAbortMessage = {
  type: "request.abort";
  id: number;
  reason: string;
};
```

### `response.start`

CLI -> server。表示本地服务开始响应。

```ts
export type ResponseStartMessage = {
  type: "response.start";
  id: number;
  status: number;
  headers: HeaderEntry[];
  body: boolean;
  protocol?: string;
};
```

HTTP response：

```json
{
  "type": "response.start",
  "id": 101,
  "status": 200,
  "headers": [["content-type", "text/plain"]],
  "body": true
}
```

WebSocket accept：

```json
{
  "type": "response.start",
  "id": 102,
  "status": 101,
  "headers": [],
  "body": false,
  "protocol": "chat"
}
```

### `response.end`

CLI -> server。表示本地 response body 结束，或 local WebSocket server 侧关闭。

```ts
export type ResponseEndMessage = {
  type: "response.end";
  id: number;
  kind: "response.body" | "ws.server";
  lastSeq: number;
  code?: number;
  reason?: string;
};
```

### `response.abort`

CLI -> server。表示本地响应失败或中断。

```ts
export type ResponseAbortMessage = {
  type: "response.abort";
  id: number;
  reason: string;
};
```

### `credit`

接收方 -> 发送方。表示还可以继续发送多少字节。

```ts
export type CreditMessage = {
  type: "credit";
  scope: "stream" | "connection";
  id?: number;
  kind?: DataKind;
  bytes: number;
};
```

stream credit：

```json
{
  "type": "credit",
  "scope": "stream",
  "id": 101,
  "kind": "response.body",
  "bytes": 65536
}
```

connection credit：

```json
{
  "type": "credit",
  "scope": "connection",
  "bytes": 1048576
}
```

规则：

- `scope = "stream"` 时，必须有 `id` 和 `kind`。
- `scope = "connection"` 时，不允许有 `id` 和 `kind`。
- `bytes` 必须是正整数。

## DataFrame Binary Layout

dataFrame 是 dataChannel 上的一条完整 binary WebSocket message。

header 固定 17 bytes：

```text
offset  size  field
0       2     magic = "HC"
2       1     protocol version
3       1     kind code
4       1     flags
5       4     stream id, uint32, network byte order
9       4     seq, uint32, network byte order
13      4     payload length, uint32, network byte order
17      n     payload
```

`network byte order` 表示 big-endian。

data kind：

```ts
export type DataKind =
  | "request.body"
  | "response.body"
  | "ws.client"
  | "ws.server";
```

建议编码：

```text
1 = request.body
2 = response.body
3 = ws.client
4 = ws.server
```

flags：

```text
0x00 = none
0x01 = websocket text payload
0x02 = websocket binary payload
```

HTTP body 不使用 text/binary flags。WebSocket data 必须二选一。

## Seq 和 lastSeq

`seq` 规则：

- 每个 `streamId + dataKind` 独立从 `0` 开始。
- 发送方每发送一个 dataFrame，seq 加一。
- 接收方只检查连续性。
- 不做乱序重排。
- 如果同一个 `streamId + dataKind` 收到不连续 seq，视为 protocol error。

`lastSeq` 规则：

- `request.end` 或 `response.end` 必须包含该方向最后一个 dataFrame 的 seq。
- 如果该方向没有 dataFrame，`lastSeq` 使用 `-1`。
- end 只走 control，不放在 dataFrame flags 里。

原因：

- 同一条 dataChannel 内顺序由 WebSocket 保证。
- control 和 dataChannel 是不同连接，可能乱序。
- `lastSeq` 用于判断 end 到达时是否已经消费完该方向所有 dataFrame。

## Data channel 选择

同一个 `streamId` 固定到同一条 dataChannel：

```ts
channelId = streamId % dataChannels;
```

协议包必须提供：

```ts
export function selectDataChannel(streamId: number, dataChannels: number): number;
```

如果未来要分离 request/response channel，再通过新协议版本变更。v3 不做。

## Credit 规则

发送 dataFrame 前必须同时满足：

```text
streamCredit(streamId, dataKind) >= payload length
connectionCredit(connectionId) >= payload length
dataChannel bufferedAmount below local threshold
payload length <= maxFrameBytes
```

WebSocket message 限制：

- `ws.client` / `ws.server` 不做 fragment/reassembly。
- 单条 WebSocket message 必须作为单个 dataFrame 发送。
- `payload length <= maxWebSocketMessageBytes`，默认 1 MiB。
- 超过限制时必须关闭该 WebSocket stream，close code 使用 `1009 Message Too Big`，不得发送半截 message。
- HTTP request/response body 是 byte stream，可以继续按 `maxFrameBytes` chunk。

发送后：

```text
streamCredit -= payload length
connectionCredit -= payload length
```

接收方只有在下游真正消费 payload 后才归还 credit：

- CLI 消费 `request.body` 后，给 server 发 `credit(request.body)`。
- server 消费 `response.body` 后，给 CLI 发 `credit(response.body)`。
- CLI 成功写入 local WebSocket 后，给 server 发 `credit(ws.client)`。
- server 成功写入 public WebSocket 后，给 CLI 发 `credit(ws.server)`。

`bufferedAmount` 只做本地发送节流，不替代 credit。

## Low-copy API

协议包必须提供简单 API 和高性能 API。

简单 API：

```ts
export function encodeDataFrame(frame: DataFrame): Uint8Array;
export function decodeDataFrame(bytes: Uint8Array): DecodedDataFrame | null;
```

高性能 API：

```ts
export function encodeDataFrameHeader(meta: DataFrameMeta): Uint8Array;
export function decodeDataFrameView(bytes: Uint8Array): DecodedDataFrame | null;
```

要求：

- `decodeDataFrameView` 返回的 `payload` 必须是原始 `bytes.subarray(17)`，不得复制 payload。
- oversized chunk 切片使用 `subarray`，不得复制。
- 协议包不强制把多个小 chunk concat 成一个 frame。
- `maxFrameBytes` 是 dataFrame payload 上限，不是目标大小；默认 1 MiB，用于允许 1 MiB WebSocket message 单帧通过。
- HTTP runtime 可以选择更小 chunk；WebSocket runtime 不得把单条 message 拆成多条业务 message。
- 发送端若必须合并 header + payload，由 runtime adapter 决定。

## Control parser

必须提供：

```ts
export function encodeControlMessage(message: ControlMessage): string;
export function decodeControlMessage(raw: string): ControlMessage | null;
export function isControlMessage(value: unknown): value is ControlMessage;
```

要求：

- 超过 `maxControlBytes` 的 raw message 必须拒绝。
- 未知 type 拒绝。
- 未知字段可以忽略或拒绝，但必须在实现中统一。建议拒绝关键对象上的明显非法字段。
- header count、header name/value、url、reason 都要有长度限制。

## HeaderEntry

协议层只使用平台无关 entries：

```ts
export type HeaderEntry = readonly [name: string, value: string];
```

不使用 `Headers` 类型作为协议 API 入参。server/CLI 自己转换。

必须提供 hop-by-hop header filter：

```ts
export function filterHttpRequestHeaders(headers: readonly HeaderEntry[]): HeaderEntry[];
export function filterWebSocketRequestHeaders(headers: readonly HeaderEntry[]): HeaderEntry[];
export function filterResponseHeaders(headers: readonly HeaderEntry[]): HeaderEntry[];
```

## ID 校验

```ts
export function isValidStreamId(id: unknown): id is number;
export function isValidChannelId(id: unknown, dataChannels: number): id is number;
export function isValidSeq(seq: unknown): seq is number;
```

规则：

- `streamId` 是正整数，范围 `1..0xffffffff`。
- `channelId` 是整数，范围 `0..dataChannels - 1`。
- `seq` 是整数，范围 `0..0xffffffff`。
- `lastSeq` 可以是 `-1` 或合法 seq。

## Close 和错误常量

协议包定义公共常量：

```ts
export const CLOSE_NORMAL = 1000;
export const CLOSE_PROTOCOL_ERROR = 1002;
export const CLOSE_UNSUPPORTED_DATA = 1003;
export const CLOSE_TUNNEL_REPLACED = 1012;
export const CLOSE_INTERNAL_ERROR = 1011;
```

并提供：

```ts
export function normalizeWebSocketCloseCode(code: unknown): number;
export function normalizeWebSocketCloseReason(reason: unknown): string;
```

reason 最长 123 bytes。

## 测试要求

协议包必须覆盖：

- control encode/decode。
- 所有 control message validator。
- dataFrame encode/decode。
- invalid magic/version/kind/flags/id/seq/length。
- maxFrameBytes。
- low-copy decode。
- selectDataChannel。
- credit grant/consume helper。
- close code/reason。
- header filter。
- 随机 payload roundtrip。

更多测试要求见 [testing.md](./testing.md)。
