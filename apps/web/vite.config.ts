import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { cloudflare } from "@cloudflare/vite-plugin";
import solid from "@solidjs/vite-plugin";
import { fileRoutes } from "filesystem-routing/vite";
import { sitemap } from "prerender-crawler";
import { prerender } from "prerender-crawler/vite";
import { defineConfig, type Plugin } from "vite";

import { site } from "./src/site.ts";

/** Structured data, and the small script behind the copy buttons. */
const KEPT_SCRIPT = /application\/ld\+json|src="\/copy\.js"/;

/**
 * Every page is text and links, so hydrating it would only cost download time. Solid renders the
 * pages at build time; this removes what it adds for hydration, along with the client build's
 * manifest, which only the prerender reads.
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
				const publicDir = resolve(builder.config.root, builder.config.publicDir);
				rmSync(join(output, ".vite"), { recursive: true, force: true });
				for (const file of readdirSync(publicDir)) {
					if (!readFileSync(join(output, file)).equals(readFileSync(join(publicDir, file)))) {
						throw new Error(`The build changed public/${file}.`);
					}
				}
				for (const entry of readdirSync(output, { recursive: true, encoding: "utf8" })) {
					const file = join(output, entry);
					if (entry.startsWith("assets") && entry.endsWith(".js")) {
						rmSync(file);
					} else if (entry.endsWith(".html")) {
						const html = readFileSync(file, "utf8");
						if (!html.includes('rel="stylesheet"')) {
							throw new Error(`${entry} has no stylesheet.`);
						}
						writeFileSync(
							file,
							html
								.replaceAll(/<script\b[^>]*>[\s\S]*?<\/script>/g, (tag) => (KEPT_SCRIPT.test(tag) ? tag : ""))
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
			pages: ["/", "/zh", { path: "/404", filename: "404.html" }, { path: "/zh/404", filename: "zh/404.html" }],
			concurrency: 1,
			// Only pages: a crawled /llms.txt would render the 404 page and overwrite the real file.
			filter: (path) => !path.includes("."),
			// Pages marked noindex, like the 404 pages, stay out of it.
			integrations: [sitemap({ hostname: site.origin })],
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
