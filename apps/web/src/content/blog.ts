import type { Locale } from "../i18n.ts";
import { documents } from "./documents.ts";

export type Post = { slug: string; title: string; description: string; date: string; body: string };

/** Posts in one language, newest first. Chinese ones live in content/blog/zh. */
export function posts(locale: Locale): Post[] {
	return documents("blog", locale === "zh")
		.map(({ slug, meta, body }) => {
			const { title, description, date } = meta;
			if (!title || !description || !date) {
				throw new Error(`Post ${slug} needs title, description and date.`);
			}
			return { slug, title, description, date, body };
		})
		.toSorted((a, b) => b.date.localeCompare(a.date));
}
