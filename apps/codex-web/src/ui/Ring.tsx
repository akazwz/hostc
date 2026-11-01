import * as stylex from "@stylexjs/stylex";

import { color } from "./tokens.stylex.ts";

const styles = stylex.create({
	ring: { display: "block", width: "0.9375rem", height: "0.9375rem", transform: "rotate(-90deg)" },
	track: { stroke: color.line },
	value: { stroke: color.muted },
	high: { stroke: color.accentText },
});

// A small progress ring. Decoration: the control around it says the number.
export function Ring(props: { percent: number }) {
	const circumference = 2 * Math.PI * 9;
	return (
		<svg viewBox="0 0 24 24" fill="none" stroke-width="4" aria-hidden="true" {...stylex.attrs(styles.ring)}>
			<circle cx="12" cy="12" r="9" {...stylex.attrs(styles.track)} />
			<circle
				cx="12"
				cy="12"
				r="9"
				stroke-linecap="round"
				stroke-dasharray={`${(Math.min(props.percent, 100) / 100) * circumference} ${circumference}`}
				{...stylex.attrs(styles.value, props.percent >= 80 && styles.high)}
			/>
		</svg>
	);
}
