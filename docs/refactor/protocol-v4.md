# hostc tunnel protocol v4

最后更新：2026-05-09

本文定义 hostc tunnel protocol v4。v4 是下一次协议重构要实现的正式传输协议。

v4 的核心设计是：没有 `controlChannel`，只有 N 条 `dataChannel` WebSocket。每个 public 请求都会创建一个 `stream`，该 `stream` 在创建时绑定到一条 `dataChannel`，并且完整生命周期内只在这条 `dataChannel` 上传输。

## 核心规则

- 移除 `controlChannel`。
- 只保留 N 条 `dataChannel` WebSocket。
- 每个 public HTTP 请求或 public WebSocket 连接创建一个 `stream`。
- `stream` 创建时由 server 分配 `streamId` 并选择一条 `dataChannel`。
- `stream.start` 出现在哪条 `dataChannel`，该 `stream` 就绑定哪条 `dataChannel`。
- 同一个 `stream` 的 `start`、`data`、`end`、`abort`、`credit` 都必须走同一条 `dataChannel`。
- `stream-level` 错误只关闭该 `stream`。
- 协议错误、active `dataChannel` 关闭、active `clientConnection` 错误才关闭整个 `clientConnection`。

核心不变量：

```text
一个 stream 在整个生命周期内只绑定一条 dataChannel。
```

## 名词

协议只使用以下核心名词：

| 名词 | 含义 |
| --- | --- |
| `tunnel` | 一条 public tunnel，通常对应一个 public URL 和一个 Durable Object。 |
| `clientConnection` | 一个正在运行的 hostc CLI 和 tunnel 之间的一次连接会话。 |
| `dataChannel` | `clientConnection` 内的一条真实 WebSocket。 |
| `stream` | tunnel 内的一次 public HTTP 请求或 public WebSocket 会话。 |

不要引入这些同义词：

- `session`
- `control connection`
- `control socket`
- `runtime connection`

推荐代码命名：

```ts
type TunnelId = string;
type ClientConnectionId = string;
type ChannelId = number;
type StreamId = bigint;
```

## 层级关系

```text
tunnel
  activeClientConnection
    dataChannel 0
    dataChannel 1
    dataChannel N
    streams
      stream 1 -> dataChannel 0
      stream 2 -> dataChannel 1
      stream 3 -> dataChannel 0
```

说明：

- `dataChannel` 是真实 WebSocket。
- `stream` 是逻辑请求，不是真实 socket。
- `stream.channelId` 是 `StreamState` 的一部分。
- `stream` 不是 `dataChannel` 的子对象，但它会绑定到某条 `dataChannel`。

## v4 MVP 非目标

v4 MVP 不实现：

- `controlChannel`。
- WebSocket 内的 `hello` 消息。
- 应用层 `ping/pong`。
- `stream` 恢复。
- `dataChannel` 恢复。
- 同一个 `stream` 跨 `dataChannel` 迁移。
- 多版本 fallback。
- 匿名 tunnel token refresh。
- 用户账号体系。

WebSocket upgrade 成功即表示该 `dataChannel` ready。

CLI 断线后重新创建 ephemeral tunnel。v4 不保留 public URL。后续版本如果支持 reserved tunnel，仍必须遵守 active `clientConnection` replacement 规则。

## ID 规则

### tunnelId

`tunnelId` 是 public URL 的一部分，必须随机、不可预测、URL-safe。

示例：

```text
t-k9x2p7q4mc
```

| 字段 | 规则 |
| --- | --- |
| 可见性 | public |
| 生成方 | server |
| 推荐格式 | `t-` + 10 到 12 位 base32/base36 随机字符 |
| 是否递增 | 否 |
| 是否复用 | 否 |

### clientConnectionId

`clientConnectionId` 表示 CLI 到 tunnel 的一次连接会话。

CLI 每次重新创建连接，都必须使用新的 `clientConnectionId`。

| 字段 | 规则 |
| --- | --- |
| 可见性 | private-ish，出现在 channel URL 或 token payload 中 |
| 生成方 | server |
| 推荐格式 | `c-` + 随机字符 |
| 是否递增 | 否 |
| 是否复用 | 否 |

每个 tunnel 同一时间只有一个 active `clientConnection`：

```text
activeClientConnectionId = c-new
```

旧 `clientConnection` 的任何 message、close、error 都不能修改 active `clientConnection` state。

### channelId

`channelId` 是 `clientConnection` 内的 `dataChannel` 编号。

| 字段 | 规则 |
| --- | --- |
| 作用域 | clientConnection |
| 生成方 | server 返回 `dataChannels`，CLI 按范围连接 |
| 范围 | `0..dataChannels - 1` |
| 是否递增 | 固定小整数 |

### streamId

`streamId` 表示一次 public HTTP 请求或 public WebSocket 会话。

| 字段 | 规则 |
| --- | --- |
| 作用域 | clientConnection |
| 生成方 | server |
| 类型 | unsigned 64-bit integer |
| 有效范围 | `1..2^64-1` |
| `0` | 保留给 channel-level frame |
| 是否递增 | 是 |
| 是否复用 | 同一个 clientConnection 内不得复用 |
| 回绕 | 不回绕，耗尽时关闭 clientConnection |

完整唯一身份是：

```text
tunnelId + clientConnectionId + streamId
```

## 创建 tunnel

匿名临时 tunnel 使用：

```text
POST /api/tunnels/ephemeral
```

请求 body 可以为空。

响应：

```json
{
  "kind": "ephemeral",
  "protocolVersion": 4,
  "tunnelId": "t-k9x2p7q4mc",
  "publicUrl": "https://t-k9x2p7q4mc.envoq.dev",
  "clientConnectionId": "c-r5qq8fxn",
  "dataUrl": "wss://envoq.dev/api/tunnels/t-k9x2p7q4mc/channels",
  "connectToken": "signed.token",
  "dataChannels": 2,
  "limits": {
    "maxFrameBytes": 1048576,
    "maxMetadataBytes": 65536,
    "maxWebSocketMessageBytes": 1048576,
    "streamCreditBytes": 1048576,
    "channelCreditBytes": 4194304,
    "pendingDataBytes": 4194304,
    "pendingDataTimeoutMs": 120000
  }
}
```

v4 相对 v3 的变化：

| v3 | v4 |
| --- | --- |
| `connectionId` | `clientConnectionId` |
| `controlUrl` | 移除 |
| `dataUrl` | 保留 |
| `dataChannels` | 保留 |

## 连接 dataChannel

CLI 收到 create response 后，打开 `dataChannels` 条 WebSocket。

Endpoint：

```text
GET /api/tunnels/:tunnelId/channels/:channelId?clientConnectionId=...
Authorization: Bearer <connectToken>
Upgrade: websocket
```

示例：

```text
GET /api/tunnels/t-k9x2p7q4mc/channels/0?clientConnectionId=c-r5qq8fxn
GET /api/tunnels/t-k9x2p7q4mc/channels/1?clientConnectionId=c-r5qq8fxn
```

WebSocket upgrade 成功表示该 `dataChannel` ready。

tunnel ready 条件：

```text
activeClientConnectionId 存在
所有 channelId 0..dataChannels-1 都有 OPEN WebSocket
所有 dataChannel 都属于 activeClientConnectionId
```

如果 tunnel 未 ready：

| 请求类型 | 响应 |
| --- | --- |
| 浏览器 HTML 请求 | 502 HTML |
| API/fetch 请求 | 502 JSON |
| public WebSocket | close 或 502 |

## clientConnection 替换

当新的 `clientConnection` 被接受：

```text
activeClientConnectionId = newClientConnectionId
```

server 必须：

- 关闭旧 `clientConnection` 的所有 `dataChannel`。
- abort 旧 `clientConnection` 的 active streams。
- 清空旧 `clientConnection` 的 credit 和 pending state。
- 忽略旧 `clientConnection` 后续 message、close、error。

必须满足：

```text
只有当前 active clientConnection 能修改 tunnel state。
```

旧连接事件处理规则：

| 事件 | 处理 |
| --- | --- |
| 旧 clientConnection message | ignore 或 close old channel |
| 旧 clientConnection close | ignore |
| 旧 clientConnection error | ignore |
| 旧 clientConnection stream frame | ignore 或 close old channel |

## stream 分配

public 请求进入 tunnel 后：

```text
server 创建 stream
server 分配 streamId
server 选择 dataChannel
server 记录 stream.channelId
server 在该 dataChannel 上发送 request.start
```

channel 选择策略：

```text
MVP 可以使用 round-robin 或 leastBufferedChannel
```

协议禁止依赖：

```text
channelId = streamId % dataChannels
```

可以用 round-robin 作为实现策略，但协议事实必须是：

```text
stream.start 出现在哪个 dataChannel，这个 stream 就绑定哪个 dataChannel。
```

同一 `stream` 的所有后续 frame 必须继续走同一条 `dataChannel`。

如果同一 `stream` 出现在其他 `dataChannel`：

```text
protocol error
关闭 clientConnection
```

## Frame 格式

所有 `dataChannel` message 都是 binary frame。

不使用 text WebSocket message。

Frame header：

```text
offset  size  field
0       1     magic0 = 0x48
1       1     magic1 = 0x43
2       1     protocolVersion = 4
3       1     frameType
4       1     flags
5       8     streamId, uint64, network byte order
13      8     seq, uint64, network byte order
21      4     payloadLength, uint32, network byte order
25      N     payload
```

字段规则：

| 字段 | 规则 |
| --- | --- |
| `streamId` | stream frame 必须是 `1..2^64-1` |
| `streamId = 0` | 只允许 channel-level frame |
| `seq` | data frame 使用；metadata frame 必须为 `0` |
| `payloadLength` | 不得超过 `maxFrameBytes` |
| `frameType` | 未知值是 protocol error |
| text message | protocol error |

## Frame 类型

| frameType | 名称 | 方向 | payload |
| --- | --- | --- | --- |
| `0x10` | `request.start` | server -> CLI | JSON |
| `0x11` | `request.data` | server -> CLI | raw bytes |
| `0x12` | `request.end` | server -> CLI | JSON |
| `0x13` | `request.abort` | server -> CLI | JSON |
| `0x20` | `response.start` | CLI -> server | JSON |
| `0x21` | `response.data` | CLI -> server | raw bytes |
| `0x22` | `response.end` | CLI -> server | JSON |
| `0x23` | `response.abort` | CLI -> server | JSON |
| `0x30` | `stream.credit` | both | JSON |
| `0x31` | `channel.credit` | both | JSON |

方向错误是 protocol error。

## channel-level frame

`channel-level frame` 不表示需要 `controlChannel`。

它只是表示：某个 frame 作用于当前这条 `dataChannel`，不属于任何 `stream`。

规则：

```text
streamId = 0 表示 channel-level frame
streamId > 0 表示 stream-level frame
```

v4 MVP 只定义一个 channel-level frame：

```text
channel.credit
```

`channel.credit` 只影响当前 `dataChannel` 的 credit window，不能操作任何 `stream`。

## Metadata payload

所有 JSON payload 必须使用 UTF-8 编码，并由 `@hostc/protocol` 做运行时校验。

JSON payload 大小不得超过 `maxMetadataBytes`。

### request.start

HTTP：

```json
{
  "kind": "http",
  "method": "POST",
  "target": "/upload?index",
  "headers": [["content-type", "application/octet-stream"]],
  "hasBody": true
}
```

WebSocket：

```json
{
  "kind": "websocket",
  "method": "GET",
  "target": "/socket",
  "headers": [],
  "hasBody": false,
  "protocols": ["chat"]
}
```

字段规则：

| 字段 | 规则 |
| --- | --- |
| `target` | 必须是 origin-form path，必须以 `/` 开头，不允许 `//` 或反斜杠 |
| `headers` | 已过滤 hop-by-hop headers |
| `protocols` | 只用于 WebSocket |
| `hasBody` | HTTP request body 是否存在 |

### request.end

HTTP 有 body：

```json
{
  "kind": "request.body",
  "lastSeq": 3
}
```

HTTP 无 body：

```json
{
  "kind": "request.body",
  "lastSeq": -1
}
```

public WebSocket 关闭：

```json
{
  "kind": "ws.client",
  "lastSeq": 12,
  "code": 1000,
  "reason": "closed"
}
```

### request.abort

```json
{
  "reason": "public client cancelled"
}
```

含义：public side 不再需要这个 stream。收到后应该关闭本地请求或本地 WebSocket，并清理 stream。

### response.start

HTTP：

```json
{
  "status": 200,
  "headers": [["content-type", "text/plain"]],
  "hasBody": true
}
```

WebSocket accept：

```json
{
  "status": 101,
  "headers": [],
  "hasBody": false,
  "protocol": "chat"
}
```

字段规则：

| 字段 | 规则 |
| --- | --- |
| `status` | HTTP 不能是 `101`；WebSocket 必须是 `101` |
| `headers` | 已过滤 hop-by-hop headers |
| `protocol` | 必须是 `request.start.protocols` 中的一个 |

### response.end

HTTP：

```json
{
  "kind": "response.body",
  "lastSeq": 7
}
```

local WebSocket 关闭：

```json
{
  "kind": "ws.server",
  "lastSeq": 4,
  "code": 1000,
  "reason": "closed"
}
```

### response.abort

```json
{
  "reason": "local server unavailable"
}
```

含义：local side 无法处理这个 stream。收到后 server 应该给 public client 返回 stream-level 错误，并清理 stream。

### stream.credit

```json
{
  "kind": "response.body",
  "bytes": 65536
}
```

字段规则：

| 字段 | 规则 |
| --- | --- |
| `streamId` | 来自 frame header，必须大于 `0` |
| `kind` | 必须是 data kind |
| `bytes` | 正整数 |

### channel.credit

```json
{
  "bytes": 1048576
}
```

字段规则：

| 字段 | 规则 |
| --- | --- |
| `streamId` | 必须为 `0` |
| `bytes` | 正整数 |

## Data kind

| data kind | frame | 方向 |
| --- | --- | --- |
| `request.body` | `request.data` | server -> CLI |
| `response.body` | `response.data` | CLI -> server |
| `ws.client` | `request.data` | server -> CLI |
| `ws.server` | `response.data` | CLI -> server |

`data kind` 由 stream kind 和 frame 方向推导。

HTTP stream：

| frame | data kind |
| --- | --- |
| `request.data` | `request.body` |
| `response.data` | `response.body` |

WebSocket stream：

| frame | data kind |
| --- | --- |
| `request.data` | `ws.client` |
| `response.data` | `ws.server` |

WebSocket text/binary 使用 `flags` 表示：

| flag | 含义 |
| --- | --- |
| `0x01` | WebSocket text |
| `0x02` | WebSocket binary |

HTTP body frame 必须使用：

```text
flags = 0
```

## Sequence 规则

每个 `streamId + dataKind` 都有独立的 `seq`。

| 场景 | 规则 |
| --- | --- |
| 第一个 data frame | `seq = 0` |
| 下一个 data frame | `seq = previous + 1` |
| empty body | 不发送 data frame，`lastSeq = -1` |
| 有 data 的 end | `lastSeq = final seq` |
| end 后继续收到 data | 按状态机处理，通常是 stream-level ignore 或 protocol error |
| seq gap | protocol error |
| duplicate seq | protocol error |

因为 `request.start`、`request.data`、`request.end` 由同一发送方在同一条 `dataChannel` 上发送，接收方不需要为 request body 做跨 channel pending buffer。

因为 `response.start`、`response.data`、`response.end` 由同一发送方在同一条 `dataChannel` 上发送，接收方不需要为 response body 做跨 channel pending buffer。

## HTTP stream 生命周期

HTTP stream 允许 local response 在 request body 完全消费前开始返回。

状态：

| state | 含义 |
| --- | --- |
| `requestStarted` | server 已发送 `request.start` |
| `requestEnded` | request side 已结束 |
| `responseStarted` | response side 已开始 |
| `responseEnded` | response side 已结束 |
| `closed` | request side 和 response side 都结束 |
| `aborted` | stream 已异常终止 |

事件规则：

| Event | 允许条件 | 结果 |
| --- | --- | --- |
| `request.start` | stream unknown | 创建 stream |
| `request.data` | request side open 且 `hasBody = true` | 写入 local request body |
| `request.end` | request side open | 关闭 local request body |
| `request.abort` | stream active | abort local request 并 cleanup |
| `response.start` | stream active | 创建 public response |
| `response.data` | response started 且允许 body | 写入 public response body |
| `response.end` | response side open | 关闭 public response |
| `response.abort` | stream active | 返回 stream-level 错误 |

stream 关闭条件：

```text
request side ended or aborted
response side ended or aborted
```

public 浏览器取消：

```text
server 标记 stream aborted
server 发送 request.abort
server 清理 public request/response 资源
后续该 stream 的迟到 response frame 直接忽略
```

local upstream 失败：

```text
CLI 发送 response.abort
CLI 清理 stream
server 返回 stream-level 502
clientConnection 保持打开
```

## WebSocket stream 生命周期

WebSocket stream 以 `request.start kind="websocket"` 开始。

CLI 使用 `response.start status=101` 接受。

状态：

| state | 含义 |
| --- | --- |
| `connecting` | 已发送 request，等待 local WebSocket accept |
| `open` | public WebSocket 和 local WebSocket 都已打开 |
| `clientHalfClosed` | public side 已关闭 |
| `serverHalfClosed` | local side 已关闭 |
| `closed` | 两边都已关闭 |
| `aborted` | stream 已异常终止 |

事件规则：

| Event | 允许条件 | 结果 |
| --- | --- | --- |
| `request.start websocket` | stream unknown | 连接 local WebSocket |
| `response.start 101` | connecting | 接受 public WebSocket |
| `request.data` | open 或 serverHalfClosed | 发送到 local WebSocket |
| `response.data` | open 或 clientHalfClosed | 发送到 public WebSocket |
| `request.end ws.client` | open 或 serverHalfClosed | 关闭 local WebSocket 对应方向 |
| `response.end ws.server` | open 或 clientHalfClosed | 关闭 public WebSocket |
| `request.abort` | stream active | abort local WebSocket |
| `response.abort` | stream active | abort public WebSocket |

WebSocket message size 规则：

```text
WebSocket message payload 必须完整放在一个 protocol frame 中。
```

如果 WebSocket message 超过 `maxWebSocketMessageBytes`：

```text
关闭该 WebSocket stream，close code 使用 1009
不拆分该 WebSocket message
不关闭 clientConnection，除非对端持续违反协议
```

## Flow control

flow control 使用 credit。

每个方向有两层 window：

| window | 作用 |
| --- | --- |
| stream credit | 限制单个 `stream + dataKind` 的未消费 bytes |
| channel credit | 限制单条 `dataChannel` 的总未消费 bytes |

发送 data frame 前，发送方必须同时满足：

```text
streamCredit(streamId, dataKind) >= payloadLength
channelCredit(channelId) >= payloadLength
```

发送后：

```text
streamCredit -= payloadLength
channelCredit -= payloadLength
```

接收方只能在 payload 被下一层 consumer 接受后归还 credit：

| 接收方 | 归还 credit 的时机 |
| --- | --- |
| CLI HTTP request body | local request writer 接受 bytes 后 |
| CLI local WebSocket send | local WebSocket 接受 bytes 且 backpressure 低于阈值后 |
| server HTTP response body | public response stream 接受 bytes 后 |
| server public WebSocket send | public WebSocket 接受 bytes 且 backpressure 低于阈值后 |

JS 实现中 credit 不得超过：

```text
Number.MAX_SAFE_INTEGER
```

credit violation 是 protocol error。

## Backpressure

每条 `dataChannel` 必须观察 WebSocket buffered amount。

推荐阈值：

```text
highWatermark = 512 KiB
lowWatermark = 128 KiB
```

如果 channel buffered amount 超过 high watermark：

```text
暂停该 channel 上的发送
降到 low watermark 以下再恢复
```

backpressure 必须是 per-channel。

`dataChannel 0` 的 backpressure 不得阻塞 `dataChannel 1`。

## Error level

### stream-level error

`stream-level error` 只影响一个 stream。

| Error | Action |
| --- | --- |
| public client cancelled | 发送 `request.abort`，cleanup stream |
| local HTTP fetch failed | 发送 `response.abort`，cleanup stream |
| local WebSocket rejected | 发送 `response.abort`，cleanup stream |
| public WebSocket closed | 发送 `request.end`，等待 peer end 后 cleanup stream |
| local WebSocket closed | 发送 `response.end`，等待 peer end 后 cleanup stream |
| response start timeout | abort stream |
| recently closed stream 的迟到 frame | ignore |

`stream-level error` 不得关闭 `clientConnection`。

### protocol error

`protocol error` 会关闭 `clientConnection`。

| Error | Action |
| --- | --- |
| invalid frame magic/version | close clientConnection |
| text WebSocket message | close clientConnection |
| unknown frame type | close clientConnection |
| invalid JSON metadata | close clientConnection |
| frame exceeds hard limit | close clientConnection |
| stream appears on wrong dataChannel | close clientConnection |
| seq discontinuity | close clientConnection |
| credit violation | close clientConnection |
| wrong frame direction | close clientConnection |
| old clientConnection attempts to mutate active state | close old channel or ignore |

### channel close

v4 MVP 规则：

```text
任何 active dataChannel close 都会使 active clientConnection 失效。
```

server action：

```text
关闭 activeClientConnectionId 的所有 dataChannel
abort 所有 active stream
清空 activeClientConnectionId
等待 CLI 创建新的 ephemeral tunnel
```

CLI action：

```text
关闭所有本地 dataChannel
abort active local stream
创建新的 ephemeral tunnel
连接新的 dataChannel
输出新的 publicUrl
```

v4 MVP 不实现“只 abort 某条 channel 上的 streams，保留其他 channels”。

## 关闭 stream

关闭 stream 不是关闭 `dataChannel`。

关闭 stream 时，两端都必须清理：

```text
streams.delete(streamId)
credit.deleteStream(streamId)
pendingFrames.delete(streamId)
closedStreamTombstones.add(streamId)
```

HTTP stream 还需要：

```text
abort/cancel local fetch
close/abort request body writer
close/error public response stream
```

WebSocket stream 还需要：

```text
close public WebSocket
close local WebSocket
```

收到 `request.abort` 或 `response.abort` 后，可以直接清理整个 stream。

除非关闭原因本身是 protocol error，否则不得关闭 `dataChannel` 或 `clientConnection`。

## Closed stream tombstone

CLI 和 server 都应该保留一个有上限的 recently closed stream tombstone set。

目的：

```text
closed stream 的迟到 frame 直接忽略，不进入 pending buffer，也不关闭 clientConnection。
```

推荐规则：

| Item | Value |
| --- | --- |
| max tombstones | 4096 |
| scope | clientConnection |
| cleanup | FIFO |

如果收到 tombstone 中 stream 的 frame：

```text
ignore
```

如果收到未知 stream 且不在 tombstone 中：

```text
除 server -> CLI 的 request.start 外，都是 protocol error。
```

## Durable Object state

Durable state：

| State | Durable |
| --- | --- |
| activeClientConnectionId | yes |
| expected dataChannelCount | yes |
| channel attachments | WebSocket attachment |
| active stream runtime | no |
| ReadableStream controller | no |
| pending promise resolver | no |
| credit windows | no，按 clientConnection 重新初始化 |

如果 DO 从 hibernation 恢复后发现 active stream runtime 已丢失：

```text
关闭无法恢复的 public socket
abort 对应 stream state
不能假装该 stream 还能继续
```

旧 channel close/error 到达时：

```text
如果 channel.clientConnectionId !== activeClientConnectionId
  ignore 或只关闭 old channel
```

## API validation

Tunnel API：

| Case | Response |
| --- | --- |
| invalid tunnelId | 400 |
| invalid clientConnectionId | 400 |
| invalid channelId | 400 |
| non-WebSocket channel request | 426 |
| auth failed | 401 |
| protocol version mismatch | 426 或明确的 upgrade response |

Public request：

| Case | Response |
| --- | --- |
| tunnel not ready HTML request | 502 HTML |
| tunnel not ready fetch/API request | 502 JSON |
| local response timeout | 根据 Accept 返回 502 JSON 或 HTML |
| stream abort due public cancel | 不影响 clientConnection |

## Header 规则

转发到 local server 的 request headers 必须移除：

```text
connection
keep-alive
proxy-authenticate
proxy-authorization
te
trailer
transfer-encoding
upgrade
host
content-length
```

WebSocket request headers 还必须额外移除：

```text
sec-websocket-accept
sec-websocket-extensions
sec-websocket-key
sec-websocket-protocol
sec-websocket-version
```

转发到 public client 的 response headers 必须移除：

```text
connection
keep-alive
proxy-authenticate
proxy-authorization
te
trailer
transfer-encoding
upgrade
content-encoding
content-length
```

Header validation：

| Item | Rule |
| --- | --- |
| max entries | 128 |
| name bytes | <= 128 |
| value bytes | <= 8192 |
| value controls | reject control chars except tab |

## Limits

默认 limits：

```text
maxFrameBytes = 1 MiB
maxMetadataBytes = 64 KiB
maxWebSocketMessageBytes = 1 MiB
streamCreditBytes = 1 MiB
channelCreditBytes = 4 MiB
pendingDataBytes = 4 MiB
pendingDataTimeoutMs = 120000
dataChannels = 2
maxDataChannels = 8
```

必须满足：

```text
maxFrameBytes >= maxWebSocketMessageBytes
```

原因：

```text
v4 不拆分 WebSocket message。
```

## Security

| Item | Rule |
| --- | --- |
| tunnelId | random, unguessable, URL-safe |
| clientConnectionId | random, unguessable |
| connectToken | signed, scoped to tunnelId and clientConnectionId |
| token storage | CLI must not persist connectToken |
| logs | redact authorization, token, secret fields |
| old tokens | invalid after expiration or replacement |
| fallback | no old protocol fallback after protocol upgrade |

Token payload 应包含：

```json
{
  "aud": "connect",
  "tunnelId": "t-k9x2p7q4mc",
  "clientConnectionId": "c-r5qq8fxn",
  "exp": 1770000000
}
```

## Reconnect 行为

匿名 tunnel reconnect：

```text
dataChannel closes
CLI closes all dataChannels
CLI aborts active streams
CLI creates a new ephemeral tunnel
CLI receives new tunnelId, publicUrl, clientConnectionId, token
CLI connects all dataChannels
```

规则：

- 不做 token refresh。
- 不尝试 reconnect 到旧 anonymous tunnel。
- 新的 ephemeral tunnel 可以有新的 public URL。

如果后续账号/reserved domain 支持 persistent tunnel：

```text
CLI 可以在同一个 tunnel 内创建新的 clientConnection
activeClientConnectionId replacement 规则仍然适用
```

## Logging

必需 structured events：

```text
tunnel.created
clientConnection.created
channel.connected
channel.closed
clientConnection.closed
stream.request.start
stream.response.start
stream.end
stream.abort
protocol.error
credit.violation
```

公共字段：

```ts
type LogFields = {
  event: string;
  tunnelId?: string;
  clientConnectionId?: string;
  channelId?: number;
  streamId?: string;
  reason?: string;
  code?: number;
};
```

`streamId` 应以十进制字符串记录，因为它是 uint64。

## Package responsibilities

`@hostc/protocol` 负责：

```text
constants
limits
frame encode/decode
metadata validators
header filters
credit helpers
state-machine model helpers
close code normalization
```

`apps/server` 负责：

```text
HTTP API
Durable Object lifecycle
dataChannel accept/close/error
public HTTP proxy
public WebSocket proxy
server-side stream registry
```

`apps/cli` 负责：

```text
config
create ephemeral tunnel
dataChannel client
local HTTP proxy
local WebSocket proxy
reconnect loop
terminal UI
```

禁止：

```text
server 和 CLI 不得在 @hostc/protocol 之外发明协议字段。
```

## Required tests

Protocol unit tests：

```text
frame encode/decode
metadata validators
limits validators
header filters
credit helper
uint64 streamId encode/decode
invalid frame rejection
```

State machine tests：

```text
HTTP request body start/data/end
HTTP response body start/data/end
WebSocket open/data/half-close/close
public cancel only aborts stream
local unavailable only aborts stream
late frame for tombstoned stream ignored
stream on wrong channel is protocol error
seq gap is protocol error
credit violation is protocol error
old clientConnection cannot mutate active state
```

CLI tests：

```text
connect N dataChannels
no controlChannel usage
local fetch abort on request.abort
late frames ignored after stream cleanup
local WebSocket failure is stream-level
channel close triggers reconnect
debug logs redact tokens
```

Server tests：

```text
create ephemeral tunnel response
dataChannel connect auth
all dataChannels ready means tunnel ready
public HTTP GET/POST/large upload
public client cancel
public WebSocket text/binary/subprotocol
old clientConnection close ignored
dataChannel close invalidates active clientConnection
```

E2E：

```text
HTTP GET
HTTP POST body
large upload
large download
streaming response
slow response start
public client cancel
local upstream error
WebSocket text echo
WebSocket binary echo
WebSocket subprotocol
public WebSocket close
CLI reconnect
tunnel not ready
```

Load：

```text
concurrent HTTP GET
large upload with body equality check
large download with byte count check
WebSocket burst
idle WebSocket
reconnect storm
```

Acceptance metrics：

```text
failed = 0
healthy local upstream load 下 status502 = 0
protocolErrorRate = 0
creditViolation = 0
intentional reconnect 场景以外 close1011 = 0
```

## Implementation status

v4 is the active protocol. The previous v3 control-channel design is removed from the active server, SDK, CLI, and refactor docs.

```text
protocol package owns v4 frames, metadata, limits, credits, close codes, and create-response validation
client SDK creates ephemeral tunnels, opens dataChannels, multiplexes streams, and proxies upstream traffic
server accepts v4 data-channel endpoints and routes each stream through its assigned channel
CLI is a thin product layer over @hostc/client
```

## 最终总结

v4 协议可以用一段话说明：

```text
创建 ephemeral tunnel 会返回 tunnelId、clientConnectionId、connectToken 和 N 条 dataChannel 的连接信息。CLI 打开所有 dataChannel。所有 dataChannel 都 open 后，tunnel ready。每个 public HTTP 请求或 public WebSocket 连接都会成为一个 stream。server 分配 uint64 streamId，并为该 stream 选择一条 dataChannel。这个 stream 的 request、response、WebSocket data、end、abort、credit 全部都在这条 dataChannel 上传输。stream 失败只关闭该 stream。协议错误或 active dataChannel 失败才关闭 clientConnection。匿名 CLI 重连会创建新的 ephemeral tunnel。
```
