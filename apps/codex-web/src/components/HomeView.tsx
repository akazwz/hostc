import { useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, onSettled, Show } from "solid-js";

import { folderName } from "../harness/folder.ts";
import type { Harness, RequestStep, Run } from "../harness/model.ts";
import { t } from "../i18n.ts";
import { paths } from "../router.ts";
import { base } from "../ui/base.ts";
import { Icon } from "../ui/Icon.tsx";
import { color, control, media, space, text } from "../ui/tokens.stylex.ts";
import { Composer, moveDraft, type SlashCommand } from "./Composer.tsx";
import { DecisionDock } from "./DecisionDock.tsx";
import { FolderPicker } from "./FolderPicker.tsx";
import { RunView } from "./RunView.tsx";

const noop = () => undefined;

const styles = stylex.create({
	root: { display: "flex", flexDirection: "column", minWidth: 0, height: "100dvh", backgroundColor: color.bg },
	header: {
		display: { default: "none", [media.narrow]: "flex" },
		alignItems: "center",
		minHeight: "3.25rem",
		paddingBlockStart: "env(safe-area-inset-top)",
		paddingInline: space.sm,
	},
	back: {
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		width: control.lg,
		height: control.lg,
		borderWidth: 0,
		backgroundColor: "transparent",
		color: color.text,
	},
	center: {
		display: "flex",
		flexDirection: "column",
		flexGrow: 1,
		justifyContent: { default: "center", [media.narrow]: "flex-end" },
		gap: space.lg,
		width: "100%",
		maxWidth: "40rem",
		marginInline: "auto",
		padding: { default: space.xl, [media.narrow]: space.sm },
		paddingBlockEnd: { default: "18dvh", [media.narrow]: `max(${space.sm}, env(safe-area-inset-bottom))` },
	},
	centerStarting: {
		justifyContent: "flex-start",
		maxWidth: "46rem",
		paddingBlockStart: { default: `calc(3.25rem + ${space.xl})`, [media.narrow]: space.xl },
		paddingBlockEnd: `max(${space.sm}, env(safe-area-inset-bottom))`,
		paddingInline: { default: space.xl, [media.narrow]: space.sm },
	},
	run: { display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 },
	heading: {
		marginInline: 0,
		// On a phone the input sits at the bottom, for the thumb; the heading stays in the middle of what is left.
		marginBlock: { default: 0, [media.narrow]: "auto" },
		paddingInline: space.xs,
		fontSize: text.display,
		fontWeight: 400,
		lineHeight: 1.25,
		overflowWrap: "anywhere",
		textAlign: "center",
	},
	folder: { color: color.faint },
});

// Where new work starts. A session only exists once there is something to send.
export function HomeView(props: {
	harness: Harness;
	folder: string;
	onFolder: (path: string) => void;
	backToList: boolean;
	onBack: () => void;
}) {
	const navigate = useNavigate();
	// A reply that comes after the person has gone elsewhere does not take them back.
	let here = true;
	let creating: Promise<string | null> | null = null;
	onSettled(() => () => {
		here = false;
	});
	// Sent, while the session it goes to is being made. It looks as the session will, so nothing jumps.
	const [starting, setStarting] = createSignal<RequestStep | null>(null);
	const startingRun = createMemo((): Run | null => {
		const request = starting();
		return (
			request && {
				id: "starting",
				status: () => "running",
				steps: () => [request],
				error: () => null,
				startedAt: () => null,
				durationMs: () => null,
				checklist: () => null,
				diff: () => null,
				retrying: () => null,
			}
		);
	});
	const onCommand = (command: SlashCommand) => {
		if (command === "plan") {
			props.harness.setPlanning(!props.harness.planning());
		}
	};
	return (
		<div {...stylex.attrs(styles.root)}>
			<Show when={props.backToList}>
				<div {...stylex.attrs(styles.header)}>
					<button
						type="button"
						aria-label={t.allThreads}
						{...stylex.attrs(styles.back, base.focusRing)}
						onClick={() => props.onBack()}
					>
						<Icon name="back" />
					</button>
				</div>
			</Show>
			<main {...stylex.attrs(styles.center, starting() && styles.centerStarting)}>
				<Show
					when={startingRun()}
					fallback={<h2 {...stylex.attrs(styles.heading)}>{t.home(folderName(props.folder))}</h2>}
				>
					{(run) => (
						<div {...stylex.attrs(styles.run)}>
							<RunView
								run={run()}
								root={props.folder}
								latest
								waiting={false}
								onSend={() => undefined}
								onCarryOut={() => undefined}
								onFork={() => undefined}
								onUndo={() => undefined}
								onShowChanges={() => undefined}
							/>
						</div>
					)}
				</Show>
				<DecisionDock harness={props.harness} sessionId={null} />
				<Composer
					harness={props.harness}
					sessionId={null}
					busy={false}
					usage={null}
					branch={props.harness.sessions().find((session) => session.folder === props.folder)?.branch}
					folder={props.folder}
					{...(props.harness.anyFolder()
						? {
								folderPicker: (
									<FolderPicker
										harness={props.harness}
										value={props.folder}
										onChange={(path) => props.onFolder(path)}
									/>
								),
							}
						: {})}
					autofocus
					onGoal={async (objective) => {
						const id = await props.harness.beginGoal(objective, props.folder);
						if (id && here) {
							navigate(`${paths()}?thread=${id}`);
						}
						return id !== null;
					}}
					onSubmit={async (draft) => {
						// Another message while the session is being made goes to that same session.
						if (creating) {
							const id = await creating;
							if (id === null) {
								return false;
							}
							return (await props.harness.send(id, draft)) || { failedIn: id };
						}
						setStarting(props.harness.requestOf(draft));
						let ready: (id: string | null) => void = noop;
						creating = new Promise((resolve) => {
							ready = resolve;
						});
						let thread = null as string | null;
						const id = await props.harness.begin(draft, props.folder, (started) => {
							thread = started;
							moveDraft(null, started);
							if (here) {
								navigate(`${paths()}?thread=${started}`);
							}
							ready(started);
						});
						ready(id);
						if (!id) {
							creating = null;
							setStarting(null);
						}
						// The thread is open by now, with its own composer: that is where to give this back.
						return id !== null || (thread ? { failedIn: thread } : false);
					}}
					onStop={async () => false}
					onCommand={onCommand}
				/>
			</main>
		</div>
	);
}
