import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { omit } from "solid-js";

import { base } from "./base.ts";
import { color, control, media, motion, radius, space, text } from "./tokens.stylex.ts";

const styles = stylex.create({
	base: {
		position: "relative",
		display: "inline-flex",
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		gap: "0.375rem",
		margin: 0,
		borderWidth: 0,
		borderRadius: radius.full,
		fontFamily: "inherit",
		fontWeight: 500,
		lineHeight: 1.2,
		// The label stays on one line and the button keeps its width: in a crowded row it is
		// the text beside it that gives way.
		whiteSpace: "nowrap",
		cursor: { default: "pointer", ":disabled": "default" },
		transitionDuration: motion.quick,
		transitionProperty: "background-color, box-shadow, color, opacity, transform",
		transitionTimingFunction: motion.ease,
		transform: { default: "none", ":active": { default: "scale(0.98)", ":disabled": "none" } },
		// No grey flash under a finger: the button has its own press look.
		WebkitTapHighlightColor: "transparent",
	},
	sm: { minWidth: control.sm, minHeight: control.sm, paddingInline: space.sm, fontSize: text.sm },
	md: { minWidth: control.md, minHeight: control.md, paddingInline: space.md, fontSize: text.sm },
	lg: { minWidth: control.lg, minHeight: control.lg, paddingInline: space.lg, fontSize: text.md },
	// The main action, and there is at most one in view. A fill in the accent says "this is the answer".
	solid: {
		backgroundColor: {
			default: color.accent,
			":disabled": color.selected,
			[media.hover]: {
				default: color.accent,
				":hover": { default: color.accentHover, ":disabled": color.selected },
				":disabled": color.selected,
			},
		},
		color: { default: color.onAccent, ":disabled": color.faint },
	},
	// The one action of an input, and stopping it: as strong as the text, without saying "needs you".
	strong: {
		backgroundColor: { default: color.text, ":disabled": color.selected },
		color: { default: color.bg, ":disabled": color.faint },
		opacity: { default: 1, [media.hover]: { default: 1, ":hover": { default: 0.85, ":disabled": 1 } } },
	},
	// An action beside the main one.
	secondary: {
		backgroundColor: {
			default: color.selected,
			[media.hover]: { default: color.selected, ":hover": color.press },
			":active": color.press,
		},
		color: { default: color.text, ":disabled": color.faint },
	},
	// Quiet until the pointer is over it: toolbars, and anything that repeats down the page.
	ghost: {
		backgroundColor: {
			default: "transparent",
			[media.hover]: { default: "transparent", ":hover": { default: color.hover, ":disabled": "transparent" } },
			":active": color.press,
		},
		color: {
			default: color.muted,
			[media.hover]: { default: color.muted, ":hover": { default: color.text, ":disabled": color.faint } },
			":disabled": color.faint,
		},
	},
	// On the inverse colors of a notice.
	inverse: { backgroundColor: "rgb(127 127 127 / 0.25)", color: "inherit" },
	// A control that is switched on.
	on: { color: color.text, backgroundColor: color.selected },
	// Square, for a single icon. Always pair with `aria-label`.
	iconOnly: { paddingInline: 0, aspectRatio: "1" },
	round: { borderRadius: radius.full },
});

type Props = Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "class" | "style"> & {
	variant?: "solid" | "strong" | "secondary" | "ghost" | "inverse";
	size?: "sm" | "md" | "lg";
	// A single icon and no text. Needs `aria-label`.
	icon?: boolean;
	round?: boolean;
	// Switched on: for a control that toggles something.
	on?: boolean;
	// Extra StyleX styles from the call site, for layout only (position, size, margins).
	xstyle?: stylex.StyleXStyles;
};

// A button. Use it for every action; something that goes to another address is an `<a>`. It takes every
// attribute of a native `<button>` except `class` and `style`, and is `type="button"` unless told otherwise.
export function Button(props: Props) {
	const rest = omit(props, "variant", "size", "icon", "round", "on", "xstyle");
	return (
		<button
			type="button"
			{...rest}
			{...stylex.attrs(
				styles.base,
				base.focusRing,
				styles[props.size ?? "md"],
				styles[props.variant ?? "secondary"],
				props.on && styles.on,
				props.icon && styles.iconOnly,
				props.round && styles.round,
				props.xstyle,
			)}
		/>
	);
}
