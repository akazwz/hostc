# hostc website

hostc.dev: Solid and StyleX pages in `src/routes`, rendered to static HTML at build time, with `llms.txt` for coding
agents. Cloudflare Workers serves the files. Browsers get HTML and CSS, no JavaScript.

```sh
pnpm -F web dev                          # http://localhost:5173
WEB_DOMAIN=hostc.dev pnpm -F web build   # writes .cloudflare/output/v0/workers/default/assets
WEB_DOMAIN=hostc.dev pnpm deploy:web     # from the repository root
```
