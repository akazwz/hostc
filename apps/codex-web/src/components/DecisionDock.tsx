import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";

import { parseDiff } from "../harness/diff.ts";
import type { AccessLine, Choice, Decision, Harness } from "../harness/model.ts";
import { t } from "../i18n.ts";
import { base } from "../ui/base.ts";
import { Button } from "../ui/Button.tsx";
import { TextInput } from "../ui/Field.tsx";
import { color, control, font, motion, radius, shadow, space, text } from "../ui/tokens.stylex.ts";
import { DiffFileView } from "./DiffView.tsx";

const arrive = stylex.keyframes({ from: { opacity: 0, transform: "translateY(0.5rem)" } });

const styles = stylex.create({
	// The one place on the page in the accent: the agent is waiting for a person.
	dock: {
		display: "flex",
		flexDirection: "column",
		gap: space.md,
		maxHeight: "60dvh",
		padding: space.lg,
		overflowY: "auto",
		borderRadius: radius.lg,
		backgroundColor: color.raised,
		boxShadow: `inset 0 0 0 1px ${color.accentText}, ${shadow.rest}`,
		animationName: { default: arrive, "@media (prefers-reduced-motion: reduce)": "none" },
		animationDuration: motion.slow,
		animationTimingFunction: motion.ease,
	},
	head: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: space.md },
	title: { margin: 0, fontSize: text.read, fontWeight: 600, lineHeight: 1.35, overflowWrap: "anywhere" },
	count: { flexShrink: 0, color: color.faint, fontSize: text.xs, fontVariantNumeric: "tabular-nums" },
	hint: { margin: 0, color: color.muted, fontSize: text.md, lineHeight: 1.5 },
	meta: { margin: 0, color: color.faint, fontSize: text.xs, overflowWrap: "anywhere" },
	command: {
		margin: 0,
		maxHeight: "10rem",
		padding: space.md,
		overflow: "auto",
		borderRadius: radius.sm,
		backgroundColor: color.surface,
		fontFamily: font.mono,
		fontSize: text.sm,
		lineHeight: 1.5,
		overflowWrap: "anywhere",
		whiteSpace: "pre-wrap",
	},
	actions: { display: "flex", flexWrap: "wrap", gap: space.sm },
	grow: { flexGrow: { default: 0, "@media (pointer: coarse)": 1 } },
	files: { display: "flex", flexDirection: "column", gap: space.xs },
	list: {
		display: "flex",
		flexDirection: "column",
		gap: space.xs,
		margin: 0,
		padding: 0,
		listStyle: "none",
		fontFamily: font.mono,
		fontSize: text.sm,
	},
	form: { display: "flex", flexDirection: "column", gap: space.md, margin: 0, padding: 0, borderWidth: 0 },
	legend: { padding: 0, marginBlockEnd: space.sm, fontSize: text.md, fontWeight: 500 },
	option: {
		display: "flex",
		alignItems: "flex-start",
		gap: space.sm,
		minHeight: control.md,
		padding: space.sm,
		borderRadius: radius.sm,
		backgroundColor: { default: color.surface, ":has(input:checked)": color.accentSoft },
		cursor: "pointer",
		fontSize: text.md,
	},
	optionBody: { display: "flex", flexDirection: "column", gap: space.xxs, minWidth: 0 },
	description: { color: color.muted, fontSize: text.sm },
	radio: { marginBlock: "0.125rem" },
	options: { display: "flex", flexDirection: "column", gap: space.xs },
	checkRow: { display: "flex", alignItems: "center", gap: space.sm, minHeight: control.md, fontSize: text.md },
	label: { display: "flex", flexDirection: "column", gap: space.xs, fontSize: text.md },
	select: {
		width: "100%",
		minHeight: control.lg,
		paddingInline: space.md,
		borderWidth: "1px",
		borderStyle: "solid",
		borderColor: { default: color.line, ":focus": color.outline },
		borderRadius: radius.sm,
		backgroundColor: color.surface,
		color: color.text,
		fontFamily: "inherit",
		fontSize: { default: text.md, "@media (pointer: coarse)": "1rem" },
	},
});

function choiceLabel(choice: Choice): string {
	switch (choice.key) {
		case "allow":
			return t.allow;
		case "allowSession":
			return t.allowSession;
		case "allowRule":
			return t.allowAlways(choice.detail ?? "");
		case "denyRule":
			return t.denyAlways(choice.detail ?? "");
		case "decline":
			return t.decline;
		case "stop":
			return t.stopTurn;
	}
}

// Long enough for the second click of a double click.
const READ_FIRST_MS = 350;

const VARIANTS = { primary: "solid", normal: "secondary", quiet: "ghost" } as const;

function Choices(props: { choices: Choice[]; onAnswer: (answer: unknown) => void }) {
	return (
		<div {...stylex.attrs(styles.actions)}>
			<For each={props.choices}>
				{(choice) => (
					<Button
						variant={VARIANTS[choice.tone]}

						xstyle={styles.grow}
						onClick={() => props.onAnswer(choice.answer)}
					>
						{choiceLabel(choice)}
					</Button>
				)}
			</For>
		</div>
	);
}

function accessText(line: AccessLine): string {
	if (line.what === "network") {
		return t.permissionNetwork;
	}
	const verb = line.what === "write" ? t.permissionWrite : line.what === "deny" ? t.permissionDeny : t.permissionRead;
	return `${verb} ${line.target}`;
}

function AccessList(props: { lines: AccessLine[] }) {
	return (
		<ul {...stylex.attrs(styles.list)}>
			<For each={props.lines}>{(line) => <li>{accessText(line)}</li>}</For>
		</ul>
	);
}

function titleOf(decision: Decision): string {
	switch (decision.kind) {
		case "command":
			return decision.host ? t.allowNetworkTo(decision.protocol ?? "", decision.host) : t.runCommand;
		case "edit":
			return t.changeFiles;
		case "access":
			return t.morePermissions;
		case "question":
			return t.agentAsks;
		case "form":
		case "link":
			return t.asksFrom(decision.source);
	}
}

function QuestionForm(props: {
	decision: Extract<Decision, { kind: "question" }>;
	onAnswer: (answer: unknown) => void;
}) {
	return (
		<form
			{...stylex.attrs(styles.form)}
			onSubmit={(event) => {
				event.preventDefault();
				const data = new FormData(event.currentTarget);
				const values: Record<string, string> = {};
				for (const question of props.decision.questions) {
					const chosen = data.get(question.id);
					const other = data.get(`${question.id}:other`);
					values[question.id] = String((chosen === "__other" || chosen === null ? other : chosen) ?? "");
				}
				props.onAnswer(props.decision.answer(values));
			}}
		>
			<For each={props.decision.questions}>
				{(question) => (
					<fieldset {...stylex.attrs(styles.form)}>
						<legend {...stylex.attrs(styles.legend)}>{question.question}</legend>
						<div {...stylex.attrs(styles.options)}>
							<For each={question.options}>
								{(option, index) => (
									<label {...stylex.attrs(styles.option)}>
										<input
											type="radio"
											name={question.id}
											value={option.label}
											checked={index() === 0}
											{...stylex.attrs(base.radio, base.focusRing, styles.radio)}
										/>
										<span {...stylex.attrs(styles.optionBody)}>
											<span>{option.label}</span>
											<Show when={option.description}>
												<span {...stylex.attrs(styles.description)}>{option.description}</span>
											</Show>
										</span>
									</label>
								)}
							</For>
							<Show when={question.allowOther && question.options.length > 0}>
								<label {...stylex.attrs(styles.option)}>
									<input
										type="radio"
										name={question.id}
										value="__other"
										{...stylex.attrs(base.radio, base.focusRing, styles.radio)}
									/>
									<span>{t.other}</span>
								</label>
							</Show>
							<Show when={question.allowOther}>
								<TextInput
									name={`${question.id}:other`}
									type={question.secret ? "password" : "text"}
									autocomplete="off"
									aria-label={question.question}
									placeholder={question.secret ? t.secretPlaceholder : t.answerPlaceholder}
									// Typing an answer is choosing to answer in your own words.
									onInput={(event) => {
										const other = event.currentTarget.form?.querySelector<HTMLInputElement>(
											`input[type=radio][name="${CSS.escape(question.id)}"][value="__other"]`,
										);
										if (other) {
											other.checked = true;
										}
									}}
								/>
							</Show>
						</div>
					</fieldset>
				)}
			</For>
			<div {...stylex.attrs(styles.actions)}>
				<Button variant="solid" type="submit" xstyle={styles.grow}>
					{t.submit}
				</Button>
			</div>
		</form>
	);
}

function McpForm(props: { decision: Extract<Decision, { kind: "form" }>; onAnswer: (answer: unknown) => void }) {
	return (
		<form
			{...stylex.attrs(styles.form)}
			onSubmit={(event) => {
				event.preventDefault();
				props.onAnswer(props.decision.answer(new FormData(event.currentTarget)));
			}}
		>
			<For each={props.decision.fields}>
				{(field) => (
					<Switch
						fallback={
							<label {...stylex.attrs(styles.label)}>
								<span>{field.label}</span>
								<TextInput
									name={field.name}
									required={field.required}
									type={field.kind === "number" ? "number" : field.inputType}
									{...(field.kind === "number" ? { step: "any" } : {})}
									placeholder={field.description}
									value={field.defaultValue === undefined ? "" : String(field.defaultValue)}
								/>
							</label>
						}
					>
						<Match when={field.kind === "boolean"}>
							<label {...stylex.attrs(styles.checkRow)}>
								<input
									type="checkbox"
									name={field.name}
									checked={field.defaultValue === true}
									{...stylex.attrs(base.checkbox, base.focusRing)}
								/>
								<span>{field.label}</span>
							</label>
						</Match>
						<Match when={field.kind === "select"}>
							<label {...stylex.attrs(styles.label)}>
								<span>{field.label}</span>
								<select name={field.name} required={field.required} {...stylex.attrs(styles.select, base.focusRing)}>
									<For each={field.options}>
										{(option) => (
											<option value={option.value} selected={option.value === field.defaultValue}>
												{option.label}
											</option>
										)}
									</For>
								</select>
							</label>
						</Match>
						<Match when={field.kind === "multi"}>
							<fieldset {...stylex.attrs(styles.form)}>
								<legend {...stylex.attrs(styles.legend)}>{field.label}</legend>
								<For each={field.options}>
									{(option) => (
										<label {...stylex.attrs(styles.checkRow)}>
											<input
												type="checkbox"
												name={field.name}
												value={option.value}
												checked={Array.isArray(field.defaultValue) && field.defaultValue.includes(option.value)}
												{...stylex.attrs(base.checkbox, base.focusRing)}
											/>
											<span>{option.label}</span>
										</label>
									)}
								</For>
							</fieldset>
						</Match>
					</Switch>
				)}
			</For>
			<div {...stylex.attrs(styles.actions)}>
				<Button variant="solid" type="submit" xstyle={styles.grow}>
					{t.submit}
				</Button>
				<Button xstyle={styles.grow} onClick={() => props.onAnswer(props.decision.decline)}>
					{t.decline}
				</Button>
			</div>
		</form>
	);
}

function LinkDecision(props: { decision: Extract<Decision, { kind: "link" }>; onAnswer: (answer: unknown) => void }) {
	const [opened, setOpened] = createSignal(false);
	return (
		<>
			<pre {...stylex.attrs(styles.command)}>{props.decision.url}</pre>
			<div {...stylex.attrs(styles.actions)}>
				<Show
					when={opened()}
					fallback={
						<Button
							variant="solid"

							xstyle={styles.grow}
							onClick={() => {
								// Only the web. Another scheme could start an application on this device with one click.
								if (/^https?:/i.test(props.decision.url)) {
									open(props.decision.url, "_blank", "noopener,noreferrer");
								}
								setOpened(true);
							}}
						>
							{t.open}
						</Button>
					}
				>
					<Button variant="solid" xstyle={styles.grow} onClick={() => props.onAnswer(props.decision.done)}>
						{t.done}
					</Button>
				</Show>
				<Button xstyle={styles.grow} onClick={() => props.onAnswer(props.decision.decline)}>
					{t.decline}
				</Button>
			</div>
		</>
	);
}

function DecisionBody(props: { harness: Harness; decision: Decision; onAnswer: (answer: unknown) => void }) {
	const files = createMemo(() => {
		const { decision } = props;
		if (decision.kind !== "edit" || !decision.sessionId) {
			return [];
		}
		return props.harness
			.editFiles(decision.sessionId, decision.itemId)
			.flatMap((file) => parseDiff(file.diff, file.path));
	});
	return (
		<Switch>
			<Match when={props.decision.kind === "command" && props.decision}>
				{(own) => (
					<>
						<Show when={!own().host && own().command}>
							{(command) => <pre {...stylex.attrs(styles.command)}>{command() as string}</pre>}
						</Show>
						<Show when={own().cwd}>{(cwd) => <p {...stylex.attrs(styles.meta)}>{t.inFolder(cwd())}</p>}</Show>
						<Show when={own().also.length > 0}>
							<p {...stylex.attrs(styles.hint)}>{t.addedPermissions}</p>
							<AccessList lines={own().also} />
						</Show>
						<Choices choices={own().choices} onAnswer={props.onAnswer} />
					</>
				)}
			</Match>
			<Match when={props.decision.kind === "edit" && props.decision}>
				{(own) => (
					<>
						<Show when={files().length > 0} fallback={<p {...stylex.attrs(styles.hint)}>{t.changesUnavailable}</p>}>
							<div {...stylex.attrs(styles.files)}>
								<For each={files()} keyed={(file) => file.path}>
									{(file, index) => (
										<DiffFileView
											file={file()}
											root={props.harness.folderOf(props.decision.sessionId)}
											startOpen={index() === 0}
										/>
									)}
								</For>
							</div>
						</Show>
						<Choices choices={own().choices} onAnswer={props.onAnswer} />
					</>
				)}
			</Match>
			<Match when={props.decision.kind === "access" && props.decision}>
				{(own) => (
					<>
						<AccessList lines={own().lines} />
						<Show when={own().cwd}>{(cwd) => <p {...stylex.attrs(styles.meta)}>{t.inFolder(cwd())}</p>}</Show>
						<Choices choices={own().choices} onAnswer={props.onAnswer} />
					</>
				)}
			</Match>
			<Match when={props.decision.kind === "question" && props.decision}>
				{(own) => (
					<>
						<Show when={!own().blocking}>
							<p {...stylex.attrs(styles.meta)}>{t.keepsWorking}</p>
						</Show>
						<QuestionForm decision={own()} onAnswer={props.onAnswer} />
					</>
				)}
			</Match>
			<Match when={props.decision.kind === "form" && props.decision}>
				{(own) => <McpForm decision={own()} onAnswer={props.onAnswer} />}
			</Match>
			<Match when={props.decision.kind === "link" && props.decision}>
				{(own) => <LinkDecision decision={own()} onAnswer={props.onAnswer} />}
			</Match>
		</Switch>
	);
}

// What the agent is waiting on, one thing at a time, above the input and within reach of a thumb. A page
// that comes back finds the same question still here.
export function DecisionDock(props: { harness: Harness; sessionId: string | null; onAnswered?: () => void }) {
	const decisions = createMemo(() => props.harness.decisions(props.sessionId));
	return (
		<Show when={decisions()[0]} keyed>
			{(decision) => {
				const shownAt = performance.now();
				return (
					<section aria-label={titleOf(decision)} {...stylex.attrs(styles.dock)}>
						<div role="alert" {...stylex.attrs(styles.head)}>
							<h2 {...stylex.attrs(styles.title)}>{titleOf(decision)}</h2>
							<Show when={decisions().length > 1}>
								<span {...stylex.attrs(styles.count)}>{t.nOfDecisions(1, decisions().length)}</span>
							</Show>
						</div>
						<Show when={decision.foreign}>
							<p {...stylex.attrs(styles.meta)}>{t.fromSubAgent}</p>
						</Show>
						<Show when={decision.reason}>{(reason) => <p {...stylex.attrs(styles.hint)}>{reason()}</p>}</Show>
						<DecisionBody
							harness={props.harness}
							decision={decision}
							onAnswer={(answer) => {
								// A double click on one decision must not also answer the next, unread, in the same place.
								if (performance.now() - shownAt < READ_FIRST_MS) {
									return;
								}
								// The button is about to go; keyboard focus should not fall back to the page.
								props.onAnswered?.();
								props.harness.answer(decision, answer);
							}}
						/>
					</section>
				);
			}}
		</Show>
	);
}
