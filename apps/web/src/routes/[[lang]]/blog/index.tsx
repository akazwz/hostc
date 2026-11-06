import { defineFileRoute } from "@solidjs/router/fs";
import { For } from "solid-js";

import { Crumbs } from "../../../components/Crumbs.tsx";
import { Head } from "../../../components/Head.tsx";
import { posts } from "../../../content/blog.ts";
import { currentLocale, localized } from "../../../i18n.ts";

export const route = defineFileRoute("/:lang?/blog", { matchFilters: { lang: ["zh"] } });

const COPY = {
	en: {
		title: "Blog",
		lead: "How tunnels work, and what we learn building hostc.",
		description: "Notes on localhost tunnels and on building hostc.",
	},
	zh: {
		title: "博客",
		lead: "隧道的工作原理，以及开发 hostc 时学到的东西。",
		description: "关于内网穿透和 hostc 开发的文章。",
	},
};

export default function Blog() {
	const locale = currentLocale();
	const copy = COPY[locale];
	return (
		<main class="page">
			<Head title={`${copy.title} · hostc`} description={copy.description} path="/blog" />
			<Crumbs />
			<h1>{copy.title}</h1>
			<p class="lead">{copy.lead}</p>
			<ul class="index">
				<For each={posts(locale)}>
					{(post) => (
						<li>
							<a href={localized(locale, `/blog/${post.slug}`)}>{post.title}</a>
							<span>{post.description}</span>
						</li>
					)}
				</For>
			</ul>
		</main>
	);
}
