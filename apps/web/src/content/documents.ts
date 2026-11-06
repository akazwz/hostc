export type Document = { slug: string; meta: Record<string, string>; body: string };

const FILES = import.meta.glob<string>("../../content/**/*.md", { query: "?raw", import: "default", eager: true });

function parse(path: string, source: string): Document {
	const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(source);
	if (!match) {
		throw new Error(`${path} has no front matter.`);
	}
	const meta = Object.fromEntries(
		(match[1] as string).split("\n").map((line) => {
			const colon = line.indexOf(":");
			return [
				line.slice(0, colon),
				line
					.slice(colon + 1)
					.trim()
					.replace(/^(['"])(.*)\1$/, "$2"),
			];
		}),
	) as Record<string, string>;
	return { slug: (path.split("/").pop() as string).replace(/\.md$/, ""), meta, body: match[2] as string };
}

/** The Markdown files in content/<folder>, or content/<folder>/zh for Chinese. */
export function documents(folder: string, zh: boolean): Document[] {
	return Object.entries(FILES)
		.filter(([path]) => path.includes(`/content/${folder}/`) && path.includes(`/${folder}/zh/`) === zh)
		.map(([path, source]) => parse(path, source));
}
