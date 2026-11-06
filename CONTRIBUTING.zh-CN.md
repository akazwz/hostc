# 参与开发

[English](./CONTRIBUTING.md)

需要 Node.js 22.23+ 和 pnpm。

```sh
pnpm install
cp apps/server/.env.example apps/server/.env
pnpm dev                       # 隧道服务器运行在 http://localhost:8787
pnpm build                     # 构建 CLI
node apps/cli/dist/hostc.mjs 3000 --server http://localhost:8787
```

本地隧道地址是 `http://<id>.localhost:8787`，Chrome 和 Firefox 会把 `*.localhost` 解析到本机。

```sh
pnpm check      # 格式检查、lint、类型检查、单测和集成测试
pnpm test:e2e   # cf dev + CLI + 本地源站的端到端测试
```

| 路径                | 内容                                          |
| ------------------- | --------------------------------------------- |
| `packages/protocol` | 双方共用的帧格式、消息和常量                  |
| `packages/client`   | Node.js 客户端：连接、stream、重连            |
| `apps/server`       | Cloudflare Worker + Durable Object 隧道服务器 |
| `apps/cli`          | `hostc` 命令                                  |
| `apps/web`          | hostc.dev 官网和 llms.txt                     |

协议细节见 [docs/protocol.md](./docs/protocol.md)，部署和发版见 [docs/release.md](./docs/release.md)。
