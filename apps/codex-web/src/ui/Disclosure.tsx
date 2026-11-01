import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { createEffect, createSignal, type ParentProps, Show } from "solid-js";

import { base } from "./base.ts";
import { Icon } from "./Icon.tsx";
import { color, control, media, motion, radius, space, text } from "./tokens.stylex.ts";

const styles = stylex.create({
	root: { minWidth: 0 },
	summary: {
		display: "flex",
		alignItems: "center",
		gap: space.sm,
		minHeight: control.sm,
		borderRadius: radius.xs,
		color: { default: color.muted, [media.hover]: { default: color.muted, ":hover": color.text } },
		cursor: "pointer",
		fontSize: text.md,
		listStyle: "none",
		transitionDuration: motion.quick,
		transitionProperty: "color",
		"::-webkit-details-marker": { display: "none" },
	},
	chevron: {
		display: "flex",
		flexShrink: 0,
		color: color.faint,
		transitionDuration: motion.move,
		transitionProperty: "transform",
		transitionTimingFunction: motion.ease,
	},
	chevronOpen: { transform: "rotate(90deg)" },
	button: {
		flexShrink: 0,
		width: "100%",
		padding: 0,
		borderWidth: 0,
		backgroundColor: "transparent",
		fontFamily: "inherit",
		textAlign: "start",
	},
	body: { paddingBlockStart: space.xs },
});

// Something folded. The native <details> brings keyboard use and state with it. What is inside is only
// rendered once it has been opened: a long run folds a lot away, and most of it is never looked at.
export function Disclosure(
	props: ParentProps<{
		summary: JSX.Element;
		open?: boolean;
		xstyle?: stylex.StyleXStyles;
		summaryStyle?: stylex.StyleXStyles;
		bodyStyle?: stylex.StyleXStyles;
	}>,
) {
	const [open, setOpen] = createSignal(props.open ?? false);
	const [opened, setOpened] = createSignal(open());
	// A change of the prop means something happened, such as a command failing. Reading it this way
	// leaves what the person chose alone until then.
	createEffect(
		() => props.open,
		(next) => {
			if (next !== undefined) {
				setOpen(next);
				if (next) {
					setOpened(true);
				}
			}
		},
	);
	return (
		<details
			open={open()}
			{...stylex.attrs(styles.root, props.xstyle)}
			onToggle={(event) => {
				setOpen(event.currentTarget.open);
				if (event.currentTarget.open) {
					setOpened(true);
				}
			}}
		>
			<summary {...stylex.attrs(styles.summary, base.focusRing, props.summaryStyle)}>
				{props.summary}
				<span {...stylex.attrs(styles.chevron, open() && styles.chevronOpen)}>
					<Icon name="chevronRight" small />
				</span>
			</summary>
			<Show when={opened()}>
				<div {...stylex.attrs(styles.body, props.bodyStyle)}>{props.children}</div>
			</Show>
		</details>
	);
}

// The same line, for what it folds lives elsewhere in the page and has to stay where it is.
export function DisclosureButton(props: ParentProps<{ open: boolean; onToggle: () => void }>) {
	return (
		<button
			type="button"
			aria-expanded={props.open ? "true" : "false"}
			{...stylex.attrs(styles.summary, styles.button, base.focusRing)}
			onClick={() => props.onToggle()}
		>
			{props.children}
			<span {...stylex.attrs(styles.chevron, props.open && styles.chevronOpen)}>
				<Icon name="chevronRight" small />
			</span>
		</button>
	);
}
