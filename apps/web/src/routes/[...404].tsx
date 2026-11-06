import { Head } from "../components/Head.tsx";
import { currentLocale, localized, UI } from "../i18n.ts";

/**
 * Built as 404.html and zh/404.html. Cloudflare serves the nearest one with a 404 status for any
 * address with no file.
 */
export default function NotFound() {
	const locale = currentLocale();
	const ui = UI[locale];
	return (
		<main class="missing">
			<Head title={`${ui.notFoundTitle} · hostc`} description={ui.notFoundBody} />
			<h1>{ui.notFoundTitle}</h1>
			<p>{ui.notFoundBody}</p>
			<p>
				<a href={localized(locale, "/")}>{ui.notFoundLink}</a>
			</p>
		</main>
	);
}
