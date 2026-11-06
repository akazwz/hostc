import { defineFileRoute } from "@solidjs/router/fs";

import { Command } from "../../../components/Command.tsx";
import { Crumbs } from "../../../components/Crumbs.tsx";
import { Head } from "../../../components/Head.tsx";
import { JsonLd } from "../../../components/JsonLd.tsx";
import { RelatedLinks } from "../../../components/RelatedLinks.tsx";
import { posts } from "../../../content/blog.ts";
import { currentLocale, currentPath, LANGUAGE_TAGS, localized, UI } from "../../../i18n.ts";
import { site } from "../../../site.ts";

export const route = defineFileRoute("/:lang?/blog/:slug", { matchFilters: { lang: ["zh"] } });

const TRY = {
	en: "Give localhost a public URL, free and with no account",
	zh: "一条命令拿到公网地址，免费，不用注册",
};
const MORE = { en: "More from the blog", zh: "更多文章" };

export default function Post() {
	const locale = currentLocale();
	const slug = currentPath().split("/").pop();
	const all = posts(locale);
	const post = all.find((each) => each.slug === slug);
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
			<section class="cta">
				<h2>{TRY[locale]}</h2>
				<Command>npx hostc@latest 3000</Command>
			</section>
			<RelatedLinks
				title={MORE[locale]}
				links={all
					.filter((each) => each !== post)
					.slice(0, 5)
					.map((each) => ({ href: localized(locale, `/blog/${each.slug}`), label: each.title }))}
			/>
		</main>
	);
}
