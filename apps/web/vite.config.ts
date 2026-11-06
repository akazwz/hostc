import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { cloudflare } from "@cloudflare/vite-plugin";
import solid from "@solidjs/vite-plugin";
import { fileRoutes } from "filesystem-routing/vite";
import { prerender } from "prerender-crawler/vite";
import { defineConfig, type Plugin } from "vite";

/**
 * Every page is plain text and links, so the site needs no script in the browser. Solid renders
 * the pages at build time; this removes what it adds for hydrating them, along with the client
 * build's manifest, which only the prerender reads.
 */
function staticOutput(): Plugin {
	return {
		name: "static-output",
		apply: "build",
		buildApp: {
			order: "post",
			async handler(builder) {
				const client = builder.environments["client"];
				if (!client) {
					return;
				}
				const output = resolve(builder.config.root, client.config.build.outDir);
				rmSync(join(output, ".vite"), { recursive: true, force: true });
				for (const entry of readdirSync(output, { recursive: true, encoding: "utf8" })) {
					const file = join(output, entry);
					if (entry.endsWith(".js")) {
						rmSync(file);
					} else if (entry.endsWith(".html")) {
						const html = readFileSync(file, "utf8");
						if (!html.includes('rel="stylesheet"')) {
							throw new Error(`${entry} has no stylesheet.`);
						}
						writeFileSync(
							file,
							html
								.replaceAll(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
								.replaceAll(/<link\b[^>]*rel="modulepreload"[^>]*>/g, "")
								.replaceAll(/ (_hk|data-dh|data-dhf)=("[^"]*"|[^\s>]*)/g, ""),
						);
					}
				}
			},
		},
	};
}

export default defineConfig({
	plugins: [
		// `async` waits for the whole page, so its HTML carries the content. `extensions` also
		// compiles the `?pick=` route modules that fileRoutes emits.
		solid({ start: { renderMode: "async" }, ssr: true, extensions: [".jsx", ".tsx"] }),
		fileRoutes({ types: true, codeSplitting: false }),
		// One page at a time: concurrent renders have mixed pages up on earlier Solid releases.
		prerender({
			mode: "static",
			pages: ["/", { path: "/404", filename: "404.html" }],
			concurrency: 1,
		}),
		staticOutput(),
		cloudflare(),
	],
	builder: {
		// Solid's plugin records where the client build went. With one set of plugins per
		// environment, the server side never learns that the Cloudflare plugin moved it, and pages
		// render with no stylesheet while the build still succeeds.
		sharedPlugins: true,
	},
});
