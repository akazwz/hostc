/**
 * Deploys the website. The domain comes from the environment, never from the repository:
 *
 *   WEB_DOMAIN=hostc.dev pnpm -F web run deploy
 *
 * WEB_DOMAIN  host serving the site
 * WEB_ZONE    Cloudflare zone of WEB_DOMAIN, if it is a subdomain (defaults to WEB_DOMAIN)
 *
 * Extra arguments are passed to `wrangler deploy`, e.g. `--dry-run`.
 */
import { spawnSync } from "node:child_process";

const webDomain = process.env.WEB_DOMAIN;
if (!webDomain) {
	console.error("WEB_DOMAIN is required. See the comment at the top of scripts/deploy.ts.");
	process.exit(1);
}

// Routes name their zone explicitly: accounts with SSL for SaaS reject routes whose zone is inferred.
const zone = process.env.WEB_ZONE ?? webDomain;
run([
	"exec",
	"wrangler",
	"deploy",
	"--route",
	`${webDomain}/*`,
	"--x-route-zones",
	"--zone",
	zone,
	...process.argv.slice(2),
]);

function run(args: string[]): void {
	console.log(`pnpm ${args.join(" ")}`);
	const result = spawnSync("pnpm", args, { stdio: "inherit" });
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}
