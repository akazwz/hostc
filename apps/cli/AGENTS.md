# AGENT INSTRUCTIONS: hostc CLI 子项目

本说明专为 `apps/cli` Node.js CLI 工具设计，聚焦开发、构建、入口和约定。

## 目录结构

- `src/index.ts`：CLI 主入口，输出 "hostc"。
- `tsconfig.json`：TypeScript 类型检查配置。
- `tsup.config.ts`：CLI 打包配置，用于产出可单包发布的 `dist/`。
- `package.json`：定义 bin 入口、构建命令等。
- `src/config.ts`：`~/.hostc/config.json` 非敏感配置读写与优先级合并。
- `src/api.ts`：create/refresh tunnel API client。
- `src/runtime.ts`：control/data WebSocket、credit、本地 HTTP/WebSocket proxy 和 reconnect runtime。

## 开发与构建

1. 构建 CLI：
   ```sh
   pnpm build
   ```
2. 调试 CLI：
   ```sh
   node dist/index.js 3000
   ```
3. 如需联调本地或 staging Worker，可通过环境变量覆盖服务端地址：
   ```sh
   HOSTC_SERVER_URL=http://127.0.0.1:8787 node dist/index.js 3000
   ```
   也可以使用 CLI 参数：
   ```sh
   node dist/index.js 3000 --server http://127.0.0.1:8787
   ```

## 约定与建议

- 所有 CLI 逻辑建议集中在 `src/` 下，主入口为 `src/index.ts`。
- 发布/分发时以 `dist/index.js` 作为 bin 入口，CLI 通过 `tsup` 打包，并通过 workspace 依赖使用 `@hostc/protocol`。
- control message、data frame、limits、credit 和 header/close helper 必须从 `@hostc/protocol` 引入，不要在 CLI 内重复定义协议。
- CLI 的主调用形式是 `hostc <port>`，默认暴露同一端口上的 HTTP 请求与 WebSocket upgrade。
- server 地址优先级为 CLI 参数 > 环境变量 > config 文件 > 默认值。
- CLI 当前流程为：先调用 server API 创建 tunnel，随后在内存里持有 connect/refresh token，建立 1 条 control WebSocket 和 N 条 dataChannel WebSocket；任意 socket 异常断开后 refresh 并重连。
- token 不落盘；`~/.hostc/config.json` 只保存非敏感配置。
- CLI 当前不暴露自定义 subdomain 参数，公网 subdomain 由 Workers 侧随机分配。
- 如需扩展命令行参数，建议继续沿用 commander。

---
如需全局约定，见项目根目录 AGENTS.md。
