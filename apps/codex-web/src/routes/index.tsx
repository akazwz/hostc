import { useNavigate, useSearchParams } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo, createSignal, Match, onSettled, Show, Switch } from "solid-js";

import { createCodexHarness } from "../codex/harness.ts";
import { HomeView } from "../components/HomeView.tsx";
import { SessionView } from "../components/SessionView.tsx";
import { Sidebar } from "../components/Sidebar.tsx";
import { type PanelKind, SidePanel } from "../components/SidePanel.tsx";
import { language, t } from "../i18n.ts";
import { paths } from "../router.ts";
import { Button } from "../ui/Button.tsx";
import { Spinner } from "../ui/Spinner.tsx";
import { color, media, radius, shadow, space, text } from "../ui/tokens.stylex.ts";
import { TooltipLayer } from "../ui/Tooltip.tsx";

// Below this the work beside an open panel would be too narrow to use.
const DRAWER = "@media (max-width: 1240px)";

const styles = stylex.create({
	layout: {
		display: "grid",
		gridTemplateColumns: { default: "16.5rem minmax(0, 1fr)", [media.narrow]: "minmax(0, 1fr)" },
		height: "100dvh",
		overflow: "hidden",
	},
	layoutPanel: {
		gridTemplateColumns: {
			default: "16.5rem minmax(0, 1fr) minmax(0, 32rem)",
			[DRAWER]: "16.5rem minmax(0, 1fr)",
			[media.narrow]: "minmax(0, 1fr)",
		},
	},
	side: {
		minWidth: 0,
		borderInlineEndWidth: { default: "1px", [media.narrow]: 0 },
		borderInlineEndStyle: "solid",
		borderInlineEndColor: color.line,
	},
	// On a phone one pane shows at a time; the address says which, so Back works.
	hideNarrow: { display: { default: "block", [media.narrow]: "none" } },
	main: { minWidth: 0 },
	// Beside the work when there is room; over it when that would squeeze the work; the whole screen on a phone.
	panel: {
		minWidth: 0,
		borderInlineStartWidth: { default: "1px", [media.narrow]: 0 },
		borderInlineStartStyle: "solid",
		borderInlineStartColor: color.line,
		position: { default: "static", [DRAWER]: "fixed", [media.narrow]: "fixed" },
		insetBlock: { default: "auto", [DRAWER]: 0, [media.narrow]: 0 },
		insetInlineStart: { default: "auto", [DRAWER]: "auto", [media.narrow]: 0 },
		insetInlineEnd: { default: "auto", [DRAWER]: 0, [media.narrow]: 0 },
		width: { default: "auto", [DRAWER]: "min(32rem, 100vw - 18rem)", [media.narrow]: "auto" },
		zIndex: { default: "auto", [DRAWER]: 20, [media.narrow]: 20 },
		boxShadow: { default: "none", [DRAWER]: shadow.float, [media.narrow]: "none" },
	},
	center: {
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
		justifyContent: "center",
		gap: space.sm,
		minHeight: "100dvh",
		padding: space.xl,
		textAlign: "center",
	},
	heading: { margin: 0, fontSize: text.lg, fontWeight: 600 },
	hint: { margin: 0, maxWidth: "26rem", color: color.muted, fontSize: text.md },
	notice: {
		position: "fixed",
		insetInline: space.md,
		bottom: "calc(env(safe-area-inset-bottom) + 8rem)",
		zIndex: 30,
		display: "flex",
		alignItems: "center",
		gap: space.md,
		width: "fit-content",
		maxWidth: "32rem",
		marginInline: "auto",
		paddingBlock: space.sm,
		paddingInlineStart: space.md,
		paddingInlineEnd: space.sm,
		borderRadius: radius.md,
		backgroundColor: color.text,
		boxShadow: shadow.float,
		color: color.bg,
		fontSize: text.md,
	},
	noticeText: { minWidth: 0, overflowWrap: "anywhere" },
});

export default function Home() {
	// The harness for the agent this run of hostc serves. Everything below works with any of them.
	const harness = createCodexHarness();
	// Addresses are written out here rather than through the setter of `useSearchParams`, which keeps the
	// router's idea of the fragment: the link's token, already taken out of the address by the harness.
	const [search] = useSearchParams();
	const navigate = useNavigate();
	const current = createMemo(() => (typeof search.thread === "string" ? search.thread : undefined));
	const composing = createMemo(() => search.new === "1");
	const folder = createMemo(() =>
		current()
			? harness.folderOf(current() ?? null)
			: harness.anyFolder() && typeof search.folder === "string"
				? search.folder
				: harness.project().path,
	);
	const [panel, setPanel] = createSignal<PanelKind | null>(null);
	const phone = matchMedia("(max-width: 767px)");
	const [narrow, setNarrow] = createSignal(phone.matches);
	// On a phone the panel fills the screen, and what it covers is out of reach of the keyboard too.
	const covered = () => Boolean(current()) && panel() !== null && narrow();
	// On a phone the list comes first and new work is a step away; on a desktop both show at once.
	const showList = () => !current() && !composing();
	let notified = 0;

	onSettled(() => {
		document.documentElement.lang = language;
		void harness.start();
		const wake = () => {
			if (document.visibilityState === "visible") {
				harness.wake();
			}
		};
		document.addEventListener("visibilitychange", wake);
		addEventListener("online", wake);
		addEventListener("pageshow", wake);
		const onWidth = () => setNarrow(phone.matches);
		phone.addEventListener("change", onWidth);
		return () => {
			document.removeEventListener("visibilitychange", wake);
			removeEventListener("online", wake);
			removeEventListener("pageshow", wake);
			phone.removeEventListener("change", onWidth);
		};
	});

	// The tab says when a decision is waiting, and a notification does when the page is out of sight.
	createEffect(
		() => harness.waitingCount(),
		(waiting) => {
			const title = `${harness.agent} · hostc`;
			document.title = waiting > 0 ? `(${waiting}) ${title}` : title;
			if (
				waiting > notified &&
				document.hidden &&
				typeof Notification !== "undefined" &&
				Notification.permission === "granted"
			) {
				// Some browsers have the permission and still refuse this, by throwing. Inside an effect, that
				// would stop everything else on the page from updating.
				try {
					void new Notification(t.notifyTitle, { tag: "hostc" });
				} catch {
					// The tab's title still says so.
				}
			}
			notified = waiting;
		},
	);

	return (
		<Switch
			fallback={
				<>
					<div {...stylex.attrs(styles.layout, panel() ? styles.layoutPanel : null)}>
						<div inert={covered()} {...stylex.attrs(styles.side, showList() ? null : styles.hideNarrow)}>
							<Sidebar harness={harness} folder={folder()} current={current()} />
						</div>
						<div inert={covered()} {...stylex.attrs(styles.main, showList() ? styles.hideNarrow : null)}>
							<Show
								when={current()}
								keyed
								fallback={
									<HomeView
										harness={harness}
										folder={folder()}
										onFolder={(path) =>
											navigate(`${paths()}?${composing() ? "new=1&" : ""}folder=${encodeURIComponent(path)}`)
										}
										backToList={composing()}
										onBack={() => navigate(paths())}
									/>
								}
							>
								{(id) => <SessionView harness={harness} id={id} panel={panel()} onPanel={setPanel} />}
							</Show>
						</div>
						<Show when={current() ? panel() : null}>
							{(kind) => (
								<div {...stylex.attrs(styles.panel)}>
									<SidePanel
										harness={harness}
										folder={folder()}
										sessionId={current() ?? null}
										kind={kind()}
										onKind={setPanel}
										onClose={() => setPanel(null)}
									/>
								</div>
							)}
						</Show>
					</div>
					<Show when={harness.notice()}>
						{(notice) => (
							<div role="alert" {...stylex.attrs(styles.notice)}>
								<span {...stylex.attrs(styles.noticeText)}>{notice()}</span>
								<Button size="sm" variant="inverse" onClick={() => harness.dismissNotice()}>
									{t.dismiss}
								</Button>
							</div>
						)}
					</Show>
					<TooltipLayer />
				</>
			}
		>
			<Match when={harness.connection() === "checking"}>
				<main {...stylex.attrs(styles.center)} aria-busy="true">
					<Spinner />
				</main>
			</Match>
			<Match when={harness.connection() === "ended"}>
				<main {...stylex.attrs(styles.center)}>
					<h1 {...stylex.attrs(styles.heading)}>{t.sessionEnded}</h1>
					<p {...stylex.attrs(styles.hint)}>{t.sessionEndedHint}</p>
					<Button onClick={() => location.reload()}>{t.reload}</Button>
				</main>
			</Match>
			<Match when={harness.connection() === "signedOut"}>
				<main {...stylex.attrs(styles.center)}>
					<h1 {...stylex.attrs(styles.heading)}>{t.noAccessTitle}</h1>
					<p {...stylex.attrs(styles.hint)}>{t.noAccessHint}</p>
				</main>
			</Match>
		</Switch>
	);
}
