// From the Codex protocol to the interface's concepts. Pure, so it is tested without a browser.

import { formContent, formFields, type RawSchema } from "../harness/elicitation.ts";
import type { AccessLine, Choice, Decision, FormDataLike, RunStatus, Step, StepStatus } from "../harness/model.ts";
import type { Question, ThreadItem, UserInput } from "./api.ts";
import type { FileUpdateChange } from "./protocol/v2/FileUpdateChange.ts";
import { displayCommand, isExploring } from "./segments.ts";

export function imageUrl(path: string): string {
	return `/api/file?path=${encodeURIComponent(path)}`;
}

function inputText(content: readonly UserInput[]): string {
	// Mentions and skills are written in the text as well; they only stand alone when there is none.
	const written = content.flatMap((part) => (part.type === "text" ? [part.text] : []));
	if (written.some(Boolean)) {
		return written.join(" ");
	}
	return content
		.flatMap((part) => (part.type === "mention" ? [`@${part.name}`] : part.type === "skill" ? [`$${part.name}`] : []))
		.join(" ");
}

/**
 * One file as a unified diff with a display path. Codex sends the whole content for a new or deleted
 * file, and a unified diff with a "Moved to" line after it for an update.
 */
export function editedFile(change: FileUpdateChange): { path: string; diff: string } {
	const { kind, path, diff } = change;
	if (kind.type === "update") {
		return {
			path: kind.move_path ? `${path} → ${kind.move_path}` : path,
			diff: diff.replace(/\n\nMoved to: .*\n?$/, "\n"),
		};
	}
	const lines = diff.split("\n");
	if (lines.at(-1) === "") {
		lines.pop();
	}
	const added = kind.type === "add";
	const hunk = added ? `@@ -0,0 +1,${lines.length} @@` : `@@ -1,${lines.length} +0,0 @@`;
	return { path, diff: [hunk, ...lines.map((line) => `${added ? "+" : "-"}${line}`)].join("\n") };
}

function inputImages(content: readonly UserInput[]): string[] {
	return content.flatMap((part) => {
		if (part.type === "localImage") {
			return [imageUrl(part.path)];
		}
		return part.type === "image" && "url" in part ? [part.url] : [];
	});
}

type LookAction = Extract<Step, { kind: "look" }>["actions"][number];

function stepStatus(status: string): StepStatus {
	return status === "inProgress"
		? "running"
		: status === "failed"
			? "failed"
			: status === "declined"
				? "declined"
				: "done";
}

function fileName(path: string): string {
	return path.split("/").at(-1) ?? path;
}

/** One protocol item as the step it is. Items with nothing to show become nothing. */
export function stepOf(item: ThreadItem): Step | null {
	switch (item.type) {
		case "userMessage":
			return { kind: "request", id: item.id, text: inputText(item.content), images: inputImages(item.content) };
		case "agentMessage":
			return {
				kind: "message",
				id: item.id,
				text: item.text,
				asks:
					item.delivery === "async"
						? (item.questions ?? []).map((question) => ({ title: question.title, options: question.options ?? [] }))
						: [],
			};
		case "reasoning": {
			const text = item.summary.join("\n\n");
			return text ? { kind: "thinking", id: item.id, text } : null;
		}
		case "plan":
			return { kind: "plan", id: item.id, text: item.text };
		case "commandExecution":
			if (isExploring(item)) {
				return {
					kind: "look",
					id: item.id,
					status: stepStatus(item.status),
					actions: item.commandActions.flatMap((action): LookAction[] => {
						switch (action.type) {
							case "read":
								return [{ verb: "read", target: action.name || fileName(action.path) }];
							case "search":
								return [{ verb: "search", target: action.query ?? "" }];
							case "listFiles":
								return [{ verb: "list", target: action.path ?? "" }];
							default:
								return [];
						}
					}),
				};
			}
			return {
				kind: "command",
				id: item.id,
				command: displayCommand(item.command),
				output: item.aggregatedOutput ?? "",
				status: stepStatus(item.status),
				exitCode: item.exitCode,
				durationMs: item.durationMs,
			};
		case "fileChange":
			return {
				kind: "edit",
				id: item.id,
				status: stepStatus(item.status),
				files: item.changes.map(editedFile),
			};
		case "webSearch":
			return { kind: "note", id: item.id, text: "web", detail: item.query || null, status: "done" };
		case "mcpToolCall":
			return {
				kind: "note",
				id: item.id,
				text: `${item.server}: ${item.tool}`,
				detail: item.error?.message ?? null,
				status: stepStatus(item.status),
			};
		case "collabAgentToolCall":
			return {
				kind: "note",
				id: item.id,
				text: "agent",
				detail: item.prompt,
				status: stepStatus(item.status),
			};
		case "enteredReviewMode":
			return { kind: "note", id: item.id, text: "review", detail: item.review || null, status: "running" };
		case "dynamicToolCall":
			return {
				kind: "note",
				id: item.id,
				text: `${item.namespace ?? "tool"}: ${item.tool}`,
				detail: null,
				status: stepStatus(item.status),
			};
		case "subAgentActivity":
			return { kind: "note", id: item.id, text: item.agentPath, detail: null, status: "done" };
		case "contextCompaction":
			return { kind: "note", id: item.id, text: "compacted", detail: null, status: "done" };
		case "imageGeneration":
			return "result" in item && item.result
				? { kind: "image", id: item.id, url: `data:image/png;base64,${item.result}`, caption: item.revisedPrompt ?? "" }
				: null;
		case "imageView":
			return { kind: "image", id: item.id, url: imageUrl(item.path), caption: fileName(item.path) };
		case "exitedReviewMode":
			return { kind: "message", id: item.id, text: item.review, asks: [] };
		default:
			return null;
	}
}

export function runStatus(status: string): RunStatus {
	return status === "inProgress"
		? "running"
		: status === "interrupted"
			? "stopped"
			: status === "failed"
				? "failed"
				: "done";
}

type Grant = NonNullable<Extract<Question, { method: "item/permissions/requestApproval" }>["params"]["permissions"]>;

type FileSystemPath = NonNullable<NonNullable<Grant["fileSystem"]>["entries"]>[number]["path"];

function targetOf(path: FileSystemPath): string {
	if (path.type === "path") {
		return path.path;
	}
	if (path.type === "glob_pattern") {
		return path.pattern;
	}
	const special = path.value;
	const names: Record<string, string> = {
		root: "/",
		tmpdir: "$TMPDIR",
		slash_tmp: "/tmp",
		project_roots: "<project>",
		minimal: "<minimal>",
	};
	const unknown = special.kind === "unknown" ? special.path : null;
	const subpath = special.kind === "project_roots" || special.kind === "unknown" ? special.subpath : null;
	return `${names[special.kind] ?? unknown ?? special.kind}${subpath ? `/${subpath}` : ""}`;
}

/** Everything a permission request asks for, spelled out: this is what the person is agreeing to. */
export function accessLines(grant: Partial<Grant> | null | undefined): AccessLine[] {
	const lines: AccessLine[] = [];
	if (grant?.network?.enabled) {
		lines.push({ what: "network" });
	}
	for (const entry of grant?.fileSystem?.entries ?? []) {
		lines.push({ what: entry.access, target: targetOf(entry.path) });
	}
	for (const target of grant?.fileSystem?.read ?? []) {
		lines.push({ what: "read", target });
	}
	for (const target of grant?.fileSystem?.write ?? []) {
		lines.push({ what: "write", target });
	}
	return lines;
}

type CommandQuestion = Extract<Question, { method: "item/commandExecution/requestApproval" }>;
type WireDecision = NonNullable<CommandQuestion["params"]["availableDecisions"]>[number];

function commandChoice(decision: WireDecision, index: number): Choice {
	const answer = { decision };
	const tone = index === 0 ? ("primary" as const) : decision === "cancel" ? ("quiet" as const) : ("normal" as const);
	if (typeof decision === "object") {
		if ("acceptWithExecpolicyAmendment" in decision) {
			return {
				key: "allowRule",
				detail: decision.acceptWithExecpolicyAmendment.execpolicy_amendment.join(" "),
				tone,
				answer,
			};
		}
		const amendment = decision.applyNetworkPolicyAmendment.network_policy_amendment;
		return { key: amendment.action === "deny" ? "denyRule" : "allowRule", detail: amendment.host, tone, answer };
	}
	const keys = { accept: "allow", acceptForSession: "allowSession", decline: "decline", cancel: "stop" } as const;
	return { key: keys[decision], tone, answer };
}

/** A question from Codex as a decision. `foreign` is for the caller: it knows which threads it lists. */
const choice = (key: Choice["key"], decision: string, tone: Choice["tone"]): Choice => ({
	key,
	tone,
	answer: { decision },
});

const reply = (action: string, content: unknown = null) => ({ action, content, _meta: null });

export function decisionOf(question: Question, foreign: boolean): Decision {
	const base = { id: question.id, sessionId: question.params.threadId, foreign };
	switch (question.method) {
		case "item/commandExecution/requestApproval": {
			const { params } = question;
			// Codex says which answers this request accepts; the fallback is what it accepts when it does not.
			const rule = params.proposedExecpolicyAmendment;
			const listed: WireDecision[] = params.availableDecisions?.length
				? params.availableDecisions
				: [
						"accept",
						"acceptForSession",
						...(rule ? [{ acceptWithExecpolicyAmendment: { execpolicy_amendment: rule } }] : []),
						"decline",
						"cancel",
					];
			return {
				...base,
				kind: "command",
				reason: params.reason ?? null,
				command: params.command ? displayCommand(params.command) : null,
				cwd: params.cwd ?? null,
				host: params.networkApprovalContext?.host ?? null,
				protocol: params.networkApprovalContext?.protocol ?? null,
				also: accessLines(params.additionalPermissions as Partial<Grant> | null | undefined),
				choices: listed.map(commandChoice),
			};
		}
		case "item/fileChange/requestApproval": {
			const { params } = question;
			return {
				...base,
				kind: "edit",
				reason: params.reason ?? null,
				itemId: params.itemId,
				choices: [
					choice("allow", "accept", "primary"),
					choice("allowSession", "acceptForSession", "normal"),
					choice("decline", "decline", "normal"),
					choice("stop", "cancel", "quiet"),
				],
			};
		}
		case "item/permissions/requestApproval": {
			const { params } = question;
			return {
				...base,
				kind: "access",
				reason: params.reason,
				cwd: params.cwd,
				lines: accessLines(params.permissions),
				choices: [
					{ key: "allow", tone: "primary", answer: { permissions: params.permissions, scope: "turn" } },
					{ key: "allowSession", tone: "normal", answer: { permissions: params.permissions, scope: "session" } },
					{ key: "decline", tone: "normal", answer: { permissions: {}, scope: "turn" } },
				],
			};
		}
		case "item/tool/requestUserInput": {
			const { params } = question;
			return {
				...base,
				kind: "question",
				reason: null,
				blocking: params.isBlocking,
				questions: params.questions.map((own) => ({
					id: own.id,
					question: own.question,
					options: own.options ?? [],
					allowOther: own.isOther || !own.options?.length,
					secret: own.isSecret,
				})),
				answer: (values) => ({
					answers: Object.fromEntries(
						params.questions.map((own) => [own.id, { answers: values[own.id] ? [values[own.id]] : [] }]),
					),
				}),
			};
		}
		case "mcpServer/elicitation/request": {
			const { params } = question;
			if (params.mode === "openai/userVerification") {
				// Nothing here can verify a person: show what it asks, and let them decline.
				return {
					...base,
					kind: "form",
					reason: [params.title, params.description, params.challenge].filter(Boolean).join("\n\n"),
					source: params.serverName,
					fields: [],
					answer: () => reply("accept"),
					decline: reply("decline"),
				};
			}
			const reason = params.message;
			if (params.mode === "url") {
				return {
					...base,
					sessionId: params.threadId,
					kind: "link",
					reason,
					source: params.serverName,
					url: params.url,
					done: reply("accept"),
					decline: reply("decline"),
				};
			}
			const fields = formFields(params.requestedSchema as RawSchema | null);
			return {
				...base,
				kind: "form",
				reason,
				source: params.serverName,
				fields,
				answer: (data: FormDataLike) => reply("accept", formContent(fields, data)),
				decline: reply("decline"),
			};
		}
	}
}
