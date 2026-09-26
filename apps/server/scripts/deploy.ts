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
 * Extra arguments are passed to `wrangler deploy`, e.g. `--dry-run`.
 * TOKEN_SECRET is a Worker secret: `pnpm exec wrangler secret put TOKEN_SECRET`.
 */
import { spawnSync } from "node:child_process";

const apiDomain = required("API_DOMAIN");
const tunnelDomain = required("TUNNEL_DOMAIN");

const args = [
	"exec",
	"wrangler",
	"deploy",
	"--route",
	`${apiDomain}/api/*`,
	"--route",
	`*.${tunnelDomain}/*`,
	// Routes name their zone explicitly: accounts with SSL for SaaS reject routes whose zone is inferred.
	"--x-route-zones",
	"--zone",
	process.env.API_ZONE ?? apiDomain,
	"--zone",
	process.env.TUNNEL_ZONE ?? tunnelDomain,
	"--var",
	`TUNNEL_DOMAIN:${tunnelDomain}`,
	...process.argv.slice(2),
];
console.log(`pnpm ${args.join(" ")}`);
const result = spawnSync("pnpm", args, { stdio: "inherit" });
process.exit(result.status ?? 1);

function required(name: string): string {
	const value = process.env[name];
	if (!value) {
		console.error(`${name} is required. See the comment at the top of scripts/deploy.ts.`);
		process.exit(1);
	}
	return value;
}
