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

在任何设备上打开这个地址即可。每个请求到达时，终端里都会打印一行。需要 Node.js 22.1 或更高版本。

**这个地址是公开的：** 拿到它的人都能访问你的本地服务，只分享你打算公开的东西。

hostc 免费开源。如果它帮到了你，欢迎[在 GitHub 上点个 Star](https://github.com/akazwz/hostc)：
能让更多开发者发现它，也是对这个项目最大的鼓励。

## 为什么用 hostc

- **什么都不用配。** 不用注册，不用 token，不用下载二进制。装了 Node.js 就能用。
- **访客直接看到你的应用。** 前面没有需要点击才能继续的警告页。
- **热更新能用。** WebSocket 直接透传，Vite、Next.js 等开发服务器一保存，所有打开的设备都会跟着更新。
  Server-Sent Events 也是边产生边送达。
- **开发服务器不用改配置。** 请求到达时的地址就是 localhost，指向 localhost 的跳转也会改写回公网地址，
  不需要去改 allowed hosts 之类的设置。
- **链接不会失效。** 断网或服务端重启后，hostc 会自己重连，只要在 10 分钟内连回来，URL 就不变。

## 适合用来

- 用 AI 写了个东西，还没部署就想先分享给别人看；
- 把开发中的页面给同事或客户看；
- 用本机正在跑的代码测试 Stripe、GitHub、Slack 的 webhook；
- 在真机上调试你的网站，热更新照样生效（`--qr` 会打印二维码，扫一下就能打开）；
- 让 AI 编程助手分享它做好的东西。把 [hostc.dev/llms.txt](https://hostc.dev/llms.txt) 发给它，
  它就知道怎么运行 hostc、怎么读取地址。

## 用法

```text
hostc <target> [options]
hostc codex [options]

  3000                     http://localhost:3000
  127.0.0.1:8080           http://127.0.0.1:8080
  https://localhost:5173   任意 http(s) 地址

  --server <url>   隧道服务器（环境变量 HOSTC_SERVER）
  --qr             打印公网地址的二维码
  --here           hostc codex：只显示当前目录（命令仍能访问整台电脑）
  -h, --help       显示帮助
  -v, --version    显示版本
```

按 Ctrl+C 停止，URL 会立即释放。重新启动 hostc 会得到一个新的 URL。

### 限制

- 每个隧道最多同时处理 256 个请求和 WebSocket，多出的最多 1024 个排队等待空位，再多的返回 `503`。
- WebSocket 单条消息最大 1 MiB。如果本地服务不再读取，积压超过 4 MiB 时这条连接也会被关闭。
- 本地服务需要在 2 分钟内开始响应请求。

### 始终使用 `@latest`

服务端更新可能与旧版 CLI 不兼容，所以请用 `npx hostc@latest` 运行，拿到的永远是配套的版本。不要全局安装
（`npm i -g hostc`），也不要加进项目依赖：装好的那一份会停在当时的版本，旧版启动时会停下并提示你升级。

## 常见问题

请求到不了你的应用时，访客会看到这些错误：

| 错误                           | 含义                         | 怎么办                          |
| ------------------------------ | ---------------------------- | ------------------------------- |
| `404` Tunnel not found         | 隧道已停止或已过期           | 重新运行 hostc，换一个新 URL    |
| `502` Tunnel offline           | hostc 没连上，通常是正在重连 | 稍后再试；确认 hostc 还在运行   |
| `502` Local server unavailable | 隧道正常，但本地服务没有响应 | 确认它运行在你给 hostc 的端口上 |
| `503` Tunnel busy              | 同时进来的请求太多           | 稍后再试                        |
| `504` Local server timed out   | 2 分钟内没有开始响应         | 查一下本地服务卡在哪里          |

## hostc codex（实验性）

在任何浏览器里（包括手机）使用你电脑上的 Codex CLI：

```sh
npx hostc@latest codex --qr
```

这是实验性功能，依赖的 Codex 协议也标记为实验性。使用前请先了解：

- **链接能控制你的电脑。** 拿到链接的人能以你的身份读取任何文件、运行任何命令。请像密码一样保管，不要发到聊天里，也不要在共享屏幕上显示二维码。
- **“询问批准”防不住链接泄露。** 新会话在行动前会询问，但拿到链接的人自己就能批准。`--here` 只是只显示当前目录，命令仍然能访问整台电脑。
- **链接在你停止之前一直有效。** token 是随机生成的，只保存在内存里，每次启动都会更换。按 Ctrl+C 结束访问，目前没有其他撤销方式。

hostc 是开源的，你也可以[自己部署](#自部署)，并使用 `--server`。

## hostc 与 Cloudflare Tunnel 对比

hostc 同样运行在 Cloudflare 上，但只做 Cloudflare 自家隧道中更窄的一件事：临时分享开发服务器。

|                    | hostc          | Quick Tunnel    | Cloudflare Tunnel |
| ------------------ | -------------- | --------------- | ----------------- |
| 安装               | 只需 Node.js   | `cloudflared`   | `cloudflared`     |
| 账号               | 不需要         | 不需要          | 需要              |
| URL                | 随机           | 随机            | 你自己的域名      |
| Server-Sent Events | 支持           | 不支持          | 支持              |
| 开发服务器         | 直接可用       | 可能要放行 host | 可配置            |
| 访问控制           | 无             | 邮箱白名单      | Cloudflare Access |
| 适合               | 分享开发服务器 | 快速测试        | 生产环境          |

## 工作原理

```
浏览器 ──▶ Worker ──▶ Durable Object（每个隧道一个）◀── WebSocket ── hostc ──▶ localhost
```

hostc 只向外建立一条 WebSocket 连接，所以你的电脑不需要能从公网访问。每个公网请求或 WebSocket
都是这条连接上的一个 stream，请求体和响应体带流控。空闲的隧道会在服务端休眠，这也是 hostc 能免费的原因。
协议细节见 [docs/protocol.md](./docs/protocol.md)。

## 自部署

服务端是一个 Cloudflare Worker，你可以部署到自己的域名上，再用 `--server` 让 CLI 指向它。
详见 [docs/self-hosting.zh-CN.md](./docs/self-hosting.zh-CN.md)。

## 参与开发

欢迎提 Issue 和 Pull Request，详见 [CONTRIBUTING.zh-CN.md](./CONTRIBUTING.zh-CN.md)。

## License

[Apache-2.0](./LICENSE)
