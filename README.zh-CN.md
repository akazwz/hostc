<div align="center">
  <img src="./apps/web/public/favicon.svg" alt="hostc logo" width="80" height="80" />
  <h1>hostc</h1>
  <p><strong>localhost，随处可达。</strong></p>
  <p>一条命令，给你的开发服务器一个公网 HTTPS 地址，WebSocket 和热更新都能用。<br />免费、开源、不用注册。</p>
  <p>
    <a href="https://www.npmjs.com/package/hostc"><img src="https://img.shields.io/npm/v/hostc?color=ea580c&label=npm" alt="npm version" /></a>
    <a href="./LICENSE"><img src="https://img.shields.io/github/license/akazwz/hostc?color=52525b" alt="Apache-2.0 license" /></a>
    <a href="https://github.com/akazwz/hostc/stargazers"><img src="https://img.shields.io/github/stars/akazwz/hostc?style=flat&color=52525b" alt="GitHub stars" /></a>
  </p>
  <p><a href="https://hostc.dev">hostc.dev</a> · <a href="./README.md">English</a></p>
</div>

## 快速开始

先启动你的应用，再让 hostc 指向它的端口：

```sh
npx hostc@latest 3000
```

```text
  https://k7m2xq9pa4dn.hostc.app  → http://localhost:3000

  Anyone with this URL can reach your local server. Press Ctrl+C to stop.
```

在任何设备上打开这个地址即可。每个请求到达时，终端里都会打印一行。

hostc 是我业余做的免费开源项目，不是商业产品。如果它帮到了你，欢迎[在 GitHub 上点个 Star](https://github.com/akazwz/hostc)：
能让更多开发者发现它，也是对我继续做下去最大的鼓励。

## 为什么用 hostc

- **什么都不用配。** 不用注册，不用 token，不用下载二进制。装了 Node.js 就能用。
- **访客直接看到你的应用。** 前面没有需要点击才能继续的警告页。
- **热更新能用。** WebSocket 直接透传，Vite、Next.js 等开发服务器一保存，所有打开的设备都会跟着更新。
  Server-Sent Events 也是边产生边送达。
- **开发服务器不用改配置。** 请求到达时的地址就是 localhost，指向 localhost 的跳转也会改写回公网地址，
  不需要去改 allowed hosts 之类的设置。
- **链接不会失效。** 断网、服务端重启都不会改变 URL，hostc 会自己重连。
- **免费、开源。** 服务端是一个 Cloudflare Worker，你也可以部署到自己的域名上。

## 适合用来

- 用 AI 写了个东西，还没部署就想先分享给别人看；
- 把开发中的页面给同事或客户看；
- 用本机正在跑的代码测试 Stripe、GitHub、Slack 的 webhook；
- 在真机上调试你的网站，热更新照样生效；
- 让 AI 编程助手分享它做好的东西。把 [hostc.dev/llms.txt](https://hostc.dev/llms.txt) 发给它，
  它就知道怎么运行 hostc、怎么读取地址。

## 用法

```text
hostc <target> [options]

  3000                     http://localhost:3000
  127.0.0.1:8080           http://127.0.0.1:8080
  https://localhost:5173   任意 http(s) 地址

  --server <url>   隧道服务器（环境变量 HOSTC_SERVER）
  --qr             打印公网地址的二维码
  -h, --help       显示帮助
  -v, --version    显示版本
```

按 Ctrl+C 停止，URL 会立即释放。重新启动 hostc 会得到一个新的 URL。

这个地址是公开的：拿到它的人都能访问你的本地服务。只分享你打算公开的东西。

### 始终使用 `@latest`

hostc 免费，迭代很快，服务端更新可能与旧版 CLI 不兼容。用 `npx hostc@latest` 运行，拿到的永远是配套的版本。

不要全局安装（`npm i -g hostc`），也不要加进项目依赖：装好的那一份会停在当时的版本，服务端一更新就用不了。
用的是旧版的话，启动时会停下并提示你升级。

## 工作原理

```
浏览器 ──▶ Worker ──▶ Durable Object（每个隧道一个）◀── WebSocket ── hostc ──▶ localhost
```

hostc 只向外建立一条 WebSocket 连接，所以你的电脑不需要能从公网访问。每个公网请求或 WebSocket
都是这条连接上的一个 stream，请求体和响应体带流控。空闲的隧道会在服务端休眠，这也是 hostc 能免费的原因。
协议细节见 [docs/protocol.md](./docs/protocol.md)。

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

## 参与开发

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

| 路径                | 内容                                          |
| ------------------- | --------------------------------------------- |
| `packages/protocol` | 双方共用的帧格式、消息和常量                  |
| `packages/client`   | Node.js 客户端：连接、stream、重连            |
| `apps/server`       | Cloudflare Worker + Durable Object 隧道服务器 |
| `apps/cli`          | `hostc` 命令                                  |
| `apps/web`          | hostc.dev 官网（单个静态页面）和 llms.txt     |

欢迎提 Issue 和 Pull Request。

如果 hostc 对你有用，欢迎[在 GitHub 上点个 Star](https://github.com/akazwz/hostc)。

## License

[Apache-2.0](./LICENSE)
