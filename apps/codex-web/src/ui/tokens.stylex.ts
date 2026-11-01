import * as stylex from "@stylexjs/stylex";

// Design tokens. Components read these variables and never hard-code a color, a size or a
// radius. Light and dark are both in each variable and follow the system's setting; a theme
// would be one `stylex.createTheme()` override of a group below.

// The media queries styles are written under: `[media.narrow]: value`. `narrow` is the one
// breakpoint between the phone layout and the desktop one; `dark` is the system's dark
// appearance; `hover` is a primary pointer that can hover (a touch screen would keep `:hover`
// on after a tap); `reducedMotion` is the reader's request for less movement.
export const media = stylex.defineConsts({
	narrow: "@media (max-width: 767px)",
	dark: "@media (prefers-color-scheme: dark)",
	hover: "@media (hover: hover)",
	reducedMotion: "@media (prefers-reduced-motion: reduce)",
});

// The accent is written once: the variables below that derive from it read this. hostc's orange.
const accent = "#c2410c";

export const color = stylex.defineVars({
	// Lightness carries structure, from the bottom up: the sidebar, the working area, a block set into it,
	// a card lifted off it, a panel floating over everything.
	canvas: { default: "#f7f7f8", [media.dark]: "#0f0f11" },
	bg: { default: "#ffffff", [media.dark]: "#141416" },
	surface: { default: "#f4f4f5", [media.dark]: "#1c1c1f" },
	raised: { default: "#ffffff", [media.dark]: "#232327" },
	overlay: { default: "#ffffff", [media.dark]: "#2c2c31" },
	// What the person said. Has to stand out from `bg` in both schemes.
	bubble: { default: "#efeff1", [media.dark]: "#2c2c31" },
	// Under the pointer, and while pressed.
	hover: { default: "rgb(0 0 0 / 0.045)", [media.dark]: "rgb(255 255 255 / 0.06)" },
	press: { default: "rgb(0 0 0 / 0.08)", [media.dark]: "rgb(255 255 255 / 0.1)" },
	selected: { default: "rgb(0 0 0 / 0.06)", [media.dark]: "rgb(255 255 255 / 0.08)" },
	// A hairline between regions, and the line around a control (3:1 or more on `bg` in both schemes).
	line: { default: "rgb(0 0 0 / 0.09)", [media.dark]: "rgb(255 255 255 / 0.09)" },
	outline: { default: "#8b8b95", [media.dark]: "#71717a" },
	scrim: { default: "rgb(0 0 0 / 0.32)", [media.dark]: "rgb(0 0 0 / 0.55)" },
	// Text: what matters, what supports it, and what only helps. All 4.5:1 or more on `bg`.
	text: { default: "#111113", [media.dark]: "#f4f4f5" },
	muted: { default: "#5f5f68", [media.dark]: "#a1a1aa" },
	faint: { default: "#74747d", [media.dark]: "#8d8d96" },
	// The accent means one thing: this needs you. `accent` is a fill, and
	// `onAccent` text on it is 5.1:1. `accentText` carries the accent as text, a line or a mark.
	accent,
	accentHover: {
		default: `color-mix(in oklch, ${accent} 85%, black)`,
		[media.dark]: `color-mix(in oklch, ${accent} 88%, white)`,
	},
	onAccent: "#ffffff",
	accentText: { default: accent, [media.dark]: "#ff8a3d" },
	accentSoft: { default: "rgb(194 65 12 / 0.08)", [media.dark]: "rgb(255 138 61 / 0.1)" },
	// Added and removed, succeeded and failed. 4.5:1 or more on `bg`.
	added: { default: "#15803d", [media.dark]: "#4ade80" },
	removed: { default: "#b91c1c", [media.dark]: "#f87171" },
	addedBg: { default: "rgb(21 128 61 / 0.09)", [media.dark]: "rgb(74 222 128 / 0.09)" },
	removedBg: { default: "rgb(185 28 28 / 0.08)", [media.dark]: "rgb(248 113 113 / 0.09)" },
	// Code. All 4.5:1 or more on `surface` in both schemes.
	codeKeyword: { default: "#6d28d9", [media.dark]: "#c4b5fd" },
	codeString: { default: "#166534", [media.dark]: "#86efac" },
	codeComment: { default: "#6b6b75", [media.dark]: "#9a9aa3" },
	codeNumber: { default: "#1d4ed8", [media.dark]: "#93c5fd" },
});

export const space = stylex.defineVars({
	xxs: "0.125rem",
	xs: "0.25rem",
	sm: "0.5rem",
	md: "0.75rem",
	lg: "1rem",
	xl: "1.5rem",
	xxl: "2.5rem",
});

export const radius = stylex.defineVars({
	xs: "0.375rem",
	sm: "0.625rem",
	md: "0.875rem",
	lg: "1.125rem",
	xl: "1.5rem",
	full: "999px",
});

export const shadow = stylex.defineVars({
	// A panel floating over the page.
	float: {
		default: "0 0 0 1px rgb(0 0 0 / 0.06), 0 12px 32px rgb(0 0 0 / 0.12), 0 2px 6px rgb(0 0 0 / 0.06)",
		[media.dark]: "0 0 0 1px rgb(255 255 255 / 0.08), 0 12px 32px rgb(0 0 0 / 0.5), 0 2px 6px rgb(0 0 0 / 0.3)",
	},
	// The input, resting just above the page.
	rest: {
		default: "0 0 0 1px rgb(0 0 0 / 0.09), 0 2px 10px rgb(0 0 0 / 0.05)",
		[media.dark]: "inset 0 0 1px rgb(255 255 255 / 0.25), 0 2px 12px rgb(0 0 0 / 0.25)",
	},
});

export const text = stylex.defineVars({
	xs: "0.75rem",
	sm: "0.8125rem",
	md: "0.875rem",
	// Text to read, and to type: iOS zooms into inputs smaller than 1rem.
	read: "1rem",
	lg: "1.125rem",
	display: "1.5rem",
});

// How tall a control is. A finger needs more than a pointer.
const coarse = "@media (pointer: coarse)";
export const control = stylex.defineVars({
	sm: { default: "1.75rem", [coarse]: "2.75rem" },
	md: { default: "2rem", [coarse]: "2.75rem" },
	lg: { default: "2.25rem", [coarse]: "2.75rem" },
});

export const font = stylex.defineVars({
	body: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
	mono: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
});

// The page's frame: how wide the content may run and the space beside it. Everything that
// lines up with the page (a header, a footer) reads the same two values.
export const frame = stylex.defineVars({
	width: "70rem",
	gutter: { default: "1.5rem", [media.narrow]: "1rem" },
});

// Every duration reads these, so a request for reduced motion reaches all of them at once.
export const motion = stylex.defineVars({
	// Hover and press.
	quick: { default: "100ms", [media.reducedMotion]: "0s" },
	// Something appearing or moving a little.
	move: { default: "180ms", [media.reducedMotion]: "0s" },
	// A panel arriving.
	slow: { default: "280ms", [media.reducedMotion]: "0s" },
	// Everything decelerates into place.
	ease: "cubic-bezier(0.2, 0.8, 0.2, 1)",
});
