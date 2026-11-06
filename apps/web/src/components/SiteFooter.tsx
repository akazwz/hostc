import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";

import { ALTERNATIVES } from "../content/alternatives.ts";
import { GUIDES } from "../content/guides.ts";
import { currentLocale, localized, UI } from "../i18n.ts";
import { site } from "../site.ts";
import { base } from "../ui/base.ts";
import { color, media, text } from "../ui/tokens.stylex.ts";

const styles = stylex.create({
	footer: {
		paddingBlock: "44px 40px",
		borderTopWidth: "1px",
		borderTopStyle: "solid",
		borderTopColor: color.line,
		color: color.muted,
		fontSize: text.sm,
	},
	columns: {
		display: "grid",
		gridTemplateColumns: {
			default: "repeat(3, minmax(0, 1fr))",
			[media.narrow]: "repeat(2, minmax(0, 1fr))",
		},
		gap: "32px",
	},
	column: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "8px" },
	title: { marginBlock: "0 4px", color: color.ink, fontSize: text.sm, fontWeight: 600 },
	copyright: { marginBlock: "36px 0", fontSize: text.xs },
});

function Column(props: { title: JSX.Element; label: string; children: JSX.Element }) {
	return (
		<nav aria-label={props.label} {...stylex.attrs(styles.column)}>
			<h2 {...stylex.attrs(styles.title)}>{props.title}</h2>
			{props.children}
		</nav>
	);
}

export function SiteFooter() {
	const locale = currentLocale();
	const ui = UI[locale];
	const to = (path: string) => localized(locale, path);
	const link = stylex.attrs(base.quietLink, base.hoverInk, base.focusRing);
	return (
		<footer {...stylex.attrs(styles.footer)}>
			<div {...stylex.attrs(styles.columns)}>
				<Column title={ui.product} label={ui.product}>
					<a href={to("/blog")} {...link}>
						{ui.blog}
					</a>
					<a href={to("/changelog")} {...link}>
						{ui.changelog}
					</a>
					<a href="/llms.txt" {...link}>
						llms.txt
					</a>
					<a href={site.github} {...link}>
						{ui.star}
					</a>
				</Column>
				<Column title={ui.guides} label={ui.guides}>
					<For each={GUIDES}>
						{(guide) => (
							<a href={to(guide.path)} {...link}>
								{guide[locale].title}
							</a>
						)}
					</For>
				</Column>
				<Column
					title={
						<a href={to("/alternatives")} {...link}>
							{ui.alternatives}
						</a>
					}
					label={ui.alternatives}
				>
					<For each={ALTERNATIVES}>
						{(item) => (
							<a href={to(`/alternatives/${item.slug}`)} {...link}>
								{item.name}
							</a>
						)}
					</For>
				</Column>
			</div>
			<p {...stylex.attrs(styles.copyright)}>© 2026 hostc · Apache-2.0</p>
		</footer>
	);
}
