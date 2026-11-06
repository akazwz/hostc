import * as stylex from "@stylexjs/stylex";

import { currentLocale, UI } from "../i18n.ts";
import { base } from "../ui/base.ts";
import { color, font, media, motion, text } from "../ui/tokens.stylex.ts";

const styles = stylex.create({
	box: {
		display: "flex",
		alignItems: "center",
		width: "fit-content",
		maxWidth: "100%",
		gap: "12px",
		marginBlock: "12px",
		paddingBlock: "14px",
		paddingInline: "18px 14px",
		overflowX: "auto",
		borderWidth: "1px",
		borderStyle: "solid",
		borderColor: color.line,
		borderRadius: "10px",
		backgroundColor: color.subtle,
		fontFamily: font.mono,
		fontSize: text.md,
		lineHeight: 1.6,
		whiteSpace: "nowrap",
	},
	prompt: { color: color.link, userSelect: "none" },
	code: { userSelect: "all" },
	// No `display` here: copy.js reveals the button by clearing `hidden`.
	button: {
		paddingBlock: "4px",
		paddingInline: "10px",
		borderWidth: "1px",
		borderStyle: "solid",
		borderColor: color.line,
		borderRadius: "6px",
		backgroundColor: color.bg,
		color: { default: color.muted, [media.hover]: { default: color.muted, ":hover": color.ink } },
		fontFamily: font.body,
		fontSize: "12px",
		fontWeight: 500,
		lineHeight: 1.5,
		cursor: "pointer",
		transitionDuration: motion.quick,
		transitionProperty: "color",
	},
});

/** A command to run, with a button that copies it. public/copy.js shows and wires the button. */
export function Command(props: { children: string }) {
	const ui = UI[currentLocale()];
	return (
		<div {...stylex.attrs(styles.box)}>
			<span aria-hidden="true" {...stylex.attrs(styles.prompt)}>
				$
			</span>
			<code {...stylex.attrs(styles.code)}>{props.children}</code>
			<button
				type="button"
				hidden
				data-copy={props.children}
				data-copied={ui.copied}
				{...stylex.attrs(styles.button, base.focusRing)}
			>
				{ui.copy}
			</button>
		</div>
	);
}
