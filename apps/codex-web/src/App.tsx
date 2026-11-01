import * as stylex from "@stylexjs/stylex";
import { Loading, type ParentProps } from "solid-js";

import { Router } from "./router.ts";
import { color, font, text } from "./ui/tokens.stylex.ts";

import "./global.css";

const styles = stylex.create({
	app: {
		display: "flex",
		flexDirection: "column",
		minHeight: "100dvh",
		backgroundColor: color.bg,
		color: color.text,
		fontFamily: font.body,
		fontSize: text.md,
		lineHeight: 1.5,
	},
});

// What stays on screen whatever the address: the page's ground and its type. A header or a
// navigation shared by every page goes here, around `props.children`.
function Shell(props: ParentProps) {
	return (
		<div {...stylex.attrs(styles.app)}>
			{/* Each route is a chunk of its own; this waits for the one being opened. */}
			<Loading>{props.children}</Loading>
		</div>
	);
}

export default function App() {
	return <Router>{(props) => <Shell>{props.children}</Shell>}</Router>;
}
