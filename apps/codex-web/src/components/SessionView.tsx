import { useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js";

import { diffTotals, filesOf, parseDiff } from "../harness/diff.ts";
import type { Draft, Harness } from "../harness/model.ts";
import { t } from "../i18n.ts";
import { paths } from "../router.ts";
import { base } from "../ui/base.ts";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Disclosure } from "../ui/Disclosure.tsx";
import { TextInput } from "../ui/Field.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Menu, MenuItem, MenuSeparator } from "../ui/Menu.tsx";
import { Dot, Skeleton, Spinner } from "../ui/Spinner.tsx";
import { color, control, media, radius, shadow, space, text } from "../ui/tokens.stylex.ts";
import { Composer, type SlashCommand } from "./Composer.tsx";
import { DecisionDock } from "./DecisionDock.tsx";
import { DiffCount } from "./DiffView.tsx";
import { GoalStrip } from "./GoalStrip.tsx";
import { RunView } from "./RunView.tsx";
import type { PanelKind } from "./SidePanel.tsx";

const COLUMN = "46rem";

const styles = stylex.create({
	root: {
		display: "flex",
		flexDirection: "column",
		minWidth: 0,
		minHeight: 0,
		height: "100dvh",
		backgroundColor: color.bg,
	},
	header: {
		display: "flex",
		alignItems: "center",
		gap: space.xs,
		minHeight: "3.25rem",
		paddingBlockStart: "env(safe-area-inset-top)",
		paddingInline: space.sm,
	},
	back: {
		display: { default: "none", [media.narrow]: "inline-flex" },
		alignItems: "center",
		justifyContent: "center",
		flexShrink: 0,
		width: control.lg,
		height: control.lg,
		color: color.text,
	},
	title: {
		flexGrow: 1,
		minWidth: 0,
		margin: 0,
		paddingInline: space.sm,
		overflow: "hidden",
		fontSize: text.md,
		fontWeight: 600,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	status: {
		display: "flex",
		alignItems: "center",
		gap: space.sm,
		margin: 0,
		paddingBlock: space.xs,
		paddingInline: space.lg,
		backgroundColor: color.surface,
		color: color.muted,
		fontSize: text.xs,
	},
	// Reversed so that the browser keeps the scroll position at the newest text while it streams, and
	// leaves it alone once the reader has scrolled up. No scripted scrolling while streaming.
	scroller: {
		display: "flex",
		flexDirection: "column-reverse",
		flexGrow: 1,
		minHeight: 0,
		overflowY: "auto",
		maskImage: "linear-gradient(to bottom, transparent, black 0.75rem, black calc(100% - 0.75rem), transparent)",
	},
	column: {
		display: "flex",
		flexDirection: "column",
		gap: "2.25rem",
		width: "100%",
		maxWidth: COLUMN,
		marginInline: "auto",
		// In a reversed scroller this keeps short work at the top of the page.
		marginBlockEnd: "auto",
		paddingBlockStart: space.xl,
		paddingBlockEnd: space.lg,
		paddingInline: { default: space.xl, [media.narrow]: space.lg },
	},
	// Not what the browser should hold in place when older work arrives: what is being read is.
	older: { alignSelf: "center", overflowAnchor: "none" },
	skeleton: { display: "flex", flexDirection: "column", gap: space.md },
	jumpWrap: { position: "relative", height: 0, width: "100%", maxWidth: COLUMN, marginInline: "auto" },
	jump: {
		position: "absolute",
		bottom: space.sm,
		left: "50%",
		transform: "translateX(-50%)",
		backgroundColor: color.overlay,
		boxShadow: shadow.float,
		color: color.text,
	},
	footer: {
		display: "flex",
		flexDirection: "column",
		gap: space.sm,
		width: "100%",
		maxWidth: COLUMN,
		marginInline: "auto",
		paddingBlockEnd: `max(${space.sm}, env(safe-area-inset-bottom))`,
		paddingInline: { default: space.xl, [media.narrow]: space.sm },
	},
	checklist: {
		paddingBlock: space.xs,
		paddingInline: space.md,
		borderRadius: radius.md,
		backgroundColor: color.surface,
	},
	planSummary: { display: "flex", alignItems: "center", gap: space.sm, flexGrow: 1, minWidth: 0, fontSize: text.sm },
	planCount: { flexShrink: 0, color: color.faint, fontSize: text.xs, fontVariantNumeric: "tabular-nums" },
	planCurrent: { minWidth: 0, overflow: "hidden", color: color.text, textOverflow: "ellipsis", whiteSpace: "nowrap" },
	planList: {
		display: "flex",
		flexDirection: "column",
		gap: space.xs,
		margin: 0,
		padding: 0,
		paddingBlockEnd: space.xs,
		listStyle: "none",
		fontSize: text.sm,
	},
	planStep: { display: "flex", alignItems: "flex-start", gap: space.sm, color: color.muted },
	planNow: { color: color.text, fontWeight: 500 },
	planDone: { display: "flex", color: color.faint },
	planMark: {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		flexShrink: 0,
		width: "1rem",
		height: "1.25rem",
	},
	dialogActions: { display: "flex", justifyContent: "flex-end", gap: space.sm },
	formStack: { display: "flex", flexDirection: "column", gap: space.md },
	counts: { fontVariantNumeric: "tabular-nums" },
});

type DialogKind = "rename" | "undo" | null;

function TextDialog(props: {
	open: boolean;
	title: string;
	hint?: string;
	initial: string;
	onClose: () => void;
	onSave: (value: string) => void;
}) {
	let input: HTMLInputElement | undefined;
	createEffect(
		() => props.open,
		(open) => {
			if (open && input) {
				input.value = untrack(() => props.initial);
			}
		},
	);
	return (
		<Dialog open={props.open} title={props.title} {...(props.hint ? { hint: props.hint } : {})} onClose={props.onClose}>
			<form
				{...stylex.attrs(styles.formStack)}
				onSubmit={(event) => {
					event.preventDefault();
					const value = input?.value.trim();
					if (value) {
						props.onSave(value);
					}
					props.onClose();
				}}
			>
				<TextInput
					ref={(element: HTMLInputElement) => {
						input = element;
					}}
					required
					aria-label={props.title}
				/>
				<div {...stylex.attrs(styles.dialogActions)}>
					<Button onClick={() => props.onClose()}>{t.cancel}</Button>
					<Button variant="strong" type="submit">
						{t.save}
					</Button>
				</div>
			</form>
		</Dialog>
	);
}

// One session. It is created per session id, so scroll position and a half-typed message never carry over.
export function SessionView(props: {
	harness: Harness;
	id: string;
	panel: PanelKind | null;
	onPanel: (kind: PanelKind | null) => void;
}) {
	const { harness } = props;
	const navigate = useNavigate();
	const session = createMemo(() => harness.session(props.id));
	const runs = createMemo(() => harness.runs(props.id));
	const [dialog, setDialog] = createSignal<DialogKind>(null);
	const [away, setAway] = createSignal(false);
	let scroller: HTMLDivElement | undefined;
	let focusComposer: (() => void) | undefined;

	// A reply that comes after the person has gone elsewhere does not take them back.
	let here = true;
	onSettled(() => {
		harness.open(props.id);
		return () => {
			here = false;
		};
	});

	const busy = () => harness.activeRun(props.id) !== null;
	// Stays once the run ends, until the next one starts: taking it away would move what is being read.
	const checklist = createMemo(() => {
		const list = runs().at(-1)?.checklist();
		return list?.length ? list : null;
	});
	const checklistDone = () => checklist()?.filter((item) => item.state === "done").length ?? 0;
	const checklistNow = () => (busy() ? (checklist()?.find((item) => item.state === "active")?.text ?? "") : "");

	const totals = createMemo(() => {
		for (const run of runs().toReversed()) {
			const diff = run.diff();
			if (diff) {
				return diffTotals(parseDiff(diff));
			}
			const files = run.steps().flatMap((step) => (step.kind === "edit" ? filesOf(step) : []));
			if (files.length > 0) {
				return diffTotals(files);
			}
		}
		return null;
	});

	// What was just asked for, while the answer is on its way: over a slow link, that is most of a second.
	const [loadingOlder, setLoadingOlder] = createSignal(false);
	const [doing, setDoing] = createSignal<keyof typeof t.doing | null>(null);
	const during = <T,>(what: keyof typeof t.doing, work: Promise<T>): Promise<T> => {
		setDoing(what);
		return work.finally(() => setDoing(null));
	};
	const sendText = (value: string) => void harness.send(props.id, { text: value, files: [], skills: [], images: [] });
	const fork = (fromRun?: string) => {
		void during("fork", harness.fork(props.id, fromRun)).then((id) => {
			if (id && here) {
				navigate(`${paths()}?thread=${id}`);
			}
		});
	};
	const archive = () => {
		void during("archive", harness.archive(props.id)).then((done) => {
			if (done && here) {
				navigate(paths());
			}
		});
	};

	const onCommand = (command: SlashCommand) => {
		switch (command) {
			case "new":
				navigate(`${paths()}?new=1`);
				break;
			case "plan":
				harness.setPlanning(!harness.planning());
				break;
			case "compact":
				void during("compact", harness.compact(props.id));
				break;
			case "review":
				void during("review", harness.review(props.id));
				break;
			case "undo":
				setDialog("undo");
				break;
			case "fork":
				fork();
				break;
			case "rename":
				setDialog("rename");
				break;
			case "diff":
				props.onPanel("changes");
				break;
			case "files":
				props.onPanel("files");
				break;
		}
	};

	return (
		<div {...stylex.attrs(styles.root)}>
			<header {...stylex.attrs(styles.header)}>
				<a href={paths()} aria-label={t.allThreads} {...stylex.attrs(styles.back, base.focusRing)}>
					<Icon name="back" />
				</a>
				<h1 {...stylex.attrs(styles.title)}>{session()?.title ?? t.newThread}</h1>
				<Show when={totals()}>
					{(own) => (
						<Button
							variant="ghost"
							aria-label={t.changes}
							data-tip={t.changes}
							xstyle={styles.counts}
							onClick={() => props.onPanel(props.panel === "changes" ? null : "changes")}
						>
							<DiffCount added={own().added} removed={own().removed} />
						</Button>
					)}
				</Show>
				<Button
					variant="ghost"
					icon
					on={props.panel !== null}
					aria-label={t.filesAndChanges}
					aria-pressed={props.panel !== null ? "true" : "false"}
					data-tip={t.filesAndChanges}
					onClick={() => props.onPanel(props.panel === null ? (totals() ? "changes" : "files") : null)}
				>
					<Icon name="panel" />
				</Button>
				<Menu label={t.threadActions} tip={t.threadActions} trigger={<Icon name="more" />}>
					<MenuItem
						label={t.review}
						icon={<Icon name="eye" />}
						onSelect={() => void during("review", harness.review(props.id))}
					/>
					<MenuItem
						label={t.compact}
						icon={<Icon name="compress" />}
						onSelect={() => void during("compact", harness.compact(props.id))}
					/>
					<MenuItem label={t.fork} icon={<Icon name="fork" />} onSelect={() => fork()} />
					<MenuSeparator />
					<MenuItem label={t.rename} icon={<Icon name="pencil" />} onSelect={() => setDialog("rename")} />
					<MenuItem label={t.archive} icon={<Icon name="archive" />} onSelect={archive} />
				</Menu>
			</header>
			<Show when={harness.connection() === "offline" || harness.connection() === "connecting"}>
				<p role="status" {...stylex.attrs(styles.status)}>
					<Dot tone="done" />
					{t.reconnecting}
				</p>
			</Show>
			<Show when={doing()}>
				{(what) => (
					<p role="status" {...stylex.attrs(styles.status)}>
						<Spinner />
						{t.doing[what()]}
					</p>
				)}
			</Show>
			<div
				ref={(element) => {
					scroller = element;
				}}
				{...stylex.attrs(styles.scroller)}
				onScroll={(event) => setAway(event.currentTarget.scrollTop < -200)}
			>
				<div {...stylex.attrs(styles.column)}>
					<Show when={!harness.loaded(props.id) && runs().length === 0}>
						<div {...stylex.attrs(styles.skeleton)}>
							<Skeleton width="medium" />
							<Skeleton />
							<Skeleton />
							<Skeleton width="short" />
						</div>
					</Show>
					<Show when={harness.hasOlder(props.id)}>
						<Button
							xstyle={styles.older}
							disabled={loadingOlder()}
							onClick={() => {
								setLoadingOlder(true);
								void harness.loadOlder(props.id).finally(() => setLoadingOlder(false));
							}}
						>
							<Show when={loadingOlder()}>
								<Spinner />
							</Show>
							{t.loadEarlier}
						</Button>
					</Show>
					<For each={runs()} keyed={(run) => run.id}>
						{(run, index) => (
							<RunView
								run={run()}
								root={harness.folderOf(props.id)}
								latest={index() === runs().length - 1}
								waiting={harness.decisions(props.id).length > 0}
								onSend={sendText}
								onCarryOut={() => void harness.carryOutPlan(props.id, t.implementPrompt)}
								onFork={(runId) => fork(runId)}
								onUndo={() => setDialog("undo")}
								onShowChanges={() => props.onPanel("changes")}
							/>
						)}
					</For>
				</div>
			</div>
			<Show when={away()}>
				<div {...stylex.attrs(styles.jumpWrap)}>
					<Button
						xstyle={styles.jump}
						onClick={() =>
							scroller?.scrollTo({
								top: 0,
								behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
							})
						}
					>
						<Icon name="chevronDown" small />
						{t.jumpToLatest}
					</Button>
				</div>
			</Show>
			<div {...stylex.attrs(styles.footer)}>
				<Show when={harness.goal(props.id)}>
					{(goal) => <GoalStrip harness={harness} id={props.id} goal={goal()} />}
				</Show>
				<Show when={checklist()}>
					{(items) => (
						<Disclosure
							xstyle={styles.checklist}
							summary={
								<span {...stylex.attrs(styles.planSummary)}>
									<span {...stylex.attrs(styles.planCount)}>{t.stepsDone(checklistDone(), items().length)}</span>
									<span {...stylex.attrs(styles.planCurrent)}>{checklistNow()}</span>
								</span>
							}
						>
							<ol {...stylex.attrs(styles.planList)}>
								<For each={items()}>
									{(item) => (
										<li {...stylex.attrs(styles.planStep, item.state === "active" && styles.planNow)}>
											<span {...stylex.attrs(styles.planMark)}>
												<Show
													when={item.state === "done"}
													fallback={<Dot tone={item.state === "active" ? "live" : "done"} />}
												>
													<span {...stylex.attrs(styles.planDone)}>
														<Icon name="check" small />
													</span>
												</Show>
											</span>
											<span>{item.text}</span>
										</li>
									)}
								</For>
							</ol>
						</Disclosure>
					)}
				</Show>
				<DecisionDock harness={harness} sessionId={props.id} onAnswered={() => focusComposer?.()} />
				<Composer
					harness={harness}
					sessionId={props.id}
					focusRef={(focus) => {
						focusComposer = focus;
					}}
					busy={busy()}
					usage={harness.usage(props.id)}
					branch={session()?.branch}
					folder={harness.folderOf(props.id)}
					autofocus
					onGoal={(objective) => harness.setGoal(props.id, objective)}
					onSubmit={(draft: Draft) => harness.send(props.id, draft)}
					onStop={() => harness.stop(props.id)}
					onCommand={onCommand}
				/>
			</div>
			<TextDialog
				open={dialog() === "rename"}
				title={t.renameTitle}
				initial={session()?.title ?? ""}
				onClose={() => setDialog(null)}
				onSave={(title) => void harness.rename(props.id, title)}
			/>
			<Dialog open={dialog() === "undo"} title={t.undoTitle} hint={t.undoHint} onClose={() => setDialog(null)}>
				<div {...stylex.attrs(styles.dialogActions)}>
					<Button onClick={() => setDialog(null)}>{t.cancel}</Button>
					<Button
						variant="strong"
						onClick={() => {
							setDialog(null);
							void during("undo", harness.undo(props.id));
						}}
					>
						{t.undo}
					</Button>
				</div>
			</Dialog>
		</div>
	);
}
