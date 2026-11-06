import * as stylex from "@stylexjs/stylex";

// Design tokens: components read these and never hard-code a color or a size.
export const media = stylex.defineConsts({
	narrow: "@media (max-width: 720px)",
	dark: "@media (prefers-color-scheme: dark)",
	hover: "@media (hover: hover)",
	reducedMotion: "@media (prefers-reduced-motion: reduce)",
});

// Colors come from the logo: zinc neutrals and white, with orange as the one accent.
export const color = stylex.defineVars({
	bg: { default: "#ffffff", [media.dark]: "#1c1c1f" },
	subtle: { default: "#f4f4f5", [media.dark]: "#26262a" },
	ink: { default: "#111113", [media.dark]: "#f4f4f5" },
	// 4.5:1 or more on `bg` and `subtle` in both schemes.
	muted: { default: "#5f5f68", [media.dark]: "#a1a1aa" },
	line: { default: "#e4e4e7", [media.dark]: "#323237" },
	link: { default: "#c2410c", [media.dark]: "#ff8a3d" },
	// The terminal stays dark in both schemes.
	terminal: { default: "#18181b", [media.dark]: "#141416" },
	terminalLine: { default: "#27272a", [media.dark]: "#323237" },
	terminalInk: "#e4e4e7",
	terminalDim: "#8b8b94",
	terminalDot: "#3f3f46",
	terminalLink: "#ff8a3d",
	terminalOk: "#6ee7a0",
});

export const font = stylex.defineConsts({
	body: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Roboto, "Helvetica Neue", sans-serif',
	mono: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
});

export const text = stylex.defineVars({
	xs: "13px",
	sm: "14px",
	md: "15px",
	lg: "16px",
	lead: "18px",
	heading: "22px",
});

export const motion = stylex.defineVars({
	quick: { default: "0.15s", [media.reducedMotion]: "0s" },
});
