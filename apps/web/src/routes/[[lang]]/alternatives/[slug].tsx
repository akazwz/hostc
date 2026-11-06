import { defineFileRoute } from "@solidjs/router/fs";
import { For } from "solid-js";

import { Command } from "../../../components/Command.tsx";
import { Crumbs } from "../../../components/Crumbs.tsx";
import { Head } from "../../../components/Head.tsx";
import { RelatedLinks } from "../../../components/RelatedLinks.tsx";
import { ALTERNATIVES, CHECKED_ON, HOSTC, ROW_LABELS, type Row } from "../../../content/alternatives.ts";
import { currentLocale, currentPath, localized, UI } from "../../../i18n.ts";

export const route = defineFileRoute("/:lang?/alternatives/:slug", { matchFilters: { lang: ["zh"] } });

const COPY = {
	en: {
		title: (name: string) => `${name} alternative: hostc vs ${name}`,
		description: (name: string, summary: string) =>
			`A free, open source ${name} alternative for sharing a dev server. ${summary}. How the two compare, and when to use each.`,
		chooseThem: (name: string) => `When ${name} is the better choice`,
		chooseUs: "When hostc is the better choice",
		chooseUsItems: [
			"You want a public link to a dev server in seconds, on any machine with Node.js.",
			"You share with people or services that shouldn't need an account or a click-through.",
			"You use hot reload, WebSockets or Server-Sent Events.",
		],
		tryIt: "Try hostc",
		checked: `From each product's documentation on ${CHECKED_ON}. Products change, so check theirs before you decide.`,
		sources: "Sources",
		more: "Other comparisons",
		vs: (name: string) => `hostc vs ${name}`,
	},
	zh: {
		title: (name: string) => `${name} 替代方案：hostc 与 ${name} 对比`,
		description: (name: string, summary: string) =>
			`免费开源的 ${name} 替代方案，用来分享开发服务。${summary}。两者的对比，以及各自适合什么场景。`,
		chooseThem: (name: string) => `什么时候选 ${name}`,
		chooseUs: "什么时候选 hostc",
		chooseUsItems: [
			"想在几秒内拿到开发服务的公网链接，在任何装了 Node.js 的机器上。",
			"要分享给不该注册账号、也不该多点一步的人或服务。",
			"用到了热更新、WebSocket 或 Server-Sent Events。",
		],
		tryIt: "试试 hostc",
		checked: `内容来自各产品 ${CHECKED_ON} 的文档。产品会变，决定之前请以它们的文档为准。`,
		sources: "资料来源",
		more: "其他对比",
		vs: (name: string) => `hostc 与 ${name} 对比`,
	},
};

export default function Alternative() {
	const locale = currentLocale();
	const copy = COPY[locale];
	const slug = currentPath().split("/").pop();
	const item = ALTERNATIVES.find((each) => each.slug === slug);
	if (!item) {
		throw new Error(`No comparison for ${slug}.`);
	}
	return (
		<main class="page">
			<Head
				title={`${copy.title(item.name)} · hostc`}
				description={copy.description(item.name, item.summary[locale])}
				path={`/alternatives/${item.slug}`}
			/>
			<Crumbs section={{ label: UI[locale].alternatives, path: "/alternatives" }} />
			<h1>{copy.title(item.name)}</h1>
			<p class="lead">{item.lead[locale]}</p>
			<div class="table">
				<table>
					<thead>
						<tr>
							<th />
							<th>hostc</th>
							<th>{item.name}</th>
						</tr>
					</thead>
					<tbody>
						<For each={Object.keys(ROW_LABELS) as Row[]}>
							{(row) => (
								<tr>
									<th scope="row">{ROW_LABELS[row][locale]}</th>
									<td>{HOSTC[row][locale]}</td>
									<td>{item.rows[row][locale]}</td>
								</tr>
							)}
						</For>
					</tbody>
				</table>
			</div>
			<p class="note">{copy.checked}</p>
			<div class="prose">
				<h2>{copy.chooseUs}</h2>
				<ul>
					<For each={copy.chooseUsItems}>{(reason) => <li>{reason}</li>}</For>
				</ul>
				<h2>{copy.chooseThem(item.name)}</h2>
				<ul>
					<For each={item.chooseThem[locale]}>{(reason) => <li>{reason}</li>}</For>
				</ul>
				<h2>{copy.tryIt}</h2>
				<Command>npx hostc@latest 3000</Command>
				<h2>{copy.sources}</h2>
				<ul>
					<For each={item.sources}>
						{(source) => (
							<li>
								<a href={source.url} rel="nofollow">
									{source.label}
								</a>
							</li>
						)}
					</For>
				</ul>
			</div>
			<RelatedLinks
				title={copy.more}
				links={ALTERNATIVES.filter((each) => each !== item).map((each) => ({
					href: localized(locale, `/alternatives/${each.slug}`),
					label: copy.vs(each.name),
				}))}
			/>
		</main>
	);
}
