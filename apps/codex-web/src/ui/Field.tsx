import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { omit } from "solid-js";

import { color, control, radius, space, text } from "./tokens.stylex.ts";

const styles = stylex.create({
	input: {
		width: "100%",
		minHeight: control.lg,
		paddingBlock: space.xs,
		paddingInline: space.md,
		borderWidth: "1px",
		borderStyle: "solid",
		borderColor: { default: color.line, ":focus": color.outline },
		outlineStyle: "none",
		borderRadius: radius.sm,
		backgroundColor: color.surface,
		color: color.text,
		fontFamily: "inherit",
		// 1rem under a finger: iOS zooms the page into anything smaller when it takes focus.
		fontSize: { default: text.md, "@media (pointer: coarse)": "1rem" },
	},
});

// A one-line text input. It takes every attribute of a native `<input>` except `class` and `style`.
export function TextInput(
	props: Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "class" | "style"> & { xstyle?: stylex.StyleXStyles },
) {
	const rest = omit(props, "xstyle");
	return <input {...rest} {...stylex.attrs(styles.input, props.xstyle)} />;
}
