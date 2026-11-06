import { marked } from "marked";

import type { Locale } from "../i18n.ts";

export type Post = { slug: string; title: string; description: string; date: string; html: string };

const FILES = import.meta.glob<string>("../../content/blog/**/*.md", {
	query: "?raw",
	import: "default",
	eager: true,
});

function parse(path: string, source: string): Post {
	const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(source);
	if (!match) {
		throw new Error(`${path} has no front matter.`);
	}
	const meta = Object.fromEntries(
		(match[1] as string).split("\n").map((line) => {
			const colon = line.indexOf(":");
			return [
				line.slice(0, colon),
				line
					.slice(colon + 1)
					.trim()
					.replace(/^(['"])(.*)\1$/, "$2"),
			];
		}),
	) as Record<string, string>;
	const { title, description, date } = meta;
	if (!title || !description || !date) {
		throw new Error(`${path} needs title, description and date.`);
	}
	const slug = (path.split("/").pop() as string).replace(/\.md$/, "");
	return { slug, title, description, date, html: marked.parse(match[2] as string, { async: false }) };
}

/** Posts in one language, newest first. Chinese ones live in content/blog/zh. */
export function posts(locale: Locale): Post[] {
	return Object.entries(FILES)
		.filter(([path]) => path.includes("/blog/zh/") === (locale === "zh"))
		.map(([path, source]) => parse(path, source))
		.toSorted((a, b) => b.date.localeCompare(a.date));
}
