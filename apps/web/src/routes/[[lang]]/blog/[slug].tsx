import { defineFileRoute } from "@solidjs/router/fs";

import { Crumbs } from "../../../components/Crumbs.tsx";
import { Head } from "../../../components/Head.tsx";
import { JsonLd } from "../../../components/JsonLd.tsx";
import { posts } from "../../../content/blog.ts";
import { currentLocale, currentPath, LANGUAGE_TAGS, UI } from "../../../i18n.ts";
import { site } from "../../../site.ts";

export const route = defineFileRoute("/:lang?/blog/:slug", { matchFilters: { lang: ["zh"] } });

export default function Post() {
	const locale = currentLocale();
	const slug = currentPath().split("/").pop();
	const post = posts(locale).find((each) => each.slug === slug);
	if (!post) {
		throw new Error(`No post called ${slug}.`);
	}
	return (
		<main class="page">
			<Head title={`${post.title} · hostc`} description={post.description} path={`/blog/${post.slug}`} />
			<JsonLd
				data={{
					"@type": "BlogPosting",
					headline: post.title,
					description: post.description,
					datePublished: post.date,
					inLanguage: LANGUAGE_TAGS[locale],
					author: { "@type": "Organization", name: site.name, url: site.origin },
				}}
			/>
			<Crumbs section={{ label: UI[locale].blog, path: "/blog" }} />
			<h1>{post.title}</h1>
			<p class="note">
				<time datetime={post.date}>{post.date}</time>
			</p>
			<div class="prose" innerHTML={post.html} />
		</main>
	);
}
