import { GUIDES, type GuideContent } from "../content/guides.tsx";
import { currentLocale, localized, UI } from "../i18n.ts";
import { Crumbs } from "./Crumbs.tsx";
import { Head } from "./Head.tsx";
import { RelatedLinks } from "./RelatedLinks.tsx";

/** A page answering one question, in one language or the other. */
export function Guide(props: { guide: GuideContent }) {
	const locale = currentLocale();
	const copy = props.guide[locale];
	return (
		<main class="page">
			<Head title={`${copy.title} · hostc`} description={copy.description} path={props.guide.path} />
			<Crumbs />
			<h1>{copy.title}</h1>
			<p class="lead">{copy.lead}</p>
			<div class="prose">{copy.body}</div>
			<RelatedLinks
				title={UI[locale].guides}
				links={GUIDES.filter((guide) => guide !== props.guide).map((guide) => ({
					href: localized(locale, guide.path),
					label: guide[locale].title,
				}))}
			/>
		</main>
	);
}
