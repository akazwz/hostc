# 自部署

[English](./self-hosting.md)

1. 克隆这个仓库并运行 `pnpm install`。
2. 把域名加到 Cloudflare：一个给 API，一个给隧道，例如 `example.com` 和 `example.app`。
   两者也可以是同一个域名，但隧道单独用一个域名，可以让隧道的 cookie 和滥用举报不牵连主站。
   给隧道域名加一条开启代理的通配符 DNS 记录（`*` → `192.0.2.1`）；Cloudflare 的 Universal SSL
   会覆盖 `*.example.app`。
3. 设置一次 token 密钥：`pnpm -F @hostc/server exec wrangler secret put TOKEN_SECRET --name hostc-tunnel`
   （至少 32 字节随机值，例如 `openssl rand -base64 48`）。
4. 部署：

   ```sh
   API_DOMAIN=example.com TUNNEL_DOMAIN=example.app pnpm deploy:server
   ```

5. 使用：`npx hostc@latest 3000 --server https://example.com`，或者用
   `HOSTC_DEFAULT_SERVER=https://example.com pnpm build` 构建自己的 CLI。
