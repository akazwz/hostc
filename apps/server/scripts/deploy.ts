/**
 * Deploys the tunnel server. Domains come from the environment, never from the repository:
 *
 *   API_DOMAIN=hostc.dev TUNNEL_DOMAIN=hostc.app pnpm deploy:server
 *
 * API_DOMAIN     host serving /api/* (create and connect)
 * TUNNEL_DOMAIN  tunnels are https://<id>.<TUNNEL_DOMAIN>; needs a proxied wildcard DNS record
 * API_ZONE, TUNNEL_ZONE  Cloudflare zones of the two domains, if they are subdomains
 *                        (default to the domains themselves)
 *
 * Routes and bindings are configured by cloudflare.config.ts in production mode.
 * Extra arguments are passed to `cf deploy`, e.g. `--dry-run`.
 * TOKEN_SECRET is a Worker secret: `pnpm exec wrangler secret put TOKEN_SECRET --name hostc-tunnel`.
 */
import { spawnSync } from "node:child_process";

const args = ["exec", "cf", "deploy", "--mode", "production", ...process.argv.slice(2)];
console.log(`pnpm ${args.join(" ")}`);
const result = spawnSync("pnpm", args, { stdio: "inherit" });
process.exit(result.status ?? 1);
