/**
 * Deploys the website. The domain comes from the environment, never from the repository:
 *
 *   WEB_DOMAIN=hostc.dev pnpm -F web run deploy
 *
 * WEB_DOMAIN  host serving the site
 * WEB_ZONE    Cloudflare zone of WEB_DOMAIN, if it is a subdomain (defaults to WEB_DOMAIN)
 *
 * Routes are configured by cloudflare.config.ts in production mode.
 * Extra arguments are passed to `cf deploy`, e.g. `--dry-run`.
 */
import { spawnSync } from "node:child_process";

const args = ["exec", "cf", "deploy", "--mode", "production", ...process.argv.slice(2)];
console.log(`pnpm ${args.join(" ")}`);
const result = spawnSync("pnpm", args, { stdio: "inherit" });
process.exit(result.status ?? 1);
