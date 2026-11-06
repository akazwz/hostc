import { GUIDES, type GuideContent } from "../content/guides.ts";
import { currentLocale, localized, UI } from "../i18n.ts";
import { Markdown } from "../ui/Markdown.tsx";
import { Lead, Page, PageTitle } from "../ui/Page.tsx";
import { Crumbs } from "./Crumbs.tsx";
import { Head } from "./Head.tsx";
import { RelatedLinks } from "./RelatedLinks.tsx";

/** A page answering one question, in one language or the other. */
export function Guide(props: { guide: GuideContent }) {
	const locale = currentLocale();
	const copy = props.guide[locale];
	return (
		<Page>
			<Head title={`${copy.title} · hostc`} description={copy.description} path={props.guide.path} />
			<Crumbs />
			<PageTitle>{copy.title}</PageTitle>
			<Lead>{copy.lead}</Lead>
			<Markdown source={copy.body} />
			<RelatedLinks
				title={UI[locale].guides}
				links={GUIDES.filter((guide) => guide !== props.guide).map((guide) => ({
					href: localized(locale, guide.path),
					label: guide[locale].title,
				}))}
			/>
		</Page>
	);
}
