import * as stylex from "@stylexjs/stylex";

import { currentLocale, currentPath, localized, UI } from "../i18n.ts";
import { site } from "../site.ts";
import { base } from "../ui/base.ts";
import { color, text } from "../ui/tokens.stylex.ts";

const styles = stylex.create({
	top: { display: "flex", alignItems: "center", justifyContent: "space-between", paddingBlock: "24px" },
	brand: {
		display: "flex",
		alignItems: "center",
		gap: "10px",
		color: color.ink,
		fontWeight: 600,
		letterSpacing: "-0.01em",
		textDecorationLine: "none",
	},
	logo: {
		width: "26px",
		height: "26px",
		borderRadius: "6px",
		// Keeps the mark's near-black tile from melting into the dark background.
		boxShadow: `0 0 0 1px ${color.line}`,
	},
	nav: { display: "flex", alignItems: "center", gap: "20px", color: color.muted, fontSize: text.sm },
	link: { display: "flex" },
	icon: { width: "18px", height: "18px" },
});

export function SiteHeader() {
	const locale = currentLocale();
	const ui = UI[locale];
	const other = locale === "en" ? "zh" : "en";
	// The 404 page has no counterpart at its own address.
	const path = currentPath();
	const translation = localized(other, path === "/404" ? "/" : path);
	const link = stylex.attrs(base.quietLink, base.hoverInk, styles.link, base.focusRing);
	return (
		<header {...stylex.attrs(styles.top)}>
			<a href={localized(locale, "/")} {...stylex.attrs(styles.brand, base.focusRing)}>
				<img src="/favicon.svg" alt="" width="28" height="28" {...stylex.attrs(styles.logo)} />
				hostc
			</a>
			<nav aria-label="Site" {...stylex.attrs(styles.nav)}>
				<a href={localized(locale, "/alternatives")} {...link}>
					{ui.alternatives}
				</a>
				<a href={localized(locale, "/blog")} {...link}>
					{ui.blog}
				</a>
				<a href={translation} lang={other === "zh" ? "zh-CN" : "en"} aria-label={ui.otherLanguageLabel} {...link}>
					{ui.otherLanguage}
				</a>
				<a href={site.github} aria-label="GitHub" title="GitHub" {...link}>
					<svg {...stylex.attrs(styles.icon)} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
						{" "}
						<path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />{" "}
					</svg>
				</a>
			</nav>
		</header>
	);
}
