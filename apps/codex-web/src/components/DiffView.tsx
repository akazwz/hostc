import * as stylex from "@stylexjs/stylex";
import { createSignal, For, Show } from "solid-js";

import type { DiffFile } from "../harness/diff.ts";
import { base } from "../ui/base.ts";
import { Icon } from "../ui/Icon.tsx";
import { color, control, font, media, motion, radius, space, text } from "../ui/tokens.stylex.ts";

const styles = stylex.create({
	file: { minWidth: 0, borderRadius: radius.sm, backgroundColor: color.surface, overflow: "hidden" },
	header: {
		display: "flex",
		alignItems: "center",
		gap: space.sm,
		width: "100%",
		minHeight: control.md,
		paddingInline: space.sm,
		borderWidth: 0,
		backgroundColor: {
			default: "transparent",
			[media.hover]: { default: "transparent", ":hover": color.hover },
		},
		color: color.text,
		cursor: "pointer",
		fontFamily: font.mono,
		fontSize: text.xs,
		textAlign: "start",
	},
	path: {
		flexGrow: 1,
		minWidth: 0,
		overflow: "hidden",
		direction: "rtl",
		textAlign: "left",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	chevron: {
		display: "flex",
		color: color.faint,
		transitionDuration: motion.move,
		transitionProperty: "transform",
		transitionTimingFunction: motion.ease,
	},
	chevronOpen: { transform: "rotate(90deg)" },
	lines: { overflowX: "auto", fontFamily: font.mono, fontSize: text.xs, lineHeight: 1.6, paddingBlockEnd: space.xs },
	line: { display: "grid", gridTemplateColumns: "2.5rem 2.5rem 1fr", width: "max-content", minWidth: "100%" },
	add: { backgroundColor: color.addedBg },
	remove: { backgroundColor: color.removedBg },
	hunk: { color: color.faint },
	context: {},
	number: { paddingInlineEnd: space.xs, color: color.faint, textAlign: "end", userSelect: "none" },
	code: { paddingInline: space.sm, whiteSpace: "pre" },
	hunkText: { gridColumn: "1 / -1", paddingInline: space.sm, whiteSpace: "pre" },
	added: { color: color.added, fontVariantNumeric: "tabular-nums", fontFamily: font.mono, fontSize: text.xs },
	removed: { color: color.removed, fontVariantNumeric: "tabular-nums", fontFamily: font.mono, fontSize: text.xs },
});

// The size of a change: +12 -3.
export function DiffCount(props: { added: number; removed: number }) {
	return (
		<>
			<Show when={props.added > 0}>
				<span {...stylex.attrs(styles.added)}>+{props.added}</span>
			</Show>
			<Show when={props.removed > 0}>
				<span {...stylex.attrs(styles.removed)}>-{props.removed}</span>
			</Show>
		</>
	);
}

// One file of a diff, folded until asked for.
export function DiffFileView(props: { file: DiffFile; root: string; startOpen?: boolean }) {
	const [open, setOpen] = createSignal(props.startOpen ?? false);
	const shortPath = () =>
		props.file.path.startsWith(`${props.root}/`) ? props.file.path.slice(props.root.length + 1) : props.file.path;
	return (
		<div {...stylex.attrs(styles.file)}>
			<button
				type="button"
				aria-expanded={open() ? "true" : "false"}
				{...stylex.attrs(styles.header, base.focusRing)}
				onClick={() => setOpen((value) => !value)}
			>
				{/* Reversed so that a long path keeps its file name and loses its start. */}
				<span dir="rtl" {...stylex.attrs(styles.path)}>
					<bdi>{shortPath()}</bdi>
				</span>
				<DiffCount added={props.file.added} removed={props.file.removed} />
				<span {...stylex.attrs(styles.chevron, open() && styles.chevronOpen)}>
					<Icon name="chevronRight" small />
				</span>
			</button>
			<Show when={open()}>
				<div tabindex="0" {...stylex.attrs(styles.lines, base.focusRing)}>
					<For each={props.file.lines}>
						{(line) => (
							<div {...stylex.attrs(styles.line, styles[line.kind])}>
								<Show
									when={line.kind !== "hunk"}
									fallback={<span {...stylex.attrs(styles.hunkText)}>{line.text}</span>}
								>
									<span {...stylex.attrs(styles.number)}>{line.oldLine ?? ""}</span>
									<span {...stylex.attrs(styles.number)}>{line.newLine ?? ""}</span>
									<span {...stylex.attrs(styles.code)}>{line.text || " "}</span>
								</Show>
							</div>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}
