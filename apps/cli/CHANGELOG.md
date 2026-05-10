# Changelog

## [1.3.0] - 2026-05-10

### 新增
- 新增 `@hostc/client` 客户端 SDK，CLI 现在基于 SDK 启动 tunnel，协议逻辑不再放在 CLI 内部
- 新增 v4 tunnel 协议：以 data channel 承载二进制 frames，并以 stream 表示每个 HTTP/WebSocket 请求
- 新增更完整的本地、staging、stress、load 和 refactor audit 验证流程

### 变更
- CLI 不再兼容旧协议 fallback；服务端协议升级后需要同步升级 CLI
- 匿名 tunnel 重连时重新创建 ephemeral tunnel，不再刷新旧 token
- CLI 输出更简洁，启动、成功、重连和错误状态更清晰
- 代码结构调整为 `protocol`、`client`、`server`、`cli` 四层职责

### 修复
- 修复 Vite/HMR 等高频 WebSocket 场景下可能出现的 stream/channel 边界问题
- 修复本地 upstream 单个 stream 失败时导致整个 client connection 重连的问题
- 修复 `Set-Cookie` 响应头在部分运行时下丢失的问题
- 修复 SDK 发布包中旧类型定义残留的问题

## [1.2.6] - 2026-04-27

### 修复
- 修复 CLI 在 Node.js 18/20 环境下因使用全局 `WebSocket` 而启动即崩溃的问题，现统一通过 `ws` 包创建隧道连接

## [1.2.5] - 2026-04-27

### 变更
- CLI 默认本地服务 host 从 `127.0.0.1` 调整为 `localhost`，可通过 `--local-host 127.0.0.1` 回退

## [1.2.4] - 2026-04-27

### 新增
- CLI 遇到可上报的 fatal error 时会上传脱敏错误摘要，可通过 `HOSTC_DISABLE_ERROR_REPORTING=1` 或 `DO_NOT_TRACK=1` 关闭

## [1.2.3] - 2026-04-27

### 新增
- CLI 启动时会在交互式终端中提示可用的新版本，可通过 `HOSTC_DISABLE_UPDATE_CHECK=1` 关闭

### 修复
- 新 CLI 兼容缺少 v2 握手字段的旧服务端消息，旧 CLI 继续通过 `client-capabilities` 与新服务端协商

## [1.2.2] - 2026-04-26

### 修复
- 修复 CLI 在 `Ctrl-C` 主动关闭 tunnel 时，仍可能打印 `Tunnel connection is unavailable` 栈的问题
- 为大体积 HTTP 响应增加 response-body credit 流控，降低视频和文件流量场景下隧道缓冲失控导致的崩溃风险

## [1.2.1] - 2026-04-18

### 修复
- 终端二维码渲染改为更兼容的 ANSI 空格块实现，减少部分终端对全角空格的异常显示

---

## [1.2.0] - 2026-04-18

### 新增
- 新增 `--qr` 参数，可在交互终端中显示公网地址二维码
- CLI 帮助信息与 README 补充二维码用法示例

### 变更
- 默认输出不再展示二维码，只有显式传入 `--qr` 时才会显示
- `hostc --version` 输出与发布版本保持一致

---

## [1.1.0] - 2026-04-17

### 新增
- 支持与服务端协商 binary-payload 能力，自动切换为二进制传输（大幅减少 base64 开销）
- 兼容老服务端/老 CLI，自动回退为 base64 路径，无需手动切换

### 优化
- 性能提升：大流量下 CPU/内存占用显著下降
- 代码结构更清晰，便于后续扩展

---

## [1.0.0] - 初始发布
- 支持 HTTP/WS 本地服务暴露
- Cloudflare Worker 隧道转发
