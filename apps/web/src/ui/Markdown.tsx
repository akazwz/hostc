import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { marked, type Token, type Tokens } from "marked";

import { Command } from "../components/Command.tsx";
import { base } from "./base.ts";
import { color, font, text } from "./tokens.stylex.ts";

const styles = stylex.create({
	body: { fontSize: text.lg, lineHeight: 1.7 },
	h2: {
		marginBlock: "44px 12px",
		fontSize: "21px",
		fontWeight: 600,
		lineHeight: 1.3,
		letterSpacing: "-0.015em",
	},
	h3: { marginBlock: "28px 8px", fontSize: "17px", fontWeight: 600 },
	p: { marginBlock: "0 16px" },
	list: { marginBlock: "0 16px", paddingInlineStart: "22px" },
	item: { paddingBlock: "3px" },
	code: {
		paddingBlock: "1px",
		paddingInline: "5px",
		borderRadius: "4px",
		backgroundColor: color.subtle,
		fontFamily: font.mono,
		fontSize: "0.92em",
		overflowWrap: "anywhere",
	},
	pre: {
		marginBlock: "0 16px",
		paddingBlock: "14px",
		paddingInline: "16px",
		overflowX: "auto",
		borderWidth: "1px",
		borderStyle: "solid",
		borderColor: color.line,
		borderRadius: "10px",
		backgroundColor: color.subtle,
		fontFamily: font.mono,
		fontSize: text.sm,
		lineHeight: 1.6,
		tabSize: 2,
	},
	tableBox: { marginBlockEnd: "16px", overflowX: "auto" },
	table: { width: "100%", borderCollapse: "collapse", fontSize: text.md, lineHeight: 1.5 },
	cell: {
		paddingBlock: "12px",
		paddingInline: "0 16px",
		borderBottomWidth: "1px",
		borderBottomStyle: "solid",
		borderBottomColor: color.line,
		textAlign: "start",
		verticalAlign: "top",
	},
	head: { fontWeight: 600 },
});

export function H2(props: { children: JSX.Element }) {
	return <h2 {...stylex.attrs(styles.h2)}>{props.children}</h2>;
}

export function Paragraph(props: { children: JSX.Element }) {
	return <p {...stylex.attrs(styles.p)}>{props.children}</p>;
}

export function List(props: { children: JSX.Element }) {
	return <ul {...stylex.attrs(styles.list)}>{props.children}</ul>;
}

export function Item(props: { children: JSX.Element }) {
	return <li {...stylex.attrs(styles.item)}>{props.children}</li>;
}

export function Prose(props: { children: JSX.Element; lang?: string }) {
	return (
		<div lang={props.lang} {...stylex.attrs(styles.body)}>
			{props.children}
		</div>
	);
}

function inline(tokens: Token[] | undefined): JSX.Element {
	return (tokens ?? []).map((token) => {
		switch (token.type) {
			case "strong":
				return <strong>{inline((token as Tokens.Strong).tokens)}</strong>;
			case "em":
				return <em>{inline((token as Tokens.Em).tokens)}</em>;
			case "codespan":
				return <code {...stylex.attrs(styles.code)}>{(token as Tokens.Codespan).text}</code>;
			case "link":
				return (
					<a href={(token as Tokens.Link).href} {...stylex.attrs(base.textLink, base.focusRing)}>
						{inline((token as Tokens.Link).tokens)}
					</a>
				);
			case "text": {
				const nested = (token as Tokens.Text).tokens;
				return nested ? inline(nested) : (token as Tokens.Text).text;
			}
			case "escape":
				return (token as Tokens.Escape).text;
			case "br":
				return <br />;
			default:
				throw new Error(`Unsupported inline Markdown: ${token.type}`);
		}
	});
}

function block(token: Token): JSX.Element {
	switch (token.type) {
		case "heading": {
			const heading = token as Tokens.Heading;
			if (heading.depth === 2) {
				return <H2>{inline(heading.tokens)}</H2>;
			}
			return <h3 {...stylex.attrs(styles.h3)}>{inline(heading.tokens)}</h3>;
		}
		case "paragraph":
			return <Paragraph>{inline((token as Tokens.Paragraph).tokens)}</Paragraph>;
		case "text":
			return inline((token as Tokens.Text).tokens);
		case "list": {
			const list = token as Tokens.List;
			const items = list.items.map((item) => <Item>{item.tokens.map(block)}</Item>);
			return list.ordered ? (
				<ol {...stylex.attrs(styles.list)}>{items}</ol>
			) : (
				<ul {...stylex.attrs(styles.list)}>{items}</ul>
			);
		}
		case "code": {
			const code = token as Tokens.Code;
			// A single shell command gets a copy button; anything else is just shown.
			if (code.lang === "sh" && !code.text.includes("\n")) {
				return <Command>{code.text}</Command>;
			}
			return (
				<pre {...stylex.attrs(styles.pre)}>
					<code>{code.text}</code>
				</pre>
			);
		}
		case "table": {
			const table = token as Tokens.Table;
			return (
				<div {...stylex.attrs(styles.tableBox)}>
					<table {...stylex.attrs(styles.table)}>
						<thead>
							<tr>
								{table.header.map((cell) => (
									<th {...stylex.attrs(styles.cell, styles.head)}>{inline(cell.tokens)}</th>
								))}
							</tr>
						</thead>
						<tbody>
							{table.rows.map((row) => (
								<tr>
									{row.map((cell) => (
										<td {...stylex.attrs(styles.cell)}>{inline(cell.tokens)}</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			);
		}
		case "space":
			return null;
		default:
			throw new Error(`Unsupported Markdown: ${token.type}`);
	}
}

/** Renders Markdown as components, so its text uses the same styles as everything else. */
export function Markdown(props: { source: string; lang?: string }) {
	return <Prose {...(props.lang ? { lang: props.lang } : {})}>{marked.lexer(props.source).map(block)}</Prose>;
}
