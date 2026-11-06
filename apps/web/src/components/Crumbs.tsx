import { currentLocale, localized, UI } from "../i18n.ts";

/** The way back up from a page. `section` is the page's parent, when it has one besides the home page. */
export function Crumbs(props: { section?: { label: string; path: string } }) {
	const locale = currentLocale();
	return (
		<nav class="crumbs" aria-label="Breadcrumb">
			<a href={localized(locale, "/")}>{UI[locale].home}</a>
			{props.section && (
				<>
					<span aria-hidden="true">/</span>
					<a href={localized(locale, props.section.path)}>{props.section.label}</a>
				</>
			)}
		</nav>
	);
}
