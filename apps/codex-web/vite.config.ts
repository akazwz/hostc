import solid from "@solidjs/vite-plugin";
import stylex from "@stylexjs/unplugin";
import { fileRoutes } from "filesystem-routing/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		// StyleX must compile before Solid transforms JSX.
		stylex.vite({
			useCSSLayers: true,
			// The plugin appends its rules to the built CSS after Vite has minified it, and
			// leaves them pretty-printed unless told to minify them itself.
			lightningcssOptions: { minify: true },
		}),
		// Client start mode: no index.html and no mount file. The plugin generates the entries
		// around src/App.tsx and src/Document.tsx, and `vite build` emits a static dist/client.
		// `extensions` also compiles the `?pick=` route modules that fileRoutes emits.
		// `diagnostics` serves /__solid/diagnostics on the dev server (see docs/solid2-stylex.md).
		solid({ start: true, extensions: [".jsx", ".tsx"], diagnostics: true }),
		// Scans src/routes and writes file-routes.d.ts, which types `paths` in src/router.ts.
		fileRoutes({ types: true }),
	],
	server: {
		// Print the browser's console warnings and errors, Solid's diagnostics among them, in
		// the dev server's log. Vite only does this by itself when it detects a coding agent.
		forwardConsole: true,
	},
});
