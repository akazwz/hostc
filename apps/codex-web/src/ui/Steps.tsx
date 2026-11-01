import * as stylex from "@stylexjs/stylex";
import { createEffect, For } from "solid-js";

import { color, media, motion, radius } from "./tokens.stylex.ts";

const THUMB = "1.625rem";

const styles = stylex.create({
	root: { position: "relative", height: THUMB, minWidth: 0 },
	track: {
		position: "absolute",
		insetInline: 0,
		top: "0.125rem",
		bottom: "0.125rem",
		overflow: "hidden",
		borderRadius: radius.full,
		backgroundColor: color.selected,
	},
	fill: {
		position: "absolute",
		insetBlock: 0,
		insetInlineStart: 0,
		borderRadius: radius.full,
		backgroundColor: color.outline,
		transitionDuration: motion.quick,
		transitionProperty: "width",
	},
	marks: {
		position: "absolute",
		insetInline: `calc(${THUMB} / 2)`,
		top: "50%",
		display: "flex",
		justifyContent: "space-between",
	},
	// No width of its own, so that the dot sits exactly on the value.
	mark: { display: "flex", justifyContent: "center", width: 0 },
	dot: {
		flexShrink: 0,
		width: "0.1875rem",
		height: "0.1875rem",
		marginBlockStart: "-0.09375rem",
		borderRadius: "50%",
		backgroundColor: color.muted,
	},
	input: {
		appearance: "none",
		position: "absolute",
		inset: 0,
		width: "100%",
		height: "100%",
		margin: 0,
		borderRadius: radius.full,
		backgroundColor: "transparent",
		cursor: "pointer",
		// A horizontal drag on a phone moves this, not the page.
		touchAction: "pan-y",
		outlineColor: color.outline,
		outlineOffset: "2px",
		outlineStyle: { default: "none", ":focus-visible": "solid" },
		outlineWidth: "2px",
		"::-webkit-slider-thumb": {
			appearance: "none",
			width: THUMB,
			height: THUMB,
			borderRadius: "50%",
			backgroundColor: "#ffffff",
			boxShadow: "0 0 0 0.5px rgb(0 0 0 / 0.12), 0 1px 4px rgb(0 0 0 / 0.3)",
			transitionDuration: motion.quick,
			transitionProperty: "scale",
			scale: { default: 1, [media.hover]: { default: 1, ":hover": 1.04 } },
		},
		"::-moz-range-thumb": {
			width: THUMB,
			height: THUMB,
			borderWidth: 0,
			borderRadius: "50%",
			backgroundColor: "#ffffff",
			boxShadow: "0 0 0 0.5px rgb(0 0 0 / 0.12), 0 1px 4px rgb(0 0 0 / 0.3)",
		},
	},
});

// A choice along one line of a few ordered values, such as how hard to think. A native range input,
// so the keyboard, touch and screen readers work; everything else here only draws it.
export function Steps(props: {
	label: string;
	value: number;
	count: number;
	// What the current value is called, read out instead of its number.
	valueText: string;
	onChange: (value: number) => void;
}) {
	let fill: HTMLDivElement | undefined;
	createEffect(
		() => (props.count > 1 ? props.value / (props.count - 1) : 0),
		(share) => {
			// Set from script: the page's content security policy allows no inline style attributes.
			if (fill) {
				fill.style.width = `calc(${THUMB} + (100% - ${THUMB}) * ${share})`;
			}
		},
	);
	return (
		<div {...stylex.attrs(styles.root)}>
			<div aria-hidden="true" {...stylex.attrs(styles.track)}>
				<div
					ref={(element) => {
						fill = element;
					}}
					{...stylex.attrs(styles.fill)}
				/>
				<div {...stylex.attrs(styles.marks)}>
					<For each={Array.from({ length: props.count }, (_, index) => index)}>
						{() => (
							<span {...stylex.attrs(styles.mark)}>
								<span {...stylex.attrs(styles.dot)} />
							</span>
						)}
					</For>
				</div>
			</div>
			<input
				type="range"
				min="0"
				max={props.count - 1}
				step="1"
				value={props.value}
				aria-label={props.label}
				aria-valuetext={props.valueText}
				{...stylex.attrs(styles.input)}
				onInput={(event) => props.onChange(Number(event.currentTarget.value))}
			/>
		</div>
	);
}
