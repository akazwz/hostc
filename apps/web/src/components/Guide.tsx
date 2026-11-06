import type { GuideContent } from "../content/guides.tsx";
import { currentLocale, localized, UI } from "../i18n.ts";
import { Head } from "./Head.tsx";

/** A page answering one question, in one language or the other. */
export function Guide(props: { guide: GuideContent }) {
	const locale = currentLocale();
	const copy = props.guide[locale];
	return (
		<main class="guide">
			<Head
				title={copy.title.includes("hostc") ? copy.title : `${copy.title} · hostc`}
				description={copy.description}
				path={props.guide.path}
			/>
			<h1>{copy.title}</h1>
			<p class="lead">{copy.lead}</p>
			{copy.body}
			<p class="more">
				<a href={localized(locale, "/")}>{UI[locale].home}</a>
			</p>
		</main>
	);
}
