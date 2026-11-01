import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For, Match, onSettled, Show, Switch } from "solid-js";

import { diffTotals, filesOf } from "../harness/diff.ts";
import type { CommandStep, EditStep, LookStep, Run, Step, ThinkingStep } from "../harness/model.ts";
import { duration, t } from "../i18n.ts";
import { base } from "../ui/base.ts";
import { Button } from "../ui/Button.tsx";
import { Card } from "../ui/Card.tsx";
import { CopyButton } from "../ui/CopyButton.tsx";
import { Disclosure, DisclosureButton } from "../ui/Disclosure.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Dot, Spinner } from "../ui/Spinner.tsx";
import { color, control, font, media, motion, radius, space, text } from "../ui/tokens.stylex.ts";
import { DiffCount, DiffFileView } from "./DiffView.tsx";
import { Markdown } from "./Markdown.tsx";

const styles = stylex.create({
	run: {
		display: "flex",
		flexDirection: "column",
		gap: space.md,
		minWidth: 0,
	},
	// What the person said, on the right, as in every conversation they have ever had on a screen.
	request: {
		display: "flex",
		flexDirection: "column",
		alignItems: "flex-end",
		alignSelf: "flex-end",
		gap: space.sm,
		maxWidth: "85%",
		minWidth: 0,
	},
	// Earlier work costs nothing until it is scrolled to. The browser remembers its real height.
	earlier: { contentVisibility: "auto", containIntrinsicSize: "auto 16rem" },
	bubble: {
		margin: 0,
		paddingBlock: space.sm,
		paddingInline: "0.875rem",
		borderRadius: radius.lg,
		backgroundColor: color.bubble,
		fontSize: text.read,
		lineHeight: 1.5,
		overflowWrap: "anywhere",
		whiteSpace: "pre-wrap",
	},
	bubbleClamped: { display: "-webkit-box", overflow: "hidden", WebkitBoxOrient: "vertical", WebkitLineClamp: 12 },
	showAll: { fontWeight: 400 },
	images: { display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: space.sm },
	image: {
		display: "block",
		maxWidth: "min(14rem, 70vw)",
		maxHeight: "14rem",
		borderRadius: radius.md,
		objectFit: "cover",
	},
	// The work: a quiet timeline.
	summaryText: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.1875rem 0.5rem", fontSize: text.sm },
	// One list for the whole life of a run: nothing is drawn again when it ends, only folded.
	body: { display: "flex", flexDirection: "column", gap: space.xs, minWidth: 0 },
	step: { minWidth: 0 },
	folded: { display: "none" },
	// What the agent says or makes stands apart from the rows of work around it.
	said: {
		marginBlockStart: { default: `calc(${space.md} - ${space.xs})`, ":first-child": 0 },
		marginBlockEnd: { default: `calc(${space.md} - ${space.xs})`, ":last-child": 0 },
	},
	stepSummary: { fontSize: text.sm },
	machine: {
		flexGrow: 1,
		minWidth: 0,
		overflow: "hidden",
		fontFamily: font.mono,
		fontSize: text.xs,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	prompt: { color: color.faint, userSelect: "none" },
	status: { flexShrink: 0, color: color.faint, fontSize: text.xs, fontVariantNumeric: "tabular-nums" },
	bad: { color: color.removed },
	output: {
		margin: 0,
		maxHeight: "20rem",
		padding: space.md,
		overflow: "auto",
		fontFamily: font.mono,
		fontSize: text.xs,
		lineHeight: 1.55,
	},
	lookLine: {
		minWidth: 0,
		overflow: "hidden",
		color: color.faint,
		fontFamily: font.mono,
		fontSize: text.xs,
		lineHeight: 1.7,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	thought: {
		color: color.muted,
		fontSize: text.sm,
		lineHeight: 1.55,
		whiteSpace: "pre-wrap",
		overflowWrap: "anywhere",
	},
	files: { display: "flex", flexDirection: "column", gap: space.xs },
	note: {
		display: "flex",
		alignItems: "center",
		minHeight: control.sm,
		margin: 0,
		color: color.faint,
		fontSize: text.sm,
	},
	saidRow: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: space.sm, minWidth: 0 },
	noteDetail: {
		marginInlineStart: space.sm,
		overflow: "hidden",
		color: color.faint,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	steered: { maxWidth: "85%" },
	asks: { display: "flex", flexDirection: "column", gap: space.sm, marginBlockStart: space.lg },
	askTitle: { margin: 0, color: color.muted, fontSize: text.sm },
	options: { display: "flex", flexWrap: "wrap", gap: space.sm },
	planActions: { marginBlockStart: space.md },
	error: {
		display: "flex",
		alignItems: "flex-start",
		gap: space.sm,
		padding: space.md,
		borderRadius: radius.md,
		backgroundColor: color.removedBg,
		color: color.removed,
		fontSize: text.md,
	},
	errorText: { minWidth: 0, overflowWrap: "anywhere" },
	// Icons line up with the text above and sit close under it; the buttons around them are as big as a
	// finger needs, and that room is taken out of the margins.
	footer: {
		display: "flex",
		alignItems: "center",
		marginBlock: `calc((1rem - ${control.sm}) / 2)`,
		marginInlineStart: `calc((1rem - ${control.sm}) / 2)`,
		color: color.faint,
		fontSize: text.xs,
	},
	footerCount: { paddingInline: `calc((${control.sm} - 1rem) / 2)` },
	// Earlier runs show their actions when the pointer comes near; a touch screen always shows them.
	footerQuiet: {
		opacity: {
			default: 1,
			[media.hover]: { default: 0, [stylex.when.ancestor(":hover")]: 1, ":focus-within": 1 },
		},
		transitionDuration: motion.quick,
		transitionProperty: "opacity",
	},
	footerText: {
		paddingInline: `calc((${control.sm} - 1rem) / 2)`,
		fontVariantNumeric: "tabular-nums",
	},
	// As much room as the footer that replaces it, so that the text above stays where it is.
	working: {
		display: "flex",
		alignItems: "center",
		gap: space.sm,
		minHeight: control.sm,
		marginBlock: `calc((1rem - ${control.sm}) / 2)`,
		color: color.muted,
		fontSize: text.sm,
	},
	workingText: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
	elapsed: { flexShrink: 0, color: color.faint, fontSize: text.xs, fontVariantNumeric: "tabular-nums" },
});

/** Runs of looking and thinking fold into one line; anything that did something stands alone. */
type Part =
	| { kind: "quiet"; id: string; steps: (LookStep | ThinkingStep)[] }
	| { kind: "step"; id: string; step: Step };

function partsOf(steps: readonly Step[]): Part[] {
	const parts: Part[] = [];
	let quiet: (LookStep | ThinkingStep)[] | null = null;
	for (const step of steps) {
		if (step.kind === "look" || step.kind === "thinking") {
			if (!quiet) {
				quiet = [];
				parts.push({ kind: "quiet", id: step.id, steps: quiet });
			}
			quiet.push(step);
			continue;
		}
		quiet = null;
		parts.push({ kind: "step", id: step.id, step });
	}
	return parts;
}

function lookCounts(steps: readonly Step[]) {
	const files = new Set<string>();
	let searches = 0;
	let lists = 0;
	for (const step of steps) {
		if (step.kind === "look") {
			for (const action of step.actions) {
				if (action.verb === "read") {
					files.add(action.target);
				} else if (action.verb === "search") {
					searches++;
				} else {
					lists++;
				}
			}
		}
	}
	return [
		files.size > 0 ? t.nFiles(files.size) : "",
		searches > 0 ? t.nSearches(searches) : "",
		lists > 0 ? t.nLists(lists) : "",
	]
		.filter(Boolean)
		.join(", ");
}

function lookLine(action: LookStep["actions"][number]): string {
	const verb = action.verb === "read" ? t.read : action.verb === "search" ? t.searched : t.listed;
	return `${verb} ${action.target}`.trim();
}

function Quiet(props: { steps: (LookStep | ThinkingStep)[]; live: boolean }) {
	const counts = () => lookCounts(props.steps);
	const label = () => (counts() ? `${props.live ? t.exploring : t.explored} ${counts()}` : t.thinking);
	return (
		<Disclosure summary={<span {...stylex.attrs(styles.stepSummary)}>{label()}</span>}>
			<For each={props.steps} keyed={(step) => step.id}>
				{(step) => (
					<Show
						when={stepAsLook(step())}
						fallback={
							<div {...stylex.attrs(styles.thought)}>
								<Markdown text={(step() as ThinkingStep).text} />
							</div>
						}
					>
						{(look) => (
							<For each={look().actions}>
								{(action) => <div {...stylex.attrs(styles.lookLine)}>{lookLine(action)}</div>}
							</For>
						)}
					</Show>
				)}
			</For>
		</Disclosure>
	);
}

function stepAsLook(step: LookStep | ThinkingStep) {
	return step.kind === "look" ? step : undefined;
}

function CommandRow(props: { step: CommandStep }) {
	const status = () => {
		const { step } = props;
		if (step.status === "declined") {
			return t.declined;
		}
		if (step.status === "failed") {
			return step.exitCode === null ? t.failed : t.exit(step.exitCode);
		}
		return step.durationMs === null ? "" : duration(step.durationMs);
	};
	const bad = () => props.step.status === "failed" || props.step.status === "declined";
	return (
		<Disclosure
			open={props.step.status === "failed"}
			summary={
				<>
					<span {...stylex.attrs(styles.machine)}>
						<span {...stylex.attrs(styles.prompt)}>$ </span>
						{props.step.command}
					</span>
					<span {...stylex.attrs(styles.status, bad() && styles.bad)}>{status()}</span>
				</>
			}
		>
			<Show when={props.step.output}>
				{(output) => (
					<Card>
						<pre tabindex="0" {...stylex.attrs(styles.output, base.focusRing)}>
							{output()}
						</pre>
					</Card>
				)}
			</Show>
		</Disclosure>
	);
}

function EditRow(props: { step: EditStep; root: string }) {
	const files = () => filesOf(props.step);
	const totals = createMemo(() => diffTotals(files()));
	const failed = () => props.step.status === "failed" || props.step.status === "declined";
	const label = () =>
		props.step.status === "running"
			? t.editing
			: props.step.status === "declined"
				? t.declined
				: props.step.status === "failed"
					? t.failed
					: t.edited(props.step.files.length);
	return (
		<Disclosure
			open
			summary={
				<span {...stylex.attrs(styles.summaryText)}>
					<span {...stylex.attrs(failed() && styles.bad)}>{label()}</span>
					<DiffCount added={totals().added} removed={totals().removed} />
				</span>
			}
		>
			<div {...stylex.attrs(styles.files)}>
				<For each={files()} keyed={(file) => file.path}>
					{(file) => <DiffFileView file={file()} root={props.root} />}
				</For>
			</div>
		</Disclosure>
	);
}

function noteText(value: string): string {
	const names: Record<string, string> = {
		web: t.searchedWeb,
		compacted: t.contextCompacted,
		agent: t.subAgent,
		review: t.reviewing,
	};
	return names[value] ?? value;
}

// What the person said during a run. A picture alone is as much a message as words.
function Said(props: { text: string; images: readonly string[] }) {
	return (
		<div {...stylex.attrs(styles.saidRow)}>
			<Show when={props.images.length > 0}>
				<div {...stylex.attrs(styles.images)}>
					<For each={props.images}>{(url) => <img src={url} alt="" {...stylex.attrs(styles.image)} />}</For>
				</div>
			</Show>
			<Show when={props.text}>
				<p {...stylex.attrs(styles.bubble, styles.steered)}>{props.text}</p>
			</Show>
		</div>
	);
}

function Asks(props: { asks: { title: string; options: string[] }[]; onAnswer: (value: string) => void }) {
	return (
		<div {...stylex.attrs(styles.asks)}>
			<For each={props.asks}>
				{(ask) => (
					<>
						<p {...stylex.attrs(styles.askTitle)}>{ask.title}</p>
						<Show when={ask.options.length > 0}>
							<div {...stylex.attrs(styles.options)}>
								<For each={ask.options}>
									{(option) => <Button onClick={() => props.onAnswer(option)}>{option}</Button>}
								</For>
							</div>
						</Show>
					</>
				)}
			</For>
		</div>
	);
}

function Part(props: {
	part: Part;
	root: string;
	live: boolean;
	idle: boolean;
	onSend: (value: string) => void;
	onCarryOut: () => void;
}) {
	return (
		<Switch>
			<Match when={props.part.kind === "quiet" && props.part}>
				{(part) => <Quiet steps={part().steps} live={props.live} />}
			</Match>
			<Match when={props.part.kind === "step" && props.part.step}>
				{(step) => (
					<Switch>
						<Match when={step().kind === "command" && (step() as CommandStep)}>
							{(own) => <CommandRow step={own()} />}
						</Match>
						<Match when={step().kind === "edit" && (step() as EditStep)}>
							{(own) => <EditRow step={own()} root={props.root} />}
						</Match>
						<Match when={step().kind === "message" && (step() as Extract<Step, { kind: "message" }>)}>
							{(own) => (
								<>
									<Markdown text={own().text} />
									<Show when={props.idle && own().asks.length > 0}>
										<Asks asks={own().asks} onAnswer={props.onSend} />
									</Show>
								</>
							)}
						</Match>
						<Match when={step().kind === "request" && (step() as Extract<Step, { kind: "request" }>)}>
							{(own) => <Said text={own().text} images={own().images} />}
						</Match>
						<Match when={step().kind === "plan" && (step() as Extract<Step, { kind: "plan" }>)}>
							{(own) => (
								<Card pad>
									<Markdown text={own().text} />
									<Show when={props.idle}>
										<div {...stylex.attrs(styles.planActions)}>
											<Button variant="solid" onClick={() => props.onCarryOut()}>
												{t.implementPlan}
											</Button>
										</div>
									</Show>
								</Card>
							)}
						</Match>
						<Match when={step().kind === "note" && (step() as Extract<Step, { kind: "note" }>)}>
							{(own) => (
								<p
									{...stylex.attrs(
										styles.note,
										(own().status === "failed" || own().status === "declined") && styles.bad,
									)}
								>
									{noteText(own().text)}
									<Show when={own().detail}>
										{(detail) => <span {...stylex.attrs(styles.noteDetail)}>{detail()}</span>}
									</Show>
								</p>
							)}
						</Match>
						<Match when={step().kind === "image" && (step() as Extract<Step, { kind: "image" }>)}>
							{(own) => <img src={own().url} alt={own().caption} {...stylex.attrs(styles.image)} />}
						</Match>
					</Switch>
				)}
			</Match>
		</Switch>
	);
}

const standsApart = (part: Part) =>
	part.kind === "step" && ["message", "plan", "image", "request"].includes(part.step.kind);

// Long enough to push the answer off the screen.
function isLong(value: string): boolean {
	return value.length > 800 || value.split("\n").length > 12;
}

function headline(steps: readonly Step[]): string {
	for (const step of steps.toReversed()) {
		if (step.kind === "thinking") {
			const heading = /\*\*(.+?)\*\*/.exec(step.text)?.[1];
			if (heading) {
				return heading;
			}
		}
		if (step.kind === "message" && step.text) {
			return "";
		}
	}
	return "";
}

// What a running run is up to, with a clock. The clock runs only while this is on screen.
function Working(props: {
	steps: readonly Step[];
	startedAt: number | null;
	waiting: boolean;
	retrying: string | null;
}) {
	const [now, setNow] = createSignal(Date.now());
	const started = Date.now();
	onSettled(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	});
	const elapsed = () => Math.max(0, now() - (props.startedAt ? props.startedAt * 1000 : started));
	return (
		<div role="status" {...stylex.attrs(styles.working)}>
			<Show when={!props.waiting} fallback={<Dot tone="attention" />}>
				<Spinner />
			</Show>
			<span {...stylex.attrs(styles.workingText)}>
				{props.waiting
					? t.waitingForYou
					: props.retrying
						? t.retrying(props.retrying)
						: headline(props.steps) || t.working}
			</span>
			<span aria-hidden="true" {...stylex.attrs(styles.elapsed)}>
				{duration(elapsed())}
			</span>
		</div>
	);
}

function workSummary(steps: readonly Step[]): string {
	const commands = steps.filter((step) => step.kind === "command");
	const failed = commands.filter((step) => step.status === "failed").length;
	return [
		lookCounts(steps),
		commands.length > 0 ? t.nCommands(commands.length) : "",
		failed > 0 ? t.nFailed(failed) : "",
	]
		.filter(Boolean)
		.join(" · ");
}

// One piece of work: what was asked on the right, the work folded away once it is done, and the result.
export function RunView(props: {
	run: Run;
	root: string;
	latest: boolean;
	waiting: boolean;
	onSend: (value: string) => void;
	onCarryOut: () => void;
	onFork: (runId: string) => void;
	onUndo: () => void;
	onShowChanges: () => void;
}) {
	const steps = createMemo(() => props.run.steps());
	const running = () => props.run.status() === "running";
	const [whole, setWhole] = createSignal(false);
	const request = createMemo(() => {
		const first = steps()[0];
		return first?.kind === "request" ? first : null;
	});
	const resultIndex = createMemo(() => {
		if (running()) {
			return -1;
		}
		return steps().findLastIndex((step) => step.kind === "message");
	});
	const result = createMemo(() => {
		const own = steps()[resultIndex()];
		return own?.kind === "message" ? own : null;
	});
	// What stays in view once the work has folded away. While running, everything is in order.
	const isOutcome = (step: Step, index: number) =>
		!running() &&
		(index === resultIndex() ||
			step.kind === "plan" ||
			step.kind === "image" ||
			(step.kind === "request" && step !== request()) ||
			(step.kind === "message" && step.asks.length > 0));
	const outcomes = createMemo(() =>
		steps()
			.filter((step, index) => step !== request() && isOutcome(step, index))
			.map((step): Part => ({ kind: "step", id: step.id, step })),
	);
	const work = createMemo(() =>
		partsOf(
			steps().filter(
				// A message that has not said anything yet has nothing to show.
				(step, index) => step !== request() && !isOutcome(step, index) && !(step.kind === "message" && !step.text),
			),
		),
	);
	const [chosen, setChosen] = createSignal<boolean | null>(null);
	const open = () => chosen() ?? props.run.status() === "failed";
	// Work that nobody has looked at costs nothing: a long history folds a lot away. Once on screen it stays,
	// hidden when folded, with whatever was opened or scrolled still as it was.
	let seen = false;
	const workSeen = createMemo(() => {
		seen ||= running() || open();
		return seen;
	});
	const rows = createMemo(() => [...(workSeen() ? work() : []), ...outcomes()]);
	const foldedAway = (part: Part) => !running() && !open() && !outcomes().some((outcome) => outcome.id === part.id);
	const edits = createMemo(() => {
		const files = steps().flatMap((step) => (step.kind === "edit" ? filesOf(step) : []));
		return files.length > 0 ? diffTotals(files) : null;
	});
	const idleLatest = () => props.latest && !running();
	const workLabel = () => {
		const ms = props.run.durationMs();
		const detail = workSummary(steps());
		return [ms ? t.worked(duration(ms)) : "", detail].filter(Boolean).join(" · ") || t.working;
	};
	return (
		<article {...stylex.attrs(styles.run, !props.latest && styles.earlier, stylex.defaultMarker())}>
			<Show when={request()}>
				{(own) => (
					<header {...stylex.attrs(styles.request)}>
						<Show when={own().images.length > 0}>
							<div {...stylex.attrs(styles.images)}>
								<For each={own().images}>{(url) => <img src={url} alt="" {...stylex.attrs(styles.image)} />}</For>
							</div>
						</Show>
						<Show when={own().text}>
							<div {...stylex.attrs(styles.bubble, !whole() && isLong(own().text) && styles.bubbleClamped)}>
								{own().text}
							</div>
							<Show when={isLong(own().text) && !whole()}>
								<Button variant="ghost" size="sm" xstyle={styles.showAll} onClick={() => setWhole(true)}>
									{t.showAll}
								</Button>
							</Show>
						</Show>
					</header>
				)}
			</Show>
			<Show when={rows().length > 0 || work().length > 0}>
				<div
					{...stylex.attrs(styles.body)}
					onClick={(event) => {
						// Opened a row while it works: they are reading it, so the end of the run leaves it in view.
						const details = (event.target as Element).closest("summary")?.parentElement;
						if (running() && details instanceof HTMLDetailsElement && !details.open) {
							setChosen(true);
						}
					}}
				>
					{/* Finished: the work is one line until someone wants to look. */}
					<Show when={!running() && work().length > 0}>
						<DisclosureButton open={open()} onToggle={() => setChosen(!open())}>
							<span {...stylex.attrs(styles.summaryText)}>{workLabel()}</span>
						</DisclosureButton>
					</Show>
					<For each={rows()} keyed={(part) => part.id}>
						{(part) => (
							<div
								{...stylex.attrs(styles.step, standsApart(part()) && styles.said, foldedAway(part()) && styles.folded)}
							>
								<Part
									part={part()}
									root={props.root}
									live={running() && part().id === work().at(-1)?.id}
									idle={idleLatest()}
									onSend={props.onSend}
									onCarryOut={props.onCarryOut}
								/>
							</div>
						)}
					</For>
				</div>
			</Show>
			<Show when={running()}>
				<Working
					steps={steps()}
					startedAt={props.run.startedAt()}
					waiting={props.waiting}
					retrying={props.run.retrying()}
				/>
			</Show>
			<Show when={props.run.error()}>
				{(error) => (
					<div role="alert" {...stylex.attrs(styles.error)}>
						<Icon name="warn" />
						<span {...stylex.attrs(styles.errorText)}>{error()}</span>
					</div>
				)}
			</Show>
			<Show when={!running() && steps().length > 0}>
				<div {...stylex.attrs(styles.footer, !props.latest && styles.footerQuiet)}>
					<Show when={props.run.status() === "stopped"}>
						<span {...stylex.attrs(styles.footerText)}>{t.stopped}</span>
					</Show>
					<Show when={edits()}>
						{(own) => (
							<Button
								variant="ghost"
								size="sm"
								aria-label={t.changes}
								data-tip={t.changes}
								xstyle={styles.footerCount}
								onClick={() => props.onShowChanges()}
							>
								<DiffCount added={own().added} removed={own().removed} />
							</Button>
						)}
					</Show>
					<Show when={result()}>{(own) => <CopyButton text={own().text} />}</Show>
					<Button
						variant="ghost"
						size="sm"
						icon
						aria-label={t.forkHere}
						data-tip={t.forkHere}
						onClick={() => props.onFork(props.run.id)}
					>
						<Icon name="fork" />
					</Button>
					<Show when={props.latest}>
						<Button variant="ghost" size="sm" icon aria-label={t.undo} data-tip={t.undo} onClick={() => props.onUndo()}>
							<Icon name="undo" />
						</Button>
					</Show>
				</div>
			</Show>
		</article>
	);
}
