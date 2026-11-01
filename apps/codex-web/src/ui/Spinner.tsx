import * as stylex from "@stylexjs/stylex";

import { color, radius } from "./tokens.stylex.ts";

const spin = stylex.keyframes({ to: { transform: "rotate(360deg)" } });
const pulse = stylex.keyframes({ "50%": { opacity: 0.35 } });
const sheen = stylex.keyframes({ "50%": { opacity: 0.5 } });
const reduced = "@media (prefers-reduced-motion: reduce)";

const styles = stylex.create({
	spinner: {
		display: "inline-block",
		flexShrink: 0,
		width: "0.875rem",
		height: "0.875rem",
		borderWidth: "1.5px",
		borderStyle: "solid",
		borderColor: color.line,
		borderTopColor: color.muted,
		borderRadius: "50%",
		animationName: { default: spin, [reduced]: "none" },
		animationDuration: "0.8s",
		animationTimingFunction: "linear",
		animationIterationCount: "infinite",
	},
	dot: { display: "inline-block", flexShrink: 0, width: "0.4375rem", height: "0.4375rem", borderRadius: "50%" },
	live: {
		backgroundColor: color.muted,
		animationName: { default: pulse, [reduced]: "none" },
		animationDuration: "1.4s",
		animationIterationCount: "infinite",
	},
	attention: { backgroundColor: color.accentText },
	done: { backgroundColor: color.faint },
	failed: { backgroundColor: color.removed },
	skeleton: {
		display: "block",
		height: "0.875rem",
		borderRadius: radius.xs,
		backgroundColor: color.selected,
		animationName: { default: sheen, [reduced]: "none" },
		animationDuration: "1.6s",
		animationIterationCount: "infinite",
	},
	short: { width: "45%" },
	medium: { width: "70%" },
	long: { width: "92%" },
});

// Something in progress. Decoration: whatever it means is also said in text nearby.
export function Spinner() {
	return <span aria-hidden="true" {...stylex.attrs(styles.spinner)} />;
}

export type DotTone = "live" | "attention" | "done" | "failed";

// A small state mark. Only "this needs you" is in the accent. Decoration too.
export function Dot(props: { tone: DotTone }) {
	return <span aria-hidden="true" {...stylex.attrs(styles.dot, styles[props.tone])} />;
}

// A line standing in for text that is on its way. Better than a spinner: the layout doesn't jump.
export function Skeleton(props: { width?: "short" | "medium" | "long" }) {
	return <span aria-hidden="true" {...stylex.attrs(styles.skeleton, styles[props.width ?? "long"])} />;
}
