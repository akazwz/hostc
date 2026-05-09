# CLI 重构规格

本文定义新的 `apps/cli`。

## 目标

CLI 是本地代理 runtime：

- 创建 tunnel。
- 维护 1 条 control WebSocket 和 N 条 dataChannel WebSocket。
- 将 server 的 public HTTP/WebSocket 请求转发到本地服务。
- 将本地 response/WebSocket frame 按协议发回 server。
- 实现 refresh、reconnect、credit、config、debug output。

## 命令

主命令：

```sh
hostc <port>
hostc <port> --local-host localhost
hostc <port> --server https://envoq.dev
hostc <port> --data-channels 2
hostc <port> --qr
```

配置命令：

```sh
hostc config get
hostc config set server-url https://envoq.dev
hostc config unset server-url
hostc config path
```

`server-url` 是用户面对的名字，配置文件内部字段使用 `serverUrl`。

## 持久化配置

配置文件：

```text
~/.hostc/config.json
```

支持 override：

```text
HOSTC_CONFIG=/path/to/config.json
```

第一版配置：

```json
{
  "serverUrl": "https://envoq.dev",
  "localHost": "localhost",
  "dataChannels": 2,
  "qr": false
}
```

配置优先级：

```text
CLI 参数 > 环境变量 > ~/.hostc/config.json > 默认值
```

环境变量：

```text
HOSTC_SERVER_URL
HOSTC_CONFIG
HOSTC_DEBUG
HOSTC_DISABLE_UPDATE_CHECK
```

token 不落盘。

写配置要求：

- 自动创建 `~/.hostc`。
- `config.json` 权限尽量 `0600`。
- 写临时文件，再 rename。
- 设置时校验值。
- home directory 缺失时给明确错误。

## 默认值

```text
serverUrl = https://hostc.dev
localHost = localhost
dataChannels = 2
qr = false
```

staging 使用：

```sh
hostc config set server-url https://envoq.dev
```

## 建议目录结构

```text
apps/cli/src/
  index.ts
  commands/
    tunnel.ts
    config.ts
  config/
    file.ts
    resolve.ts
  client/
    api.ts
    tunnel-client.ts
    control-socket.ts
    data-channel.ts
    reconnect.ts
  runtime/
    credit.ts
    stream-state.ts
    pending-data.ts
  proxy/
    http.ts
    websocket.ts
    headers.ts
  output/
    spinner.ts
    logger.ts
    qr.ts
  errors.ts
  env.ts
```

原则：

- `index.ts` 只注册命令。
- output 不进入协议/连接核心。
- `TunnelClient` 不直接实现 local fetch/ws 细节。
- proxy 层不关心 reconnect。
- `@hostc/protocol` 是唯一协议来源。

## 启动流程

```text
解析 CLI 参数
读取 ~/.hostc/config.json
按优先级 resolve options
构造 localOrigin
POST /api/tunnels
拿到 tunnelId/publicUrl/connectionId/controlUrl/dataUrl/token/limits
创建 TunnelClient
连接 control
并行连接 N 条 dataChannel
全部连接成功后打印 publicUrl
进入运行状态
```

输出：

```text
Tunnel ready t-abc123 -> http://localhost:3000/
Public URL: https://t-abc123.envoq.dev
```

## API client

`client/api.ts` 负责：

- `createTunnel(serverUrl)`
- `refreshTunnel(serverUrl, tunnelId, refreshToken)`

要求：

- 校验 response status。
- 使用 `@hostc/protocol` parser 校验 response JSON。
- 错误信息隐藏 token。
- 支持 timeout。
- staging/local 通过 `serverUrl` 切换。

## TunnelClient

`TunnelClient` 维护一次 tunnel connection：

```ts
type TunnelClientState = {
  tunnelId: string;
  connectionId: string;
  publicUrl: string;
  control: ControlSocket | null;
  dataChannels: DataChannel[];
  limits: TunnelLimits;
  streams: StreamRegistry;
  credits: CreditState;
};
```

职责：

- connect control。
- connect dataChannels。
- dispatch control messages。
- dispatch data frames。
- send control messages。
- send data frames with credit。
- reconnect on failure。
- close on SIGINT/SIGTERM。

## Reconnect

任意 control 或 dataChannel 断开：

```text
标记 current connection failed
关闭所有 sockets
abort active streams
清空 pending data / credit
调用 refresh
拿到新 connectionId/token
指数退避 + jitter 后重连
```

不要尝试复用旧 streams。

建议：

```text
initial backoff = 500ms
max backoff = 10s
jitter = 20%
```

## ControlSocket

收消息：

- `request.start`
- `request.end`
- `request.abort`
- `credit`

发消息：

- `response.start`
- `response.end`
- `response.abort`
- `credit`

要求：

- 只处理 text message。
- 收到 binary control message 是 protocol error。
- 使用 `decodeControlMessage` 校验。
- 发送前使用 `encodeControlMessage`。
- 不在这里实现 local fetch/ws。

## DataChannel

每条 dataChannel：

- 只处理 binary message。
- text message 是 protocol error。
- 使用 `decodeDataFrameView`。
- 发送使用 `encodeDataFrame` 或 header API。
- 维护发送队列，确保同一 WebSocket send 顺序。
- 使用 `bufferedAmount` 做本地节流。

同一个 stream：

```text
channelId = streamId % dataChannels
```

发送 dataFrame 前：

```text
等待 stream credit
等待 connection credit
等待 dataChannel bufferedAmount 降到阈值
payload <= maxFrameBytes
seq 连续
```

## HTTP proxy

收到 `request.start(kind="http")`：

```text
创建 stream state
如果 body=true，创建 TransformStream 作为本地 fetch request body
根据 method/url/headers 构造 local fetch
收到 request.body dataFrame 后写入 request body writer
写入成功后发送 credit(request.body)
收到 request.end 后关闭 writer
fetch 返回后发送 response.start
读取 response.body
有 credit 时发送 dataFrame(response.body)
读完发送 response.end(lastSeq)
失败发送 response.abort
```

如果 public request abort：

```text
收到 request.abort
abort local fetch
关闭 writer
清理 stream
```

## WebSocket proxy

收到 `request.start(kind="websocket")`：

```text
构造 local ws:// 或 wss:// URL
转发过滤后的 headers 和 protocols
连接本地 WebSocket
open 后发送 response.start(status=101, protocol)
收到 dataFrame(ws.client) 后 send 到 local WebSocket
local WebSocket message 后发送 dataFrame(ws.server)
local close 后发送 response.end(kind=ws.server, code, reason, lastSeq)
收到 request.end(kind=ws.client) 后关闭 local WebSocket
失败发送 response.abort
```

WebSocket text/binary：

- `ws.client` 和 `ws.server` dataFrame 必须带 text/binary flag。
- text payload 使用 UTF-8 bytes。
- binary payload 原样 bytes。
- 单条 WebSocket message 必须 `<= maxWebSocketMessageBytes`，默认 1 MiB。
- CLI 不做 WebSocket message fragment/reassembly；一条 local WebSocket message 对应一个 `ws.server` dataFrame。
- 超过限制时关闭 local WebSocket，close code 使用 `1009 Message Too Big`，不得发送半截 message。
- HTTP body 可以继续按 `maxFrameBytes` chunk；WebSocket message 不得被 chunk 成多条业务 message。

## Credit

CLI 是双向角色。

CLI 作为接收方，给 server 发 credit：

- `request.body`
- `ws.client`

CLI 作为发送方，消耗 server 给的 credit：

- `response.body`
- `ws.server`

归还 credit 的时机：

- `request.body` 写入 local fetch request body writer 后。
- `ws.client` 成功 send 到 local WebSocket，且 local socket bufferedAmount 可接受后。

发送 response body：

- 无 credit 时不要继续从 local response body 读取太多数据。
- 允许最多一个小 pending chunk，但不能无界缓存。
- oversized chunk 用 `subarray` 切片。

## Pending data

CLI 必须处理 data 先于 control start 到达：

```text
按 streamId + dataKind 暂存
限制 per-stream bytes
限制 global bytes
限制 timeout
start 到达后消费
超限或超时 response.abort / connection protocol error
```

同样必须处理 end 先于最后 data 到达：

```text
记录 lastSeq
等 seq <= lastSeq 数据消费完后再真正 end
```

## 输出和 debug

默认输出保持干净：

```text
Tunnel ready t-abc123 -> http://localhost:3000/
Public URL: https://t-abc123.envoq.dev
```

debug：

```sh
HOSTC_DEBUG=1 hostc 3000
```

debug 可打印：

- serverUrl。
- tunnelId。
- connectionId。
- dataChannels ready。
- reconnect reason。
- stream start/end/abort。
- protocol error。

必须隐藏 token。

## 错误处理

用户错误：

- port 非法。
- local-host 为空。
- server-url 非法。
- config 写入失败。

连接错误：

- create tunnel failed。
- refresh failed。
- control connect failed。
- dataChannel connect failed。
- local service down。

协议错误：

- invalid control message。
- invalid dataFrame。
- seq discontinuity。
- credit violation。
- unexpected data kind。

错误输出要短，debug 下给更多上下文。

## 测试要求

CLI 必须覆盖：

- config get/set/unset/path。
- config priority。
- server URL normalization。
- create/refresh API parsing。
- reconnect backoff。
- control message dispatch。
- dataFrame dispatch。
- HTTP local proxy。
- WebSocket local proxy text/binary。
- credit send/consume。
- token redaction。

详见 [testing.md](./testing.md)。
