import { useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo, createSignal, For, Match, Show, Switch, untrack } from "solid-js";

import { folderName } from "../harness/folder.ts";
import type { Harness, LimitWindow, Session } from "../harness/model.ts";
import { ago, t } from "../i18n.ts";
import { paths } from "../router.ts";
import { base } from "../ui/base.ts";
import { Button } from "../ui/Button.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Menu, MenuHeading, MenuItem, MenuSeparator } from "../ui/Menu.tsx";
import { Dot, Skeleton, Spinner } from "../ui/Spinner.tsx";
import { color, control, media, motion, radius, space, text } from "../ui/tokens.stylex.ts";

const styles = stylex.create({
	root: { display: "flex", flexDirection: "column", minHeight: 0, height: "100dvh", backgroundColor: color.canvas },
	header: {
		display: "flex",
		alignItems: "center",
		gap: space.sm,
		minHeight: "3.25rem",
		paddingBlockStart: "env(safe-area-inset-top)",
		paddingInlineStart: space.md,
		paddingInlineEnd: space.sm,
	},
	logo: { width: "1.375rem", height: "1.375rem", borderRadius: "0.3125rem" },
	project: {
		flexGrow: 1,
		minWidth: 0,
		margin: 0,
		overflow: "hidden",
		fontSize: text.md,
		fontWeight: 600,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	// Rows above the list, drawn like its rows.
	action: {
		display: "flex",
		alignItems: "center",
		gap: space.sm,
		flexShrink: 0,
		minHeight: control.lg,
		marginInline: space.sm,
		paddingInline: space.sm,
		borderRadius: radius.sm,
		backgroundColor: {
			default: "transparent",
			[media.hover]: { default: "transparent", ":hover": color.hover },
			":focus-within": color.selected,
		},
		color: color.text,
		cursor: "pointer",
		fontSize: text.md,
		textDecoration: "none",
	},
	searchInput: {
		flexGrow: 1,
		minWidth: 0,
		padding: 0,
		borderWidth: 0,
		outlineStyle: "none",
		backgroundColor: "transparent",
		color: color.text,
		fontFamily: "inherit",
		fontSize: { default: text.md, "@media (pointer: coarse)": "1rem" },
		"::placeholder": { color: color.text },
	},
	status: {
		display: "flex",
		alignItems: "center",
		gap: space.sm,
		margin: 0,
		paddingBlock: space.sm,
		paddingInline: space.lg,
		color: color.muted,
		fontSize: text.xs,
	},
	scroll: {
		display: "flex",
		flexDirection: "column",
		flexGrow: 1,
		gap: space.xxs,
		minHeight: 0,
		padding: space.sm,
		paddingBlockStart: space.md,
		overflowY: "auto",
	},
	groupTitle: {
		margin: 0,
		paddingBlock: space.xs,
		paddingInline: space.sm,
		color: color.faint,
		fontSize: text.sm,
		fontWeight: 500,
	},
	folderHeading: { flexGrow: 1, minWidth: 0, margin: 0, fontSize: "inherit", fontWeight: "inherit" },
	folderToggle: {
		display: "flex",
		alignItems: "center",
		gap: space.xs,
		maxWidth: "100%",
		minHeight: control.sm,
		paddingInline: space.sm,
		borderWidth: 0,
		borderRadius: radius.sm,
		backgroundColor: "transparent",
		color: { default: color.faint, [media.hover]: { default: color.faint, ":hover": color.text } },
		cursor: "pointer",
		fontFamily: "inherit",
		fontSize: text.sm,
		fontWeight: 500,
		transitionDuration: motion.quick,
		transitionProperty: "color",
	},
	folderName: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
	chevron: {
		display: "flex",
		flexShrink: 0,
		transitionDuration: motion.move,
		transitionProperty: "transform",
		transitionTimingFunction: motion.ease,
	},
	chevronOpen: { transform: "rotate(90deg)" },
	// A fixed box, whichever mark it holds.
	mark: {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		flexShrink: 0,
		width: "1rem",
		height: "1rem",
	},
	loadingList: {
		display: "flex",
		flexDirection: "column",
		gap: space.md,
		paddingBlock: space.sm,
		paddingInline: space.sm,
	},
	listOpen: { marginBlockEnd: space.md },
	groupHead: { display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: control.sm },
	// Appears with the pointer; a touch screen always shows it.
	groupAdd: {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		width: control.sm,
		height: control.sm,
		borderRadius: radius.full,
		backgroundColor: { default: "transparent", [media.hover]: { default: "transparent", ":hover": color.hover } },
		color: color.muted,
		opacity: {
			default: 1,
			[media.hover]: { default: 0, [stylex.when.ancestor(":hover")]: 1, ":focus-visible": 1 },
		},
	},
	more: {
		display: "block",
		minHeight: control.sm,
		paddingInline: space.sm,
		borderWidth: 0,
		borderRadius: radius.sm,
		backgroundColor: "transparent",
		color: color.muted,
		cursor: "pointer",
		fontFamily: "inherit",
		fontSize: text.sm,
	},
	list: { display: "flex", flexDirection: "column", gap: "0.0625rem", margin: 0, padding: 0, listStyle: "none" },
	link: {
		display: "flex",
		alignItems: "center",
		gap: space.sm,
		minWidth: 0,
		minHeight: control.lg,
		paddingInline: space.sm,
		borderRadius: radius.sm,
		backgroundColor: {
			default: "transparent",
			"[aria-current='true']": color.selected,
			[media.hover]: { default: "transparent", ":hover": color.hover, "[aria-current='true']": color.selected },
		},
		color: color.text,
		fontSize: text.md,
		textDecoration: "none",
		transitionDuration: motion.quick,
		transitionProperty: "background-color",
		WebkitTapHighlightColor: "transparent",
	},
	row: {
		display: "flex",
		alignItems: "center",
		gap: space.sm,
		minHeight: control.lg,
		paddingInline: space.sm,
		fontSize: text.sm,
	},
	title: { flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
	footer: {
		display: "flex",
		alignItems: "center",
		padding: space.sm,
		paddingBlockEnd: `max(${space.sm}, env(safe-area-inset-bottom))`,
	},
	meter: {
		display: "flex",
		flexDirection: "column",
		gap: space.xs,
		paddingBlock: space.sm,
		paddingInline: space.sm,
		fontSize: text.xs,
	},
	meterRow: { display: "flex", justifyContent: "space-between", gap: space.xl },
	muted: { color: color.faint },
	track: {
		display: "block",
		width: "100%",
		height: "0.1875rem",
		borderRadius: radius.full,
		backgroundColor: color.line,
	},
	meterFill: { fill: color.muted },
	accountLabel: { maxWidth: "12rem", overflow: "hidden", textOverflow: "ellipsis" },
});

type Group = { key: string; title: string; folder?: string; sessions: Session[] };

// One group per folder, in a steady order, so that a session stays where it was started and nothing
// moves under the pointer. With only one folder, the dates.
function grouped(sessions: readonly Session[], order: readonly string[]): Group[] {
	const startOfToday = new Date().setHours(0, 0, 0, 0) / 1000;
	const inUse = new Set(sessions.map((session) => session.folder));
	const groups = new Map<string, Group>();
	if (inUse.size > 1) {
		for (const folder of order.filter((path) => inUse.has(path))) {
			groups.set(folder, { key: folder, title: folderName(folder), folder, sessions: [] });
		}
	}
	const add = (key: string, title: string, session: Session) => {
		const group = groups.get(key) ?? { key, title, sessions: [] };
		group.sessions.push(session);
		groups.set(key, group);
	};
	for (const session of sessions) {
		if (inUse.size > 1) {
			add(session.folder, folderName(session.folder), session);
		} else if (session.updatedAt >= startOfToday) {
			add("today", t.today, session);
		} else if (session.updatedAt >= startOfToday - 86_400) {
			add("yesterday", t.yesterday, session);
		} else {
			add("earlier", t.earlier, session);
		}
	}
	return [...groups.values()];
}

const COLLAPSED_KEY = "hostc-collapsed-folders";

function readCollapsed(): ReadonlySet<string> {
	try {
		const saved: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
		return new Set(Array.isArray(saved) ? saved.filter((path) => typeof path === "string") : []);
	} catch {
		return new Set();
	}
}

// What a session or a closed folder is up to. In its own place at the end of the row, so that the
// title beside it stays exactly where it is as the state comes and goes.
function StateMark(props: { state: "needsYou" | "running" | null }) {
	return (
		<Switch>
			<Match when={props.state === "needsYou"}>
				<span role="img" aria-label={t.needsYou} data-tip={t.needsYou} {...stylex.attrs(styles.mark)}>
					<Dot tone="attention" />
				</span>
			</Match>
			<Match when={props.state === "running"}>
				<span role="img" aria-label={t.runningNow} data-tip={t.runningNow} {...stylex.attrs(styles.mark)}>
					<Spinner />
				</span>
			</Match>
		</Switch>
	);
}

const FOLDER_ROWS = 5;

function Meter(props: { window: LimitWindow }) {
	return (
		<div {...stylex.attrs(styles.meter)}>
			<div {...stylex.attrs(styles.meterRow)}>
				<span>{t.window(props.window.minutes)}</span>
				<span {...stylex.attrs(styles.muted)}>{t.used(Math.round(props.window.percent))}</span>
			</div>
			{/* An SVG attribute, not a style: the page's content security policy allows no inline styles. */}
			<svg viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true" {...stylex.attrs(styles.track)}>
				<rect width={Math.min(100, props.window.percent)} height="4" rx="2" {...stylex.attrs(styles.meterFill)} />
			</svg>
			<Show when={props.window.resetsAt}>
				{(reset) => <span {...stylex.attrs(styles.muted)}>{t.resets(ago(reset()))}</span>}
			</Show>
		</div>
	);
}

// The sessions, by folder. What they are up to shows at the end of each row.
export function Sidebar(props: { harness: Harness; folder: string; current: string | undefined }) {
	const navigate = useNavigate();
	const newThreadIn = (folder: string) =>
		props.harness.anyFolder() ? `${paths()}?new=1&folder=${encodeURIComponent(folder)}` : `${paths()}?new=1`;
	const stateOf = (session: Session) =>
		props.harness.needsYou(session.id) ? "needsYou" : session.state === "running" ? "running" : null;
	const groupState = (group: Group) => {
		const states = group.sessions.map(stateOf);
		return states.includes("needsYou") ? "needsYou" : states.includes("running") ? "running" : null;
	};
	const [collapsed, setCollapsed] = createSignal(readCollapsed());
	const [unarchiving, setUnarchiving] = createSignal<string | null>(null);
	const toggle = (key: string) => {
		setCollapsed((own) => {
			const next = new Set(own);
			if (!next.delete(key)) {
				next.add(key);
			}
			localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
			return next;
		});
	};
	// Work that just moved to a folder is not hidden by that folder having been closed.
	createEffect(
		() => props.folder,
		(folder) => {
			if (untrack(collapsed).has(folder)) {
				toggle(folder);
			}
		},
	);
	// An open folder shows its latest few, and always what is in view or going on.
	const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
	const visibleIn = (group: Group) => {
		if (!group.folder || expanded().has(group.key)) {
			return group.sessions;
		}
		return group.sessions.filter(
			(session, index) => index < FOLDER_ROWS || session.id === props.current || stateOf(session) !== null,
		);
	};
	const isOpen = (group: Group) => !group.folder || !collapsed().has(group.key) || props.harness.showingArchived();
	const [notifications, setNotifications] = createSignal(
		typeof Notification !== "undefined" && Notification.permission === "granted",
	);
	const groups = createMemo(() =>
		grouped(
			props.harness.sessions(),
			props.harness.folders().map((folder) => folder.path),
		),
	);
	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	return (
		<nav aria-label={t.threads} {...stylex.attrs(styles.root)}>
			<header {...stylex.attrs(styles.header)}>
				<img src="/favicon.svg" alt="" {...stylex.attrs(styles.logo)} />
				<h1 {...stylex.attrs(styles.project)}>{props.harness.agent}</h1>
			</header>
			<a href={newThreadIn(props.folder)} {...stylex.attrs(styles.action, base.focusRing)}>
				<Icon name="plus" />
				{t.newThread}
			</a>
			<label {...stylex.attrs(styles.action)}>
				<Icon name="search" />
				<input
					type="search"
					aria-label={t.searchThreads}
					placeholder={t.searchThreads}
					{...stylex.attrs(styles.searchInput)}
					onInput={(event) => {
						const { value } = event.currentTarget;
						clearTimeout(searchTimer);
						searchTimer = setTimeout(() => props.harness.search(value), 200);
					}}
				/>
			</label>
			<Show when={props.harness.connection() === "offline" || props.harness.connection() === "connecting"}>
				<p role="status" {...stylex.attrs(styles.status)}>
					<Dot tone="done" />
					{t.reconnecting}
				</p>
			</Show>
			<div {...stylex.attrs(styles.scroll)}>
				<Show when={props.harness.showingArchived()}>
					<p {...stylex.attrs(styles.groupTitle)}>{t.archivedThreads}</p>
				</Show>
				<For
					each={groups()}
					keyed={(group) => group.key}
					fallback={
						<Show
							when={props.harness.listed()}
							fallback={
								<div {...stylex.attrs(styles.loadingList)}>
									<Skeleton width="medium" />
									<Skeleton />
									<Skeleton width="short" />
								</div>
							}
						>
							<EmptyState title={t.noThreads} />
						</Show>
					}
				>
					{(group) => (
						<section {...stylex.attrs(stylex.defaultMarker())}>
							<Show when={!props.harness.showingArchived()}>
								<div {...stylex.attrs(styles.groupHead)}>
									<Show when={group().folder} fallback={<h2 {...stylex.attrs(styles.groupTitle)}>{group().title}</h2>}>
										{(folder) => (
											<>
												<h2 {...stylex.attrs(styles.folderHeading)}>
													<button
														type="button"
														aria-expanded={isOpen(group()) ? "true" : "false"}
														data-tip={folder()}
														{...stylex.attrs(styles.folderToggle, base.focusRing)}
														onClick={() => toggle(group().key)}
													>
														<span {...stylex.attrs(styles.folderName)}>{group().title}</span>
														<span {...stylex.attrs(styles.chevron, isOpen(group()) && styles.chevronOpen)}>
															<Icon name="chevronRight" small />
														</span>
													</button>
												</h2>
												<Show when={!isOpen(group())}>
													<StateMark state={groupState(group())} />
												</Show>
												<a
													href={newThreadIn(folder())}
													aria-label={t.newThreadIn(group().title)}
													data-tip={t.newThreadIn(group().title)}
													{...stylex.attrs(styles.groupAdd, base.focusRing)}
												>
													<Icon name="plus" small />
												</a>
											</>
										)}
									</Show>
								</div>
							</Show>
							<Show when={isOpen(group())}>
								<ul {...stylex.attrs(styles.list, styles.listOpen)}>
									<For each={visibleIn(group())} keyed={(session) => session.id}>
										{(session) => (
											<li>
												<Show
													when={!props.harness.showingArchived()}
													fallback={
														<div {...stylex.attrs(styles.row)}>
															<span {...stylex.attrs(styles.title)}>{session().title}</span>
															<Button
																size="sm"
																disabled={unarchiving() === session().id}
																onClick={() => {
																	const { id } = session();
																	setUnarchiving(id);
																	void props.harness.unarchive(id).then((done) => {
																		setUnarchiving(null);
																		if (done) {
																			navigate(`${paths()}?thread=${id}`);
																		}
																	});
																}}
															>
																<Show when={unarchiving() === session().id}>
																	<Spinner />
																</Show>
																{t.unarchive}
															</Button>
														</div>
													}
												>
													<a
														href={`${paths()}?thread=${session().id}`}
														aria-current={props.current === session().id ? "true" : undefined}
														{...stylex.attrs(styles.link, base.focusRing)}
													>
														<span {...stylex.attrs(styles.title)}>{session().title}</span>
														<StateMark state={stateOf(session())} />
													</a>
												</Show>
											</li>
										)}
									</For>
								</ul>
								<Show when={visibleIn(group()).length < group().sessions.length}>
									<button
										type="button"
										{...stylex.attrs(styles.more, base.focusRing)}
										onClick={() => setExpanded((own) => new Set(own).add(group().key))}
									>
										{t.showMore}
									</button>
								</Show>
							</Show>
						</section>
					)}
				</For>
			</div>
			<footer {...stylex.attrs(styles.footer)}>
				<Menu
					label={t.account}
					trigger={
						<>
							<Icon name="account" />
							<span {...stylex.attrs(styles.accountLabel)}>{props.harness.account()?.name ?? t.account}</span>
						</>
					}
				>
					<Show when={props.harness.account()}>
						{(account) => (
							<>
								<MenuHeading>{account().name}</MenuHeading>
								<For each={account().limits}>{(window) => <Meter window={window} />}</For>
								<MenuSeparator />
							</>
						)}
					</Show>
					<MenuItem
						label={props.harness.showingArchived() ? t.activeThreads : t.archivedThreads}
						icon={<Icon name="archive" />}
						onSelect={() => props.harness.showArchived(!props.harness.showingArchived())}
					/>
					<Show when={typeof Notification !== "undefined"}>
						<MenuItem
							label={t.notifyMe}
							icon={<Icon name="bell" />}
							checked={notifications()}
							stayOpen
							onSelect={() => {
								void Notification.requestPermission().then((result) => setNotifications(result === "granted"));
							}}
						/>
					</Show>
				</Menu>
			</footer>
		</nav>
	);
}
