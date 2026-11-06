import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";

import { base } from "../ui/base.ts";
import { color, text } from "../ui/tokens.stylex.ts";

const styles = stylex.create({
	section: {
		marginBlockStart: "56px",
		paddingBlockStart: "28px",
		borderTopWidth: "1px",
		borderTopStyle: "solid",
		borderTopColor: color.line,
	},
	title: { marginBlock: "0 12px", fontSize: text.lg, fontWeight: 600 },
	list: { margin: 0, padding: 0, listStyleType: "none" },
	item: { paddingBlock: "5px", fontSize: text.md },
});

export function RelatedLinks(props: { title: string; links: { href: string; label: string }[] }) {
	return (
		<section {...stylex.attrs(styles.section)}>
			<h2 {...stylex.attrs(styles.title)}>{props.title}</h2>
			<ul {...stylex.attrs(styles.list)}>
				<For each={props.links}>
					{(link) => (
						<li {...stylex.attrs(styles.item)}>
							<a href={link.href} {...stylex.attrs(base.listLink, base.focusRing)}>
								{link.label}
							</a>
						</li>
					)}
				</For>
			</ul>
		</section>
	);
}
