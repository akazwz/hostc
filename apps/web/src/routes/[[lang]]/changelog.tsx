import { defineFileRoute } from "@solidjs/router/fs";

import CHANGELOG from "../../../../cli/CHANGELOG.md?raw";
import { Crumbs } from "../../components/Crumbs.tsx";
import { Head } from "../../components/Head.tsx";
import { currentLocale } from "../../i18n.ts";
import { Markdown } from "../../ui/Markdown.tsx";
import { Lead, Page, PageTitle } from "../../ui/Page.tsx";

export const route = defineFileRoute("/:lang?/changelog", { matchFilters: { lang: ["zh"] } });

const COPY = {
	en: {
		title: "Changelog",
		lead: "What changed in each release of the hostc CLI.",
		description: "Release notes for the hostc CLI.",
	},
	zh: {
		title: "更新日志",
		lead: "hostc CLI 每个版本的改动。更新日志只有英文版。",
		description: "hostc CLI 的版本更新记录。",
	},
};

export default function Changelog() {
	const copy = COPY[currentLocale()];
	return (
		<Page>
			<Head title={`${copy.title} · hostc`} description={copy.description} path="/changelog" />
			<Crumbs />
			<PageTitle>{copy.title}</PageTitle>
			<Lead>{copy.lead}</Lead>
			{/* The file's first line is its own title. */}
			<Markdown source={CHANGELOG.replace(/^# .*\n/, "")} lang="en" />
		</Page>
	);
}
