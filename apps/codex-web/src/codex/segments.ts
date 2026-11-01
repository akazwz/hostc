import type { ThreadItem } from "./api.ts";

export type CommandItem = Extract<ThreadItem, { type: "commandExecution" }>;
export type ReasoningItem = Extract<ThreadItem, { type: "reasoning" }>;

/** What a turn shows: runs of quiet work folded together, everything else as itself. */
export type Segment =
	| { kind: "activity"; id: string; items: (CommandItem | ReasoningItem)[] }
	| { kind: "item"; id: string; item: ThreadItem };

/** Reading and searching only look around. Anything else a command does deserves its own card. */
export function isExploring(item: CommandItem): boolean {
	return (
		item.source !== "userShell" &&
		item.status !== "failed" &&
		item.status !== "declined" &&
		item.commandActions.length > 0 &&
		item.commandActions.every((action) => action.type !== "unknown")
	);
}

export function segmentsOf(items: readonly ThreadItem[]): Segment[] {
	const segments: Segment[] = [];
	let run: (CommandItem | ReasoningItem)[] | null = null;
	for (const item of items) {
		if (item.type === "reasoning" || (item.type === "commandExecution" && isExploring(item))) {
			if (!run) {
				run = [];
				segments.push({ kind: "activity", id: item.id, items: run });
			}
			run.push(item);
			continue;
		}
		run = null;
		segments.push({ kind: "item", id: item.id, item });
	}
	return segments;
}

export type ActivityCounts = { files: number; searches: number; lists: number };

export function activityCounts(items: readonly (CommandItem | ReasoningItem)[]): ActivityCounts {
	const files = new Set<string>();
	let searches = 0;
	let lists = 0;
	for (const item of items) {
		if (item.type !== "commandExecution") {
			continue;
		}
		for (const action of item.commandActions) {
			if (action.type === "read") {
				files.add(action.path);
			} else if (action.type === "search") {
				searches++;
			} else if (action.type === "listFiles") {
				lists++;
			}
		}
	}
	return { files: files.size, searches, lists };
}

/** The command as the person would have typed it: without the login shell wrapper Codex adds. */
export function displayCommand(command: string): string {
	const wrapped = /^\S*sh -lc (['"])(.*)\1$/s.exec(command);
	return (wrapped?.[2] ?? command).replaceAll(`'\\''`, "'");
}
