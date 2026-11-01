import type {
	CodexEvent,
	Question,
	Thread,
	ThreadGoal,
	ThreadItem,
	ThreadTokenUsage,
	Turn,
	TurnPlanStep,
	UserInput,
} from "./api.ts";

/** One turn as this page knows it: the protocol's turn, whose items arrive as events. */
export type TurnState = Pick<Turn, "id" | "items" | "status" | "error" | "startedAt" | "durationMs"> & {
	plan: TurnPlanStep[] | null;
	diff: string | null;
};

/** One open thread. */
export type Conversation = {
	turns: TurnState[];
	activeTurnId: string | null;
	/** Cursor for older turns; null when there are none. */
	olderCursor: string | null;
	loaded: boolean;
	usage: ThreadTokenUsage | null;
	goal: ThreadGoal | null;
	/** Sent, and not yet confirmed by Codex. Shown at once: the round trip can take seconds. */
	pending: PendingInput[];
	/** What went wrong while Codex tries again by itself. */
	retrying: string | null;
};

export type PendingInput = { clientId: string; input: UserInput[] };

export type State = {
	cwd: string;
	threads: Thread[];
	conversations: Record<string, Conversation>;
	questions: Question[];
	// Every thread seen, unlike `threads`, which search and the archive replace.
	known: Record<string, Thread>;
	listed: boolean;
	// Whether this link is kept to one folder.
	here: boolean;
	notice: string | null;
};

export function initialState(): State {
	return {
		cwd: "",
		threads: [],
		conversations: {},
		questions: [],
		known: {},
		listed: false,
		here: false,
		notice: null,
	};
}

export function emptyConversation(): Conversation {
	return {
		turns: [],
		activeTurnId: null,
		olderCursor: null,
		loaded: false,
		usage: null,
		goal: null,
		pending: [],
		retrying: null,
	};
}

function turnFrom(turn: Pick<Turn, "id"> & Partial<Turn>): TurnState {
	return {
		id: turn.id,
		items: turn.items ?? [],
		status: turn.status ?? "inProgress",
		error: turn.error ?? null,
		startedAt: turn.startedAt ?? null,
		durationMs: turn.durationMs ?? null,
		plan: null,
		diff: null,
	};
}

/** The turn, created when an event mentions one this page has not heard of (it may have reconnected). */
export function turnOf(conversation: Conversation, turnId: string): TurnState {
	const found = conversation.turns.find((turn) => turn.id === turnId);
	if (found) {
		return found;
	}
	conversation.turns.push(turnFrom({ id: turnId }));
	// Read back: in the app, the store hands out its own proxy of what was pushed.
	return conversation.turns.at(-1) as TurnState;
}

function itemOf(turn: TurnState, itemId: string, create: () => ThreadItem): ThreadItem {
	const found = turn.items.find((item) => item.id === itemId);
	if (found) {
		return found;
	}
	turn.items.push(create());
	return turn.items.at(-1) as ThreadItem;
}

function upsert(turn: TurnState, item: ThreadItem): void {
	const index = turn.items.findIndex((candidate) => candidate.id === item.id);
	if (index === -1) {
		turn.items.push(item);
	} else {
		turn.items[index] = item;
	}
}

function isQuestion(event: CodexEvent): event is Question {
	return "id" in event;
}

/**
 * Applies one event to `state` in place. The state is a plain object here and a store draft in the
 * app; everything that depends on event order lives in this function and is tested without a browser.
 */
export function applyEvent(state: State, event: CodexEvent): void {
	if (isQuestion(event)) {
		if (!state.questions.some((question) => question.id === event.id)) {
			state.questions.push(event);
		}
		return;
	}
	switch (event.method) {
		case "serverRequest/resolved": {
			const index = state.questions.findIndex((question) => question.id === event.params.requestId);
			if (index !== -1) {
				state.questions.splice(index, 1);
			}
			return;
		}
		case "thread/started": {
			// Sub-agents run under their parent; the list holds the threads a person started.
			if (
				!event.params.thread.parentThreadId &&
				!state.threads.some((thread) => thread.id === event.params.thread.id)
			) {
				state.threads.unshift(event.params.thread);
			}
			if (!event.params.thread.parentThreadId) {
				state.known[event.params.thread.id] = event.params.thread;
			}
			return;
		}
		case "thread/status/changed": {
			const thread = state.threads.find((candidate) => candidate.id === event.params.threadId);
			if (thread) {
				thread.status = event.params.status;
			}
			return;
		}
		case "item/fileChange/patchUpdated": {
			const conversation = state.conversations[event.params.threadId];
			const item = conversation
				? turnOf(conversation, event.params.turnId).items.find((own) => own.id === event.params.itemId)
				: undefined;
			if (item?.type === "fileChange") {
				item.changes = event.params.changes;
			}
			return;
		}
		case "thread/name/updated": {
			const thread = state.threads.find((candidate) => candidate.id === event.params.threadId);
			if (thread) {
				thread.name = event.params.threadName ?? null;
			}
			return;
		}
		case "thread/archived": {
			const index = state.threads.findIndex((thread) => thread.id === event.params.threadId);
			if (index !== -1) {
				state.threads.splice(index, 1);
			}
			return;
		}
		case "thread/tokenUsage/updated": {
			const conversation = state.conversations[event.params.threadId];
			if (conversation) {
				conversation.usage = event.params.tokenUsage;
			}
			return;
		}
		case "thread/goal/updated": {
			const conversation = state.conversations[event.params.threadId];
			if (conversation) {
				conversation.goal = event.params.goal;
			}
			return;
		}
		case "thread/goal/cleared": {
			const conversation = state.conversations[event.params.threadId];
			if (conversation) {
				conversation.goal = null;
			}
			return;
		}
		case "turn/started": {
			const conversation = state.conversations[event.params.threadId];
			if (conversation) {
				const turn = turnOf(conversation, event.params.turn.id);
				turn.status = "inProgress";
				turn.startedAt = event.params.turn.startedAt ?? turn.startedAt;
				conversation.activeTurnId = event.params.turn.id;
			}
			const thread = state.threads.find((candidate) => candidate.id === event.params.threadId);
			if (thread) {
				thread.updatedAt = Math.floor(Date.now() / 1000);
			}
			return;
		}
		case "turn/completed": {
			const { threadId, turn } = event.params;
			const conversation = state.conversations[threadId];
			if (conversation) {
				conversation.pending = [];
				conversation.retrying = null;
				const own = turnOf(conversation, turn.id);
				own.status = turn.status;
				own.error = turn.error;
				own.durationMs = turn.durationMs;
				if (conversation.activeTurnId === turn.id) {
					conversation.activeTurnId = null;
				}
			}
			return;
		}
		case "turn/plan/updated": {
			const conversation = state.conversations[event.params.threadId];
			if (conversation) {
				turnOf(conversation, event.params.turnId).plan = event.params.plan;
			}
			return;
		}
		case "turn/diff/updated": {
			const conversation = state.conversations[event.params.threadId];
			if (conversation) {
				turnOf(conversation, event.params.turnId).diff = event.params.diff;
			}
			return;
		}
		case "item/started":
		case "item/completed": {
			const conversation = state.conversations[event.params.threadId];
			if (conversation) {
				upsert(turnOf(conversation, event.params.turnId), event.params.item);
				settlePending(conversation, event.params.item);
				conversation.retrying = null;
			}
			return;
		}
		case "item/agentMessage/delta": {
			const { threadId, turnId, itemId, delta } = event.params;
			const conversation = state.conversations[threadId];
			if (conversation) {
				const item = itemOf(turnOf(conversation, turnId), itemId, () => ({
					type: "agentMessage",
					id: itemId,
					text: "",
					phase: null,
					memoryCitation: null,
					delivery: null,
					questions: null,
				}));
				if (item.type === "agentMessage") {
					item.text += delta;
				}
			}
			return;
		}
		case "item/plan/delta": {
			const { threadId, turnId, itemId, delta } = event.params;
			const conversation = state.conversations[threadId];
			if (conversation) {
				const item = itemOf(turnOf(conversation, turnId), itemId, () => ({ type: "plan", id: itemId, text: "" }));
				if (item.type === "plan") {
					item.text += delta;
				}
			}
			return;
		}
		case "item/reasoning/summaryTextDelta": {
			const { threadId, turnId, itemId, delta, summaryIndex } = event.params;
			const conversation = state.conversations[threadId];
			if (conversation) {
				const item = itemOf(turnOf(conversation, turnId), itemId, () => ({
					type: "reasoning",
					id: itemId,
					summary: [],
					content: [],
				}));
				if (item.type === "reasoning") {
					while (item.summary.length <= summaryIndex) {
						item.summary.push("");
					}
					item.summary[summaryIndex] = `${item.summary[summaryIndex] ?? ""}${delta}`;
				}
			}
			return;
		}
		case "item/commandExecution/outputDelta": {
			const { threadId, turnId, itemId, delta } = event.params;
			const item = state.conversations[threadId]?.turns
				.find((turn) => turn.id === turnId)
				?.items.find((candidate) => candidate.id === itemId);
			if (item?.type === "commandExecution") {
				item.aggregatedOutput = `${item.aggregatedOutput ?? ""}${delta}`;
			}
			return;
		}
		case "error": {
			const conversation = state.conversations[event.params.threadId];
			if (event.params.willRetry && conversation) {
				conversation.retrying = event.params.error.message;
			} else if (!event.params.willRetry) {
				state.notice = event.params.error.message;
			}
			return;
		}
		case "warning":
			state.notice = event.params.message;
			return;
		case "configWarning":
			state.notice = event.params.summary;
			return;
		case "guardianWarning":
			state.notice = event.params.message;
			return;
		case "thread/closed": {
			const conversation = state.conversations[event.params.threadId];
			if (conversation) {
				conversation.activeTurnId = null;
				conversation.pending = [];
			}
			return;
		}
		default:
			return;
	}
}

/** Forgets what a conversation holds, for when events were missed and it has to be read again. */
export function resetConversation(conversation: Conversation): void {
	conversation.turns = [];
	conversation.activeTurnId = null;
	conversation.olderCursor = null;
	conversation.loaded = false;
}

/**
 * Merges a page of turns, newest first as the server sends them, into a conversation. Turns the page
 * does not have came from events while it was on its way, so they are newer. A snapshot can also be
 * older than an event already seen: a turn known to have finished stays finished.
 */
function textOf(input: readonly UserInput[]): string {
	return input.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(" ");
}

/** Codex has what was sent, so it no longer needs showing on its behalf. */
function settlePending(conversation: Conversation, item: ThreadItem): void {
	if (item.type !== "userMessage" || conversation.pending.length === 0) {
		return;
	}
	const byId = conversation.pending.findIndex((own) => own.clientId === item.clientId);
	const index =
		byId === -1 ? conversation.pending.findIndex((own) => textOf(own.input) === textOf(item.content)) : byId;
	if (index !== -1) {
		conversation.pending.splice(index, 1);
	}
}

const isDone = (item: ThreadItem) => "status" in item && item.status !== "inProgress";

// How much of an item has arrived. Its text only ever grows.
function received(item: ThreadItem): number {
	switch (item.type) {
		case "agentMessage":
		case "plan":
			return item.text.length;
		case "reasoning":
			return [...item.summary, ...item.content].join("").length;
		case "commandExecution":
			return item.aggregatedOutput?.length ?? 0;
		default:
			return 0;
	}
}

const ahead = (mine: ThreadItem, theirs: ThreadItem) =>
	(isDone(mine) && !isDone(theirs)) || received(mine) > received(theirs);

// A snapshot of a running turn may be older than the events that came while it travelled. One of a
// finished turn is complete, and final.
function itemsOf(own: ThreadItem[], snapshot: ThreadItem[]): ThreadItem[] {
	const known = new Set(snapshot.map((item) => item.id));
	return [
		...snapshot.map((item) => {
			const mine = own.find((candidate) => candidate.id === item.id);
			return mine && ahead(mine, item) ? mine : item;
		}),
		...own.filter((item) => !known.has(item.id)),
	];
}

export function applyTurns(
	conversation: Conversation,
	turns: Turn[],
	olderCursor: string | null,
	older: boolean,
): void {
	const page = turns.toReversed().map((turn) => {
		const own = conversation.turns.find((candidate) => candidate.id === turn.id);
		const merged = { ...turnFrom(turn), plan: own?.plan ?? null, diff: own?.diff ?? null };
		if (own && turn.status === "inProgress") {
			merged.items = itemsOf(own.items, turn.items);
		}
		if (own && own.status !== "inProgress" && turn.status === "inProgress") {
			merged.status = own.status;
			merged.error = own.error;
			merged.durationMs = own.durationMs;
		}
		return merged;
	});
	for (const item of turns.flatMap((turn) => turn.items)) {
		settlePending(conversation, item);
	}
	const known = new Set(page.map((turn) => turn.id));
	conversation.turns = [...page, ...conversation.turns.filter((turn) => !known.has(turn.id))];
	if (!older) {
		conversation.activeTurnId = conversation.turns.findLast((turn) => turn.status === "inProgress")?.id ?? null;
		conversation.loaded = true;
	}
	conversation.olderCursor = olderCursor;
}
