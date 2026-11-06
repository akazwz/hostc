import { defineFileRoute } from "@solidjs/router/fs";
import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";

import { Command } from "../../../components/Command.tsx";
import { Crumbs } from "../../../components/Crumbs.tsx";
import { Head } from "../../../components/Head.tsx";
import { RelatedLinks } from "../../../components/RelatedLinks.tsx";
import { ALTERNATIVES, CHECKED_ON, HOSTC, ROW_LABELS, type Row } from "../../../content/alternatives.ts";
import { currentLocale, currentPath, localized, UI } from "../../../i18n.ts";
import { base } from "../../../ui/base.ts";
import { H2, Item, List, Prose } from "../../../ui/Markdown.tsx";
import { Lead, Note, Page, PageTitle } from "../../../ui/Page.tsx";
import { color, text } from "../../../ui/tokens.stylex.ts";

export const route = defineFileRoute("/:lang?/alternatives/:slug", { matchFilters: { lang: ["zh"] } });

const styles = stylex.create({
	tableBox: { overflowX: "auto" },
	table: { width: "100%", borderCollapse: "collapse", fontSize: text.md, lineHeight: 1.5 },
	cell: {
		paddingBlock: "12px",
		paddingInline: "0 16px",
		borderBottomWidth: "1px",
		borderBottomStyle: "solid",
		borderBottomColor: color.line,
		fontWeight: 400,
		textAlign: "start",
		verticalAlign: "top",
	},
	strong: { fontWeight: 600 },
	rowLabel: { color: color.muted, whiteSpace: "nowrap" },
});

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
			"需要保存后页面自动更新（热更新），或者用到 WebSocket、Server-Sent Events。",
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
	const heading = copy.title(item.name);
	return (
		<Page>
			<Head
				title={`${heading} · hostc`}
				description={copy.description(item.name, item.summary[locale])}
				path={`/alternatives/${item.slug}`}
			/>
			<Crumbs section={{ label: UI[locale].alternatives, path: "/alternatives" }} />
			<PageTitle>{heading}</PageTitle>
			<Lead>{item.lead[locale]}</Lead>
			<div {...stylex.attrs(styles.tableBox)}>
				<table {...stylex.attrs(styles.table)}>
					<thead>
						<tr>
							<th {...stylex.attrs(styles.cell)} />
							<th {...stylex.attrs(styles.cell, styles.strong)}>hostc</th>
							<th {...stylex.attrs(styles.cell, styles.strong)}>{item.name}</th>
						</tr>
					</thead>
					<tbody>
						<For each={Object.keys(ROW_LABELS) as Row[]}>
							{(row) => (
								<tr>
									<th scope="row" {...stylex.attrs(styles.cell, styles.rowLabel)}>
										{ROW_LABELS[row][locale]}
									</th>
									<td {...stylex.attrs(styles.cell)}>{HOSTC[row][locale]}</td>
									<td {...stylex.attrs(styles.cell)}>{item.rows[row][locale]}</td>
								</tr>
							)}
						</For>
					</tbody>
				</table>
			</div>
			<Note>{copy.checked}</Note>
			<Prose>
				<H2>{copy.chooseUs}</H2>
				<List>
					<For each={copy.chooseUsItems}>{(reason) => <Item>{reason}</Item>}</For>
				</List>
				<H2>{copy.chooseThem(item.name)}</H2>
				<List>
					<For each={item.chooseThem[locale]}>{(reason) => <Item>{reason}</Item>}</For>
				</List>
				<H2>{copy.tryIt}</H2>
				<Command>npx hostc@latest 3000</Command>
				<H2>{copy.sources}</H2>
				<List>
					<For each={item.sources}>
						{(source) => (
							<Item>
								<a href={source.url} rel="nofollow" {...stylex.attrs(base.textLink, base.focusRing)}>
									{source.label}
								</a>
							</Item>
						)}
					</For>
				</List>
			</Prose>
			<RelatedLinks
				title={copy.more}
				links={ALTERNATIVES.filter((each) => each !== item).map((each) => ({
					href: localized(locale, `/alternatives/${each.slug}`),
					label: copy.vs(each.name),
				}))}
			/>
		</Page>
	);
}
