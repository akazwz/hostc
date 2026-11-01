import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";

import { base } from "./base.ts";
import { color, control, media, motion, radius, space, text } from "./tokens.stylex.ts";

const styles = stylex.create({
	list: {
		display: "inline-flex",
		gap: space.xxs,
		padding: space.xxs,
		borderRadius: radius.sm,
		backgroundColor: color.surface,
	},
	tab: {
		minHeight: control.sm,
		paddingInline: space.md,
		borderWidth: 0,
		borderRadius: radius.xs,
		backgroundColor: { default: "transparent", "[aria-selected='true']": color.overlay },
		boxShadow: { default: "none", "[aria-selected='true']": "0 1px 2px rgb(0 0 0 / 0.12)" },
		color: {
			default: color.muted,
			"[aria-selected='true']": color.text,
			[media.hover]: { default: color.muted, ":hover": color.text, "[aria-selected='true']": color.text },
		},
		cursor: "pointer",
		fontFamily: "inherit",
		fontSize: text.sm,
		fontWeight: 500,
		transitionDuration: motion.quick,
		transitionProperty: "background-color, color",
	},
});

// A choice between views of the same thing.
export function Tabs<T extends string>(props: {
	label: string;
	value: T;
	options: readonly { value: T; label: string }[];
	onChange: (value: T) => void;
}) {
	return (
		<div role="tablist" aria-label={props.label} {...stylex.attrs(styles.list)}>
			<For each={props.options}>
				{(option) => (
					<button
						type="button"
						role="tab"
						aria-selected={option.value === props.value ? "true" : "false"}
						{...stylex.attrs(styles.tab, base.focusRing)}
						onClick={() => props.onChange(option.value)}
					>
						{option.label}
					</button>
				)}
			</For>
		</div>
	);
}
