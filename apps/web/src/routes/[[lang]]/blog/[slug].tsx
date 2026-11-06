import { defineFileRoute } from "@solidjs/router/fs";
import * as stylex from "@stylexjs/stylex";

import { Command } from "../../../components/Command.tsx";
import { Crumbs } from "../../../components/Crumbs.tsx";
import { Head } from "../../../components/Head.tsx";
import { JsonLd } from "../../../components/JsonLd.tsx";
import { RelatedLinks } from "../../../components/RelatedLinks.tsx";
import { posts } from "../../../content/blog.ts";
import { currentLocale, currentPath, LANGUAGE_TAGS, localized, UI } from "../../../i18n.ts";
import { site } from "../../../site.ts";
import { Markdown } from "../../../ui/Markdown.tsx";
import { Note, Page, PageTitle } from "../../../ui/Page.tsx";
import { color, media, text } from "../../../ui/tokens.stylex.ts";

export const route = defineFileRoute("/:lang?/blog/:slug", { matchFilters: { lang: ["zh"] } });

const styles = stylex.create({
	cta: {
		marginBlockStart: "48px",
		padding: { default: "24px", [media.narrow]: "16px" },
		borderWidth: "1px",
		borderStyle: "solid",
		borderColor: color.line,
		borderRadius: "12px",
		backgroundColor: color.subtle,
	},
	ctaTitle: { marginBlock: "0 2px", fontSize: text.lg, fontWeight: 600 },
});

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
		<Page>
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
			<PageTitle>{post.title}</PageTitle>
			<Note>
				<time datetime={post.date}>{post.date}</time>
			</Note>
			<Markdown source={post.body} />
			<section {...stylex.attrs(styles.cta)}>
				<h2 {...stylex.attrs(styles.ctaTitle)}>{TRY[locale]}</h2>
				<Command>npx hostc@latest 3000</Command>
			</section>
			<RelatedLinks
				title={MORE[locale]}
				links={all
					.filter((each) => each !== post)
					.slice(0, 5)
					.map((each) => ({ href: localized(locale, `/blog/${each.slug}`), label: each.title }))}
			/>
		</Page>
	);
}
