import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		cloudflareTest({
			experimental: { newConfig: true },
			miniflare: {
				// Vitest renames the Worker; bind Tunnel to the test runner itself.
				durableObjects: {
					TUNNEL: { className: "Tunnel", useSQLite: true },
				},
				bindings: {
					TUNNEL_DOMAIN: "tunnel.test",
					TOKEN_SECRET: "test-secret-that-is-at-least-32-bytes-long",
				},
			},
		}),
	],
});
