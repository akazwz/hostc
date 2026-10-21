import { env } from "node:process";

import { defineConfig, triggers } from "cf/config";

export default defineConfig(({ mode }) => {
	const webDomain = mode === "production" ? env.WEB_DOMAIN : undefined;
	if (mode === "production" && !webDomain) {
		throw new Error("WEB_DOMAIN is required in production mode.");
	}

	return {
		worker: {
			name: "hostc-web",
			compatibilityDate: "2026-09-20",
			workersDev: false,
			// Every switch is explicit: an omitted one falls back to Cloudflare's default (logs on).
			observability: {
				enabled: false,
				logs: { enabled: false, invocationLogs: false },
				traces: { enabled: false },
			},
			assets: {
				htmlHandling: "drop-trailing-slash",
				notFoundHandling: "404-page",
			},
			triggers: webDomain ? [triggers.fetch({ pattern: `${webDomain}/*`, zone: env.WEB_ZONE ?? webDomain })] : [],
		},
	};
});
