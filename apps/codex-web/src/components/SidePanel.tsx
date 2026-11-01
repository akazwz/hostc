import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For, Match, onSettled, Show, Switch } from "solid-js";

import { type DiffFile, diffTotals, filesOf, parseDiff } from "../harness/diff.ts";
import type { FolderEntry, Harness } from "../harness/model.ts";
import { t } from "../i18n.ts";
import { base } from "../ui/base.ts";
import { Button } from "../ui/Button.tsx";
import { Card } from "../ui/Card.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Skeleton } from "../ui/Spinner.tsx";
import { Tabs } from "../ui/Tabs.tsx";
import { color, control, font, media, motion, radius, space, text } from "../ui/tokens.stylex.ts";
import { DiffCount, DiffFileView } from "./DiffView.tsx";
import { Code } from "./Markdown.tsx";

export type PanelKind = "changes" | "files";

const arrive = stylex.keyframes({ from: { opacity: 0, transform: "translateX(0.5rem)" } });

const styles = stylex.create({
	root: {
		display: "flex",
		flexDirection: "column",
		outlineStyle: "none",
		minWidth: 0,
		minHeight: 0,
		height: "100dvh",
		backgroundColor: color.bg,
		animationName: { default: arrive, "@media (prefers-reduced-motion: reduce)": "none" },
		animationDuration: motion.slow,
		animationTimingFunction: motion.ease,
	},
	header: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: space.sm,
		minHeight: "3.25rem",
		paddingBlockStart: "env(safe-area-inset-top)",
		paddingInline: space.sm,
	},
	body: {
		display: "flex",
		flexDirection: "column",
		flexGrow: 1,
		gap: space.sm,
		minHeight: 0,
		padding: space.md,
		paddingBlockEnd: `max(${space.md}, env(safe-area-inset-bottom))`,
		overflowY: "auto",
	},
	totals: {
		display: "flex",
		alignItems: "center",
		gap: space.sm,
		minHeight: control.sm,
		color: color.muted,
		fontSize: text.sm,
	},
	entry: {
		display: "flex",
		alignItems: "center",
		gap: space.sm,
		flexShrink: 0,
		width: "100%",
		minHeight: control.md,
		paddingInline: space.sm,
		borderWidth: 0,
		borderRadius: radius.xs,
		backgroundColor: { default: "transparent", [media.hover]: { default: "transparent", ":hover": color.hover } },
		color: color.text,
		cursor: "pointer",
		fontFamily: "inherit",
		fontSize: text.sm,
		textAlign: "start",
	},
	name: {
		minWidth: 0,
		overflow: "hidden",
		fontFamily: font.mono,
		fontSize: text.xs,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	loadingRows: { display: "flex", flexDirection: "column", gap: space.md, padding: space.sm },
	entryIcon: { display: "flex", color: color.faint },
	path: {
		minWidth: 0,
		overflow: "hidden",
		color: color.muted,
		fontFamily: font.mono,
		fontSize: text.xs,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	fileView: { paddingBlockStart: space.md },
});

function Loading() {
	return (
		<div role="status" aria-label={t.loading} {...stylex.attrs(styles.loadingRows)}>
			<Skeleton width="medium" />
			<Skeleton />
			<Skeleton width="short" />
		</div>
	);
}

function ChangesPanel(props: { harness: Harness; sessionId: string; folder: string }) {
	const [tab, setTab] = createSignal<"turn" | "branch">("turn");
	const [branch, setBranch] = createSignal<string | null | undefined>(undefined);
	let branchSerial = 0;
	const lastRun = createMemo((): DiffFile[] => {
		for (const run of props.harness.runs(props.sessionId).toReversed()) {
			const diff = run.diff();
			if (diff) {
				return parseDiff(diff);
			}
			const files = run.steps().flatMap((step) => (step.kind === "edit" ? filesOf(step) : []));
			if (files.length > 0) {
				return files;
			}
		}
		return [];
	});
	// Read each time: the agent may have changed it since. `undefined` while the answer is on its way.
	const choose = (next: "turn" | "branch") => {
		setTab(next);
		if (next === "branch") {
			setBranch(undefined);
			const serial = ++branchSerial;
			void props.harness.branchDiff(props.folder).then((diff) => {
				if (serial === branchSerial) {
					setBranch(diff);
				}
			});
		}
	};
	const files = createMemo(() => (tab() === "turn" ? lastRun() : parseDiff(branch() ?? "")));
	const totals = createMemo(() => diffTotals(files()));
	return (
		<div {...stylex.attrs(styles.body)}>
			<div>
				<Tabs
					label={t.changes}
					value={tab()}
					options={[
						{ value: "turn", label: t.lastTurn },
						{ value: "branch", label: t.branch },
					]}
					onChange={choose}
				/>
			</div>
			<Show
				when={files().length > 0}
				fallback={
					<Show when={tab() === "turn" || branch() !== undefined} fallback={<Loading />}>
						<EmptyState title={tab() === "branch" && branch() === null ? t.notGit : t.noChanges} />
					</Show>
				}
			>
				<div {...stylex.attrs(styles.totals)}>
					<span>{t.nFiles(files().length)}</span>
					<DiffCount added={totals().added} removed={totals().removed} />
				</div>
				<For each={files()} keyed={(file) => file.path}>
					{(file, index) => <DiffFileView file={file()} root={props.folder} startOpen={index() < 3} />}
				</For>
			</Show>
		</div>
	);
}

function FilesPanel(props: { harness: Harness; folder: string }) {
	const root = () => props.folder;
	const [path, setPath] = createSignal("");
	const [entries, setEntries] = createSignal<FolderEntry[]>([]);
	const [file, setFile] = createSignal<{ path: string; text: string | null } | null>(null);
	const [loading, setLoading] = createSignal(true);

	// Only the latest thing asked for lands, and the view changes when it has: a tap made meanwhile acts
	// on what is on the screen.
	let serial = 0;
	const openFolder = (folder: string) => {
		const own = ++serial;
		setLoading(true);
		void props.harness.readFolder(folder).then((found) => {
			if (own !== serial) {
				return;
			}
			setLoading(false);
			if (found) {
				setPath(folder);
				setFile(null);
				setEntries(found.toSorted((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name)));
			}
		});
	};
	const openFile = (target: string) => {
		const own = ++serial;
		setLoading(true);
		void props.harness.readFile(target).then((content) => {
			if (own !== serial) {
				return;
			}
			setLoading(false);
			if (content !== undefined) {
				setFile({ path: target, text: content });
			}
		});
	};
	const parent = () => path().slice(0, path().lastIndexOf("/"));
	const relative = (target: string) => target.slice(root().length + 1);

	onSettled(() => {
		openFolder(root());
	});

	return (
		<div {...stylex.attrs(styles.body)}>
			<Show
				when={file()}
				fallback={
					<>
						<Show when={path() !== root()}>
							<button
								type="button"
								{...stylex.attrs(styles.entry, base.focusRing)}
								onClick={() => openFolder(parent())}
							>
								<span {...stylex.attrs(styles.entryIcon)}>
									<Icon name="back" />
								</span>
								<span {...stylex.attrs(styles.path)}>{relative(path())}</span>
							</button>
						</Show>
						<For
							each={entries()}
							keyed={(entry) => entry.name}
							fallback={
								<Show when={!loading()} fallback={<Loading />}>
									<EmptyState title={t.emptyFolder} />
								</Show>
							}
						>
							{(entry) => (
								<button
									type="button"
									{...stylex.attrs(styles.entry, base.focusRing)}
									onClick={() =>
										entry().folder ? openFolder(`${path()}/${entry().name}`) : openFile(`${path()}/${entry().name}`)
									}
								>
									<span {...stylex.attrs(styles.entryIcon)}>
										<Icon name={entry().folder ? "folder" : "file"} />
									</span>
									<span {...stylex.attrs(styles.name)}>{entry().name}</span>
								</button>
							)}
						</For>
					</>
				}
			>
				{(open) => (
					<>
						<button type="button" {...stylex.attrs(styles.entry, base.focusRing)} onClick={() => setFile(null)}>
							<span {...stylex.attrs(styles.entryIcon)}>
								<Icon name="back" />
							</span>
							<span {...stylex.attrs(styles.path)}>{relative(open().path)}</span>
						</button>
						<Show when={open().text !== null} fallback={<EmptyState title={t.binaryFile} />}>
							<Card xstyle={styles.fileView}>
								<Code text={open().text ?? ""} language={open().path.split(".").at(-1) ?? ""} />
							</Card>
						</Show>
					</>
				)}
			</Show>
		</div>
	);
}

// The changes and the files, beside the work.
export function SidePanel(props: {
	harness: Harness;
	folder: string;
	sessionId: string | null;
	kind: PanelKind;
	onKind: (kind: PanelKind) => void;
	onClose: () => void;
}) {
	let root: HTMLElement | undefined;
	// The keyboard goes where the panel opened, and comes back to what opened it.
	onSettled(() => {
		const opener = document.activeElement;
		root?.focus({ preventScroll: true });
		return () => {
			if (opener instanceof HTMLElement && opener.isConnected) {
				opener.focus({ preventScroll: true });
			}
		};
	});
	const options = () => [
		...(props.sessionId ? [{ value: "changes" as const, label: t.changes }] : []),
		{ value: "files" as const, label: t.files },
	];
	return (
		<aside
			ref={(element) => {
				root = element;
			}}
			tabindex="-1"
			aria-label={props.kind === "changes" ? t.changes : t.files}
			{...stylex.attrs(styles.root)}
		>
			<div {...stylex.attrs(styles.header)}>
				<Tabs label={t.files} value={props.kind} options={options()} onChange={props.onKind} />
				<Button variant="ghost" icon aria-label={t.closePanel} onClick={() => props.onClose()}>
					<Icon name="close" />
				</Button>
			</div>
			<Switch>
				<Match when={props.kind === "changes" && props.sessionId}>
					{(id) => (
						<Show when={id()} keyed>
							{(sessionId) => <ChangesPanel harness={props.harness} sessionId={sessionId} folder={props.folder} />}
						</Show>
					)}
				</Match>
				<Match when={props.kind === "files"}>
					{/* A new one per folder: it starts at the top of the folder it was opened in. */}
					<Show when={props.folder} keyed>
						{(folder) => <FilesPanel harness={props.harness} folder={folder} />}
					</Show>
				</Match>
			</Switch>
		</aside>
	);
}
