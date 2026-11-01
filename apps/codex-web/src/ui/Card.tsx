import * as stylex from "@stylexjs/stylex";
import type { ParentProps } from "solid-js";

import { color, radius, shadow, space } from "./tokens.stylex.ts";

const styles = stylex.create({
	base: { minWidth: 0, borderRadius: radius.md },
	// Set into the page.
	inset: { backgroundColor: color.surface },
	// Lifted off the page.
	raised: { backgroundColor: color.raised, boxShadow: shadow.rest, borderRadius: radius.lg },
	pad: { padding: space.lg },
});

// A block of related things. Everything rounded on the page is one of these two, so they agree.
export function Card(props: ParentProps<{ tone?: "inset" | "raised"; pad?: boolean; xstyle?: stylex.StyleXStyles }>) {
	return (
		<div {...stylex.attrs(styles.base, styles[props.tone ?? "inset"], props.pad && styles.pad, props.xstyle)}>
			{props.children}
		</div>
	);
}
