import * as stylex from "@stylexjs/stylex";

import { color, media, motion } from "./tokens.stylex.ts";

/** Styles several components share. */
export const base = stylex.create({
	// A link inside text: underlined, because color alone doesn't mark it.
	textLink: {
		color: color.link,
		textDecorationLine: "underline",
		textUnderlineOffset: "3px",
	},
	// A link on its own line, where its place already marks it.
	listLink: { color: color.link, textDecorationLine: "none" },
	// A link that is the content itself: in lists, navigation and the footer.
	quietLink: {
		color: "inherit",
		textDecorationLine: "none",
		transitionDuration: motion.quick,
		transitionProperty: "color",
	},
	hoverInk: {
		color: {
			default: "inherit",
			[media.hover]: { default: "inherit", ":hover": color.ink },
		},
	},
	focusRing: {
		outlineColor: color.muted,
		outlineOffset: "2px",
		outlineStyle: { default: "none", ":focus-visible": "solid" },
		outlineWidth: "2px",
	},
});
