import { env } from "node:process";

import { bindings, defineConfig, defineWorker, exports, triggers } from "cf/config";

import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };
import { CREATE_RATE_LIMIT } from "./src/limits.ts";

const worker = defineWorker({
	name: "hostc-tunnel",
	entrypoint,
	// 2026-11-17+ enables Request.signal by default (no compatibilityFlags needed).
	compatibilityDate: "2026-11-27",
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
				TUNNEL_LIMITS: bindings.text(env.TUNNEL_LIMITS ?? ""),
				TOKEN_SECRET: bindings.secret(),
				TUNNEL: bindings.durableObject({ worker, exportName: "Tunnel" }),
				ERRORS: bindings.analyticsEngineDataset({ name: "hostc_errors" }),
				CREATE_LIMIT: bindings.rateLimit({
					namespace: "1001",
					simple: { limit: CREATE_RATE_LIMIT.limit, period: CREATE_RATE_LIMIT.period },
				}),
			},
			// Explicit zones are required by accounts with SSL for SaaS.
			triggers: apiDomain
				? [
						triggers.fetch({ pattern: `${apiDomain}/api/*`, zone: env.API_ZONE ?? apiDomain }),
						triggers.fetch({ pattern: `*.${tunnelDomain}/*`, zone: env.TUNNEL_ZONE ?? tunnelDomain }),
					]
				: [],
			// Every switch is explicit: an omitted one falls back to Cloudflare's default (invocation logs on).
			// Keep invocationLogs off so only explicit structured warning/error logs and uncaught errors are ingested.
			observability: {
				enabled: true,
				logs: { enabled: true, invocationLogs: false, persist: true, headSamplingRate: 1 },
				traces: { enabled: false },
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
