import { getRequestEvent } from "@solidjs/web";

export type Locale = "en" | "zh";

export const LOCALES: readonly Locale[] = ["en", "zh"];
export const LANGUAGE_TAGS: Record<Locale, string> = { en: "en", zh: "zh-CN" };

function pathname(): string {
	return new URL(getRequestEvent()?.request.url ?? "http://localhost/").pathname;
}

/** The language of the page being rendered. Pages only render at build time, so the request is always there. */
export function currentLocale(): Locale {
	const path = pathname();
	return path === "/zh" || path.startsWith("/zh/") ? "zh" : "en";
}

/** The address of `path`, written without a language ("/ngrok-alternative"), in `locale`. */
export function localized(locale: Locale, path: string): string {
	if (locale === "en") {
		return path;
	}
	return path === "/" ? "/zh" : `/zh${path}`;
}

/** The current page's address without its language, for links to the other language. */
export function currentPath(): string {
	const path = pathname();
	return currentLocale() === "zh" ? path.slice(3) || "/" : path;
}

export const UI = {
	en: {
		forAgents: "For agents",
		otherLanguage: "中文",
		otherLanguageLabel: "Read this page in Chinese",
		compare: "vs ngrok and Cloudflare Tunnel",
		star: "Star on GitHub",
		home: "All of hostc",
		notFoundTitle: "Page not found",
		notFoundBody: "This page doesn't exist.",
		notFoundLink: "Go to the home page",
	},
	zh: {
		forAgents: "给 AI 助手",
		otherLanguage: "English",
		otherLanguageLabel: "Read this page in English",
		compare: "与 ngrok、Cloudflare Tunnel 对比",
		star: "在 GitHub 上点 Star",
		home: "了解 hostc",
		notFoundTitle: "页面不存在",
		notFoundBody: "这个页面不存在。",
		notFoundLink: "回到首页",
	},
} satisfies Record<Locale, Record<string, string>>;
