import { describe, expect, it } from "vitest";

import { diffTotals, parseDiff } from "../harness/diff.ts";
import { formContent, formFields } from "../harness/elicitation.ts";
import { tokenize } from "../harness/highlight.ts";
import { parseInline, parseMarkdown } from "../harness/markdown.ts";
import type { CodexEvent, Thread, ThreadItem, Turn } from "./api.ts";
import { CodexConnection, type ConnectionStatus, MessageTooLong, type SocketLike } from "./connection.ts";
import { activityCounts, displayCommand, segmentsOf } from "./segments.ts";
import { modeIdFor, parsePreferences, permissionModes } from "./settings.ts";
import { applyEvent, applyTurns, emptyConversation, initialState, resetConversation, type State } from "./state.ts";
import { accessLines, decisionOf, editedFile, stepOf } from "./translate.ts";

class FakeSocket implements SocketLike {
	sent: Record<string, unknown>[] = [];
	url: string;
	private onMessage: ((event: { data: string }) => void) | null = null;
	private onClose: (() => void) | null = null;
	constructor(url: string) {
		this.url = url;
	}
	addEventListener(type: "message" | "close", listener: (event: { data: string }) => void) {
		if (type === "message") {
			this.onMessage = listener;
		} else {
			this.onClose = listener as () => void;
		}
	}
	send(text: string) {
		this.sent.push(JSON.parse(text));
	}
	close() {
		this.onClose?.();
	}
	raw(data: string) {
		this.onMessage?.({ data });
	}
	frames(...frames: object[]) {
		this.raw(JSON.stringify(frames));
	}
}

function setup() {
	const sockets: FakeSocket[] = [];
	const timers: (() => void)[] = [];
	const statuses: ConnectionStatus[] = [];
	const hellos: { resumed: boolean }[] = [];
	const events: CodexEvent[] = [];
	const connection = new CodexConnection(
		{
			open(url) {
				const socket = new FakeSocket(url);
				sockets.push(socket);
				return socket;
			},
			setTimer(callback) {
				timers.push(callback);
				return callback;
			},
			clearTimer(timer) {
				timers.splice(timers.indexOf(timer as () => void), 1);
			},
		},
		{
			onStatus: (status) => statuses.push(status),
			onHello: (hello) => hellos.push(hello),
			onEvent: (event) => events.push(event),
		},
	);
	connection.connect();
	return { connection, sockets, timers, statuses, hellos, events };
}

const hello = (seq: number, resumed = false) => ({ t: "hello", boot: "b1", cwd: "/w", seq, resumed, pending: [] });
const warning = (seq: number) => ({ t: "event", seq, message: { method: "warning", params: { message: "w" } } });

const askToRun = (params: object) =>
	({ method: "item/commandExecution/requestApproval", id: 1, params: { threadId: "t", ...params } }) as never;

describe("connection", () => {
	it("asks for what it missed when it reconnects", () => {
		const { sockets, timers, hellos, events, statuses } = setup();
		sockets[0]?.frames(hello(3), warning(4), warning(5));
		expect(events).toHaveLength(2);
		sockets[0]?.close();
		expect(statuses.at(-1)).toBe("offline");
		timers.shift()?.();
		expect(sockets[1]?.url).toBe("/ws?boot=b1&since=5");
		sockets[1]?.frames(hello(9, true), warning(6));
		expect(hellos[1]?.resumed).toBe(true);
		sockets[1]?.close();
		timers.shift()?.();
		expect(sockets[2]?.url).toBe("/ws?boot=b1&since=6");
	});

	it("starts from the server's position when it has to reload", () => {
		const { sockets, timers } = setup();
		sockets[0]?.frames(hello(3), warning(4));
		sockets[0]?.close();
		timers.shift()?.();
		sockets[1]?.frames(hello(100, false));
		sockets[1]?.close();
		timers.shift()?.();
		expect(sockets[2]?.url).toBe("/ws?boot=b1&since=100");
	});

	it("reassembles a frame sent in parts", () => {
		const { sockets, events } = setup();
		const text = JSON.stringify([hello(0), warning(1)]);
		const middle = Math.floor(text.length / 2);
		sockets[0]?.raw(JSON.stringify({ part: 0, parts: 2, text: text.slice(0, middle) }));
		expect(events).toHaveLength(0);
		sockets[0]?.raw(JSON.stringify({ part: 1, parts: 2, text: text.slice(middle) }));
		expect(events).toHaveLength(1);
	});

	it("settles requests by id, and fails them when the connection drops", async () => {
		const { connection, sockets } = setup();
		sockets[0]?.frames(hello(0));
		const first = connection.request("thread/list", {});
		const second = connection.request("thread/list", {});
		sockets[0]?.frames({
			t: "response",
			id: sockets[0]?.sent.filter((own) => own.t === "request")[1]?.id,
			result: { data: [], nextCursor: null },
		});
		sockets[0]?.close();
		await expect(first).rejects.toThrow("Connection lost");
		await expect(second).resolves.toMatchObject({ data: [] });
	});

	it("holds requests made before the bridge said hello", () => {
		const { connection, sockets } = setup();
		void connection.request("thread/list", {});
		expect(sockets[0]?.sent).toHaveLength(0);
		sockets[0]?.frames(hello(0));
		expect(sockets[0]?.sent).toHaveLength(1);
		void connection.request("thread/list", {});
		expect(sockets[0]?.sent.filter((own) => own.t === "request")).toHaveLength(2);
	});

	it("refuses a message too long for the tunnel, and keeps the connection", async () => {
		const { connection, sockets } = setup();
		sockets[0]?.frames(hello(0));
		await expect(connection.request("thread/list", { searchTerm: "汉".repeat(400_000) })).rejects.toBeInstanceOf(
			MessageTooLong,
		);
		expect(sockets[0]?.sent).toHaveLength(0);
		expect(sockets).toHaveLength(1);
	});

	it("tests an open socket when woken, and replaces it if it stays silent", () => {
		const { connection, sockets, timers } = setup();
		sockets[0]?.frames(hello(0));
		connection.wake();
		expect(sockets[0]?.sent.at(-1)).toMatchObject({ t: "ping" });
		// Alive: the answer cancels the deadline.
		sockets[0]?.frames({ t: "pong", id: sockets[0]?.sent.at(-1)?.id });
		expect(timers).toHaveLength(0);
		// Dead: the deadline passes without an answer or a close event.
		connection.wake();
		timers.shift()?.();
		timers.shift()?.();
		expect(sockets).toHaveLength(2);
	});

	it("reconnects at once when woken, without a second socket", () => {
		const { connection, sockets, timers } = setup();
		connection.wake();
		expect(sockets).toHaveLength(1);
		sockets[0]?.close();
		connection.wake();
		expect(sockets).toHaveLength(2);
		// Only the limit on how long the new socket may take to connect.
		expect(timers).toHaveLength(1);
	});
});

function withConversation(): State {
	const state = initialState();
	state.conversations.t = emptyConversation();
	return state;
}

const event = (method: string, params: unknown) => ({ method, params }) as CodexEvent;
const message = (id: string, text: string) => ({ type: "agentMessage", id, text }) as ThreadItem;
const turn = (id: string, items: ThreadItem[], status = "completed") => ({ id, items, status }) as unknown as Turn;
const itemsOf = (state: State, turnId: string) => state.conversations.t?.turns.find((own) => own.id === turnId)?.items;

describe("state", () => {
	it("appends streaming text, even when neither the turn nor the item was announced", () => {
		const state = withConversation();
		for (const delta of ["Hel", "lo"]) {
			applyEvent(state, event("item/agentMessage/delta", { threadId: "t", turnId: "u", itemId: "i", delta }));
		}
		expect(itemsOf(state, "u")).toMatchObject([{ id: "i", text: "Hello" }]);
	});

	it("takes the completed item as the final word", () => {
		const state = withConversation();
		applyEvent(state, event("item/agentMessage/delta", { threadId: "t", turnId: "u", itemId: "i", delta: "partial" }));
		applyEvent(state, event("item/completed", { threadId: "t", turnId: "u", item: message("i", "whole") }));
		expect(itemsOf(state, "u")).toMatchObject([{ id: "i", text: "whole" }]);
	});

	it("tracks the running turn, and a newer turn is not ended by an older one", () => {
		const state = withConversation();
		applyEvent(state, event("turn/started", { threadId: "t", turn: { id: "a" } }));
		applyEvent(state, event("turn/started", { threadId: "t", turn: { id: "b" } }));
		applyEvent(
			state,
			event("turn/completed", { threadId: "t", turn: { id: "a", status: "completed", error: null, durationMs: 5 } }),
		);
		expect(state.conversations.t?.activeTurnId).toBe("b");
		applyEvent(
			state,
			event("turn/completed", {
				threadId: "t",
				turn: { id: "b", status: "failed", error: { message: "boom" }, durationMs: 9 },
			}),
		);
		expect(state.conversations.t?.activeTurnId).toBeNull();
		expect(state.conversations.t?.turns[1]).toMatchObject({
			status: "failed",
			durationMs: 9,
			error: { message: "boom" },
		});
	});

	it("ignores events for threads that are not open", () => {
		const state = initialState();
		applyEvent(state, event("item/agentMessage/delta", { threadId: "x", turnId: "u", itemId: "i", delta: "a" }));
		expect(state.conversations).toEqual({});
	});

	it("keeps every kind of question once, and removes it when resolved or cleared", () => {
		const state = initialState();
		const blocking = {
			method: "item/tool/requestUserInput",
			id: 7,
			params: { isBlocking: true },
		} as unknown as CodexEvent;
		applyEvent(state, blocking);
		applyEvent(state, blocking);
		applyEvent(state, { method: "mcpServer/elicitation/request", id: 8, params: {} } as unknown as CodexEvent);
		expect(state.questions.map((question) => question.id)).toEqual([7, 8]);
		applyEvent(state, event("serverRequest/resolved", { threadId: "t", requestId: 7 }));
		expect(state.questions.map((question) => question.id)).toEqual([8]);
	});

	it("records a turn's plan and diff, and the thread's usage and goal", () => {
		const state = withConversation();
		applyEvent(
			state,
			event("turn/plan/updated", { threadId: "t", turnId: "u", plan: [{ step: "a", status: "completed" }] }),
		);
		applyEvent(state, event("turn/diff/updated", { threadId: "t", turnId: "u", diff: "+x" }));
		applyEvent(
			state,
			event("thread/tokenUsage/updated", { threadId: "t", turnId: "u", tokenUsage: { modelContextWindow: 100 } }),
		);
		applyEvent(state, event("thread/goal/updated", { threadId: "t", goal: { objective: "ship" } }));
		expect(state.conversations.t?.turns[0]).toMatchObject({ plan: [{ step: "a" }], diff: "+x" });
		expect(state.conversations.t?.usage).toMatchObject({ modelContextWindow: 100 });
		expect(state.conversations.t?.goal).toMatchObject({ objective: "ship" });
		applyEvent(state, event("thread/goal/cleared", { threadId: "t" }));
		expect(state.conversations.t?.goal).toBeNull();
	});

	it("keeps a thread list entry's position when it starts again, and drops archived threads", () => {
		const state = initialState();
		state.threads = [{ id: "a" } as Thread, { id: "b" } as Thread];
		applyEvent(state, event("thread/started", { thread: { id: "b" } }));
		applyEvent(state, event("thread/started", { thread: { id: "c" } }));
		expect(state.threads.map((thread) => thread.id)).toEqual(["c", "a", "b"]);
		applyEvent(state, event("thread/archived", { threadId: "a" }));
		expect(state.threads.map((thread) => thread.id)).toEqual(["c", "b"]);
	});

	it("puts a page of turns in reading order, keeping newer turns and what events told it", () => {
		const state = withConversation();
		const conversation = state.conversations.t as NonNullable<State["conversations"]["t"]>;
		applyEvent(state, event("turn/plan/updated", { threadId: "t", turnId: "2", plan: [] }));
		applyEvent(state, event("turn/started", { threadId: "t", turn: { id: "3" } }));
		applyTurns(
			conversation,
			[turn("2", [message("c", "")], "inProgress"), turn("1", [message("a", "")])],
			"more",
			false,
		);
		expect(conversation.turns.map((own) => own.id)).toEqual(["1", "2", "3"]);
		expect(conversation.turns[1]?.plan).toEqual([]);
		// The newest turn still running: an event said so, and the page predates it.
		expect(conversation.activeTurnId).toBe("3");
		expect(conversation.olderCursor).toBe("more");
	});

	it("does not let a snapshot of a running turn take back what events already delivered", () => {
		const state = withConversation();
		const conversation = state.conversations.t as NonNullable<State["conversations"]["t"]>;
		applyEvent(state, event("turn/started", { threadId: "t", turn: { id: "1" } }));
		applyEvent(
			state,
			event("item/agentMessage/delta", { threadId: "t", turnId: "1", itemId: "m", delta: "newer text" }),
		);
		applyEvent(state, event("item/agentMessage/delta", { threadId: "t", turnId: "1", itemId: "only", delta: "here" }));

		applyTurns(conversation, [turn("1", [message("m", "old")], "inProgress")], null, false);
		const running = conversation.turns[0]?.items as { id: string; text: string }[];
		expect(running.map((item) => [item.id, item.text])).toEqual([
			["m", "newer text"],
			["only", "here"],
		]);

		// A snapshot further along wins, and one of a finished turn is final.
		applyTurns(conversation, [turn("1", [message("m", "newer text, and more")], "inProgress")], null, false);
		expect(conversation.turns[0]?.items[0]).toMatchObject({ text: "newer text, and more" });
		applyTurns(conversation, [turn("1", [message("m", "final")])], null, false);
		expect((conversation.turns[0]?.items ?? []).map((item) => (item as { text: string }).text)).toEqual(["final"]);
	});

	it("does not let an older snapshot reopen a finished turn", () => {
		const state = withConversation();
		const conversation = state.conversations.t as NonNullable<State["conversations"]["t"]>;
		applyEvent(state, event("turn/started", { threadId: "t", turn: { id: "1" } }));
		applyEvent(
			state,
			event("turn/completed", { threadId: "t", turn: { id: "1", status: "completed", error: null, durationMs: 7 } }),
		);
		applyTurns(conversation, [turn("1", [], "inProgress")], null, false);
		expect(conversation.activeTurnId).toBeNull();
		expect(conversation.turns[0]).toMatchObject({ status: "completed", durationMs: 7 });
	});

	it("keeps a turn running when the snapshot predates it", () => {
		const state = withConversation();
		const conversation = state.conversations.t as NonNullable<State["conversations"]["t"]>;
		applyEvent(state, event("turn/started", { threadId: "t", turn: { id: "2" } }));
		applyTurns(conversation, [turn("1", [])], null, false);
		expect(conversation.activeTurnId).toBe("2");
	});

	it("starts over after missing events, so a later page cannot land out of order", () => {
		const conversation = emptyConversation();
		applyTurns(conversation, [turn("2", []), turn("1", [])], "more", false);
		resetConversation(conversation);
		applyTurns(conversation, [turn("9", []), turn("8", [])], "older", false);
		expect(conversation.turns.map((own) => own.id)).toEqual(["8", "9"]);
		expect(conversation.olderCursor).toBe("older");
	});

	it("leaves sub-agents out of the thread list", () => {
		const state = initialState();
		applyEvent(state, event("thread/started", { thread: { id: "child", parentThreadId: "p" } }));
		expect(state.threads).toEqual([]);
	});

	it("puts older turns in front, without duplicates", () => {
		const conversation = emptyConversation();
		applyTurns(conversation, [turn("2", [])], "more", false);
		applyTurns(conversation, [turn("2", []), turn("1", [])], null, true);
		expect(conversation.turns.map((own) => own.id)).toEqual(["1", "2"]);
		expect(conversation.olderCursor).toBeNull();
	});
});

const command = (id: string, type: string, extra = {}) =>
	({
		type: "commandExecution",
		id,
		source: "agent",
		status: "completed",
		command: "x",
		commandActions: [{ type, path: `/f/${id}`, command: "x" }],
		...extra,
	}) as ThreadItem;

describe("segments", () => {
	it("folds looking around together and leaves real work on its own", () => {
		const segments = segmentsOf([
			message("m0", ""),
			{ type: "reasoning", id: "r", summary: [], content: [] },
			command("c1", "read"),
			command("c2", "search"),
			command("c3", "unknown"),
			command("c4", "read"),
			command("c5", "read", { status: "failed" }),
			message("m1", ""),
		]);
		expect(segments.map((segment) => segment.kind)).toEqual(["item", "activity", "item", "activity", "item", "item"]);
		expect(segments[1]?.kind === "activity" && activityCounts(segments[1].items)).toEqual({
			files: 1,
			searches: 1,
			lists: 0,
		});
	});

	it("shows what a person typed, not the login shell around it", () => {
		expect(displayCommand("/bin/zsh -lc 'pnpm test'")).toBe("pnpm test");
		expect(displayCommand('bash -lc "ls -a"')).toBe("ls -a");
		expect(displayCommand(String.raw`/bin/zsh -lc 'echo '\''hi'\'''`)).toBe("echo 'hi'");
		expect(displayCommand("git status")).toBe("git status");
	});
});

const profile = (id: string, allowed = true) => ({ id, description: null, allowed });

describe("permission modes", () => {
	it("offers what this Codex allows, then its own profiles", () => {
		const modes = permissionModes([
			profile(":read-only"),
			profile(":workspace"),
			profile(":danger-full-access", false),
			profile("team"),
			profile("banned", false),
		]);
		expect(modes.map((mode) => mode.id)).toEqual(["read-only", "ask", "auto-review", "team"]);
		expect(modes[2]).toMatchObject({ profile: ":workspace", approvalsReviewer: "auto_review" });
	});

	it("survives damaged preferences", () => {
		expect(parsePreferences("{oops").modes).toEqual({});
		expect(parsePreferences(JSON.stringify({ fast: true }))).toMatchObject({ fast: true, modes: {} });
		expect(parsePreferences(JSON.stringify({ modes: "full" })).modes).toEqual({});
	});
});

describe("what a permission request asks for", () => {
	it("spells out every kind of path", () => {
		expect(
			accessLines({
				network: { enabled: true },
				fileSystem: {
					entries: [
						{ access: "write", path: { type: "special", value: { kind: "root" } } },
						{ access: "deny", path: { type: "glob_pattern", pattern: "**/.env" } },
						{ access: "read", path: { type: "path", path: "/a" } },
					],
					read: null,
					write: ["/legacy"],
				},
			}),
		).toEqual([
			{ what: "network" },
			{ what: "write", target: "/" },
			{ what: "deny", target: "**/.env" },
			{ what: "read", target: "/a" },
			{ what: "write", target: "/legacy" },
		]);
	});
});

describe("translation to the interface's concepts", () => {
	it("tells looking around from real work", () => {
		expect(stepOf(command("c", "read"))).toMatchObject({ kind: "look", actions: [{ verb: "read" }] });
		expect(stepOf(command("c", "unknown", { command: "/bin/zsh -lc 'pnpm test'" }))).toMatchObject({
			kind: "command",
			command: "pnpm test",
		});
		expect(stepOf({ type: "reasoning", id: "r", summary: [], content: [] })).toBeNull();
	});

	it("carries an asynchronous question with its message, and only then", () => {
		const asked = {
			type: "agentMessage",
			id: "m",
			text: "t",
			delivery: "async",
			questions: [{ title: "Next?", options: ["Yes"] }],
		} as unknown as ThreadItem;
		expect(stepOf(asked)).toMatchObject({ asks: [{ title: "Next?", options: ["Yes"] }] });
		expect(stepOf(message("m", "t"))).toMatchObject({ asks: [] });
	});

	it("offers what Codex says a command accepts, and otherwise the usual answers", () => {
		const usual = decisionOf(askToRun({ proposedExecpolicyAmendment: ["pnpm", "test"] }), false);
		expect(usual.kind === "command" && usual.choices.map((choice) => [choice.key, choice.detail])).toEqual([
			["allow", undefined],
			["allowSession", undefined],
			["allowRule", "pnpm test"],
			["decline", undefined],
			["stop", undefined],
		]);
		const listed = decisionOf(askToRun({ availableDecisions: ["accept", "decline"] }), false);
		expect(listed.kind === "command" && listed.choices.map((choice) => choice.answer)).toEqual([
			{ decision: "accept" },
			{ decision: "decline" },
		]);
	});

	it("answers each kind of question in the shape it asks for", () => {
		const input = decisionOf(
			{
				method: "item/tool/requestUserInput",
				id: 2,
				params: {
					threadId: "t",
					isBlocking: false,
					questions: [
						{ id: "q", question: "?", isOther: false, isSecret: false, options: [{ label: "A", description: "" }] },
					],
				},
			} as never,
			false,
		);
		expect(input.kind === "question" && input.blocking).toBe(false);
		expect(input.kind === "question" && input.answer({ q: "A" })).toEqual({ answers: { q: { answers: ["A"] } } });
		const access = decisionOf(
			{
				method: "item/permissions/requestApproval",
				id: 3,
				params: { threadId: "t", permissions: { network: { enabled: true } } },
			} as never,
			false,
		);
		expect(access.kind === "access" && access.choices[1]?.answer).toEqual({
			permissions: { network: { enabled: true } },
			scope: "session",
		});
		const link = decisionOf(
			{
				method: "mcpServer/elicitation/request",
				id: 4,
				params: { threadId: "t", serverName: "s", mode: "url", url: "https://x", message: "m" },
			} as never,
			false,
		);
		expect(link).toMatchObject({ kind: "link", url: "https://x", done: { action: "accept", content: null } });
	});
});

describe("MCP forms", () => {
	const fields = formFields({
		required: ["repo"],
		properties: {
			repo: { type: "string", title: "Repository" },
			mail: { type: "string", format: "email" },
			pick: { type: "string", oneOf: [{ const: "a", title: "Option A" }] },
			old: { type: "string", enum: ["x"], enumNames: ["Name X"], default: "x" },
			many: {
				type: "array",
				items: {
					anyOf: [
						{ const: "1", title: "One" },
						{ const: "2", title: "Two" },
					],
				},
			},
			count: { type: "integer" },
			flag: { type: "boolean" },
		},
	});

	it("reads every kind of field", () => {
		expect(fields.map((field) => field.kind)).toEqual([
			"text",
			"text",
			"select",
			"select",
			"multi",
			"number",
			"boolean",
		]);
		expect(fields[0]).toMatchObject({ label: "Repository", required: true });
		expect(fields[1]?.inputType).toBe("email");
		expect(fields[2]?.options).toEqual([{ value: "a", label: "Option A" }]);
		expect(fields[3]).toMatchObject({ options: [{ value: "x", label: "Name X" }], defaultValue: "x" });
	});

	it("answers each field in the type it asks for", () => {
		const data = new Map<string, string[]>([
			["repo", ["a/b"]],
			["pick", ["a"]],
			["many", ["1", "2"]],
			["count", ["3"]],
			["flag", ["on"]],
		]);
		const content = formContent(fields, {
			get: (name) => data.get(name)?.[0] ?? null,
			getAll: (name) => data.get(name) ?? [],
		});
		expect(content).toEqual({ repo: "a/b", pick: "a", many: ["1", "2"], count: 3, flag: true });
	});
});

describe("diff", () => {
	const text =
		"diff --git a/a.ts b/a.ts\nindex 1..2 100644\n--- a/a.ts\n+++ b/a.ts\n@@ -10,2 +10,2 @@ fn\n same\n-old\n+new\n+more\ndiff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ b/b.ts\n@@ -1 +1 @@\n-x\n+y\n";

	it("splits files, counts changes and numbers lines", () => {
		const files = parseDiff(text);
		expect(files.map((file) => [file.path, file.added, file.removed])).toEqual([
			["a.ts", 2, 1],
			["b.ts", 1, 1],
		]);
		expect(diffTotals(files)).toEqual({ added: 3, removed: 2 });
		expect(files[0]?.lines[1]).toMatchObject({ kind: "context", oldLine: 10, newLine: 10 });
		expect(files[0]?.lines[3]).toMatchObject({ kind: "add", newLine: 11, text: "new" });
	});

	it("treats a bare patch as one file", () => {
		expect(parseDiff("+a\n+b\n", "new.ts")).toMatchObject([{ path: "new.ts", added: 2 }]);
	});
});

describe("highlight", () => {
	it("marks the parts of a line without losing a character", () => {
		const code = 'const a = "x"; // note\nreturn 12;';
		const tokens = tokenize(code, "ts");
		expect(tokens.map((token) => token.text).join("")).toBe(code);
		expect(tokens.filter((token) => token.kind !== "plain").map((token) => token.kind)).toEqual([
			"keyword",
			"string",
			"comment",
			"keyword",
			"number",
		]);
	});

	it("knows hash comments by language", () => {
		expect(tokenize("# hi", "sh")[0]?.kind).toBe("comment");
		expect(tokenize("# hi", "ts")[0]?.kind).toBe("plain");
	});
});

describe("markdown", () => {
	it("parses the blocks agents write", () => {
		const blocks = parseMarkdown(
			"# Title\n\nSome `code`, **bold** and *soft*.\nSame paragraph.\n\n- one\n- two\n\n3. third\n\n> quoted\n\n---\n\n```ts\nconst a = 1;\n```",
		);
		expect(blocks.map((block) => block.kind)).toEqual([
			"heading",
			"paragraph",
			"list",
			"list",
			"quote",
			"rule",
			"code",
		]);
		expect(blocks[6]).toEqual({ kind: "code", language: "ts", text: "const a = 1;" });
		expect(blocks[3]).toMatchObject({ ordered: true, start: 3 });
	});

	it("parses tables and nested lists", () => {
		const [table] = parseMarkdown("| A | B |\n| --- | --- |\n| 1 | `2` |");
		expect(table).toMatchObject({ kind: "table", rows: [[[{ text: "1" }], [{ kind: "code", text: "2" }]]] });
		const [list] = parseMarkdown("- a\n  - nested\n- b");
		expect(list?.kind === "list" && list.items.map((item) => item.children.length)).toEqual([1, 0]);
	});

	it("keeps a list together across blank lines", () => {
		expect(parseMarkdown("1. a\n\n2. b")).toHaveLength(1);
	});

	it("treats an unclosed fence as code while a message streams", () => {
		expect(parseMarkdown("```\nstill going")).toEqual([{ kind: "code", language: "", text: "still going" }]);
	});

	it("only links to http(s)", () => {
		expect(parseInline("[a](https://example.com)")).toEqual([{ kind: "link", text: "a", href: "https://example.com" }]);
		expect(parseInline("[a](javascript:alert(1))")).toEqual([{ kind: "text", text: "[a](javascript:alert(1))" }]);
	});

	it("keeps markup as text", () => {
		expect(parseMarkdown("<img src=x onerror=alert(1)>")).toEqual([
			{ kind: "paragraph", inline: [{ kind: "text", text: "<img src=x onerror=alert(1)>" }] },
		]);
	});
});

describe("what the review of real Codex traffic found", () => {
	it("shows a new file as added lines, since Codex sends its whole content", () => {
		const { path, diff } = editedFile({ path: "/a/new.txt", kind: { type: "add" }, diff: "alpha\nbeta\n" });
		const [file] = parseDiff(diff, path);
		expect(file?.path).toBe("/a/new.txt");
		expect([file?.added, file?.removed]).toEqual([2, 0]);
		expect(file?.lines.filter((line) => line.kind === "add").map((line) => [line.newLine, line.text])).toEqual([
			[1, "alpha"],
			[2, "beta"],
		]);
	});

	it("shows a deleted file as removed lines", () => {
		const { diff } = editedFile({ path: "/a/old.txt", kind: { type: "delete" }, diff: "gone\n" });
		expect(parseDiff(diff, "/a/old.txt")[0]?.removed).toBe(1);
	});

	it("names the target of a moved file and keeps the note out of the diff", () => {
		const { path, diff } = editedFile({
			path: "/a/from.ts",
			kind: { type: "update", move_path: "/a/to.ts" },
			diff: "@@ -1 +1 @@\n-a\n+b\n\nMoved to: /a/to.ts\n",
		});
		expect(path).toBe("/a/from.ts → /a/to.ts");
		expect(parseDiff(diff, path)[0]?.lines.map((line) => line.kind)).toEqual(["hunk", "remove", "add"]);
	});

	it("counts a removed line that looks like a file header", () => {
		const [file] = parseDiff("@@ -1,2 +1,2 @@\n--- comment\n+++ other\n", "a.sql");
		expect([file?.path, file?.added, file?.removed]).toEqual(["a.sql", 1, 1]);
	});

	it("takes the new diff when an approval's patch is updated", () => {
		const state = initialState();
		state.conversations.t = emptyConversation();
		const changes = [{ path: "a", kind: { type: "add" }, diff: "x" }];
		applyEvent(state, {
			method: "item/started",
			params: {
				threadId: "t",
				turnId: "u",
				startedAtMs: 0,
				item: { type: "fileChange", id: "i", changes: [], status: "inProgress" },
			},
		} as never);
		applyEvent(state, {
			method: "item/fileChange/patchUpdated",
			params: { threadId: "t", turnId: "u", itemId: "i", changes },
		} as never);
		expect(state.conversations.t?.turns[0]?.items[0]).toMatchObject({ changes });
	});

	it("does not repeat a mention that the text already contains", () => {
		const step = stepOf({
			type: "userMessage",
			id: "m",
			clientId: null,
			content: [
				{ type: "text", text: "see @a.ts", text_elements: [] },
				{ type: "mention", name: "a.ts", path: "/a.ts" },
			],
		} as never);
		expect(step?.kind === "request" && step.text).toBe("see @a.ts");
	});

	it("does not call a blocking network rule an allowance", () => {
		const decision = decisionOf(
			askToRun({
				availableDecisions: [
					{ applyNetworkPolicyAmendment: { network_policy_amendment: { host: "x.test", action: "deny" } } },
				],
			}),
			false,
		);
		expect(decision.kind === "command" && decision.choices.map((choice) => [choice.key, choice.detail])).toEqual([
			["denyRule", "x.test"],
		]);
	});

	it("lets a person type an answer when a question has an empty option list", () => {
		const decision = decisionOf(
			{
				method: "item/tool/requestUserInput",
				id: 2,
				params: {
					threadId: "t",
					isBlocking: true,
					questions: [{ id: "q", question: "Name?", options: [], isOther: false, isSecret: false }],
				},
			} as never,
			false,
		);
		expect(decision.kind === "question" && decision.questions[0]?.allowOther).toBe(true);
	});

	it("shows what a user verification asks instead of an empty form", () => {
		const decision = decisionOf(
			{
				method: "mcpServer/elicitation/request",
				id: 3,
				params: {
					threadId: "t",
					serverName: "s",
					mode: "openai/userVerification",
					title: "Verify",
					description: "Are you there",
					challenge: "abc",
				},
			} as never,
			false,
		);
		expect(decision.reason).toContain("Are you there");
		expect(decision.reason).toContain("abc");
	});
});

describe("permission modes", () => {
	it("does not carry full access into another folder", () => {
		const preferences = parsePreferences(JSON.stringify({ modes: { "/scratch": "full" } }));
		expect(modeIdFor(preferences, "/scratch")).toBe("full");
		expect(modeIdFor(preferences, "/important")).toBe("ask");
	});

	it("does not take a choice from before modes were per folder", () => {
		expect(modeIdFor(parsePreferences(JSON.stringify({ mode: "full" })), "/any")).toBe("ask");
	});
});

const userMessage = (clientId: string | null, text: string) => ({
	method: "item/started",
	params: {
		threadId: "t",
		turnId: "u",
		startedAtMs: 0,
		item: { type: "userMessage", id: "m", clientId, content: [{ type: "text", text, text_elements: [] }] },
	},
});
const textInput = (text: string) => [{ type: "text" as const, text, text_elements: [] }];

describe("messages on their way", () => {
	it("stops showing a message once Codex reports it, by its id", () => {
		const state = initialState();
		const conversation = emptyConversation();
		state.conversations.t = conversation;
		conversation.pending = [
			{ clientId: "a", input: textInput("same") },
			{ clientId: "b", input: textInput("same") },
		];
		applyEvent(state, userMessage("b", "same") as never);
		expect(conversation.pending.map((own) => own.clientId)).toEqual(["a"]);
	});

	it("falls back on the text when Codex does not echo the id", () => {
		const state = initialState();
		const conversation = emptyConversation();
		state.conversations.t = conversation;
		conversation.pending = [{ clientId: "a", input: textInput("hello") }];
		applyEvent(state, userMessage(null, "hello") as never);
		expect(conversation.pending).toEqual([]);
	});

	it("cannot stay on screen once the turn is over", () => {
		const state = initialState();
		const conversation = emptyConversation();
		state.conversations.t = conversation;
		conversation.pending = [{ clientId: "a", input: textInput("lost") }];
		applyEvent(state, {
			method: "turn/completed",
			params: { threadId: "t", turn: { id: "u", status: "completed", items: [], error: null } },
		} as never);
		expect(conversation.pending).toEqual([]);
	});

	it("clears when a reload finds it in the history", () => {
		const conversation = emptyConversation();
		conversation.pending = [{ clientId: "a", input: textInput("hello") }];
		applyTurns(
			conversation,
			[{ id: "u", status: "completed", error: null, items: [userMessage("a", "hello").params.item] }] as never,
			null,
			false,
		);
		expect(conversation.pending).toEqual([]);
	});
});

function connected() {
	const sockets: FakeSocket[] = [];
	const timers: { callback: () => void; ms: number; cleared: boolean }[] = [];
	const connection = new CodexConnection(
		{
			open(url) {
				const socket = new FakeSocket(url);
				sockets.push(socket);
				return socket;
			},
			setTimer(callback, ms) {
				const timer = { callback, ms, cleared: false };
				timers.push(timer);
				return timer;
			},
			clearTimer(timer) {
				(timer as { cleared: boolean }).cleared = true;
			},
		},
		{ onStatus: () => undefined, onHello: () => undefined, onEvent: () => undefined },
	);
	connection.connect();
	return { connection, sockets, timers };
}

describe("a connection that may be dead", () => {
	it("gives up on a socket that never finishes connecting", () => {
		const { sockets, timers } = connected();
		timers[0]?.callback();
		// It is treated as gone: a retry is scheduled, for a new socket.
		timers.at(-1)?.callback();
		expect(sockets).toHaveLength(2);
	});

	it("treats any message as a sign of life", () => {
		const { connection, sockets, timers } = connected();
		sockets[0]?.frames({ t: "hello", boot: "b", cwd: "/", here: false, seq: 0, resumed: false, pending: [] });
		void connection.request("thread/list", {}).catch(() => undefined);
		const probe = timers.at(-1);
		sockets[0]?.frames({ t: "event", seq: 1, message: { method: "warning", params: {} } });
		expect(probe?.cleared).toBe(true);
	});

	it("stops trying for good when told the session is over", () => {
		const { connection, timers } = connected();
		connection.stop();
		const before = timers.length;
		connection.connect();
		expect(timers.length).toBe(before);
	});
});
