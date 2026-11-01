import { HydrationScript } from "@solidjs/web";
import type { ParentProps } from "solid-js";

import { site } from "./site.ts";

// The document shell, in place of index.html. It is rendered once, at build time, into
// dist/client/index.html, which answers every address, and it ships no client code of its
// own. <HydrationScript /> is stripped in client mode and takes effect under `ssr: true`.
export default function Document(props: ParentProps) {
	return (
		<html lang="en">
			<head>
				<meta charset="utf-8" />
				<meta
					name="viewport"
					content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"
				/>
				<title>{site.name}</title>
				<meta name="description" content={site.description} />
				<meta name="robots" content="noindex" />
				<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
				<HydrationScript />
				{/* Without index.html, the StyleX plugin cannot inject its dev stylesheet and HMR runtime. */}
				{import.meta.env.DEV && (
					<>
						<link rel="stylesheet" href="/virtual:stylex.css" />
						<script type="module" src="/@id/virtual:stylex:runtime" />
					</>
				)}
			</head>
			<body>{props.children}</body>
		</html>
	);
}
