<div align="center">
  <img src="./apps/web/public/favicon.svg" alt="hostc logo" width="80" height="80" />
  <h1>hostc</h1>
  <p><strong>把 localhost 暴露到边缘网络。</strong></p>
  <p>基于 Cloudflare Workers 和 Durable Objects 的轻量 tunnel 工具，支持本地 HTTP 和 WebSocket 服务。</p>
  <p>
    <a href="./README.md">English</a>
  </p>
</div>

---

> hostc 目前处于 preview 阶段。核心 tunnel 流程已经可用，但早期协议变化时可能需要升级 CLI。

## hostc 是什么？

hostc 可以给你的本地开发服务生成一个公网 URL。

它适合用来分享本地 Web 应用、测试 webhook、预览 Vite 或 Next.js 项目，或者临时暴露一个本地 HTTP/WebSocket 服务。

```sh
npx hostc 3000
```

运行后会得到一个公网 URL，并把请求转发到 `http://localhost:3000`。

## 特性

- 零配置 CLI，快速创建临时公网 tunnel。
- 支持 HTTP 和 WebSocket，包括带 HMR 的本地开发服务。
- 基于 Cloudflare Worker + Durable Object 的服务端架构。
- v4 协议包含 stream、data channel、frame metadata、credit flow control 和明确的 close code。
- 可嵌入的 client SDK，可用于 CLI、桌面端、daemon、自定义 Node.js 集成。
- 已有 local、staging、E2E、stress、benchmark 工作流。

## 快速开始

无需安装，直接运行：

```sh
npx hostc 5173
```

也可以全局安装：

```sh
npm install -g hostc
hostc 5173
```

示例输出：

```text
Success  Tunnel ready
  Public URL: https://t-example.hostc.example.com/
  Local:      http://localhost:5173/
  Tunnel:     t-example
  Channels:   4
```

## CLI 用法

```sh
hostc <port>
```

示例：

```sh
hostc 3000
hostc 5173 --data-channels 4
hostc 8080 --local-host 127.0.0.1
hostc 3000 --server https://hostc.example.com
```

配置：

```sh
hostc config get
hostc config set server-url https://hostc.example.com
hostc config unset server-url
hostc config path
```

诊断：

```sh
hostc doctor 5173
```

## 架构

hostc 现在拆成四个主要部分：

| Package / App | 职责 |
| --- | --- |
| `packages/protocol` | 协议唯一事实来源。定义 frames、streams、metadata、limits、credits、close codes、校验和 client/server 共用 helper。 |
| `packages/client` | 可嵌入的客户端 SDK。负责创建 ephemeral tunnel、连接 data channels、stream 多路复用、HTTP/WebSocket 代理、flow control 和断线重连。 |
| `apps/server` | Cloudflare Worker + Durable Object tunnel server。负责创建 tunnel、接收公网 HTTP/WebSocket 请求、分配 stream、选择 data channel，并转发 v4 frame。 |
| `apps/cli` | 面向用户的 CLI。负责参数、配置、doctor 检查、终端输出、spinner，并调用 client SDK。CLI 不承载协议逻辑。 |

最重要的变化是：协议逻辑不再放在 CLI 里。CLI 是基于 SDK 的薄产品层，SDK 和 server 都基于共享的 protocol 包实现。

## 协议模型

- `tunnel`：由 Durable Object 管理的公网 tunnel。
- `client connection`：当前 SDK/CLI 到 tunnel 的连接。
- `data channel`：SDK 和 server 之间的 WebSocket 通道。
- `stream`：一次公网 HTTP 请求或 WebSocket 连接。
- `frame`：在 data channel 上传输的协议单元。

stream 会被分配到某个 data channel，并固定在这个 channel 上。stream-level 错误只应该关闭当前 stream；channel-level 错误才会触发 client 创建新的 ephemeral tunnel。

## Client SDK

client SDK 目前还是 monorepo 内的 internal preview package。CLI 已经在内部使用它，后续它会成为 Electron、桌面 GUI、后台 daemon 或自定义 Node.js 工具的公共集成入口。

SDK 的公开 npm package 还没有稳定发布。下面的示例可以先理解为仓库内集成预览：

```ts
import { HostcClient, localOriginAdapter } from "@hostc/client";

const client = new HostcClient({
  serverUrl: "https://hostc.example.com",
  upstream: localOriginAdapter({
    origin: new URL("http://localhost:5173/"),
  }),
});

client.on("ready", (event) => {
  console.log(event.publicUrl);
});

client.on("reconnecting", (event) => {
  console.error(`reconnecting: ${event.reason}`);
});

await client.start();
```

## 当前行为和限制

- 匿名 tunnel 是临时的。
- client connection 断开后，CLI 会创建一个新的 ephemeral tunnel。
- 重连后可能得到新的 tunnel id 和 public URL。
- 目前还没有账号系统、reserved domain、dashboard 或长期后台 daemon。
- 早期协议版本不做向后兼容。如果协议升级，需要更新 CLI/SDK。

这样可以让 preview 阶段的产品保持简单，同时优先把核心 tunnel 流程打磨稳定。

## 本地开发

环境要求：

- Node.js 18+
- pnpm
- 如果要部署，需要 Cloudflare 账号

安装依赖：

```sh
pnpm install
```

构建全部包：

```sh
pnpm build
```

本地启动 server：

```sh
pnpm dev:server
```

让 CLI 连接本地 server：

```sh
pnpm build:cli
HOSTC_SERVER_URL=http://127.0.0.1:8787 node apps/cli/dist/index.js 5173
```

## 测试和 benchmark

常用检查：

```sh
pnpm build
pnpm test
pnpm lint
pnpm test:e2e:cli
pnpm test:e2e:local
pnpm bench:local
pnpm stress:local
```

staging 检查：

```sh
pnpm deploy:server:staging
pnpm preflight:staging
HOSTC_SERVER_URL=https://hostc.example.com pnpm test:e2e:staging
HOSTC_SERVER_URL=https://hostc.example.com pnpm bench:remote
HOSTC_SERVER_URL=https://hostc.example.com pnpm stress:remote
```

staging 使用 `https://hostc.example.com` 和 `*.hostc.example.com`。

## Roadmap

- 在真实浏览器、HMR、WebSocket 场景下继续强化 tunnel 生命周期。
- 改进 Worker 和 Durable Object 的观测能力。
- 把 client SDK 作为一等集成方式发布和文档化。
- 增加 reserved tunnel、稳定域名、账号系统和访问控制。
- 探索 daemon 和桌面 GUI 工作流。

## License

Apache License 2.0. Made by [akazwz](https://github.com/akazwz).
