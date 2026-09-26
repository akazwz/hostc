<div align="center">
  <img src="./apps/web/public/favicon.svg" alt="hostc logo" width="80" height="80" />
  <h1>hostc</h1>
  <p><strong>localhost，随处可达。</strong></p>
  <p>给本地 HTTP 和 WebSocket 服务一个公网地址，运行在 Cloudflare Workers 和 Durable Objects 上。</p>
  <p><a href="./README.md">English</a></p>
</div>

---

```sh
npx hostc@latest 3000
```

```text
  https://k7m2xq9pa4dn.hostc.app  → http://localhost:3000
```

分享开发中的页面、测试 webhook、在手机上打开本地应用。不用注册，不用安装。

## 特性

- 支持 HTTP 和 WebSocket，包括带热更新的开发服务器（Vite、Next.js 等）和 Server-Sent Events。
- 网络断开、服务端重启后 URL 不变：hostc 会重连回同一个隧道。
- 请求体和响应体都是流式传输，带流控，按原样逐字节透传，压缩内容也不例外。
- 空闲的隧道不花钱：没有流量时服务端会休眠。

## CLI

```text
hostc <target> [options]

  3000                     http://localhost:3000
  127.0.0.1:8080           http://127.0.0.1:8080
  https://localhost:5173   任意 http(s) 地址

  --server <url>   隧道服务器（环境变量 HOSTC_SERVER）
  --qr             打印公网地址的二维码
```

按 Ctrl+C 停止，URL 会立即释放。重新启动 hostc 会得到一个新的 URL。

## 更新说明

hostc 免费、不需要账号，所以会快速迭代：服务端更新可能与旧版 CLI 不兼容。始终使用
`npx hostc@latest` 就能拿到配套的版本。如果用的是旧版，启动时会失败，并提示你升级。

## 工作原理

```
浏览器 ──▶ Worker ──▶ Durable Object（每个隧道一个）◀── 一条 WebSocket ── hostc ──▶ localhost
```

每个公网请求都是一个 stream，复用客户端的那条 WebSocket。协议每帧 5 字节头、7 种帧类型，
HTTP body 按 stream 做窗口流控。详见 [docs/protocol.md](./docs/protocol.md)。

| 路径                | 内容                                          |
| ------------------- | --------------------------------------------- |
| `packages/protocol` | 双方共用的帧格式、消息和常量                  |
| `packages/client`   | Node.js 客户端：连接、stream、重连            |
| `apps/server`       | Cloudflare Worker + Durable Object 隧道服务器 |
| `apps/cli`          | `hostc` 命令                                  |
| `apps/web`          | hostc.dev 官网（单个静态页面）和 llms.txt     |

## 开发

需要 Node.js 22.22+ 和 pnpm。

```sh
pnpm install
cp apps/server/.dev.vars.example apps/server/.dev.vars
pnpm dev                       # 隧道服务器运行在 http://localhost:8787
pnpm build                     # 构建 CLI
node apps/cli/dist/hostc.mjs 3000 --server http://localhost:8787
```

本地隧道地址是 `http://<id>.localhost:8787`，Chrome 和 Firefox 会把 `*.localhost` 解析到本机。

```sh
pnpm check      # 格式检查、lint、类型检查、单测和集成测试
pnpm test:e2e   # wrangler dev + CLI + 本地源站的端到端测试
```

## 自部署

1. 把域名加到 Cloudflare：一个给 API，一个给隧道，例如 `example.com` 和 `example.app`。
   两者也可以是同一个域名，但隧道单独用一个域名，可以让隧道的 cookie 和滥用举报不牵连主站。
   给隧道域名加一条开启代理的通配符 DNS 记录（`*` → `192.0.2.1`）；Cloudflare 的 Universal SSL
   会覆盖 `*.example.app`。
2. 设置一次 token 密钥：`pnpm -F @hostc/server exec wrangler secret put TOKEN_SECRET`
   （至少 32 字节随机值，例如 `openssl rand -base64 48`）。
3. 部署：

   ```sh
   API_DOMAIN=example.com TUNNEL_DOMAIN=example.app pnpm deploy:server
   ```

4. 使用：`npx hostc@latest 3000 --server https://example.com`，或者用
   `HOSTC_DEFAULT_SERVER=https://example.com pnpm build` 构建自己的 CLI。

## License

Apache-2.0
