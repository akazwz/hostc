import { defineFileRoute } from "@solidjs/router/fs";
import { marked } from "marked";

import CHANGELOG from "../../../../cli/CHANGELOG.md?raw";
import { Crumbs } from "../../components/Crumbs.tsx";
import { Head } from "../../components/Head.tsx";
import { currentLocale } from "../../i18n.ts";

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
	// The file's first line is its own title.
	const html = marked.parse(CHANGELOG.replace(/^# .*\n/, ""), { async: false });
	return (
		<main class="page">
			<Head title={`${copy.title} · hostc`} description={copy.description} path="/changelog" />
			<Crumbs />
			<h1>{copy.title}</h1>
			<p class="lead">{copy.lead}</p>
			<div class="prose" lang="en" innerHTML={html} />
		</main>
	);
}
