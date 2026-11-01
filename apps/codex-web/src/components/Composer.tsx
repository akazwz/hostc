import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js";

import { folderName } from "../harness/folder.ts";
import type { Draft, Harness, Suggestion, Usage } from "../harness/model.ts";
import { compactNumber, t } from "../i18n.ts";
import { base } from "../ui/base.ts";
import { Button } from "../ui/Button.tsx";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { Menu, MenuHeading, MenuItem } from "../ui/Menu.tsx";
import { Ring } from "../ui/Ring.tsx";
import { Spinner } from "../ui/Spinner.tsx";
import { color, control, font, media, motion, radius, shadow, space, text } from "../ui/tokens.stylex.ts";
import { ModelPicker } from "./ModelPicker.tsx";

const styles = stylex.create({
	root: { position: "relative", display: "flex", flexDirection: "column", minWidth: 0, containerType: "inline-size" },
	card: {
		display: "flex",
		flexDirection: "column",
		borderRadius: radius.xl,
		backgroundColor: color.raised,
		boxShadow: shadow.rest,
		transitionDuration: motion.move,
		transitionProperty: "box-shadow",
		transitionTimingFunction: motion.ease,
	},
	dragging: { boxShadow: `0 0 0 1.5px ${color.outline}` },
	input: {
		display: "block",
		width: "100%",
		minHeight: "3.25rem",
		maxHeight: "40dvh",
		paddingBlockStart: "1rem",
		paddingBlockEnd: space.xs,
		paddingInline: "1.125rem",
		borderWidth: 0,
		outlineStyle: "none",
		backgroundColor: "transparent",
		color: color.text,
		fontFamily: "inherit",
		fontSize: text.read,
		lineHeight: 1.5,
		resize: "none",
		"::placeholder": { color: color.faint },
	},
	// The add icon lines up with the text of the input above it.
	toolbar: { display: "flex", alignItems: "center", gap: space.xxs, padding: space.sm },
	add: { width: control.lg, minHeight: control.lg, paddingInline: 0, color: color.text },
	spacer: { flexGrow: 1 },
	label: { maxWidth: { default: "11rem", [media.narrow]: "7rem" }, overflow: "hidden", textOverflow: "ellipsis" },
	// On a phone the toolbar is full; the icon says it, and its name is still read out.
	toggleText: { display: { default: "inline", [media.narrow]: "none", "@container (max-width: 36rem)": "none" } },
	send: { width: control.lg, minHeight: control.lg },
	// A tray tucked under the input, for what is set less often than what is written.
	below: {
		display: "flex",
		alignItems: "center",
		gap: space.xxs,
		minHeight: "2.5rem",
		marginInline: "0.75rem",
		paddingInline: space.xs,
		borderEndStartRadius: radius.lg,
		borderEndEndRadius: radius.lg,
		backgroundColor: color.surface,
		overflowX: "auto",
		scrollbarWidth: "none",
	},
	place: {
		display: "inline-flex",
		alignItems: "center",
		flexShrink: 0,
		gap: "0.3125rem",
		paddingInline: space.sm,
		color: color.faint,
		fontSize: text.sm,
		whiteSpace: "nowrap",
	},
	danger: { color: color.removed },
	// A box of its own: left inline, an icon sits on the text baseline instead of beside the text.
	modeMark: { display: "flex" },
	usage: {
		display: "flex",
		alignItems: "center",
		flexShrink: 0,
		gap: space.xs,
		paddingInlineEnd: space.xs,
		color: color.faint,
		fontSize: text.xs,
		fontVariantNumeric: "tabular-nums",
	},
	thumbs: { display: "flex", flexWrap: "wrap", gap: space.sm, paddingBlockStart: space.md, paddingInline: space.md },
	thumb: { position: "relative", width: "3.25rem", height: "3.25rem" },
	thumbImage: { width: "100%", height: "100%", borderRadius: radius.sm, objectFit: "cover" },
	thumbBusy: { opacity: 0.45 },
	thumbRemove: {
		position: "absolute",
		top: "-0.375rem",
		insetInlineEnd: "-0.375rem",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		width: "1.25rem",
		height: "1.25rem",
		padding: 0,
		borderWidth: 0,
		borderRadius: "50%",
		backgroundColor: color.text,
		color: color.bg,
		cursor: "pointer",
		// A small mark, with room for a finger around it.
		"::after": { content: '""', position: "absolute", inset: "-0.75rem" },
	},
	hiddenFile: { display: "none" },
	picker: {
		position: "absolute",
		bottom: "calc(100% + 0.375rem)",
		insetInline: 0,
		zIndex: 10,
		maxHeight: "16rem",
		padding: space.xs,
		overflowY: "auto",
		borderRadius: radius.md,
		backgroundColor: color.overlay,
		boxShadow: shadow.float,
	},
	pick: {
		display: "flex",
		alignItems: "center",
		gap: space.sm,
		width: "100%",
		minHeight: control.md,
		paddingBlock: "0.375rem",
		paddingInline: space.sm,
		borderWidth: 0,
		borderRadius: radius.xs,
		backgroundColor: { default: "transparent", "[aria-selected='true']": color.selected },
		color: color.text,
		cursor: "pointer",
		fontFamily: "inherit",
		fontSize: text.sm,
		textAlign: "start",
	},
	// Wide enough that the descriptions start in one column, whatever the names.
	pickName: { flexShrink: 0, minWidth: "7rem", fontFamily: font.mono, fontSize: text.xs },
	pickHint: {
		minWidth: 0,
		overflow: "hidden",
		color: color.faint,
		fontSize: text.xs,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
});

export type SlashCommand = keyof typeof t.commands;

type Pick = { id: string; name: string; hint: string; insert: () => void };
type PickerAt = { kind: "/" | "@" | "$"; query: string; start: number; end: number };
type Attachment = { key: string; preview: string; path: string | null };

const draftKey = (sessionId: string | null) => `hostc-draft:${sessionId ?? "new"}`;

/** What is being typed follows the session it was for, once that session has its real id. */
export function moveDraft(from: string | null, to: string): void {
	try {
		const draft = sessionStorage.getItem(draftKey(from));
		if (draft) {
			sessionStorage.setItem(draftKey(to), draft);
			sessionStorage.removeItem(draftKey(from));
		}
	} catch {
		// Storage can be unavailable; then the draft stays with the view it was typed in.
	}
}

// What could not be sent after the composer that wrote it has gone: its session has its own by now.
const [returned, setReturned] = createSignal<{ sessionId: string; attachments: Attachment[] } | null>(null);

function returnDraft(sessionId: string, written: string, attachments: Attachment[]): void {
	try {
		const since = sessionStorage.getItem(draftKey(sessionId));
		sessionStorage.setItem(draftKey(sessionId), since ? `${written}\n${since}` : written);
	} catch {
		// Storage can be unavailable; the message is lost with the view that held it.
	}
	setReturned({ sessionId, attachments });
}

function readDraft(sessionId: string | null): string {
	try {
		return sessionStorage.getItem(draftKey(sessionId)) ?? "";
	} catch {
		return "";
	}
}

const hasHardwareKeyboard = () => matchMedia("(hover: hover) and (pointer: fine)").matches;
const MODE_ICONS: Record<string, IconName> = {
	"read-only": "readOnly",
	ask: "hand",
	"auto-review": "reviewer",
	full: "unlocked",
};
const modeIcon = (id: string): IconName => MODE_ICONS[id] ?? "shield";
const modeName = (id: string, fallback: string | null) => t.modes[id]?.[0] ?? fallback ?? id;
const modeHint = (id: string, description: string | null) => t.modes[id]?.[1] ?? description ?? t.customProfile;

function fit(textarea: HTMLTextAreaElement) {
	textarea.style.height = "auto";
	textarea.style.height = `${textarea.scrollHeight}px`;
}

function pickerAt(value: string, caret: number): PickerAt | null {
	const match = /(?:^|\s)([/@$])([^\s]*)$/.exec(value.slice(0, caret));
	if (!match) {
		return null;
	}
	const kind = match[1] as PickerAt["kind"];
	const query = match[2] as string;
	const start = caret - query.length - 1;
	// A slash command is only a command at the very start of the message.
	return kind === "/" && value.slice(0, start).trim() !== "" ? null : { kind, query, start, end: caret };
}

// The input, and what decides how the next run behaves.
export function Composer(props: {
	harness: Harness;
	sessionId: string | null;
	busy: boolean;
	usage: Usage | null;
	branch: string | null | undefined;
	folder: string;
	// How to change the folder, where that is possible. Otherwise the folder is only named.
	folderPicker?: JSX.Element;
	autofocus?: boolean;
	focusRef?: (focus: () => void) => void;
	/** Whether it was sent; `failedIn` when it was not and the work has moved on to that session. */
	onSubmit: (draft: Draft) => Promise<boolean | { failedIn: string }>;
	onGoal: (objective: string) => Promise<boolean>;
	/** Whether the agent was told to stop. */
	onStop: () => Promise<boolean>;
	onCommand: (command: SlashCommand) => void;
}) {
	let input: HTMLTextAreaElement | undefined;
	let fileInput: HTMLInputElement | undefined;
	const [empty, setEmpty] = createSignal(true);
	const [picker, setPicker] = createSignal<PickerAt | null>(null);
	const [selected, setSelected] = createSignal(0);
	const [attachments, setAttachments] = createSignal<Attachment[]>([]);
	const [dragging, setDragging] = createSignal(false);
	const [goalMode, setGoalMode] = createSignal(false);
	const [stopping, setStopping] = createSignal(false);
	createEffect(
		() => props.busy,
		(busy) => {
			if (!busy) {
				setStopping(false);
			}
		},
	);
	const [files, setFiles] = createSignal<Suggestion[]>([]);
	// What the message refers to, so that its text stays plain and readable.
	const mentions = new Map<string, string>();
	const usedSkills = new Map<string, string>();
	let searchSerial = 0;
	createEffect(
		() => props.folder,
		(folder) => props.harness.loadSkills(folder),
	);

	const uploading = () => attachments().some((attachment) => attachment.path === null);
	const hasContent = () => !empty() || attachments().length > 0;
	const canSend = () => (!empty() || attachments().length > 0) && !uploading();

	const updatePicker = () => {
		if (!input) {
			return;
		}
		const next = pickerAt(input.value, input.selectionStart);
		setPicker(next);
		setSelected(0);
		if (next?.kind === "@" && next.query) {
			setFiles([]);
			const serial = ++searchSerial;
			void props.harness.searchFiles(next.query, props.folder).then((found) => {
				// A slower answer to an earlier keystroke must not replace a newer one.
				if (serial === searchSerial) {
					setFiles(found);
				}
			});
		}
	};

	// What was typed stays with its session, through switching away and reloading.
	const keepDraft = () => {
		try {
			const key = draftKey(props.sessionId);
			if (input?.value) {
				sessionStorage.setItem(key, input.value);
			} else {
				sessionStorage.removeItem(key);
			}
		} catch {
			// Storage can be unavailable; the draft then lasts as long as the page shows it.
		}
	};

	const replaceToken = (replacement: string) => {
		const own = picker();
		if (!input || !own) {
			return;
		}
		input.setRangeText(replacement, own.start, own.end, "end");
		input.focus();
		setPicker(null);
		setEmpty(input.value.trim() === "");
		fit(input);
		keepDraft();
	};

	const picks = createMemo<Pick[]>(() => {
		const own = picker();
		if (!own) {
			return [];
		}
		const query = own.query.toLowerCase();
		if (own.kind === "/") {
			return (Object.keys(t.commands) as SlashCommand[])
				.filter((name) => name.startsWith(query))
				.filter((name) => props.sessionId !== null || name === "new" || name === "plan" || name === "goal")
				.map((name) => ({
					id: name,
					name: `/${name}`,
					hint: t.commands[name],
					insert: () => {
						replaceToken("");
						if (name === "goal") {
							setGoalMode(true);
						} else {
							props.onCommand(name);
						}
					},
				}));
		}
		if (own.kind === "$") {
			return props.harness
				.skills(props.folder)
				.filter((skill) => skill.name.toLowerCase().includes(query))
				.slice(0, 30)
				.map((skill) => ({
					id: skill.path,
					name: `$${skill.name}`,
					hint: skill.hint,
					insert: () => {
						usedSkills.set(skill.name, skill.path);
						replaceToken(`$${skill.name} `);
					},
				}));
		}
		return files().map((file) => ({
			id: file.path,
			name: `@${file.name}`,
			hint: "",
			insert: () => {
				mentions.set(file.name, file.path);
				replaceToken(`@${file.name} `);
			},
		}));
	});

	const addImages = (list: readonly File[]) => {
		for (const file of list.filter((candidate) => candidate.type.startsWith("image/"))) {
			const key = crypto.randomUUID();
			const preview = URL.createObjectURL(file);
			setAttachments((own) => [...own, { key, preview, path: null }]);
			void props.harness.upload(file).then((path) => {
				if (path) {
					setAttachments((own) =>
						own.map((attachment) => (attachment.key === key ? { ...attachment, path } : attachment)),
					);
				} else {
					removeAttachment(key);
				}
			});
		}
	};

	const removeAttachment = (key: string) => {
		setAttachments((own) => {
			const gone = own.find((attachment) => attachment.key === key);
			if (gone) {
				URL.revokeObjectURL(gone.preview);
			}
			return own.filter((attachment) => attachment.key !== key);
		});
	};

	// Leaving with pictures still attached gives their memory back.
	onSettled(() => () => {
		for (const attachment of untrack(attachments)) {
			URL.revokeObjectURL(attachment.preview);
		}
	});

	const clear = () => {
		if (input) {
			input.value = "";
			fit(input);
		}
		setEmpty(true);
		setPicker(null);
		keepDraft();
	};

	const restore = (value: string) => {
		if (input) {
			input.value = value;
			fit(input);
		}
		setEmpty(value === "");
		keepDraft();
	};

	// Keep what was typed when it could not be sent, along with anything added since.
	const giveBack = (written: string) => {
		const since = input?.value.trim();
		restore(since ? `${written}\n${since}` : written);
	};

	createEffect(returned, (back) => {
		if (back && back.sessionId === props.sessionId) {
			setReturned(null);
			restore(readDraft(back.sessionId));
			setAttachments((own) => [...back.attachments, ...own]);
		}
	});

	const submit = async () => {
		const written = input?.value.trim() ?? "";
		if (!input || !canSend()) {
			return;
		}
		if (goalMode()) {
			if (!written) {
				return;
			}
			clear();
			if (await props.onGoal(written)) {
				setGoalMode(false);
			} else {
				giveBack(written);
			}
			return;
		}
		if (written.startsWith("!") && props.sessionId && attachments().length === 0) {
			clear();
			if (!(await props.harness.shell(props.sessionId, written.slice(1).trim()))) {
				giveBack(written);
			}
			return;
		}
		const held = attachments();
		const draft: Draft = {
			text: written,
			files: [...mentions].filter(([name]) => written.includes(`@${name}`)).map(([name, path]) => ({ name, path })),
			skills: [...usedSkills].filter(([name]) => written.includes(`$${name}`)).map(([name, path]) => ({ name, path })),
			images: held.map((attachment) => attachment.path as string),
		};
		clear();
		setAttachments([]);
		const outcome = await props.onSubmit(draft);
		if (outcome === true) {
			// What this message used, unless the next one being typed uses it too.
			for (const [names, trigger] of [
				[mentions, "@"],
				[usedSkills, "$"],
			] as const) {
				for (const name of names.keys()) {
					if (written.includes(`${trigger}${name}`) && !input.value.includes(`${trigger}${name}`)) {
						names.delete(name);
					}
				}
			}
			for (const attachment of held) {
				URL.revokeObjectURL(attachment.preview);
			}
		} else if (outcome) {
			returnDraft(outcome.failedIn, written, held);
		} else {
			giveBack(written);
			setAttachments((own) => [...held, ...own]);
		}
	};

	const insertTrigger = (trigger: string) => {
		if (input) {
			const needsSpace = input.value && !input.value.endsWith(" ");
			input.setRangeText(`${needsSpace ? " " : ""}${trigger}`, input.value.length, input.value.length, "end");
			input.focus();
			setEmpty(false);
			keepDraft();
			updatePicker();
		}
	};

	return (
		<div {...stylex.attrs(styles.root)}>
			<Show when={picks().length > 0}>
				<div role="listbox" {...stylex.attrs(styles.picker)}>
					<For each={picks()} keyed={(pick) => pick.id}>
						{(pick, index) => (
							<button
								type="button"
								role="option"
								aria-selected={index() === selected() ? "true" : "false"}
								{...stylex.attrs(styles.pick)}
								// Keeps focus and the caret in the input.
								onPointerDown={(event) => event.preventDefault()}
								onClick={() => pick().insert()}
							>
								<span {...stylex.attrs(styles.pickName)}>{pick().name}</span>
								<span {...stylex.attrs(styles.pickHint)}>{pick().hint}</span>
							</button>
						)}
					</For>
				</div>
			</Show>
			<form
				{...stylex.attrs(styles.card, dragging() && styles.dragging)}
				onSubmit={(event) => {
					event.preventDefault();
					void submit();
				}}
				onDragOver={(event) => {
					event.preventDefault();
					setDragging(true);
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={(event) => {
					event.preventDefault();
					setDragging(false);
					addImages([...(event.dataTransfer?.files ?? [])]);
				}}
			>
				<Show when={attachments().length > 0}>
					<div {...stylex.attrs(styles.thumbs)}>
						<For each={attachments()} keyed={(attachment) => attachment.key}>
							{(attachment) => (
								<div {...stylex.attrs(styles.thumb)}>
									<img
										src={attachment().preview}
										alt=""
										{...stylex.attrs(styles.thumbImage, attachment().path === null && styles.thumbBusy)}
									/>
									<button
										type="button"
										aria-label={t.removeAttachment}
										{...stylex.attrs(styles.thumbRemove, base.focusRing)}
										onClick={() => removeAttachment(attachment().key)}
									>
										<Icon name="close" small />
									</button>
								</div>
							)}
						</For>
					</div>
				</Show>
				<textarea
					ref={(element) => {
						input = element;
						const draft = readDraft(props.sessionId);
						if (draft) {
							element.value = draft;
							setEmpty(draft.trim() === "");
							queueMicrotask(() => fit(element));
						}
						props.focusRef?.(() => {
							// Not on a touch screen, where focus would raise the keyboard over what comes next.
							if (hasHardwareKeyboard()) {
								element.focus();
							}
						});
						if (props.autofocus && hasHardwareKeyboard()) {
							queueMicrotask(() => element.focus());
						}
					}}
					rows="1"
					aria-label={t.message}
					placeholder={goalMode() ? t.goalPlaceholder : props.busy ? t.messageRunning : t.message}
					enterkeyhint="send"
					{...stylex.attrs(styles.input)}
					onInput={(event) => {
						fit(event.currentTarget);
						setEmpty(event.currentTarget.value.trim() === "");
						keepDraft();
						updatePicker();
					}}
					onClick={updatePicker}
					onBlur={() => setPicker(null)}
					onPaste={(event) => {
						const pasted = [...(event.clipboardData?.files ?? [])];
						if (pasted.some((file) => file.type.startsWith("image/"))) {
							event.preventDefault();
							addImages(pasted);
						}
					}}
					onKeyDown={(event) => {
						// Enter during input-method composition belongs to the input method. Safari sends the confirming
						// Enter with `isComposing` false and this key code.
						if (event.isComposing || event.keyCode === 229) {
							return;
						}
						const list = picks();
						if (list.length > 0) {
							if (event.key === "ArrowDown" || event.key === "ArrowUp") {
								event.preventDefault();
								setSelected((index) => (index + (event.key === "ArrowDown" ? 1 : list.length - 1)) % list.length);
								return;
							}
							if (event.key === "Enter" || event.key === "Tab") {
								event.preventDefault();
								list[selected()]?.insert();
								return;
							}
							if (event.key === "Escape") {
								setPicker(null);
								return;
							}
						}
						if (event.key === "Enter" && !event.shiftKey && hasHardwareKeyboard()) {
							event.preventDefault();
							void submit();
						}
					}}
				/>
				<div {...stylex.attrs(styles.toolbar)}>
					<Menu triggerStyle={styles.add} label={t.attach} tip={t.attach} trigger={<Icon name="plus" />}>
						<MenuItem label={t.addImages} icon={<Icon name="image" />} onSelect={() => fileInput?.click()} />
						<MenuItem label={t.mentionFile} icon={<Icon name="at" />} onSelect={() => insertTrigger("@")} />
						<Show when={props.harness.skills(props.folder).length > 0}>
							<MenuItem label={t.useSkill} icon={<Icon name="spark" />} onSelect={() => insertTrigger("$")} />
						</Show>
					</Menu>
					<input
						ref={(element) => {
							fileInput = element;
						}}
						type="file"
						accept="image/png,image/jpeg,image/webp,image/gif"
						multiple
						{...stylex.attrs(styles.hiddenFile)}
						onChange={(event) => {
							addImages([...(event.currentTarget.files ?? [])]);
							event.currentTarget.value = "";
						}}
					/>
					<div {...stylex.attrs(styles.spacer)} />
					<ModelPicker harness={props.harness} />
					{/* Stopping never depends on what is in the input. */}
					<Show when={props.busy}>
						<Button
							variant={hasContent() ? "secondary" : "strong"}
							icon
							round
							aria-label={stopping() ? t.stopping : t.stop}
							disabled={stopping()}
							xstyle={styles.send}
							onClick={() => {
								setStopping(true);
								void props.onStop().then((told) => {
									// Not told, so it is still working and this can be tried again.
									if (!told) {
										setStopping(false);
									}
								});
							}}
						>
							<Show when={stopping()} fallback={<Icon name="stop" small />}>
								<Spinner />
							</Show>
						</Button>
					</Show>
					<Show when={!props.busy || hasContent()}>
						<Button
							type="submit"
							variant="strong"
							icon
							round
							aria-label={t.send}
							disabled={!canSend()}
							xstyle={styles.send}
						>
							<Icon name="arrowUp" />
						</Button>
					</Show>
				</div>
			</form>
			<div {...stylex.attrs(styles.below)}>
				<Show when={props.harness.permission(props.folder)}>
					{(mode) => (
						<Menu
							label={t.permissions}
							trigger={
								<>
									<span {...stylex.attrs(styles.modeMark, mode().id === "full" && styles.danger)}>
										<Icon name={modeIcon(mode().id)} />
									</span>
									<span {...stylex.attrs(mode().id === "full" && styles.danger)}>
										{modeName(mode().id, mode().label)}
									</span>
									<Icon name="chevronDown" small />
								</>
							}
						>
							<MenuHeading>{t.permissions}</MenuHeading>
							<For each={props.harness.permissions()}>
								{(option) => (
									<MenuItem
										label={modeName(option.id, option.label)}
										icon={<Icon name={modeIcon(option.id)} />}
										description={modeHint(option.id, option.description)}
										checked={option.id === mode().id}
										onSelect={() => props.harness.setPermission(props.folder, option.id)}
									/>
								)}
							</For>
						</Menu>
					)}
				</Show>
				<Button
					variant="ghost"
					on={props.harness.planning()}
					aria-label={t.plan}
					aria-pressed={props.harness.planning() ? "true" : "false"}
					data-tip={t.planHint}
					onClick={() => props.harness.setPlanning(!props.harness.planning())}
				>
					<Icon name="list" />
					<span {...stylex.attrs(styles.toggleText)}>{t.plan}</span>
				</Button>
				<Button
					variant="ghost"
					on={goalMode()}
					aria-label={t.goal}
					aria-pressed={goalMode() ? "true" : "false"}
					data-tip={t.goalToggleHint}
					onClick={() => {
						setGoalMode((own) => !own);
						input?.focus();
					}}
				>
					<Icon name="goal" />
					<span {...stylex.attrs(styles.toggleText)}>{t.goal}</span>
				</Button>
				<Show
					when={props.folderPicker}
					fallback={
						<Show when={props.harness.anyFolder()}>
							<span {...stylex.attrs(styles.place)}>
								<Icon name="folder" />
								<span {...stylex.attrs(styles.label)}>{folderName(props.folder)}</span>
							</span>
						</Show>
					}
				>
					{props.folderPicker}
				</Show>
				<Show when={props.branch}>
					{(branch) => (
						<span {...stylex.attrs(styles.place)}>
							<Icon name="branch" />
							<span {...stylex.attrs(styles.label)}>{branch()}</span>
						</span>
					)}
				</Show>
				<div {...stylex.attrs(styles.spacer)} />
				<Show when={props.usage}>
					{(usage) => (
						<span
							role="img"
							aria-label={t.contextUsed(usage().percent)}
							data-tip={t.tokens(compactNumber(usage().used), compactNumber(usage().window))}
							{...stylex.attrs(styles.usage)}
						>
							<Ring percent={usage().percent} />
							<span aria-hidden="true">{usage().percent}%</span>
						</span>
					)}
				</Show>
			</div>
		</div>
	);
}
