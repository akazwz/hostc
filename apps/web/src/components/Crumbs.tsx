import * as stylex from "@stylexjs/stylex";

import { currentLocale, localized, UI } from "../i18n.ts";
import { base } from "../ui/base.ts";
import { color, text } from "../ui/tokens.stylex.ts";

const styles = stylex.create({
	crumbs: { display: "flex", gap: "8px", marginBlockEnd: "20px", color: color.muted, fontSize: text.sm },
});

/** The way back up from a page. `section` is the page's parent, when it has one besides the home page. */
export function Crumbs(props: { section?: { label: string; path: string } }) {
	const locale = currentLocale();
	const link = stylex.attrs(base.quietLink, base.hoverInk, base.focusRing);
	return (
		<nav aria-label="Breadcrumb" {...stylex.attrs(styles.crumbs)}>
			<a href={localized(locale, "/")} {...link}>
				{UI[locale].home}
			</a>
			{props.section && (
				<>
					<span aria-hidden="true">/</span>
					<a href={localized(locale, props.section.path)} {...link}>
						{props.section.label}
					</a>
				</>
			)}
		</nav>
	);
}
