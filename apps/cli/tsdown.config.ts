import { readFileSync } from "node:fs";

import { defineConfig } from "tsdown";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

export default defineConfig({
	entry: { hostc: "src/main.ts" },
	format: "esm",
	platform: "node",
	outDir: "dist",
	clean: true,
	dts: false,
	// The internal workspace packages are bundled; `ws` and `uqr` stay npm dependencies.
	deps: { onlyBundle: false },
	define: {
		__HOSTC_VERSION__: JSON.stringify(version),
		// Override when building for another deployment: HOSTC_DEFAULT_SERVER=https://example.com pnpm build
		__HOSTC_DEFAULT_SERVER__: JSON.stringify(process.env.HOSTC_DEFAULT_SERVER ?? "https://hostc.dev"),
	},
});
