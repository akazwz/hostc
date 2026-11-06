import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";

import { color, media, text } from "./tokens.stylex.ts";

const styles = stylex.create({
	page: { paddingBlock: { default: "48px 80px", [media.narrow]: "32px 56px" } },
	title: {
		margin: 0,
		fontSize: "clamp(32px, 6vw, 44px)",
		fontWeight: 600,
		lineHeight: 1.15,
		letterSpacing: "-0.025em",
		textWrap: "balance",
	},
	lead: { marginBlock: "18px 36px", color: color.muted, fontSize: text.lead, lineHeight: 1.55 },
	note: { marginBlock: "12px 28px", color: color.muted, fontSize: text.sm },
});

/** The frame of every page but the home page. */
export function Page(props: { children: JSX.Element }) {
	return <main {...stylex.attrs(styles.page)}>{props.children}</main>;
}

export function PageTitle(props: { children: JSX.Element }) {
	return <h1 {...stylex.attrs(styles.title)}>{props.children}</h1>;
}

export function Lead(props: { children: JSX.Element }) {
	return <p {...stylex.attrs(styles.lead)}>{props.children}</p>;
}

export function Note(props: { children: JSX.Element }) {
	return <p {...stylex.attrs(styles.note)}>{props.children}</p>;
}
