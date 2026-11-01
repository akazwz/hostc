import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { Show } from "solid-js";

import { color, space, text } from "./tokens.stylex.ts";

const styles = stylex.create({
	root: {
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
		justifyContent: "center",
		gap: space.xs,
		flexGrow: 1,
		padding: space.xl,
		textAlign: "center",
	},
	title: { margin: 0, color: color.muted, fontSize: text.md, fontWeight: 500 },
	hint: { margin: 0, maxWidth: "24rem", color: color.faint, fontSize: text.sm },
});

// Nothing here yet, and what to do about it.
export function EmptyState(props: { title: string; hint?: JSX.Element }) {
	return (
		<div {...stylex.attrs(styles.root)}>
			<p {...stylex.attrs(styles.title)}>{props.title}</p>
			<Show when={props.hint}>
				<p {...stylex.attrs(styles.hint)}>{props.hint}</p>
			</Show>
		</div>
	);
}
