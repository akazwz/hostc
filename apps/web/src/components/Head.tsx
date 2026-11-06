import { Link, Meta, Title } from "@solidjs/meta";
import { For } from "solid-js";

import { currentLocale, LANGUAGE_TAGS, localized, LOCALES } from "../i18n.ts";
import { site } from "../site.ts";

type Props = {
	/** The tab title, shown to search engines. */
	title: string;
	/** The title in link previews; defaults to `title`. */
	socialTitle?: string;
	description: string;
	/** The page's address without a language; leave it out of pages search engines should skip. */
	path?: string;
};

export function Head(props: Props) {
	const locale = currentLocale();
	const url = (to: typeof locale) => `${site.origin}${localized(to, props.path ?? "/")}`;
	const socialTitle = () => props.socialTitle ?? props.title;
	return (
		<>
			<Title>{props.title}</Title>
			<Meta name="description" content={props.description} />
			{props.path ? (
				<>
					<Link rel="canonical" href={url(locale)} />
					{/* Keyed: tags dedupe by rel and href, and x-default has the same address as English. */}
					<For each={LOCALES}>
						{(to) => <Link key={`alternate-${to}`} rel="alternate" hreflang={LANGUAGE_TAGS[to]} href={url(to)} />}
					</For>
					<Link key="alternate-default" rel="alternate" hreflang="x-default" href={url("en")} />
				</>
			) : (
				<Meta name="robots" content="noindex" />
			)}
			<Meta property="og:type" content="website" />
			<Meta property="og:site_name" content={site.name} />
			<Meta property="og:url" content={url(locale)} />
			<Meta property="og:title" content={socialTitle()} />
			<Meta property="og:description" content={props.description} />
			<Meta property="og:image" content={`${site.origin}/og-image.png`} />
			<Meta property="og:image:width" content="1200" />
			<Meta property="og:image:height" content="630" />
			<Meta property="og:image:alt" content="hostc: Localhost, anywhere." />
			<Meta name="twitter:card" content="summary_large_image" />
		</>
	);
}
