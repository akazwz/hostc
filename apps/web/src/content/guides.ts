import type { Locale } from "../i18n.ts";
import { documents } from "./documents.ts";

type Copy = { title: string; lead: string; description: string; body: string };
export type GuideContent = { path: string } & Record<Locale, Copy>;

function copy(slug: string, zh: boolean): Copy {
	const found = documents("guides", zh).find((each) => each.slug === slug);
	const { title, lead, description } = found?.meta ?? {};
	if (!found || !title || !lead || !description) {
		throw new Error(`Guide ${slug} needs title, lead and description.`);
	}
	return { title, lead, description, body: found.body };
}

function guide(slug: string): GuideContent {
	return { path: `/${slug}`, en: copy(slug, false), zh: copy(slug, true) };
}

export const WEBHOOKS = guide("test-webhooks-locally");
export const PHONE = guide("test-localhost-on-phone");
export const DEV_SERVERS = guide("share-vite-nextjs-dev-server");

export const GUIDES = [WEBHOOKS, PHONE, DEV_SERVERS];
