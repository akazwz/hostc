import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo, For, Match, Show, Switch } from "solid-js";

import { tokenize } from "../harness/highlight.ts";
import { type Block, type Inline, parseMarkdown } from "../harness/markdown.ts";
import { same } from "../harness/same.ts";
import { base } from "../ui/base.ts";
import { CopyButton } from "../ui/CopyButton.tsx";
import { color, control, font, radius, space, text } from "../ui/tokens.stylex.ts";

const styles = stylex.create({
	root: {
		display: "flex",
		flexDirection: "column",
		gap: space.md,
		minWidth: 0,
		fontSize: text.read,
		lineHeight: 1.65,
		overflowWrap: "anywhere",
	},
	paragraph: { margin: 0, whiteSpace: "pre-wrap" },
	h1: {
		margin: 0,
		marginBlockStart: { default: space.sm, ":first-child": 0 },
		fontSize: text.lg,
		fontWeight: 600,
		lineHeight: 1.35,
		letterSpacing: "-0.01em",
	},
	h2: {
		margin: 0,
		marginBlockStart: { default: space.sm, ":first-child": 0 },
		fontSize: text.read,
		fontWeight: 600,
		// Like the text around it, so that it sits the same under a timeline dot.
		lineHeight: 1.65,
	},
	list: { display: "flex", flexDirection: "column", gap: "0.3125rem", margin: 0, paddingInlineStart: "1.375rem" },
	listItem: { paddingInlineStart: "0.125rem" },
	nested: { display: "flex", flexDirection: "column", gap: space.sm, marginBlockStart: "0.3125rem" },
	quote: {
		display: "flex",
		flexDirection: "column",
		gap: space.sm,
		margin: 0,
		paddingInlineStart: space.md,
		borderInlineStartWidth: "2px",
		borderInlineStartStyle: "solid",
		borderInlineStartColor: color.line,
		color: color.muted,
	},
	rule: { width: "100%", height: "1px", margin: 0, borderWidth: 0, backgroundColor: color.line },
	tableWrap: { overflowX: "auto", borderRadius: radius.md, backgroundColor: color.surface },
	table: { width: "100%", borderCollapse: "collapse", fontSize: text.md, lineHeight: 1.45 },
	th: {
		paddingBlock: space.sm,
		paddingInline: space.md,
		color: color.muted,
		fontWeight: 500,
		textAlign: "start",
		whiteSpace: "nowrap",
	},
	td: {
		paddingBlock: space.sm,
		paddingInline: space.md,
		borderTopWidth: "1px",
		borderTopStyle: "solid",
		borderTopColor: color.line,
		verticalAlign: "top",
	},
	codeBox: { position: "relative", minWidth: 0, borderRadius: radius.md, backgroundColor: color.surface },
	codeHeader: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		minHeight: control.md,
		paddingInlineStart: space.md,
		paddingInlineEnd: space.xs,
		color: color.faint,
		fontSize: text.xs,
	},
	code: {
		margin: 0,
		paddingBlockEnd: space.md,
		paddingInline: space.md,
		overflowX: "auto",
		fontFamily: font.mono,
		fontSize: text.xs,
		lineHeight: 1.6,
	},
	inlineCode: {
		paddingInline: "0.3em",
		paddingBlock: "0.1em",
		borderRadius: radius.xs,
		backgroundColor: color.surface,
		fontFamily: font.mono,
		fontSize: "0.875em",
	},
	link: {
		color: "inherit",
		textDecoration: "underline",
		textDecorationColor: color.outline,
		textDecorationThickness: "1px",
		textUnderlineOffset: "0.2em",
	},
	keyword: { color: color.codeKeyword },
	string: { color: color.codeString },
	comment: { color: color.codeComment },
	number: { color: color.codeNumber },
	plain: {},
});

// Text that changes as it streams. Replacing all of a text node collapses any selection in it; changing
// only what differs leaves a selection in the part before it alone, as when later words turn bold.
function GrowingText(props: { text: string }) {
	const node = document.createTextNode(props.text);
	createEffect(
		() => props.text,
		(next) => {
			const current = node.data;
			let kept = 0;
			while (kept < current.length && current[kept] === next[kept]) {
				kept++;
			}
			if (kept < current.length || kept < next.length) {
				node.replaceData(kept, current.length - kept, next.slice(kept));
			}
		},
	);
	return node;
}

function Inlines(props: { inline: Inline[] }) {
	return (
		<For each={props.inline} keyed={false}>
			{(part) => (
				<Switch fallback={<GrowingText text={part().text} />}>
					<Match when={part().kind === "code"}>
						<code {...stylex.attrs(styles.inlineCode)}>
							<GrowingText text={part().text} />
						</code>
					</Match>
					<Match when={part().kind === "strong"}>
						<strong>
							<GrowingText text={part().text} />
						</strong>
					</Match>
					<Match when={part().kind === "emphasis"}>
						<em>
							<GrowingText text={part().text} />
						</em>
					</Match>
					<Match when={part().kind === "link" && (part() as Extract<Inline, { kind: "link" }>)}>
						{(link) => (
							<a
								href={link().href}
								target="_blank"
								rel="noreferrer noopener"
								{...stylex.attrs(styles.link, base.focusRing)}
							>
								<GrowingText text={link().text} />
							</a>
						)}
					</Match>
				</Switch>
			)}
		</For>
	);
}

// Code, lightly highlighted. It stays text: tokens only pick a color.
export function Code(props: { text: string; language: string }) {
	const tokens = createMemo(() => tokenize(props.text, props.language));
	return (
		<pre tabindex="0" {...stylex.attrs(styles.code, base.focusRing)}>
			<For each={tokens()} keyed={false}>
				{(token) => (
					<span {...stylex.attrs(styles[token().kind])}>
						<GrowingText text={token().text} />
					</span>
				)}
			</For>
		</pre>
	);
}

function BlockView(props: { block: Block }) {
	return (
		<Switch>
			<Match when={props.block.kind === "code" && props.block}>
				{(block) => (
					<div {...stylex.attrs(styles.codeBox)}>
						<div {...stylex.attrs(styles.codeHeader)}>
							<span>{block().language}</span>
							<CopyButton text={block().text} />
						</div>
						<Code text={block().text} language={block().language} />
					</div>
				)}
			</Match>
			<Match when={props.block.kind === "heading" && props.block}>
				{(block) => (
					<Show
						when={block().level <= 1}
						fallback={
							<h3 {...stylex.attrs(styles.h2)}>
								<Inlines inline={block().inline} />
							</h3>
						}
					>
						<h2 {...stylex.attrs(styles.h1)}>
							<Inlines inline={block().inline} />
						</h2>
					</Show>
				)}
			</Match>
			<Match when={props.block.kind === "list" && props.block}>
				{(block) => {
					const items = () => (
						<For each={block().items}>
							{(item) => (
								<li {...stylex.attrs(styles.listItem)}>
									<Inlines inline={item.inline} />
									<Show when={item.children.length > 0}>
										<div {...stylex.attrs(styles.nested)}>
											<For each={item.children}>{(child) => <BlockView block={child} />}</For>
										</div>
									</Show>
								</li>
							)}
						</For>
					);
					return (
						<Show when={block().ordered} fallback={<ul {...stylex.attrs(styles.list)}>{items()}</ul>}>
							<ol start={block().start} {...stylex.attrs(styles.list)}>
								{items()}
							</ol>
						</Show>
					);
				}}
			</Match>
			<Match when={props.block.kind === "quote" && props.block}>
				{(block) => (
					<blockquote {...stylex.attrs(styles.quote)}>
						<For each={block().blocks}>{(child) => <BlockView block={child} />}</For>
					</blockquote>
				)}
			</Match>
			<Match when={props.block.kind === "table" && props.block}>
				{(block) => (
					<div tabindex="0" {...stylex.attrs(styles.tableWrap, base.focusRing)}>
						<table {...stylex.attrs(styles.table)}>
							<thead>
								<tr>
									<For each={block().header}>
										{(cell) => (
											<th {...stylex.attrs(styles.th)}>
												<Inlines inline={cell} />
											</th>
										)}
									</For>
								</tr>
							</thead>
							<tbody>
								<For each={block().rows}>
									{(row) => (
										<tr>
											<For each={row}>
												{(cell) => (
													<td {...stylex.attrs(styles.td)}>
														<Inlines inline={cell} />
													</td>
												)}
											</For>
										</tr>
									)}
								</For>
							</tbody>
						</table>
					</div>
				)}
			</Match>
			<Match when={props.block.kind === "rule"}>
				<hr {...stylex.attrs(styles.rule)} />
			</Match>
			<Match when={props.block.kind === "paragraph" && props.block}>
				{(block) => (
					<p {...stylex.attrs(styles.paragraph)}>
						<Inlines inline={block().inline} />
					</p>
				)}
			</Match>
		</Switch>
	);
}

// An agent's message. It is parsed into data and rendered as text, never as HTML.
export function Markdown(props: { text: string }) {
	// Steps are rebuilt as text streams in. Unchanged text must not be parsed and rendered again, which
	// would lose a selection and the scroll position of a code block.
	const source = createMemo(() => props.text);
	let previous: Block[] = [];
	const blocks = createMemo(() => {
		previous = parseMarkdown(source()).map((block, index) => {
			const known = previous[index];
			return known && same(known, block) ? known : block;
		});
		return previous;
	});
	return (
		<div {...stylex.attrs(styles.root)}>
			<For each={blocks()} keyed={false}>
				{(block) => <BlockView block={block()} />}
			</For>
		</div>
	);
}
