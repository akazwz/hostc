import { For } from "solid-js";

import { ALTERNATIVES } from "../content/alternatives.ts";
import { GUIDES } from "../content/guides.tsx";
import { currentLocale, localized, UI } from "../i18n.ts";
import { site } from "../site.ts";

export function SiteFooter() {
	const locale = currentLocale();
	const ui = UI[locale];
	const to = (path: string) => localized(locale, path);
	return (
		<footer>
			<div class="columns">
				<nav aria-label={ui.product}>
					<h2>{ui.product}</h2>
					<a href={to("/blog")}>{ui.blog}</a>
					<a href={to("/changelog")}>{ui.changelog}</a>
					<a href="/llms.txt">llms.txt</a>
					<a href={site.github}>{ui.star}</a>
				</nav>
				<nav aria-label={ui.guides}>
					<h2>{ui.guides}</h2>
					<For each={GUIDES}>{(guide) => <a href={to(guide.path)}>{guide[locale].title}</a>}</For>
				</nav>
				<nav aria-label={ui.alternatives}>
					<h2>
						<a href={to("/alternatives")}>{ui.alternatives}</a>
					</h2>
					<For each={ALTERNATIVES}>{(item) => <a href={to(`/alternatives/${item.slug}`)}>{item.name}</a>}</For>
				</nav>
			</div>
			<p>© 2026 hostc · Apache-2.0</p>
		</footer>
	);
}
