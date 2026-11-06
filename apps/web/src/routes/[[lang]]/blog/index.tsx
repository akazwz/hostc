import { defineFileRoute } from "@solidjs/router/fs";

import { Crumbs } from "../../../components/Crumbs.tsx";
import { Head } from "../../../components/Head.tsx";
import { posts } from "../../../content/blog.ts";
import { currentLocale, localized } from "../../../i18n.ts";
import { Lead, Page, PageTitle } from "../../../ui/Page.tsx";
import { PageList } from "../../../ui/PageList.tsx";

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
		<Page>
			<Head title={`${copy.title} · hostc`} description={copy.description} path="/blog" />
			<Crumbs />
			<PageTitle>{copy.title}</PageTitle>
			<Lead>{copy.lead}</Lead>
			<PageList
				items={posts(locale).map((post) => ({
					href: localized(locale, `/blog/${post.slug}`),
					title: post.title,
					detail: post.description,
					date: post.date,
				}))}
			/>
		</Page>
	);
}
