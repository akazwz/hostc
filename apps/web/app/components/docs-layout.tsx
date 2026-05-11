import { CheckIcon, CopyIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

export type DocsTocItem = {
	title: string;
	href: string;
};

type CodeLanguage = "shell" | "ts";

type ShikiHighlighter = {
	codeToHtml: (
		code: string,
		options: { lang: "shellscript" | "typescript"; theme: "github-dark" },
	) => string;
};

let shikiHighlighterPromise: Promise<ShikiHighlighter> | null = null;

export function DocsLayout({
	eyebrow,
	title,
	description,
	toc,
	children,
}: {
	eyebrow: string;
	title: string;
	description: string;
	toc: DocsTocItem[];
	children: ReactNode;
}) {
	return (
		<article className="min-w-0">
			<header className="border-b border-border px-4 py-10 sm:px-6 md:px-8 md:py-14 lg:px-10 lg:py-16">
				<div className="max-w-4xl">
					<Badge variant="secondary" className="mb-6">
						{eyebrow}
					</Badge>
					<h1 className="text-balance font-heading text-4xl font-bold leading-tight sm:text-5xl md:text-6xl">
						{title}
					</h1>
					<p className="mt-6 max-w-2xl text-base leading-8 text-muted-foreground md:text-lg">
						{description}
					</p>
				</div>
			</header>

			<div className="grid min-w-0 xl:grid-cols-[minmax(0,1fr)_220px]">
				<div className="min-w-0 px-4 py-8 sm:px-6 md:px-8 lg:px-10">
					{children}
				</div>

				<aside className="hidden border-l border-border/80 xl:block">
					<div className="sticky top-20 px-6 py-10">
						<p className="mb-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
							On this page
						</p>
						<nav className="grid gap-2">
							{toc.map((item) => (
								<a
									key={item.href}
									href={item.href}
									className="text-sm text-muted-foreground transition-colors hover:text-foreground"
								>
									{item.title}
								</a>
							))}
						</nav>
					</div>
				</aside>
			</div>
		</article>
	);
}

export function DocsSection({
	id,
	title,
	description,
	children,
}: {
	id: string;
	title: string;
	description?: string;
	children: ReactNode;
}) {
	return (
		<section
			id={id}
			className="min-w-0 scroll-mt-20 border-b border-border py-10 md:py-12"
		>
			<h2 className="text-balance font-heading text-2xl font-bold leading-tight sm:text-3xl">
				{title}
			</h2>
			{description && (
				<p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground">
					{description}
				</p>
			)}
			<div className="mt-8 grid gap-6">{children}</div>
		</section>
	);
}

export function DocsCodeBlock({
	label,
	code,
	language = "shell",
	className,
}: {
	label: string;
	code: string;
	language?: CodeLanguage;
	className?: string;
}) {
	const [copied, setCopied] = useState(false);
	const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setHighlightedHtml(null);
		highlightWithShiki(code, language)
			.then((html) => {
				if (!cancelled) {
					setHighlightedHtml(html);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setHighlightedHtml(null);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [code, language]);

	async function copyCode() {
		try {
			await navigator.clipboard.writeText(code);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1200);
		} catch {
			setCopied(false);
		}
	}

	return (
		<div className={cn("min-w-0 border border-border bg-card", className)}>
			<div className="flex min-w-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
				<span className="min-w-0 truncate text-xs font-semibold uppercase tracking-widest text-muted-foreground">
					{label}
				</span>
				<Button
					variant="ghost"
					size="xs"
					className="h-7 shrink-0 px-2 text-[0.625rem]"
					onClick={copyCode}
				>
					{copied ? <CheckIcon /> : <CopyIcon />}
					{copied ? "Copied" : "Copy"}
				</Button>
			</div>
			{highlightedHtml ? (
				<div
					className="docs-shiki-code max-w-full overflow-x-auto [&_pre]:!m-0 [&_pre]:!bg-transparent [&_pre]:!p-4 [&_pre]:text-[0.8125rem] [&_pre]:leading-7 sm:[&_pre]:!p-5 sm:[&_pre]:text-sm"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki renders static local docs snippets, not user-provided input.
					dangerouslySetInnerHTML={{ __html: highlightedHtml }}
				/>
			) : (
				<pre className="max-w-full overflow-x-auto p-4 text-[0.8125rem] leading-7 sm:p-5 sm:text-sm">
					<code>{code}</code>
				</pre>
			)}
		</div>
	);
}

export function DocsGrid({ children }: { children: ReactNode }) {
	return (
		<div className="grid min-w-0 gap-px bg-border md:grid-cols-2">
			{children}
		</div>
	);
}

export function DocsCard({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<div className="min-w-0 bg-background p-5 sm:p-6">
			<h3 className="text-balance font-heading text-lg font-semibold sm:text-xl">
				{title}
			</h3>
			<div className="mt-3 break-words text-sm leading-7 text-muted-foreground">
				{children}
			</div>
		</div>
	);
}

async function highlightWithShiki(
	code: string,
	language: CodeLanguage,
): Promise<string> {
	const highlighter = await getShikiHighlighter();
	return highlighter.codeToHtml(code, {
		lang: language === "ts" ? "typescript" : "shellscript",
		theme: "github-dark",
	});
}

function getShikiHighlighter(): Promise<ShikiHighlighter> {
	shikiHighlighterPromise ??= createShikiHighlighter();
	return shikiHighlighterPromise;
}

async function createShikiHighlighter(): Promise<ShikiHighlighter> {
	const [core, engine, typescript, shellscript, githubDark] = await Promise.all(
		[
			import("shiki/core"),
			import("shiki/engine/javascript"),
			import("shiki/langs/typescript.mjs"),
			import("shiki/langs/shellscript.mjs"),
			import("shiki/themes/github-dark.mjs"),
		],
	);

	return core.createHighlighterCore({
		langs: [typescript.default, shellscript.default],
		themes: [githubDark.default],
		engine: engine.createJavaScriptRegexEngine(),
	});
}

export function InlineCode({ children }: { children: ReactNode }) {
	return (
		<code className="break-all bg-muted px-1 py-0.5 text-[0.85em] text-foreground">
			{children}
		</code>
	);
}
