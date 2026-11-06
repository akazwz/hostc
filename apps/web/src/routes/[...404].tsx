import * as stylex from "@stylexjs/stylex";

import { Head } from "../components/Head.tsx";
import { currentLocale, localized, UI } from "../i18n.ts";
import { base } from "../ui/base.ts";
import { color } from "../ui/tokens.stylex.ts";

const styles = stylex.create({
	page: { paddingBlock: "104px 120px" },
	title: { marginBlock: "0 16px", fontSize: "44px", fontWeight: 600, letterSpacing: "-0.03em" },
	text: { marginBlock: "0 8px", color: color.muted },
});

/**
 * Built as 404.html and zh/404.html. Cloudflare serves the nearest one with a 404 status for any
 * address with no file.
 */
export default function NotFound() {
	const locale = currentLocale();
	const ui = UI[locale];
	return (
		<main {...stylex.attrs(styles.page)}>
			<Head title={`${ui.notFoundTitle} · hostc`} description={ui.notFoundBody} />
			<h1 {...stylex.attrs(styles.title)}>{ui.notFoundTitle}</h1>
			<p {...stylex.attrs(styles.text)}>{ui.notFoundBody}</p>
			<p {...stylex.attrs(styles.text)}>
				<a href={localized(locale, "/")} {...stylex.attrs(base.textLink, base.focusRing)}>
					{ui.notFoundLink}
				</a>
			</p>
		</main>
	);
}
