import * as stylex from "@stylexjs/stylex";

import { color, motion, radius } from "./tokens.stylex.ts";

// Styles shared by several components and call sites. Apply them next to a component's own
// styles: `stylex.attrs(styles.link, base.focusRing)`.
export const base = stylex.create({
	// The keyboard focus ring of every interactive element, links included.
	focusRing: {
		outlineColor: color.outline,
		outlineOffset: "2px",
		outlineStyle: { default: "none", ":focus-visible": "solid" },
		outlineWidth: "2px",
	},
	// Answers inside a decision, the one place the accent fills a control.
	radio: {
		appearance: "none",
		flexShrink: 0,
		width: "1rem",
		height: "1rem",
		margin: 0,
		borderRadius: "50%",
		backgroundColor: { default: "transparent", ":checked": color.onAccent },
		boxShadow: {
			default: `inset 0 0 0 1.5px ${color.outline}`,
			":checked": `inset 0 0 0 0.3125rem ${color.accent}`,
		},
		cursor: "pointer",
		transitionDuration: motion.quick,
		transitionProperty: "box-shadow",
	},
	checkbox: {
		appearance: "none",
		flexShrink: 0,
		width: "1rem",
		height: "1rem",
		margin: 0,
		borderRadius: radius.xs,
		backgroundColor: { default: "transparent", ":checked": color.accent },
		backgroundImage: {
			default: "none",
			":checked":
				"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 6 9 17l-5-5'/%3E%3C/svg%3E\")",
		},
		boxShadow: { default: `inset 0 0 0 1.5px ${color.outline}`, ":checked": "none" },
		cursor: "pointer",
	},
});
