import * as stylex from "@stylexjs/stylex";
import { Loading, type ParentProps } from "solid-js";

import { SiteFooter } from "./components/SiteFooter.tsx";
import { SiteHeader } from "./components/SiteHeader.tsx";
import { Router } from "./router.ts";
import { color, font } from "./ui/tokens.stylex.ts";

import "./global.css";

const styles = stylex.create({
	site: {
		minHeight: "100dvh",
		backgroundColor: color.bg,
		color: color.ink,
		fontFamily: font.body,
		fontSize: "16px",
		lineHeight: 1.6,
	},
	// One column for the whole site.
	column: { maxWidth: "760px", marginInline: "auto", paddingInline: "24px" },
});

function Shell(props: ParentProps) {
	return (
		<div {...stylex.attrs(styles.site)}>
			<div {...stylex.attrs(styles.column)}>
				<SiteHeader />
				<Loading>{props.children}</Loading>
				<SiteFooter />
			</div>
		</div>
	);
}

export default function App() {
	return <Router>{(props) => <Shell>{props.children}</Shell>}</Router>;
}
