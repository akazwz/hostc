import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	platform: "node",
	target: "node18",
	outDir: "dist",
	bundle: true,
	clean: true,
	dts: true,
	splitting: false,
	sourcemap: false,
	external: ["ws"],
	noExternal: ["@hostc/protocol"],
});
