import { currentLocale, localized, UI } from "../i18n.ts";
import { site } from "../site.ts";

export function SiteFooter() {
	const locale = currentLocale();
	const ui = UI[locale];
	return (
		<footer>
			<span>© 2026 hostc · Apache-2.0</span>
			<nav aria-label="Footer">
				<a href="/llms.txt">llms.txt</a>
				<a href={localized(locale, "/ngrok-alternative")}>{ui.compare}</a>
				<a href={site.github}>{ui.star}</a>
			</nav>
		</footer>
	);
}
