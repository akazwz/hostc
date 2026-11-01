// The Markdown agents write, parsed into plain data. Nothing here produces HTML: the components render
// every piece as text, so a message can never inject markup.

export type Inline =
	| { kind: "text"; text: string }
	| { kind: "code"; text: string }
	| { kind: "strong"; text: string }
	| { kind: "emphasis"; text: string }
	| { kind: "link"; text: string; href: string };

export type ListItem = { inline: Inline[]; children: Block[] };

export type Block =
	| { kind: "code"; language: string; text: string }
	| { kind: "heading"; level: number; inline: Inline[] }
	| { kind: "list"; ordered: boolean; start: number; items: ListItem[] }
	| { kind: "quote"; blocks: Block[] }
	| { kind: "table"; header: Inline[][]; rows: Inline[][][] }
	| { kind: "rule" }
	| { kind: "paragraph"; inline: Inline[] };

const INLINE = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|(?<![\w*])\*([^*\n]+)\*(?![\w*])|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;

export function parseInline(text: string): Inline[] {
	const result: Inline[] = [];
	let last = 0;
	for (const match of text.matchAll(INLINE)) {
		if (match.index > last) {
			result.push({ kind: "text", text: text.slice(last, match.index) });
		}
		if (match[1] !== undefined) {
			result.push({ kind: "code", text: match[1] });
		} else if (match[2] !== undefined) {
			result.push({ kind: "strong", text: match[2] });
		} else if (match[3] !== undefined) {
			result.push({ kind: "emphasis", text: match[3] });
		} else {
			result.push({ kind: "link", text: match[4] as string, href: match[5] as string });
		}
		last = match.index + match[0].length;
	}
	if (last < text.length) {
		result.push({ kind: "text", text: text.slice(last) });
	}
	return result;
}

const LIST_ITEM = /^(\s*)(?:[-*+]|(\d+)[.)])\s+(.*)$/;
const FENCE = /^\s*```\s*([\w+-]*)/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

function cells(line: string): Inline[][] {
	return line
		.trim()
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|")
		.map((cell) => parseInline(cell.trim()));
}

function startsBlock(lines: readonly string[], index: number): boolean {
	const line = lines[index] as string;
	return (
		line.trim() === "" ||
		FENCE.test(line) ||
		/^#{1,6}\s/.test(line) ||
		LIST_ITEM.test(line) ||
		line.trimStart().startsWith(">") ||
		RULE.test(line) ||
		(line.includes("|") && TABLE_SEPARATOR.test(lines[index + 1] ?? ""))
	);
}

export function parseMarkdown(text: string): Block[] {
	return parseLines(text.split("\n"));
}

function parseLines(lines: string[]): Block[] {
	const blocks: Block[] = [];
	let index = 0;
	while (index < lines.length) {
		const line = lines[index] as string;
		if (line.trim() === "") {
			index++;
			continue;
		}
		const fence = FENCE.exec(line);
		if (fence) {
			const code: string[] = [];
			index++;
			// An unclosed fence runs to the end: the message may still be streaming.
			while (index < lines.length && !/^\s*```\s*$/.test(lines[index] as string)) {
				code.push(lines[index] as string);
				index++;
			}
			index++;
			blocks.push({ kind: "code", language: fence[1] ?? "", text: code.join("\n") });
			continue;
		}
		const heading = /^(#{1,6})\s+(.*)$/.exec(line);
		if (heading) {
			blocks.push({ kind: "heading", level: (heading[1] as string).length, inline: parseInline(heading[2] as string) });
			index++;
			continue;
		}
		if (RULE.test(line)) {
			blocks.push({ kind: "rule" });
			index++;
			continue;
		}
		if (line.trimStart().startsWith(">")) {
			const quoted: string[] = [];
			while (index < lines.length && (lines[index] as string).trimStart().startsWith(">")) {
				quoted.push((lines[index] as string).trimStart().replace(/^>\s?/, ""));
				index++;
			}
			blocks.push({ kind: "quote", blocks: parseLines(quoted) });
			continue;
		}
		if (line.includes("|") && TABLE_SEPARATOR.test(lines[index + 1] ?? "")) {
			const header = cells(line);
			index += 2;
			const rows: Inline[][][] = [];
			while (index < lines.length && (lines[index] as string).includes("|") && (lines[index] as string).trim() !== "") {
				rows.push(cells(lines[index] as string));
				index++;
			}
			blocks.push({ kind: "table", header, rows });
			continue;
		}
		const first = LIST_ITEM.exec(line);
		if (first) {
			const indent = (first[1] as string).length;
			const ordered = first[2] !== undefined;
			const items: ListItem[] = [];
			while (index < lines.length) {
				const item = LIST_ITEM.exec(lines[index] as string);
				if (!item || (item[1] as string).length !== indent || (item[2] !== undefined) !== ordered) {
					break;
				}
				index++;
				const nested: string[] = [];
				while (index < lines.length) {
					const next = lines[index] as string;
					const blank = next.trim() === "";
					const deeper = /^\s*/.exec(next)?.[0].length ?? 0;
					if (blank ? !(lines[index + 1] ?? "").startsWith(" ".repeat(indent + 2)) : deeper <= indent) {
						break;
					}
					nested.push(next.slice(Math.min(deeper, indent + 2)));
					index++;
				}
				items.push({ inline: parseInline(item[3] as string), children: parseLines(nested) });
				while (
					index < lines.length &&
					(lines[index] as string).trim() === "" &&
					LIST_ITEM.exec(lines[index + 1] ?? "")?.[1]?.length === indent
				) {
					index++;
				}
			}
			blocks.push({ kind: "list", ordered, start: Number(first[2] ?? 1), items });
			continue;
		}
		const paragraph: string[] = [line];
		index++;
		while (index < lines.length && !startsBlock(lines, index)) {
			paragraph.push(lines[index] as string);
			index++;
		}
		blocks.push({ kind: "paragraph", inline: parseInline(paragraph.join("\n")) });
	}
	return blocks;
}
