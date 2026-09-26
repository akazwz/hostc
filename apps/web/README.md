# hostc website

hostc.dev: one static page (`public/index.html` and `public/style.css`), `llms.txt` for coding agents and
a 404 page, served by Cloudflare Workers static assets. Plain HTML and CSS, no build step.

```sh
pnpm -F web dev                          # http://localhost:8788
WEB_DOMAIN=hostc.dev pnpm deploy:web     # from the repository root
```
