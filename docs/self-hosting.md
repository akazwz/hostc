# Self-hosting

[简体中文](./self-hosting.zh-CN.md)

1. Clone this repository and run `pnpm install`.
2. Add your domains to Cloudflare: one for the API and one for tunnels, for example `example.com`
   and `example.app`. They can be the same domain, but a separate tunnel domain keeps tunnel cookies
   and abuse reports away from your main site. Add a proxied wildcard DNS record on the tunnel
   domain (`*` → `192.0.2.1`); Cloudflare's Universal SSL covers `*.example.app`.
3. Set the token secret once: `pnpm -F @hostc/server exec wrangler secret put TOKEN_SECRET --name hostc-tunnel`
   (at least 32 random bytes, e.g. `openssl rand -base64 48`).
4. Deploy:

   ```sh
   API_DOMAIN=example.com TUNNEL_DOMAIN=example.app pnpm deploy:server
   ```

5. Use it: `npx hostc@latest 3000 --server https://example.com`, or build the CLI with
   `HOSTC_DEFAULT_SERVER=https://example.com pnpm build`.
