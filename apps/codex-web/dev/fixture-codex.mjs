#!/usr/bin/env node
// A scripted `codex app-server` for working on the interface without spending model quota: it speaks
// the same protocol and produces every kind of item, including every kind of question for the user.
// Use it with `pnpm -F @hostc/codex-web fixture`.
import { createInterface } from "node:readline";

// A slow link, to see what the page shows while it waits: FIXTURE_LATENCY_MS=800.
const LATENCY = Number(process.env.FIXTURE_LATENCY_MS ?? 0);
const send = (message) => {
	const line = `${JSON.stringify(message)}\n`;
	if (LATENCY > 0) {
		setTimeout(() => process.stdout.write(line), LATENCY);
	} else {
		process.stdout.write(line);
	}
};
const note = (method, params) => send({ method, params });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => Math.floor(Date.now() / 1000);
const cwd = process.cwd();
const OTHER_FOLDER = `${cwd.slice(0, cwd.lastIndexOf("/"))}/api-server`;
let nextId = 1;
const id = (prefix) => `${prefix}-${nextId++}`;

const thread = (threadId, preview, name = null) => ({
	id: threadId,
	sessionId: threadId,
	forkedFromId: null,
	parentThreadId: null,
	preview,
	ephemeral: false,
	section: null,
	sectionEnteredAt: null,
	projectId: null,
	historyMode: "paginated",
	modelProvider: "openai",
	model: "gpt-6.1-sol",
	reasoningEffort: "medium",
	createdAt: now() - 7200,
	updatedAt: now() - 600,
	recencyAt: now() - 600,
	status: { type: "idle" },
	path: null,
	cwd,
	cliVersion: "0.166.0",
	originator: "hostc",
	source: "appServer",
	threadSource: null,
	agentNickname: null,
	agentRole: null,
	gitInfo: { sha: "abc1234", branch: "feat/login", originUrl: null },
	name,
	turns: [],
});

const DIFF = `diff --git a/src/login.ts b/src/login.ts
index 1a2b3c4..5d6e7f8 100644
--- a/src/login.ts
+++ b/src/login.ts
@@ -12,7 +12,9 @@ export async function login(email: string) {
   const user = await findUser(email);
-  if (!user) throw new Error("no user");
+  if (!user) {
+    return { ok: false, reason: "unknown-email" };
+  }
   return createSession(user);
 }
`;

const MARKDOWN = `I found the problem. \`login()\` throws when the email is unknown, so the form shows a **generic error** instead of a useful message.

## What changed

1. \`login()\` now returns a result instead of throwing
2. The form reads \`reason\` and shows a [specific message](https://example.com/docs)
3. Added a test for the unknown email case

> Sessions created before this change keep working.

| File | Change |
| --- | --- |
| \`src/login.ts\` | return a result |
| \`src/form.tsx\` | show the reason |

\`\`\`ts
const result = await login(email);
if (!result.ok) {
  // Tell the person what went wrong.
  setError(messages[result.reason]);
}
\`\`\`

All 42 tests pass.`;

const threads = [
	thread("t-login", "Fix the error on the login form", "Fix login error"),
	thread("t-docs", "Update the README for the new CLI flags"),
	thread("t-flaky", "Why is the websocket test flaky on CI?"),
	thread("t-long", "A very long conversation"),
	{ ...thread("t-api", "Add rate limiting to the API"), cwd: OTHER_FOLDER, gitInfo: null },
	{ ...thread("t-busy", "Open in a terminal somewhere else"), cwd: OTHER_FOLDER, gitInfo: null },
	{ ...thread("t-cache", "Why are the cache hits so low?"), cwd: OTHER_FOLDER, gitInfo: null },
];
threads[2].updatedAt = now() - 90000;
threads[1].updatedAt = now() - 7200;
const conversations = new Map();
const goals = new Map();
setInterval(() => {
	for (const goal of goals.values()) {
		if (goal.status === "active") {
			goal.tokensUsed += 4000;
			goal.timeUsedSeconds += 1;
			note("thread/goal/updated", { threadId: goal.threadId, turnId: null, goal });
		}
	}
}, 1000);
// The other Codex holding t-busy closes after a while.
let released = false;
setTimeout(() => {
	released = true;
}, 8000);

function history(threadId) {
	if (!conversations.has(threadId)) {
		conversations.set(
			threadId,
			threadId === "t-long"
				? Array.from({ length: 40 }, () => completedTurn())
				: threadId === "t-login" || threadId === "t-busy"
					? [completedTurn()]
					: [],
		);
	}
	return conversations.get(threadId);
}

function items(turnId) {
	const started = Date.now() - 42000;
	return [
		{
			type: "userMessage",
			id: `${turnId}-u`,
			clientId: null,
			content: [
				{
					type: "text",
					text: "The login form shows a generic error for unknown emails. Fix it and add a test.",
					text_elements: [],
				},
			],
		},
		{
			type: "reasoning",
			id: `${turnId}-r`,
			summary: [
				"**Looking at the login flow**\n\nI should read how the form handles errors before changing `login()`.",
			],
			content: [],
		},
		...["src/login.ts", "src/form.tsx", "src/login.test.ts"].map((file, index) => ({
			type: "commandExecution",
			id: `${turnId}-c${index}`,
			pluginId: null,
			scriptPath: null,
			command: `/bin/zsh -lc 'sed -n 1,80p ${file}'`,
			cwd,
			processId: null,
			source: "agent",
			status: "completed",
			commandActions: [
				{ type: "read", command: `sed -n 1,80p ${file}`, name: file.split("/").at(-1), path: `${cwd}/${file}` },
			],
			aggregatedOutput: "export async function login(email: string) {\n  ...\n}\n",
			exitCode: 0,
			durationMs: 40,
		})),
		{
			type: "commandExecution",
			id: `${turnId}-s`,
			pluginId: null,
			scriptPath: null,
			command: "/bin/zsh -lc 'rg -n \"login\\(\" src'",
			cwd,
			processId: null,
			source: "agent",
			status: "completed",
			commandActions: [{ type: "search", command: 'rg -n "login(" src', query: "login(", path: "src" }],
			aggregatedOutput: "src/form.tsx:18:  await login(email)\n",
			exitCode: 0,
			durationMs: 22,
		},
		{
			type: "fileChange",
			id: `${turnId}-f`,
			status: "completed",
			changes: [
				{ path: `${cwd}/src/login.ts`, kind: { type: "update", move_path: null }, diff: DIFF },
				{
					path: `${cwd}/src/login.test.ts`,
					kind: { type: "add" },
					diff: "import { login } from './login';\n\nit('reports an unknown email', async () => {\n  expect(await login('x@y.z')).toEqual({ ok: false, reason: 'unknown-email' });\n});\n",
				},
			],
		},
		{
			type: "commandExecution",
			id: `${turnId}-t`,
			pluginId: null,
			scriptPath: null,
			command: "/bin/zsh -lc 'pnpm test'",
			cwd,
			processId: null,
			source: "agent",
			status: "completed",
			commandActions: [{ type: "unknown", command: "pnpm test" }],
			aggregatedOutput: "RUN  v5.0.5\n\n Test Files  8 passed (8)\n      Tests  42 passed (42)\n",
			exitCode: 0,
			durationMs: 3210,
		},
		{
			type: "commandExecution",
			id: `${turnId}-e`,
			pluginId: null,
			scriptPath: null,
			command: "/bin/zsh -lc 'pnpm lint --fix'",
			cwd,
			processId: null,
			source: "agent",
			status: "failed",
			commandActions: [{ type: "unknown", command: "pnpm lint --fix" }],
			aggregatedOutput: "error: unknown option --fix\n",
			exitCode: 1,
			durationMs: 310,
		},
		{
			type: "agentMessage",
			id: `${turnId}-a`,
			text: MARKDOWN,
			phase: null,
			memoryCitation: null,
			delivery: null,
			questions: null,
			startedAtMs: started,
		},
	];
}

function completedTurn() {
	const turnId = id("turn");
	return {
		id: turnId,
		rootTurnId: turnId,
		items: items(turnId),
		itemsView: "full",
		status: "completed",
		error: null,
		startedAt: now() - 700,
		completedAt: now() - 658,
		durationMs: 42000,
	};
}

const usage = (threadId, turnId, used) =>
	note("thread/tokenUsage/updated", {
		threadId,
		turnId,
		tokenUsage: {
			total: {
				totalTokens: used,
				inputTokens: used - 900,
				cachedInputTokens: 2000,
				cacheWriteInputTokens: 0,
				outputTokens: 900,
				reasoningOutputTokens: 120,
			},
			last: {
				totalTokens: used,
				inputTokens: used - 900,
				cachedInputTokens: 2000,
				cacheWriteInputTokens: 0,
				outputTokens: 900,
				reasoningOutputTokens: 120,
			},
			modelContextWindow: 258000,
		},
	});

const waiting = new Map();
const ask = (method, params) =>
	new Promise((resolve) => {
		const requestId = nextId++;
		waiting.set(requestId, resolve);
		send({ id: requestId, method, params });
	});

async function run(threadId, text, input = [{ type: "text", text, text_elements: [] }], turnId = id("turn")) {
	const turn = {
		id: turnId,
		rootTurnId: turnId,
		items: [],
		itemsView: "notLoaded",
		status: "inProgress",
		error: null,
		startedAt: now(),
		completedAt: null,
		durationMs: null,
	};
	const stored = { ...turn, itemsView: "full", items: [] };
	history(threadId).push(stored);
	const emit = (item) => {
		stored.items.push(item);
		note("item/started", { item, threadId, turnId, startedAtMs: Date.now() });
	};
	const finish = (item) => {
		const index = stored.items.findIndex((own) => own.id === item.id);
		stored.items[index] = item;
		note("item/completed", { item, threadId, turnId, completedAtMs: Date.now() });
	};
	note("turn/started", { threadId, turn });
	note("thread/status/changed", { threadId, status: { type: "active", activeFlags: [] } });
	const user = {
		type: "userMessage",
		id: id("user"),
		clientId: null,
		content: input,
	};
	emit(user);
	finish(user);
	await sleep(300);
	note("turn/plan/updated", {
		threadId,
		turnId,
		explanation: null,
		plan: [
			{ step: "Read the code", status: "completed" },
			{ step: "Make the change", status: "inProgress" },
			{ step: "Run the tests", status: "pending" },
		],
	});

	const reasoningId = id("reasoning");
	for (const delta of ["**Planning", " the change**\n\n", "I'll read the file first, ", "then edit it."]) {
		note("item/reasoning/summaryTextDelta", { threadId, turnId, itemId: reasoningId, delta, summaryIndex: 0 });
		await sleep(90);
	}
	const read = {
		type: "commandExecution",
		id: id("cmd"),
		pluginId: null,
		scriptPath: null,
		command: "/bin/zsh -lc 'sed -n 1,40p src/login.ts'",
		cwd,
		processId: null,
		source: "agent",
		status: "inProgress",
		commandActions: [
			{ type: "read", command: "sed -n 1,40p src/login.ts", name: "login.ts", path: `${cwd}/src/login.ts` },
		],
		aggregatedOutput: null,
		exitCode: null,
		durationMs: null,
	};
	emit(read);
	await sleep(400);
	finish({
		...read,
		status: "completed",
		aggregatedOutput: "export function login() {}\n",
		exitCode: 0,
		durationMs: 40,
	});

	const lower = text.toLowerCase();
	if (lower.includes("stress")) {
		for (let index = 0; index < 60; index++) {
			const done = {
				type: "commandExecution",
				id: id("cmd"),
				pluginId: null,
				scriptPath: null,
				command: `/bin/zsh -lc 'pnpm test --filter package-${index}'`,
				cwd,
				processId: null,
				source: "agent",
				status: "completed",
				commandActions: [{ type: "unknown", command: `pnpm test --filter package-${index}` }],
				aggregatedOutput: "ok   a test with a fairly long name in it\n".repeat(50),
				exitCode: 0,
				durationMs: 1200,
			};
			emit(done);
			finish(done);
		}
		const bigDiff = Array.from({ length: 300 }, (_, line) =>
			line % 3 === 0 ? `+added line ${line} const value = compute(${line});` : ` context line ${line} return value;`,
		).join("\n");
		const edit = {
			type: "fileChange",
			id: id("edit"),
			status: "completed",
			changes: Array.from({ length: 5 }, (_, file) => ({
				path: `${cwd}/src/big-${file}.ts`,
				kind: { type: "update", move_path: null },
				diff: `@@ -1,300 +1,300 @@\n${bigDiff}`,
			})),
		};
		emit(edit);
		finish(edit);
	}
	if (lower.includes("approve") || lower.includes("run")) {
		const command = {
			type: "commandExecution",
			id: id("cmd"),
			pluginId: null,
			scriptPath: null,
			command: "/bin/zsh -lc 'pnpm test --coverage'",
			cwd,
			processId: null,
			source: "agent",
			status: "inProgress",
			commandActions: [{ type: "unknown", command: "pnpm test --coverage" }],
			aggregatedOutput: null,
			exitCode: null,
			durationMs: null,
		};
		emit(command);
		const answer = await ask("item/commandExecution/requestApproval", {
			kind: "command",
			threadId,
			turnId,
			itemId: command.id,
			startedAtMs: Date.now(),
			environmentId: null,
			reason: "Do you want to run the test suite with coverage?",
			command: command.command,
			cwd,
			commandActions: command.commandActions,
			proposedExecpolicyAmendment: ["pnpm", "test"],
		});
		const declined = answer?.result?.decision === "decline";
		if (!declined)
			for (const delta of ["RUN v5.0.5\n", " Tests  42 passed\n"]) {
				note("item/commandExecution/outputDelta", { threadId, turnId, itemId: command.id, delta });
				await sleep(250);
			}
		finish({
			...command,
			status: declined ? "declined" : "completed",
			aggregatedOutput: declined ? null : "RUN v5.0.5\n Tests  42 passed\n",
			exitCode: declined ? null : 0,
			durationMs: declined ? null : 500,
		});
	}
	if (lower.includes("edit") || lower.includes("file")) {
		const change = {
			type: "fileChange",
			id: id("file"),
			status: "inProgress",
			changes: [{ path: `${cwd}/src/login.ts`, kind: { type: "update", move_path: null }, diff: DIFF }],
		};
		emit(change);
		const answer = await ask("item/fileChange/requestApproval", {
			threadId,
			turnId,
			itemId: change.id,
			startedAtMs: Date.now(),
			reason: "Change how login reports errors.",
		});
		finish({ ...change, status: answer?.result?.decision === "decline" ? "declined" : "completed" });
		note("turn/diff/updated", { threadId, turnId, diff: DIFF });
	}
	if ((lower.includes("question") || lower.includes("ask")) && !lower.includes("background")) {
		await ask("item/tool/requestUserInput", {
			threadId,
			turnId,
			itemId: id("input"),
			isBlocking: true,
			autoResolutionMs: null,
			questions: [
				{
					id: "q1",
					header: "Test runner",
					question: "Which test runner should I use?",
					isOther: true,
					isSecret: false,
					options: [
						{ label: "Vitest (Recommended)", description: "Already configured" },
						{ label: "Jest", description: "Needs a new config" },
					],
				},
				{
					id: "q2",
					header: "API key",
					question: "Paste the staging API key",
					isOther: false,
					isSecret: true,
					options: null,
				},
			],
		});
	}
	if (lower.includes("background")) {
		void ask("item/tool/requestUserInput", {
			threadId,
			turnId,
			itemId: id("input"),
			isBlocking: false,
			autoResolutionMs: null,
			questions: [
				{
					id: "q1",
					header: "Style",
					question: "Prefer tabs or spaces? I'll keep going meanwhile.",
					isOther: false,
					isSecret: false,
					options: [
						{ label: "Tabs", description: "" },
						{ label: "Spaces", description: "" },
					],
				},
			],
		});
	}
	if (lower.includes("plan")) {
		const plan = {
			type: "plan",
			id: id("plan"),
			text: "## Plan\n\n1. Return a result from `login()`\n2. Show the reason in the form\n3. Add a test for the unknown email",
		};
		emit(plan);
		finish(plan);
	}
	if (lower.includes("async")) {
		const asked = {
			type: "agentMessage",
			id: id("agent"),
			text: "I finished the login fix. Should I also update the signup form the same way?",
			phase: "final_answer",
			memoryCitation: null,
			delivery: "async",
			questions: [
				{ title: "Update signup too?", options: ["Yes, update it", "No, leave it"] },
				{ title: "Open a PR?", options: null },
			],
		};
		emit(asked);
		finish(asked);
	}
	if (lower.includes("permission")) {
		await ask("item/permissions/requestApproval", {
			threadId,
			turnId,
			itemId: id("perm"),
			environmentId: null,
			startedAtMs: Date.now(),
			cwd,
			reason: "Needs network access to install a package.",
			permissions: {
				network: { enabled: true },
				fileSystem: { entries: [{ path: { type: "path", path: "/usr/local/lib" }, access: "write" }] },
			},
		});
	}
	if (lower.includes("mcp") || lower.includes("form")) {
		await ask("mcpServer/elicitation/request", {
			threadId,
			turnId,
			serverName: "github",
			mode: "form",
			_meta: null,
			message: "Which repository should this issue go to?",
			requestedSchema: {
				type: "object",
				required: ["repo"],
				properties: {
					repo: { type: "string", title: "Repository", description: "owner/name" },
					labels: { type: "boolean", title: "Add labels" },
					priority: { type: "string", title: "Priority", enum: ["low", "high"] },
				},
			},
		});
	}
	if (lower.includes("fail")) {
		note("turn/completed", {
			threadId,
			turn: {
				...turn,
				status: "failed",
				error: {
					message: "The model is at capacity. Try again in a few minutes.",
					codexErrorInfo: null,
					additionalDetails: null,
				},
				completedAt: now(),
				durationMs: 1500,
			},
		});
		note("thread/status/changed", { threadId, status: { type: "idle" } });
		return;
	}

	const message = {
		type: "agentMessage",
		id: id("agent"),
		text: "",
		phase: null,
		memoryCitation: null,
		delivery: null,
		questions: null,
	};
	emit(message);
	const reply = lower.includes("implement")
		? `Implementing, mode=${lastMode}.`
		: lower.includes("long")
			? MARKDOWN
			: "Done. I read `src/login.ts` and everything looks **fine**.\n\n- No change was needed\n- All tests pass";
	const section =
		"## A heading\n\nA paragraph with `inline code`, **bold words** and a [link](https://example.com) that goes on for a while, so that it wraps.\n\n- First item of a list\n- Second item of a list\n\n```ts\nconst result = await login(email);\nif (!result.ok) {\n  setError(messages[result.reason]);\n}\n```\n\n";
	const words = (lower.includes("stress") ? section.repeat(120) : reply).split(/(?<=\s)/);
	let interrupted = false;
	for (let index = 0; index < words.length; index++) {
		if (stopped.delete(threadId)) {
			interrupted = true;
			break;
		}
		note("item/agentMessage/delta", { threadId, turnId, itemId: message.id, delta: words[index] });
		message.text += words[index];
		await sleep(lower.includes("slow") ? 120 : lower.includes("stress") ? 5 : 25);
	}
	finish(message);
	note("turn/plan/updated", {
		threadId,
		turnId,
		explanation: null,
		plan: [
			{ step: "Read the code", status: "completed" },
			{ step: "Make the change", status: "completed" },
			{ step: "Run the tests", status: "completed" },
		],
	});
	usage(threadId, turnId, 94000);
	stored.status = interrupted ? "interrupted" : "completed";
	stored.durationMs = 4000;
	stored.completedAt = now();
	note("turn/completed", { threadId, turn: { ...stored, items: [], itemsView: "notLoaded" } });
	note("thread/status/changed", { threadId, status: { type: "idle" } });
}

const stopped = new Set();

// Added words become part of the running turn, as with the real server.
function emitSteer(params) {
	const stored = history(params.threadId).find((turn) => turn.id === params.expectedTurnId);
	const item = {
		type: "userMessage",
		id: id("user"),
		clientId: params.clientUserMessageId ?? null,
		content: params.input,
	};
	stored?.items.push(item);
	for (const method of ["item/started", "item/completed"]) {
		note(method, {
			item,
			threadId: params.threadId,
			turnId: params.expectedTurnId,
			...(method === "item/started" ? { startedAtMs: Date.now() } : { completedAtMs: Date.now() }),
		});
	}
}
let lastMode = "none";
const model = (slug, name, isDefault, description, tiers = []) => ({
	id: slug,
	model: slug,
	upgrade: null,
	upgradeInfo: null,
	availabilityNux: null,
	displayName: name,
	description,
	modelSpecialty: null,
	hidden: false,
	supportedReasoningEfforts: (slug === "gpt-6-mini"
		? ["low", "medium"]
		: ["low", "medium", "high", "xhigh", "max", "ultra"]
	).map((reasoningEffort) => ({ reasoningEffort, description: `${reasoningEffort} effort` })),
	defaultReasoningEffort: "medium",
	inputModalities: ["text", "image"],
	supportsPersonality: false,
	multiAgentVersion: null,
	additionalSpeedTiers: [],
	serviceTiers: tiers,
	defaultServiceTier: null,
	availableAccessPrograms: null,
	isDefault,
});

createInterface({ input: process.stdin }).on("line", (line) => {
	const message = JSON.parse(line);
	const { id: requestId, method, params = {} } = message;
	if (method === undefined) {
		waiting.get(requestId)?.(message);
		waiting.delete(requestId);
		note("serverRequest/resolved", { threadId: "t-login", requestId });
		return;
	}
	const reply = (result) => send({ id: requestId, result });
	switch (method) {
		case "initialize":
			return reply({ userAgent: "fixture/0.166.0", codexHome: "/tmp", platformFamily: "unix", platformOs: "macos" });
		case "thread/list": {
			const query = params.searchTerm?.toLowerCase();
			return reply({
				data: threads
					.filter(
						(own) =>
							Boolean(own.archived) === Boolean(params.archived) &&
							(!query || `${own.name} ${own.preview}`.toLowerCase().includes(query)),
					)
					.toSorted((a, b) => b.updatedAt - a.updatedAt),
				nextCursor: null,
				backwardsCursor: null,
			});
		}
		case "thread/start": {
			const own = { ...thread(id("thread"), ""), cwd: params.cwd ?? cwd };
			threads.unshift(own);
			conversations.set(own.id, []);
			note("thread/started", { thread: own });
			return reply({
				thread: own,
				model: params.model ?? "gpt-6.1-sol",
				modelProvider: "openai",
				serviceTier: null,
				cwd,
				approvalPolicy: params.approvalPolicy,
				sandbox: { type: "workspaceWrite" },
				reasoningEffort: "medium",
				instructionSources: [],
				approvalsReviewer: "user",
				disabledPluginIds: [],
			});
		}
		case "thread/resume":
			if (params.threadId === "t-busy" && !released) {
				return send({
					id: requestId,
					error: { code: -32600, message: `thread ${params.threadId} already has an active writer` },
				});
			}
			return reply({
				thread: threads.find((own) => own.id === params.threadId),
				model: "gpt-6.1-sol",
				modelProvider: "openai",
				serviceTier: null,
				cwd,
				approvalPolicy: params.approvalPolicy,
				sandbox: { type: "workspaceWrite" },
				reasoningEffort: "medium",
				instructionSources: [],
				approvalsReviewer: "user",
				disabledPluginIds: [],
				collaborationMode: null,
				turnsBackwardsCursor: null,
				itemsBackwardsCursor: null,
			});
		case "thread/fork": {
			const own = thread(id("thread"), threads.find((candidate) => candidate.id === params.threadId)?.preview ?? "");
			threads.unshift(own);
			conversations.set(own.id, [...history(params.threadId)]);
			return reply({ thread: own });
		}
		case "thread/turns/list": {
			const all = history(params.threadId).toReversed();
			const from = Number(params.cursor ?? 0);
			const to = from + (params.limit ?? all.length);
			return reply({
				data: all.slice(from, to),
				nextCursor: to < all.length ? String(to) : null,
				backwardsCursor: null,
			});
		}
		case "thread/name/set": {
			threads.find((own) => own.id === params.threadId).name = params.name;
			note("thread/name/updated", { threadId: params.threadId, threadName: params.name });
			return reply({});
		}
		case "thread/archive": {
			threads.find((own) => own.id === params.threadId).archived = true;
			note("thread/archived", { threadId: params.threadId });
			return reply({});
		}
		case "thread/unarchive": {
			const own = threads.find((candidate) => candidate.id === params.threadId);
			own.archived = false;
			note("thread/unarchived", { threadId: params.threadId });
			return reply({ thread: own });
		}
		case "thread/compact/start": {
			reply({});
			const item = { type: "contextCompaction", id: id("compact") };
			const turnId = id("turn");
			history(params.threadId).push({ id: turnId, items: [item], itemsView: "full", status: "completed" });
			note("turn/started", { threadId: params.threadId, turn: { id: turnId, items: [], status: "inProgress" } });
			note("item/completed", { item, threadId: params.threadId, turnId, completedAtMs: Date.now() });
			usage(params.threadId, turnId, 21000);
			note("turn/completed", {
				threadId: params.threadId,
				turn: { id: turnId, items: [], status: "completed", error: null, durationMs: 800 },
			});
			return;
		}
		case "thread/revert": {
			const own = history(params.threadId);
			const index = own.findIndex((turn) => turn.id === params.beforeTurnId);
			if (index !== -1) own.splice(index);
			note("thread/reverted", { threadId: params.threadId, beforeTurnId: params.beforeTurnId });
			return reply({});
		}
		case "thread/shellCommand": {
			reply({});
			const turnId = id("turn");
			const item = {
				type: "commandExecution",
				id: id("cmd"),
				pluginId: null,
				scriptPath: null,
				command: params.command,
				cwd,
				processId: null,
				source: "userShell",
				status: "completed",
				commandActions: [{ type: "unknown", command: params.command }],
				aggregatedOutput: "On branch feat/login\nnothing to commit\n",
				exitCode: 0,
				durationMs: 12,
			};
			history(params.threadId).push({ id: turnId, items: [item], itemsView: "full", status: "completed" });
			note("turn/started", { threadId: params.threadId, turn: { id: turnId, items: [], status: "inProgress" } });
			note("item/started", { item, threadId: params.threadId, turnId, startedAtMs: Date.now() });
			note("item/completed", { item, threadId: params.threadId, turnId, completedAtMs: Date.now() });
			note("turn/completed", {
				threadId: params.threadId,
				turn: { id: turnId, items: [], status: "completed", error: null, durationMs: 12 },
			});
			return;
		}
		case "thread/goal/set": {
			const goal = {
				threadId: params.threadId,
				objective: goals.get(params.threadId)?.objective ?? "",
				status: "active",
				tokenBudget: null,
				tokensUsed: 0,
				timeUsedSeconds: 0,
				createdAt: now(),
				updatedAt: now(),
				...goals.get(params.threadId),
				...(params.objective ? { objective: params.objective } : {}),
				...(params.status ? { status: params.status } : {}),
				...(params.tokenBudget !== undefined ? { tokenBudget: params.tokenBudget } : {}),
			};
			goals.set(params.threadId, goal);
			note("thread/goal/updated", { threadId: params.threadId, turnId: null, goal });
			return reply({ goal });
		}
		case "thread/goal/clear":
			goals.delete(params.threadId);
			note("thread/goal/cleared", { threadId: params.threadId });
			return reply({ cleared: true });
		case "thread/goal/get":
			return reply({ goal: goals.get(params.threadId) ?? null });
		case "review/start": {
			reply({ turn: { id: "review" }, reviewThreadId: params.threadId });
			void run(params.threadId, "Review the uncommitted changes (long)");
			return;
		}
		case "turn/start": {
			const text = params.input.find((part) => part.type === "text")?.text ?? "(image)";
			const startedTurn = id("turn");
			reply({ turn: { id: startedTurn, items: [], status: "inProgress" } });
			const own = threads.find((candidate) => candidate.id === params.threadId);
			if (own && !own.preview) {
				own.preview = text;
			}
			own.updatedAt = now();
			lastMode = params.collaborationMode?.mode ?? "none";
			void run(params.threadId, text, params.input, startedTurn);
			return;
		}
		case "turn/steer":
			emitSteer(params);
			return reply({ turnId: params.expectedTurnId });
		case "turn/interrupt":
			stopped.add(params.threadId);
			return reply({});
		case "model/list":
			return reply({
				data: [
					model("gpt-6.1-sol", "GPT-6.1 Sol", true, "Most capable for hard coding work", [
						{ id: "priority", name: "Fast", description: "Faster responses, uses more of your plan" },
					]),
					model("gpt-6.1-terra", "GPT-6.1 Terra", false, "Balanced everyday model", [
						{ id: "priority", name: "Fast", description: "Faster responses" },
					]),
					model("gpt-6-mini", "GPT-6 Mini", false, "Quick answers, lower usage"),
				],
				nextCursor: null,
			});
		case "permissionProfile/list":
			return reply({
				data: [
					{ id: ":read-only", description: null, allowed: true },
					{ id: ":workspace", description: null, allowed: true },
					{ id: ":danger-full-access", description: null, allowed: true },
					{ id: "ci-only", description: "Team profile for CI work", allowed: false },
				],
				nextCursor: null,
			});
		case "collaborationMode/list":
			return reply({
				data: [
					{ name: "Plan", mode: "plan", model: null, reasoning_effort: "medium" },
					{ name: "Default", mode: "default", model: null, reasoning_effort: null },
				],
			});
		case "skills/list":
			return reply({
				data: [
					{
						cwd,
						errors: [],
						skills: [
							{
								name: "deploy",
								description: "Deploy this project to production",
								path: "/skills/deploy/SKILL.md",
								scope: "repo",
								enabled: true,
								pluginId: null,
							},
							{
								name: "write-tests",
								description: "Write tests that match this repo's conventions",
								path: "/skills/tests/SKILL.md",
								scope: "user",
								enabled: true,
								pluginId: null,
							},
						],
					},
				],
			});
		case "fuzzyFileSearch": {
			const all = ["src/login.ts", "src/login.test.ts", "src/form.tsx", "README.md", "package.json"];
			return reply({
				files: all
					.filter((file) => file.includes(params.query))
					.map((file) => ({
						root: cwd,
						path: file,
						match_type: "file",
						file_name: file.split("/").at(-1),
						score: 1,
						indices: null,
					})),
			});
		}
		case "account/read":
			return reply({
				account: { type: "chatgpt", email: "you@example.com", planType: "pro", workspaceName: null },
				requiresOpenaiAuth: false,
			});
		case "account/rateLimits/read":
			return reply({
				ordinaryUsageAllowed: true,
				rateLimits: {
					limitId: "codex",
					limitName: null,
					normalModelSlug: null,
					primary: { usedPercent: 38, windowDurationMins: 300, resetsAt: now() + 7200 },
					secondary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: now() + 400000 },
					credits: null,
					individualLimit: null,
					spendControlReached: null,
					planType: "pro",
					rateLimitReachedType: null,
				},
				rateLimitsByLimitId: null,
				rateLimitResetCredits: null,
				accountId: null,
				rateLimitUpsell: null,
			});
		case "config/read":
			return reply({
				config: {
					model: "gpt-6.1-sol",
					model_reasoning_effort: "medium",
					approval_policy: "on-request",
					sandbox_mode: "workspace-write",
				},
				origins: {},
			});
		case "gitDiffToRemote":
			return reply({ sha: "abc1234", diff: DIFF });
		case "fs/readDirectory":
			if (!params.path.startsWith(cwd)) {
				return reply({
					entries: [
						{ fileName: "api-server", isDirectory: true, isFile: false },
						{ fileName: "web", isDirectory: true, isFile: false },
						{ fileName: ".cache", isDirectory: true, isFile: false },
						{ fileName: "notes.txt", isDirectory: false, isFile: true },
					],
				});
			}
			return reply({
				entries:
					params.path === cwd
						? [
								{ fileName: "src", isDirectory: true, isFile: false },
								{ fileName: "README.md", isDirectory: false, isFile: true },
								{ fileName: "package.json", isDirectory: false, isFile: true },
							]
						: [
								{ fileName: "login.ts", isDirectory: false, isFile: true },
								{ fileName: "form.tsx", isDirectory: false, isFile: true },
							],
			});
		case "fs/readFile":
			return reply({
				dataBase64: Buffer.from(
					"export async function login(email: string) {\n  const user = await findUser(email);\n  return user ? createSession(user) : { ok: false };\n}\n",
				).toString("base64"),
			});
		default:
			return send({ id: requestId, error: { code: -32601, message: `fixture: ${method} is not implemented` } });
	}
});
