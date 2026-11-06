import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";

import { color, font, media } from "../ui/tokens.stylex.ts";

const styles = stylex.create({
	box: {
		marginBlock: { default: "56px 0", [media.narrow]: "40px 0" },
		marginInline: 0,
		overflow: "hidden",
		borderWidth: "1px",
		borderStyle: "solid",
		borderColor: color.terminalLine,
		borderRadius: "12px",
		backgroundColor: color.terminal,
		color: color.terminalInk,
		boxShadow: "0 24px 60px -32px rgb(0 0 0 / 0.45)",
	},
	bar: { display: "flex", gap: "7px", paddingBlock: "13px 0", paddingInline: "16px" },
	dot: { width: "10px", height: "10px", borderRadius: "50%", backgroundColor: color.terminalDot },
	pre: {
		margin: 0,
		paddingBlock: "16px 20px",
		paddingInline: "18px",
		overflowX: "auto",
		fontFamily: font.mono,
		fontSize: { default: "13px", [media.narrow]: "12px" },
		lineHeight: 1.7,
	},
	url: { color: color.terminalLink },
	dim: { color: color.terminalDim },
	ok: { color: color.terminalOk },
});

function Dim(props: { children: JSX.Element }) {
	return <span {...stylex.attrs(styles.dim)}>{props.children}</span>;
}

function Line(props: { time: string; method: string; status: string; path: string; duration?: string }) {
	return (
		<>
			<Dim>{props.time}</Dim>
			{`  ${props.method.padEnd(7)}`}
			<span {...stylex.attrs(styles.ok)}>{props.status}</span>
			{`  ${props.path}`}
			{props.duration && <Dim>{` ${props.duration}`}</Dim>}
		</>
	);
}

/** What hostc prints, line for line: keep it in step with apps/cli/src/main.ts. */
export function Terminal() {
	return (
		<figure aria-label="Terminal output of hostc" {...stylex.attrs(styles.box)}>
			<div aria-hidden="true" {...stylex.attrs(styles.bar)}>
				<i {...stylex.attrs(styles.dot)} />
				<i {...stylex.attrs(styles.dot)} />
				<i {...stylex.attrs(styles.dot)} />
			</div>
			<pre {...stylex.attrs(styles.pre)}>
				<code>
					<span {...stylex.attrs(styles.url)}>https://k7m2xq9pa4dn.hostc.app</span>
					{"  → http://localhost:3000\n\n"}
					<Dim>{"Anyone with this URL can reach your local server. Press Ctrl+C to stop.\n\n"}</Dim>
					<Line time="10:42:07" method="GET" status="200" path="/" duration="12ms" />
					{"\n"}
					<Line time="10:42:07" method="GET" status="200" path="/assets/index.js" duration="31ms" />
					{"\n"}
					<Line time="10:42:08" method="WS" status="101" path="/__vite_hmr" />
					{"\n"}
					<Line time="10:42:15" method="POST" status="200" path="/webhooks/stripe" duration="48ms" />
				</code>
			</pre>
		</figure>
	);
}
