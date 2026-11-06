import type { ParentProps } from "solid-js";

import { currentLocale, LANGUAGE_TAGS } from "./i18n.ts";
import { site } from "./site.ts";

/** The document around every page. Each page sets its own head tags through components/Head.tsx. */
export default function Document(props: ParentProps) {
	return (
		<html lang={LANGUAGE_TAGS[currentLocale()]}>
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
				<meta name="theme-color" content="#1c1c1f" media="(prefers-color-scheme: dark)" />
				<title>{site.name}</title>
				<link rel="icon" href="/favicon.ico" sizes="32x32" />
				<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
				<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
				<script src="/copy.js" defer />
			</head>
			<body>{props.children}</body>
		</html>
	);
}
