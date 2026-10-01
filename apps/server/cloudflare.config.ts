import { env } from "node:process";

import { bindings, defineConfig, defineWorker, exports, triggers } from "cf/config";

import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

const worker = defineWorker({
	name: "hostc-tunnel",
	entrypoint,
	compatibilityDate: "2026-09-20",
	workersDev: false,
	// Declare the existing SQLite namespace when switching from migration history.
	exports: {
		Tunnel: exports.durableObject({ storage: "sqlite" }),
	},
});

export default defineConfig(({ mode }) => {
	const production = mode === "production";
	const apiDomain = production ? required("API_DOMAIN") : undefined;
	const tunnelDomain = production ? required("TUNNEL_DOMAIN") : (env.TUNNEL_DOMAIN ?? "localhost:8787");

	return {
		worker: {
			...worker,
			env: {
				TUNNEL_DOMAIN: bindings.text(tunnelDomain),
				TOKEN_SECRET: bindings.secret(),
				TUNNEL: bindings.durableObject({ worker, exportName: "Tunnel" }),
				CREATE_LIMIT: bindings.rateLimit({
					namespace: "1001",
					simple: { limit: 20, period: 60 },
				}),
			},
			// Explicit zones are required by accounts with SSL for SaaS.
			triggers: apiDomain
				? [
						triggers.fetch({ pattern: `${apiDomain}/api/*`, zone: env.API_ZONE ?? apiDomain }),
						triggers.fetch({ pattern: `*.${tunnelDomain}/*`, zone: env.TUNNEL_ZONE ?? tunnelDomain }),
					]
				: [],
			observability: {
				logs: { enabled: false },
				issues: { enabled: true },
			},
		},
	};
});

function required(name: string): string {
	const value = env[name];
	if (!value) {
		throw new Error(`${name} is required in production mode.`);
	}
	return value;
}
