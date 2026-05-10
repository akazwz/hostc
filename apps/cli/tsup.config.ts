import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
	version: string;
};

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["cjs"],
	platform: "node",
	target: "node18",
	outDir: "dist",
	bundle: true,
	clean: true,
	splitting: false,
	external: ["commander", "ws"],
	define: {
		__HOSTC_CLI_VERSION__: JSON.stringify(packageJson.version),
	},
});
