import { Loading, type ParentProps } from "solid-js";

import { SiteFooter } from "./components/SiteFooter.tsx";
import { SiteHeader } from "./components/SiteHeader.tsx";
import { Router } from "./router.ts";

import "./global.css";

function Shell(props: ParentProps) {
	return (
		<div class="wrap">
			<SiteHeader />
			<Loading>{props.children}</Loading>
			<SiteFooter />
		</div>
	);
}

export default function App() {
	return <Router>{(props) => <Shell>{props.children}</Shell>}</Router>;
}
