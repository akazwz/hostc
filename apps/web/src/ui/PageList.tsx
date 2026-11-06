import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";

import { base } from "./base.ts";
import { color, text } from "./tokens.stylex.ts";

const styles = stylex.create({
	list: {
		margin: 0,
		padding: 0,
		listStyleType: "none",
		borderTopWidth: "1px",
		borderTopStyle: "solid",
		borderTopColor: color.line,
	},
	item: {
		display: "flex",
		flexDirection: "column",
		gap: "3px",
		paddingBlock: "16px",
		borderBottomWidth: "1px",
		borderBottomStyle: "solid",
		borderBottomColor: color.line,
	},
	title: { color: color.ink, fontSize: text.lg, fontWeight: 600, letterSpacing: "-0.005em" },
	detail: { color: color.muted, fontSize: text.sm, lineHeight: 1.5 },
	date: { color: color.muted, fontSize: text.xs },
});

export type PageListItem = { href: string; title: JSX.Element; detail: string; date?: string };

/** A list of pages: each a title with a line about it. */
export function PageList(props: { items: PageListItem[] }) {
	return (
		<ul {...stylex.attrs(styles.list)}>
			<For each={props.items}>
				{(item) => (
					<li {...stylex.attrs(styles.item)}>
						<a href={item.href} {...stylex.attrs(base.quietLink, styles.title, base.focusRing)}>
							{item.title}
						</a>
						<span {...stylex.attrs(styles.detail)}>{item.detail}</span>
						{item.date && (
							<time datetime={item.date} {...stylex.attrs(styles.date)}>
								{item.date}
							</time>
						)}
					</li>
				)}
			</For>
		</ul>
	);
}
