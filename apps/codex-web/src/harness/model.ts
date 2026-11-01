// What the interface knows about an agent. Components use only these concepts; a harness translates one
// agent's protocol into them. Nothing here is specific to any agent, and capabilities it may lack are
// optional, so that the interface simply leaves those controls out.

import type { FormField } from "./elicitation.ts";

export type ConnectionState = "checking" | "signedOut" | "connecting" | "online" | "offline" | "ended";

export type SessionState = "idle" | "running";

/** One line of work with an agent: what people call a thread or a conversation. */
export type Session = {
	id: string;
	title: string;
	updatedAt: number;
	state: SessionState;
	branch: string | null;
	folder: string;
};

export type RunStatus = "running" | "done" | "stopped" | "failed";

export type StepStatus = "running" | "done" | "failed" | "declined";

/** A person's request: the title of a run. */
export type RequestStep = { kind: "request"; id: string; text: string; images: string[] };

/** What the agent said. The last one of a finished run is its result. */
export type MessageStep = {
	kind: "message";
	id: string;
	text: string;
	/** Questions asked in passing. The run is over; answering is simply the next message. */
	asks: { title: string; options: string[] }[];
};

export type ThinkingStep = { kind: "thinking"; id: string; text: string };

/** Looking around: reading, searching, listing. Changes nothing, so it folds away. */
export type LookStep = {
	kind: "look";
	id: string;
	status: StepStatus;
	actions: { verb: "read" | "search" | "list"; target: string }[];
};

/** A command that may change something. */
export type CommandStep = {
	kind: "command";
	id: string;
	command: string;
	output: string;
	status: StepStatus;
	exitCode: number | null;
	durationMs: number | null;
};

export type EditStep = { kind: "edit"; id: string; status: StepStatus; files: { path: string; diff: string }[] };

export type PlanStep = { kind: "plan"; id: string; text: string };

/** Anything else worth a line: a web search, a tool call, context compacted. */
export type NoteStep = { kind: "note"; id: string; text: string; detail: string | null; status: StepStatus };

export type ImageStep = { kind: "image"; id: string; url: string; caption: string };

export type Step =
	| RequestStep
	| MessageStep
	| ThinkingStep
	| LookStep
	| CommandStep
	| EditStep
	| PlanStep
	| NoteStep
	| ImageStep;

export type ChecklistItem = { text: string; state: "pending" | "active" | "done" };

/** One piece of work: a request, the steps taken and the result. Its readers are functions so that a
 *  component can follow just what it shows. */
export type Run = {
	id: string;
	status: () => RunStatus;
	steps: () => Step[];
	error: () => string | null;
	startedAt: () => number | null;
	durationMs: () => number | null;
	checklist: () => ChecklistItem[] | null;
	diff: () => string | null;
	// What went wrong while the agent tries again by itself.
	retrying: () => string | null;
};

export type AccessLine = { what: "network" } | { what: "read" | "write" | "deny"; target: string };

export type InputQuestion = {
	id: string;
	question: string;
	options: { label: string; description: string }[];
	allowOther: boolean;
	secret: boolean;
};

export type ChoiceTone = "primary" | "normal" | "quiet";

/** One way to answer. `key` picks a label; `detail` is what it applies to, such as a command prefix. */
export type Choice = {
	key: "allow" | "allowSession" | "allowRule" | "denyRule" | "decline" | "stop";
	detail?: string;
	tone: ChoiceTone;
	answer: unknown;
};

type DecisionBase = {
	id: number | string;
	sessionId: string | null;
	/** It belongs to something the list does not show, such as a sub-agent, and has nowhere else to go. */
	foreign: boolean;
	reason: string | null;
};

/** Something only a person can settle. The agent, or part of it, is waiting. */
export type Decision = DecisionBase &
	(
		| {
				kind: "command";
				command: string | null;
				cwd: string | null;
				host: string | null;
				protocol: string | null;
				also: AccessLine[];
				choices: Choice[];
		  }
		| { kind: "edit"; itemId: string; choices: Choice[] }
		| { kind: "access"; cwd: string | null; lines: AccessLine[]; choices: Choice[] }
		| {
				kind: "question";
				blocking: boolean;
				questions: InputQuestion[];
				answer: (values: Record<string, string>) => unknown;
		  }
		| { kind: "form"; source: string; fields: FormField[]; answer: (data: FormDataLike) => unknown; decline: unknown }
		| { kind: "link"; source: string; url: string; done: unknown; decline: unknown }
	);

export type FormDataLike = { get(name: string): unknown; getAll(name: string): unknown[] };

export type ModelOption = {
	id: string;
	name: string;
	description: string;
	efforts: string[];
	fast: boolean;
};

export type PermissionOption = { id: string; label: string | null; description: string | null };

export type Usage = { percent: number; used: number; window: number };

export type LimitWindow = { minutes: number; percent: number; resetsAt: number | null };

export type Account = { name: string; limits: LimitWindow[] };

/** What a person is about to send. */
export type Draft = {
	text: string;
	files: { name: string; path: string }[];
	skills: { name: string; path: string }[];
	images: string[];
};

export type Suggestion = { name: string; path: string; hint: string };

export type FolderEntry = { name: string; folder: boolean };

/** One agent, as the interface uses it. */
export type Folder = { path: string; name: string };

export type GoalStatus = "active" | "paused" | "blocked" | "usageLimited" | "budgetLimited" | "complete";

export type Goal = {
	objective: string;
	status: GoalStatus;
	tokensUsed: number;
	tokenBudget: number | null;
	seconds: number;
};

export type Harness = {
	// State.
	// What this harness drives, as people call it. The one place an agent is named.
	agent: string;
	connection: () => ConnectionState;
	// Where this run of hostc started, and where new work goes unless the person chooses otherwise.
	project: () => Folder;
	// Whether work can happen in other folders than that one.
	anyFolder: () => boolean;
	// The folders in use, the starting one first.
	folders: () => Folder[];
	folderOf: (sessionId: string | null) => string;
	sessions: () => Session[];
	// Any session seen, also when search or the archive is what the list shows now.
	session: (id: string) => Session | undefined;
	// False until the list has come back, when no sessions does not yet mean there are none.
	listed: () => boolean;
	/** Starts following a session; safe to call again. */
	open: (id: string) => void;
	runs: (id: string) => Run[];
	loaded: (id: string) => boolean;
	hasOlder: (id: string) => boolean;
	activeRun: (id: string) => string | null;
	usage: (id: string) => Usage | null;
	goal: (id: string) => Goal | null;
	decisions: (sessionId: string | null) => Decision[];
	waitingCount: () => number;
	needsYou: (sessionId: string) => boolean;
	/** The steps an edit decision is about. */
	editFiles: (sessionId: string, itemId: string) => { path: string; diff: string }[];
	notice: () => string | null;
	dismissNotice: () => void;
	account: () => Account | null;

	// How the next run behaves.
	models: () => ModelOption[];
	model: () => ModelOption | undefined;
	effort: () => string | null;
	fast: () => boolean;
	permissions: () => PermissionOption[];
	// Chosen per folder, so that what is allowed in one project does not follow into another.
	permission: (folder: string) => PermissionOption | undefined;
	planning: () => boolean;
	setModel: (id: string) => void;
	setEffort: (id: string) => void;
	setFast: (on: boolean) => void;
	setPermission: (folder: string, id: string) => void;
	setPlanning: (on: boolean) => void;

	// Sending.
	start: () => Promise<void>;
	wake: () => void;
	send: (sessionId: string, draft: Draft) => Promise<boolean>;
	/** Starts a session with this draft. Returns its id, or null when it failed. */
	// `onStarted` as soon as the session exists, while the message is still on its way.
	begin: (draft: Draft, folder: string, onStarted: (id: string) => void) => Promise<string | null>;
	// How a draft looks once sent, to show it before any of that has happened.
	requestOf: (draft: Draft) => RequestStep;
	carryOutPlan: (sessionId: string, text: string) => Promise<void>;
	/** Whether the agent was told to stop. */
	stop: (sessionId: string) => Promise<boolean>;
	answer: (decision: Decision, answer: unknown) => void;

	// Help with writing.
	skills: (folder: string) => Suggestion[];
	loadSkills: (folder: string) => void;
	searchFiles: (query: string, folder: string) => Promise<Suggestion[]>;
	upload: (file: File) => Promise<string | null>;

	// The list of sessions.
	showingArchived: () => boolean;
	showArchived: (show: boolean) => void;
	search: (term: string) => void;
	unarchive: (id: string) => Promise<boolean>;

	// One session.
	loadOlder: (id: string) => Promise<void>;
	rename: (id: string, title: string) => Promise<void>;
	archive: (id: string) => Promise<boolean>;
	fork: (id: string, fromRun?: string) => Promise<string | null>;
	undo: (id: string) => Promise<void>;
	compact: (id: string) => Promise<void>;
	review: (id: string) => Promise<void>;
	shell: (id: string, command: string) => Promise<boolean>;
	// Setting a goal starts work at once, and the work goes on, run after run, until it is met.
	setGoal: (id: string, objective: string) => Promise<boolean>;
	beginGoal: (objective: string, folder: string) => Promise<string | null>;
	pauseGoal: (id: string, paused: boolean) => Promise<void>;
	limitGoal: (id: string, tokens: number | null) => Promise<void>;
	clearGoal: (id: string) => Promise<void>;

	// The project.
	readFolder: (path: string) => Promise<FolderEntry[] | null>;
	readFile: (path: string) => Promise<string | null | undefined>;
	branchDiff: (folder: string) => Promise<string | null>;
};
