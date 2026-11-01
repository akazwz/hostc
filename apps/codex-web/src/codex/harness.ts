import { createMemo, createSignal, createStore, flush } from "solid-js";

import { folderName } from "../harness/folder.ts";
import type {
	Decision,
	RequestStep,
	Draft,
	Goal,
	Harness,
	ModelOption,
	PermissionOption,
	Run,
	Session,
	Step,
} from "../harness/model.ts";
import { same } from "../harness/same.ts";
import { t } from "../i18n.ts";
import type {
	ThreadGoal,
	ThreadItem,
	CodexEvent,
	Model,
	Params,
	PermissionProfileSummary,
	Question,
	RateLimitSnapshot,
	SkillMetadata,
	Thread,
	UserInput,
} from "./api.ts";
import {
	CodexConnection,
	ConnectionLost,
	type ConnectionPlatform,
	MessageTooLong,
	type SocketLike,
} from "./connection.ts";
import type { GetAccountResponse } from "./protocol/v2/GetAccountResponse.ts";
import {
	DEFAULT_PREFERENCES,
	modeIdFor,
	parsePreferences,
	type PermissionMode,
	permissionModes,
	type Preferences,
} from "./settings.ts";
import {
	type PendingInput,
	turnOf,
	applyEvent,
	applyTurns,
	type Conversation,
	emptyConversation,
	initialState,
	resetConversation,
	type TurnState,
} from "./state.ts";
import { decisionOf, runStatus, stepOf, editedFile } from "./translate.ts";

const TURNS_PER_PAGE = 10;
const EVENT_BATCH_MS = 33;
const THREADS_LISTED = 300;
const START_RETRY_MS = 3000;
const START_ATTEMPTS = 4;
const FAILURES_BEFORE_CHECK = 6;
const CONNECTION_NOTICE = "Connection lost";
const PREFERENCES_KEY = "hostc-codex-preferences";

const browser: ConnectionPlatform = {
	open: (url) => new WebSocket(`${location.origin.replace(/^http/, "ws")}${url}`) as unknown as SocketLike,
	setTimer: (callback, ms) => setTimeout(callback, ms),
	clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

function readPreferences(): Preferences {
	try {
		return parsePreferences(localStorage.getItem(PREFERENCES_KEY));
	} catch {
		return DEFAULT_PREFERENCES;
	}
}

function requestOf(pending: PendingInput): Step {
	const item = {
		type: "userMessage",
		id: `pending-${pending.clientId}`,
		clientId: pending.clientId,
		content: pending.input,
	};
	return stepOf(item as ThreadItem) as Step;
}

/** What was sent before Codex has confirmed a turn for it. */
function pendingRun(pending: PendingInput): Run {
	return {
		id: pending.clientId,
		status: () => "running",
		steps: () => [requestOf(pending)],
		error: () => null,
		startedAt: () => null,
		durationMs: () => null,
		checklist: () => null,
		diff: () => null,
		retrying: () => null,
	};
}

function runOf(turn: TurnState, conversationOf: () => Conversation | undefined): Run {
	const live = () => conversationOf()?.activeTurnId === turn.id;
	// Text streaming into one item must not look like a change to every step before it.
	const steps = new Map<string, Step>();
	return {
		id: turn.id,
		// A turn reported as running that sends no events, such as one in another Codex, is not running here.
		status: () => (turn.status === "inProgress" && !live() ? "done" : runStatus(turn.status)),
		steps: () => {
			const known = turn.items.flatMap((item) => {
				const next = stepOf(item);
				if (!next) {
					return [];
				}
				const previous = steps.get(next.id);
				if (previous && same(previous, next)) {
					return [previous];
				}
				steps.set(next.id, next);
				return [next];
			});
			// Said while this turn runs. The first one opens the turn until Codex reports it.
			const sent = live() ? (conversationOf()?.pending ?? []).map(requestOf) : [];
			return known.some((step) => step.kind === "request")
				? [...known, ...sent]
				: [...sent.slice(0, 1), ...known, ...sent.slice(1)];
		},
		error: () => turn.error?.message ?? null,
		startedAt: () => turn.startedAt,
		durationMs: () => turn.durationMs,
		checklist: () =>
			turn.plan?.map((step) => ({
				text: step.step,
				state: step.status === "completed" ? "done" : step.status === "inProgress" ? "active" : "pending",
			})) ?? null,
		diff: () => turn.diff,
		retrying: () => (live() ? (conversationOf()?.retrying ?? null) : null),
	};
}

function sessionOf(thread: Thread): Session {
	return {
		id: thread.id,
		title: thread.name || thread.preview || t.newThread,
		updatedAt: thread.updatedAt,
		state: thread.status.type === "active" ? "running" : "idle",
		branch: thread.gitInfo?.branch ?? null,
		folder: thread.cwd,
	};
}

function modelOption(model: Model): ModelOption {
	return {
		id: model.id,
		name: model.displayName,
		description: model.description,
		efforts: model.supportedReasoningEfforts.map((option) => option.reasoningEffort),
		fast: model.serviceTiers.some((tier) => tier.id === "priority"),
	};
}

function toInput(draft: Draft): UserInput[] {
	const input: UserInput[] = [];
	if (draft.text) {
		input.push({ type: "text", text: draft.text, text_elements: [] });
	}
	for (const file of draft.files) {
		input.push({ type: "mention", name: file.name, path: file.path });
	}
	for (const skill of draft.skills) {
		input.push({ type: "skill", name: skill.name, path: skill.path });
	}
	for (const path of draft.images) {
		input.push({ type: "localImage", path });
	}
	return input;
}

/** Codex as a harness. The only module that knows about both the protocol and Solid. */
export function createCodexHarness(): Harness {
	const [state, setState] = createStore(initialState());
	const [connectionState, setConnectionState] = createSignal<ReturnType<Harness["connection"]>>("checking");
	const [catalog, setCatalog] = createStore({
		models: [] as Model[],
		profiles: [] as PermissionProfileSummary[],
		skills: {} as Record<string, SkillMetadata[]>,
		account: null as GetAccountResponse | null,
		limits: null as RateLimitSnapshot | null,
	});
	const [preferences, setPreferences] = createStore<Preferences>(readPreferences());
	const [planning, setPlanning] = createSignal(false);
	const [archived, setArchived] = createSignal(false);
	let searchTerm = "";
	// Threads this bridge run has resumed, so that events flow for them. Not reactive state.
	const resumed = new Set<string>();
	const skillFolders = new Set<string>();

	// Threads only read, never resumed: a sub-agent's, looked at to approve its edits.
	const readOnly = new Set<string>();
	// Sends cut off by a lost connection, waiting to learn from the next reload whether they arrived.
	const reconciling = new Map<string, (() => void)[]>();
	let failures = 0;
	let startFailures = 0;
	let greeted = false;
	let queuedEvents: CodexEvent[] = [];
	let eventTimer: ReturnType<typeof setTimeout> | undefined;
	const connection = new CodexConnection(browser, {
		onStatus: (next) => {
			// Until the agent has said hello there is nothing to show, and nothing has been lost to reconnect to.
			if (greeted) {
				setConnectionState(next);
			}
			failures = next === "online" ? 0 : next === "offline" ? failures + 1 : failures;
			if (next === "offline" && failures >= FAILURES_BEFORE_CHECK) {
				void checkSessionAlive();
			}
		},
		onHello: (hello) => {
			greeted = true;
			setConnectionState("online");
			setState((draft) => {
				draft.cwd = hello.cwd;
				draft.here = hello.here;
				draft.questions = hello.pending;
			});
			setState((draft) => {
				if (draft.notice === CONNECTION_NOTICE || draft.notice === "Not connected") {
					draft.notice = null;
				}
			});
			hello.pending.forEach(readEditsOf);
			if (catalog.models.length === 0 && hello.resumed) {
				void loadCatalog();
			}
			if (!hello.resumed) {
				// Events were missed: what the page holds may have gaps, and merging would keep them.
				resumed.clear();
				setState((draft) => {
					for (const conversation of Object.values(draft.conversations)) {
						resetConversation(conversation);
					}
				});
				void refreshThreads();
				void loadCatalog();
			}
			// A thread opened while offline never loaded, whatever the bridge could replay.
			for (const [id, conversation] of Object.entries(state.conversations)) {
				const waiting = reconciling.get(id);
				if (!hello.resumed || !conversation.loaded || waiting) {
					reconciling.delete(id);
					void (readOnly.has(id) ? loadTurns(id) : loadConversation(id)).finally(() => {
						for (const done of waiting ?? []) {
							done();
						}
					});
				}
			}
		},
		onBeforeReply: flushEvents,
		onEvent: (event) => {
			// Text can arrive hundreds of times a second, far more often than anyone can read or a page
			// can draw. Whatever arrives within one batch is one change to the page.
			queuedEvents.push(event);
			eventTimer ??= setTimeout(flushEvents, EVENT_BATCH_MS);
		},
	});

	function flushEvents() {
		clearTimeout(eventTimer);
		eventTimer = undefined;
		if (queuedEvents.length === 0) {
			return;
		}
		const events = queuedEvents;
		queuedEvents = [];
		setState((draft) => {
			for (const event of events) {
				applyEvent(draft, event);
			}
		});
		events.forEach(afterEvent);
	}

	function afterEvent(event: CodexEvent) {
		if ("id" in event) {
			readEditsOf(event);
			return;
		}
		switch (event.method) {
			case "turn/completed":
				void refreshThreads();
				void refreshLimits();
				break;
			case "thread/closed":
				resumed.delete(event.params.threadId);
				break;
			case "model/rerouted":
				setState((draft) => {
					draft.notice = t.rerouted(event.params.toModel);
				});
				break;
			case "thread/reverted":
				// Reloading merges, which would keep the turn that is gone.
				setState((draft) => {
					const conversation = draft.conversations[event.params.threadId];
					if (conversation) {
						conversation.turns = [];
						conversation.loaded = false;
					}
				});
				void loadConversation(event.params.threadId);
				break;
			case "account/rateLimits/updated":
				setCatalog((draft) => {
					draft.limits = event.params.rateLimits;
				});
				break;
			default:
				break;
		}
	}

	// Approving an edit needs the edit, and a sub-agent's thread is never opened. Reads it without
	// resuming it, which would apply this page's permission settings to that thread.
	async function readEditsOf(question: Question) {
		const id = question.params.threadId;
		if (question.method !== "item/fileChange/requestApproval" || state.conversations[id]) {
			return;
		}
		readOnly.add(id);
		setState((draft) => {
			draft.conversations[id] = emptyConversation();
		});
		await loadTurns(id).catch(() => undefined);
	}

	/** The session is over if the page can no longer even ask about it. Retrying would go on forever. */
	async function checkSessionAlive() {
		const response = await fetch("/api/session").catch(() => null);
		// No answer at all is this device's network, which comes back.
		if (response && !response.ok) {
			connection.stop();
			setConnectionState("ended");
		}
	}

	function setThreadName(id: string, name: string | null) {
		setState((draft) => {
			for (const thread of [draft.threads.find((own) => own.id === id), draft.known[id]]) {
				if (thread) {
					thread.name = name;
				}
			}
		});
	}

	/** A goal keeps running on its own, so what was asked of it shows at once; the reply corrects it. */
	async function changeGoal(id: string, change: Pick<Partial<ThreadGoal>, "status" | "tokenBudget">) {
		const previous = state.conversations[id]?.goal;
		if (!previous) {
			return;
		}
		const before = { status: previous.status, tokenBudget: previous.tokenBudget };
		setState((draft) => {
			const goal = draft.conversations[id]?.goal;
			if (goal) {
				Object.assign(goal, change);
			}
		});
		const done = await attempt(() =>
			connection.request("thread/goal/set", { threadId: id, ...change, origin: "user" }),
		);
		if (!done) {
			setState((draft) => {
				const goal = draft.conversations[id]?.goal;
				if (goal) {
					Object.assign(goal, before);
				}
			});
		}
	}

	const notify = (error: unknown) => {
		setState((draft) => {
			draft.notice =
				error instanceof MessageTooLong
					? t.messageTooLong
					: /active writer/.test(String(error instanceof Error ? error.message : error))
						? t.openElsewhere
						: error instanceof Error
							? error.message
							: String(error);
		});
	};

	/** Runs an action, reporting a failure the same way for all of them. */
	async function attempt<T>(action: () => Promise<T>): Promise<T | null> {
		try {
			return await action();
		} catch (error) {
			notify(error);
			return null;
		}
	}

	let listSerial = 0;
	async function refreshThreads() {
		// A slower answer to an earlier question must not replace a newer one.
		const serial = ++listSerial;
		try {
			const { data } = await connection.request("thread/list", {
				limit: THREADS_LISTED,
				sortKey: "updated_at",
				archived: archived(),
				// Without this Codex scans its session files to repair metadata, which takes seconds.
				useStateDbOnly: true,
				...(searchTerm ? { searchTerm } : {}),
			});
			if (serial !== listSerial) {
				return;
			}
			setState((draft) => {
				draft.threads = data;
				draft.listed = true;
				for (const thread of data) {
					draft.known[thread.id] = thread;
				}
			});
		} catch (error) {
			// Reconnecting refreshes the list.
			if (!(error instanceof ConnectionLost)) {
				notify(error);
				setState((draft) => {
					draft.listed = true;
				});
			}
		}
	}

	async function refreshLimits() {
		const limits = await connection.request("account/rateLimits/read", undefined).catch(() => null);
		if (limits) {
			setCatalog((draft) => {
				draft.limits = limits.rateLimits;
			});
		}
	}

	function loadSkills(folder: string) {
		if (!folder || skillFolders.has(folder)) {
			return;
		}
		skillFolders.add(folder);
		connection
			.request("skills/list", { cwds: [folder] })
			.then((result) => {
				setCatalog((draft) => {
					draft.skills[folder] = result.data.flatMap((entry) => entry.skills).filter((skill) => skill.enabled);
				});
			})
			.catch(() => skillFolders.delete(folder));
	}

	async function loadCatalog() {
		const [models, profiles, account] = await Promise.all([
			connection.request("model/list", { limit: 100 }).catch(() => null),
			connection.request("permissionProfile/list", {}).catch(() => null),
			connection.request("account/read", {}).catch(() => null),
		]);
		setCatalog((draft) => {
			if (models) {
				draft.models = models.data.filter((model) => !model.hidden);
			}
			if (profiles) {
				draft.profiles = profiles.data;
			}
			draft.account = account;
		});
		void refreshLimits();
		// Reconnecting may have missed a change to them.
		const folders = [...skillFolders];
		skillFolders.clear();
		folders.forEach(loadSkills);
	}

	async function resume(id: string) {
		if (!resumed.has(id)) {
			const { thread } = await connection.request("thread/resume", {
				threadId: id,
				excludeTurns: true,
				...threadOverrides(folderOf(id)),
			});
			resumed.add(id);
			// A thread further back than the list goes: now its folder and name are known too.
			setState((draft) => {
				draft.known[id] ??= thread;
			});
		}
	}

	/** What the thread holds now, from Codex. */
	async function loadTurns(id: string) {
		const goalBefore = JSON.stringify(state.conversations[id]?.goal ?? null);
		// A goal set earlier keeps going, so it has to show when the thread is opened again.
		const [page, saved] = await Promise.all([
			connection.request("thread/turns/list", {
				threadId: id,
				limit: TURNS_PER_PAGE,
				sortDirection: "desc",
				itemsView: "full",
			}),
			connection.request("thread/goal/get", { threadId: id }).catch(() => null),
		]);
		setState((draft) => {
			const conversation = draft.conversations[id];
			if (conversation) {
				applyTurns(conversation, page.data, page.nextCursor, false);
				// Changed while this was on its way: what is here is newer.
				if (JSON.stringify(conversation.goal ?? null) === goalBefore) {
					conversation.goal = saved?.goal ?? null;
				}
				// No events flow for a thread that is not resumed, so nothing here can be running.
				if (!resumed.has(id)) {
					conversation.activeTurnId = null;
				}
			}
		});
	}

	async function loadConversation(id: string) {
		try {
			// A thread another Codex is writing to cannot be resumed, but can still be read.
			await resume(id).catch(notify);
			await loadTurns(id);
		} catch (error) {
			notify(error);
			// Otherwise it would wait for a load that nothing is going to retry. Reconnecting does retry.
			if (!(error instanceof ConnectionLost)) {
				setState((draft) => {
					const conversation = draft.conversations[id];
					if (conversation) {
						conversation.loaded = true;
					}
				});
			}
		}
	}

	const selectedModel = (): Model | undefined =>
		catalog.models.find((model) => model.id === preferences.model) ?? catalog.models.find((model) => model.isDefault);

	const modes = (): PermissionMode[] => permissionModes(catalog.profiles);

	const folderOf = (sessionId: string | null) => (sessionId && state.known[sessionId]?.cwd) || state.cwd;
	const selectedMode = (folder: string): PermissionMode | undefined =>
		modes().find((mode) => mode.id === modeIdFor(preferences, folder)) ??
		modes().find((mode) => mode.id === "ask") ??
		modes()[0];

	const selectedEffort = (): string | null => {
		const model = selectedModel();
		if (!model) {
			return preferences.effort;
		}
		return model.supportedReasoningEfforts.some((option) => option.reasoningEffort === preferences.effort)
			? preferences.effort
			: model.defaultReasoningEffort;
	};

	const fastAvailable = (): boolean => Boolean(selectedModel()?.serviceTiers.some((tier) => tier.id === "priority"));
	const serviceTier = (): string => (preferences.fast && fastAvailable() ? "priority" : "default");

	function threadOverrides(folder: string) {
		const mode = selectedMode(folder);
		return mode
			? { permissions: mode.profile, approvalPolicy: mode.approvalPolicy, approvalsReviewer: mode.approvalsReviewer }
			: {};
	}

	/** What the selected controls say, for the turn about to start and the ones after it. */
	function turnOverrides(folder: string): Partial<Params<"turn/start">> {
		const model = selectedModel();
		const effort = selectedEffort();
		return {
			...threadOverrides(folder),
			...(model ? { model: model.id } : {}),
			...(effort ? { effort } : {}),
			serviceTier: serviceTier(),
			...(model
				? {
						collaborationMode: {
							mode: planning() ? ("plan" as const) : ("default" as const),
							settings: { model: model.id, reasoning_effort: effort, developer_instructions: null },
						},
					}
				: {}),
		};
	}

	function savePreferences(change: Partial<Preferences>) {
		setPreferences((draft) => {
			Object.assign(draft, change);
		});
		try {
			localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ ...preferences, ...change }));
		} catch {
			// Private browsing may refuse; the choice still holds for this page.
		}
	}

	// A turn being started, so that what comes next waits to join it instead of starting another.
	const starting = new Map<string, Promise<unknown>>();
	const forking = new Set<string>();

	function setThreadBusy(id: string, busy: boolean) {
		setState((draft) => {
			const thread = draft.threads.find((candidate) => candidate.id === id);
			if (thread) {
				thread.status = busy ? { type: "active", activeFlags: [] } : { type: "idle" };
			}
		});
	}

	async function sendInput(id: string, input: UserInput[]): Promise<boolean> {
		const clientId = crypto.randomUUID();
		setState((draft) => {
			draft.conversations[id]?.pending.push({ clientId, input });
		});
		setThreadBusy(id, true);
		try {
			await starting.get(id)?.catch(() => undefined);
			// Whatever kept it from resuming when it was opened may be gone by now. Then what is on the page
			// is what it read back then.
			if (!resumed.has(id)) {
				await resume(id);
				await loadTurns(id);
			}
			const active = state.conversations[id]?.activeTurnId;
			const start = async () => {
				const started = connection
					.request("turn/start", {
						threadId: id,
						input,
						clientUserMessageId: clientId,
						...turnOverrides(folderOf(id)),
					})
					.then(({ turn }) => {
						// Stopping should not have to wait for the event. A short turn may already be over.
						setState((draft) => {
							const conversation = draft.conversations[id];
							if (conversation && !conversation.activeTurnId) {
								const known = conversation.turns.find((own) => own.id === turn.id);
								if (!known || known.status === "inProgress") {
									turnOf(conversation, turn.id).status = "inProgress";
									conversation.activeTurnId = turn.id;
								}
							}
						});
						// What waits for this reads the state next, and has to find the turn there.
						flush();
					});
				starting.set(id, started);
				await started.finally(() => starting.delete(id));
			};
			if (active) {
				try {
					await connection.request("turn/steer", {
						threadId: id,
						input,
						expectedTurnId: active,
						clientUserMessageId: clientId,
					});
				} catch (error) {
					// The turn ended while this was on its way: then it starts the next one.
					if (error instanceof ConnectionLost || state.conversations[id]?.activeTurnId === active) {
						throw error;
					}
					await start();
				}
			} else {
				await start();
			}
			return true;
		} catch (error) {
			// Lost on the way there or on the way back: only the next reload can say which. Sending it again
			// without knowing could do the work twice.
			if (error instanceof ConnectionLost) {
				await new Promise<void>((done) => {
					reconciling.set(id, [...(reconciling.get(id) ?? []), done]);
				});
				const arrived = !state.conversations[id]?.pending.some((own) => own.clientId === clientId);
				if (arrived) {
					return true;
				}
			}
			setState((draft) => {
				const conversation = draft.conversations[id];
				if (conversation) {
					conversation.pending = conversation.pending.filter((own) => own.clientId !== clientId);
				}
			});
			if (!state.conversations[id]?.activeTurnId) {
				setThreadBusy(id, false);
			}
			notify(error);
			return false;
		}
	}

	const sessions = createMemo(() => state.threads.map(sessionOf));

	// Runs are stable per turn object, so that the view keeps its components while text streams in.
	const runCache = new WeakMap<TurnState, Run>();
	const run = (turn: TurnState, threadId: string): Run => {
		let own = runCache.get(turn);
		if (!own) {
			own = runOf(turn, () => state.conversations[threadId]);
			runCache.set(turn, own);
		}
		return own;
	};
	const pendingRuns = new Map<string, Run>();
	const runOfPending = (pending: PendingInput): Run => {
		let own = pendingRuns.get(pending.clientId);
		if (!own) {
			own = pendingRun(pending);
			pendingRuns.set(pending.clientId, own);
		}
		return own;
	};
	const conversation = (id: string): Conversation | undefined => state.conversations[id];

	const decisionCache = new Map<number | string, Decision>();
	const decisionFor = (question: Question, foreign: boolean): Decision => {
		const known = decisionCache.get(question.id);
		if (known && known.foreign === foreign) {
			return known;
		}
		const made = decisionOf(question, foreign);
		decisionCache.set(question.id, made);
		return made;
	};

	const permissions = (): PermissionOption[] =>
		modes().map((mode) => {
			const description = catalog.profiles.find((profile) => profile.id === mode.profile)?.description ?? null;
			return { id: mode.id, label: mode.id === mode.profile ? mode.profile : null, description };
		});

	return {
		connection: connectionState,
		session(id) {
			const thread = state.threads.find((candidate) => candidate.id === id) ?? state.known[id];
			return thread ? sessionOf(thread) : undefined;
		},
		listed: () => state.listed,
		agent: "Codex",
		project: () => ({ path: state.cwd, name: folderName(state.cwd) }),
		anyFolder: () => !state.here,
		folders: () =>
			[...new Set([state.cwd, ...Object.values(state.known).map((thread) => thread.cwd)])].map((path) => ({
				path,
				name: folderName(path),
			})),
		folderOf,
		sessions,
		open(id) {
			if (state.conversations[id]?.loaded) {
				return;
			}
			setState((draft) => {
				draft.conversations[id] ??= emptyConversation();
			});
			if (connectionState() === "online") {
				void loadConversation(id);
			}
		},
		runs(id) {
			const own = conversation(id);
			if (!own) {
				return [];
			}
			const runs = own.turns.map((turn) => run(turn, id));
			return own.activeTurnId ? runs : [...runs, ...own.pending.map(runOfPending)];
		},
		loaded: (id) => conversation(id)?.loaded ?? false,
		hasOlder: (id) => Boolean(conversation(id)?.olderCursor),
		activeRun: (id) => conversation(id)?.activeTurnId ?? conversation(id)?.pending[0]?.clientId ?? null,
		usage(id) {
			const usage = conversation(id)?.usage;
			const window = usage?.modelContextWindow ?? 0;
			if (!usage || window <= 0) {
				return null;
			}
			const used = usage.last.totalTokens;
			return { used, window, percent: Math.round((used / window) * 100) };
		},
		goal(id): Goal | null {
			const goal = conversation(id)?.goal;
			return goal
				? {
						objective: goal.objective,
						status: goal.status,
						tokensUsed: goal.tokensUsed,
						tokenBudget: goal.tokenBudget,
						seconds: goal.timeUsedSeconds,
					}
				: null;
		},
		decisions(sessionId) {
			return state.questions.flatMap((question) => {
				const threadId = question.params.threadId;
				if (threadId === sessionId) {
					return [decisionFor(question, false)];
				}
				// Threads no list has shown, such as sub-agents, have no other place to be answered.
				return !state.listed || state.known[threadId] ? [] : [decisionFor(question, true)];
			});
		},
		waitingCount: () => state.questions.length,
		needsYou: (sessionId) => state.questions.some((question) => question.params.threadId === sessionId),
		editFiles(sessionId, itemId) {
			for (const turn of conversation(sessionId)?.turns ?? []) {
				const item = turn.items.find((candidate) => candidate.id === itemId);
				if (item?.type === "fileChange") {
					return item.changes.map(editedFile);
				}
			}
			return [];
		},
		notice: () => state.notice,
		dismissNotice() {
			setState((draft) => {
				draft.notice = null;
			});
		},
		account() {
			const own = catalog.account?.account;
			if (!catalog.account) {
				return null;
			}
			const name =
				own?.type === "chatgpt"
					? (own.email ?? own.planType)
					: own?.type === "apiKey"
						? t.apiKey
						: (own?.type ?? t.account);
			const windows = [catalog.limits?.primary, catalog.limits?.secondary].flatMap((window) =>
				window
					? [{ minutes: window.windowDurationMins ?? 0, percent: window.usedPercent, resetsAt: window.resetsAt }]
					: [],
			);
			return { name, limits: windows };
		},

		models: () => catalog.models.map(modelOption),
		model() {
			const model = selectedModel();
			return model && modelOption(model);
		},
		effort: selectedEffort,
		fast: () => preferences.fast && fastAvailable(),
		permissions,
		permission(folder) {
			const id = selectedMode(folder)?.id;
			return permissions().find((option) => option.id === id);
		},
		planning,
		setModel: (id) => savePreferences({ model: id }),
		setEffort: (id) => savePreferences({ effort: id }),
		setFast: (on) => savePreferences({ fast: on }),
		setPermission: (folder, id) => savePreferences({ modes: { ...preferences.modes, [folder]: id } }),
		setPlanning,

		/** Exchanges the token in the link for a cookie, takes it out of the address, and connects. */
		async start() {
			// The token stays in the address until it has done its work: a failed attempt must leave it possible
			// to try again.
			const token = location.hash.slice(1);
			const exchange = token ? await fetch("/api/session", { method: "POST", body: token }).catch(() => null) : null;
			if (exchange?.ok) {
				history.replaceState(null, "", location.pathname + location.search);
			}
			const session = await fetch("/api/session").catch(() => null);
			if (session?.ok) {
				connection.connect();
			} else if (session?.status === 401 && (!token || exchange)) {
				if (token) {
					history.replaceState(null, "", location.pathname + location.search);
				}
				setConnectionState("signedOut");
			} else if (session && ++startFailures >= START_ATTEMPTS) {
				// Something answers, and it is not this session: the link has outlived it.
				setConnectionState("ended");
			} else {
				// The tunnel or this device's network, for now.
				setTimeout(() => void this.start(), START_RETRY_MS);
			}
		},
		wake() {
			if (connectionState() !== "signedOut" && connectionState() !== "checking" && connectionState() !== "ended") {
				connection.wake();
			}
		},
		send: (id, draft) => sendInput(id, toInput(draft)),
		async begin(draft, folder, onStarted) {
			const started = await attempt(() =>
				connection.request("thread/start", { ...threadOverrides(folder), serviceTier: serviceTier(), cwd: folder }),
			);
			if (!started) {
				return null;
			}
			const { thread } = started;
			resumed.add(thread.id);
			setState((own) => {
				own.conversations[thread.id] = { ...emptyConversation(), loaded: true };
				own.known[thread.id] = thread;
				if (!own.threads.some((known) => known.id === thread.id)) {
					own.threads.unshift(thread);
				}
				// Codex gives a new thread its preview later; until then it is what was asked.
				const known = own.threads.find((candidate) => candidate.id === thread.id);
				if (known && !known.preview) {
					known.preview = draft.text;
				}
			});
			// The message goes on the screen now; the thread is ready to be looked at while it travels.
			const sent = sendInput(thread.id, toInput(draft));
			onStarted(thread.id);
			return (await sent) ? thread.id : null;
		},
		requestOf(draft) {
			return requestOf({ clientId: crypto.randomUUID(), input: toInput(draft) }) as RequestStep;
		},
		async carryOutPlan(id, text) {
			setPlanning(false);
			// Writes take effect on the next microtask, and the request below reads this one.
			flush();
			await sendInput(id, [{ type: "text", text, text_elements: [] }]);
		},
		async stop(id) {
			await starting.get(id)?.catch(() => undefined);
			const turnId = state.conversations[id]?.activeTurnId;
			if (!turnId) {
				return false;
			}
			try {
				await connection.request("turn/interrupt", { threadId: id, turnId });
				return true;
			} catch (error) {
				notify(error);
				return false;
			}
		},
		answer(decision, answer) {
			if (!connection.answer(decision.id, answer)) {
				setState((draft) => {
					draft.notice = t.notSent;
				});
				return;
			}
			decisionCache.delete(decision.id);
			setState((draft) => {
				draft.questions = draft.questions.filter((own) => own.id !== decision.id);
			});
		},

		loadSkills,
		skills: (folder) =>
			(catalog.skills[folder] ?? []).map((skill) => ({
				name: skill.name,
				path: skill.path,
				hint: skill.shortDescription ?? skill.description,
			})),
		async searchFiles(query, folder) {
			const result = await attempt(() =>
				connection.request("fuzzyFileSearch", { query, roots: [folder], cancellationToken: null }),
			);
			return (result?.files ?? [])
				.slice(0, 20)
				.map((file) => ({ name: file.path, path: `${file.root}/${file.path}`, hint: "" }));
		},
		async upload(file) {
			const uploaded = await attempt(async () => {
				const response = await fetch("/api/upload", {
					method: "POST",
					body: file,
					headers: { "content-type": file.type },
				});
				if (!response.ok) {
					throw new Error(`${t.addImages}: ${response.status}`);
				}
				return (await response.json()) as { path: string };
			});
			return uploaded?.path ?? null;
		},

		showingArchived: archived,
		showArchived(show) {
			setArchived(show);
			flush();
			void refreshThreads();
		},
		search(term) {
			searchTerm = term;
			void refreshThreads();
		},
		async unarchive(id) {
			const done = await attempt(() => connection.request("thread/unarchive", { threadId: id }));
			if (!done) {
				return false;
			}
			setArchived(false);
			flush();
			await refreshThreads();
			return true;
		},

		async loadOlder(id) {
			const cursor = state.conversations[id]?.olderCursor;
			if (!cursor) {
				return;
			}
			const page = await attempt(() =>
				connection.request("thread/turns/list", {
					threadId: id,
					cursor,
					limit: TURNS_PER_PAGE,
					sortDirection: "desc",
					itemsView: "full",
				}),
			);
			if (page) {
				setState((draft) => {
					const own = draft.conversations[id];
					if (own) {
						applyTurns(own, page.data, page.nextCursor, true);
					}
				});
			}
		},
		async rename(id, title) {
			// On screen at once, and back if it could not be done.
			const previous = state.known[id]?.name ?? null;
			setThreadName(id, title);
			const done = await attempt(() => connection.request("thread/name/set", { threadId: id, name: title }));
			if (!done) {
				setThreadName(id, previous);
			}
		},
		async archive(id) {
			return (await attempt(() => connection.request("thread/archive", { threadId: id }))) !== null;
		},
		async fork(id, fromRun) {
			// A second press while the first is on its way is the same press.
			if (forking.has(id)) {
				return null;
			}
			forking.add(id);
			const result = await attempt(() =>
				connection.request("thread/fork", {
					threadId: id,
					excludeTurns: true,
					...(fromRun ? { lastTurnId: fromRun } : {}),
				}),
			).finally(() => forking.delete(id));
			if (!result) {
				return null;
			}
			resumed.add(result.thread.id);
			setState((draft) => {
				draft.known[result.thread.id] = result.thread;
				// `thread/started` may have listed it already.
				if (!draft.threads.some((known) => known.id === result.thread.id)) {
					draft.threads.unshift(result.thread);
				}
			});
			return result.thread.id;
		},
		async undo(id) {
			const beforeTurnId = state.conversations[id]?.turns.at(-1)?.id;
			if (beforeTurnId) {
				await attempt(() => connection.request("thread/revert", { threadId: id, beforeTurnId }));
			}
		},
		async compact(id) {
			await attempt(() => connection.request("thread/compact/start", { threadId: id }));
		},
		async review(id) {
			await attempt(() =>
				connection.request("review/start", {
					threadId: id,
					target: { type: "uncommittedChanges" },
					delivery: "inline",
				}),
			);
		},
		async shell(id, command) {
			return (await attempt(() => connection.request("thread/shellCommand", { threadId: id, command }))) !== null;
		},
		async setGoal(id, objective) {
			return (
				(await attempt(() => connection.request("thread/goal/set", { threadId: id, objective, origin: "user" }))) !==
				null
			);
		},
		async beginGoal(objective, folder) {
			const started = await attempt(() =>
				connection.request("thread/start", { ...threadOverrides(folder), serviceTier: serviceTier(), cwd: folder }),
			);
			if (!started) {
				return null;
			}
			const { thread } = started;
			resumed.add(thread.id);
			const title = objective.split("\n")[0]?.slice(0, 80) ?? objective;
			setState((own) => {
				own.conversations[thread.id] = { ...emptyConversation(), loaded: true };
				own.known[thread.id] = thread;
				if (!own.threads.some((known) => known.id === thread.id)) {
					own.threads.unshift(thread);
				}
				const known = own.threads.find((candidate) => candidate.id === thread.id);
				if (known) {
					known.preview ||= title;
				}
			});
			// A goal has no first message of its own to name the thread after.
			void connection.request("thread/name/set", { threadId: thread.id, name: title }).catch(() => undefined);
			const set = await attempt(() =>
				connection.request("thread/goal/set", { threadId: thread.id, objective, origin: "user" }),
			);
			return set ? thread.id : null;
		},
		async pauseGoal(id, paused) {
			await changeGoal(id, { status: paused ? "paused" : "active" });
		},
		async limitGoal(id, tokens) {
			await changeGoal(id, { tokenBudget: tokens });
		},
		async clearGoal(id) {
			const previous = state.conversations[id]?.goal ?? null;
			setState((draft) => {
				const own = draft.conversations[id];
				if (own) {
					own.goal = null;
				}
			});
			const done = await attempt(() => connection.request("thread/goal/clear", { threadId: id }));
			if (!done) {
				setState((draft) => {
					const own = draft.conversations[id];
					if (own) {
						own.goal = previous;
					}
				});
			}
		},

		async readFolder(path) {
			const result = await attempt(() => connection.request("fs/readDirectory", { path }));
			return result ? result.entries.map((entry) => ({ name: entry.fileName, folder: entry.isDirectory })) : null;
		},
		async readFile(path) {
			const result = await attempt(() => connection.request("fs/readFile", { path }));
			if (!result) {
				return undefined;
			}
			const bytes = Uint8Array.from(atob(result.dataBase64), (char) => char.charCodeAt(0));
			try {
				return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
			} catch {
				return null;
			}
		},
		async branchDiff(folder) {
			const result = await connection.request("gitDiffToRemote", { cwd: folder }).catch(() => null);
			return result?.diff ?? null;
		},
	};
}
