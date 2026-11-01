import type { ApprovalsReviewer, AskForApproval, PermissionProfileSummary } from "./api.ts";

/** How much Codex may do on its own. Each mode is a permission profile plus who approves escalations. */
export type PermissionMode = {
	id: string;
	profile: string;
	approvalPolicy: AskForApproval;
	approvalsReviewer: ApprovalsReviewer;
};

const READ_ONLY = ":read-only";
const WORKSPACE = ":workspace";
const FULL = ":danger-full-access";

const BUILT_IN: PermissionMode[] = [
	{ id: "read-only", profile: READ_ONLY, approvalPolicy: "on-request", approvalsReviewer: "user" },
	{ id: "ask", profile: WORKSPACE, approvalPolicy: "on-request", approvalsReviewer: "user" },
	{ id: "auto-review", profile: WORKSPACE, approvalPolicy: "on-request", approvalsReviewer: "auto_review" },
	{ id: "full", profile: FULL, approvalPolicy: "never", approvalsReviewer: "user" },
];

/** The modes on offer: the built-in ones this Codex allows, then profiles defined in its config. */
export function permissionModes(profiles: readonly PermissionProfileSummary[]): PermissionMode[] {
	const allowed = new Set(profiles.filter((profile) => profile.allowed).map((profile) => profile.id));
	const custom = profiles
		.filter((profile) => profile.allowed && ![READ_ONLY, WORKSPACE, FULL].includes(profile.id))
		.map((profile) => ({
			id: profile.id,
			profile: profile.id,
			approvalPolicy: "on-request" as const,
			approvalsReviewer: "user" as const,
		}));
	return [...BUILT_IN.filter((mode) => allowed.has(mode.profile)), ...custom];
}

/** What the composer remembers between visits. Choices are per browser, not per thread. */
export type Preferences = {
	model: string | null;
	effort: string | null;
	fast: boolean;
	// By folder: a choice made for one project says nothing about another, least of all full access.
	modes: Record<string, string>;
};

export const DEFAULT_PREFERENCES: Preferences = { model: null, effort: null, fast: false, modes: {} };

/** The permission mode chosen for a folder. Until one is chosen, it asks. */
export function modeIdFor(preferences: Pick<Preferences, "modes">, folder: string): string {
	return preferences.modes[folder] ?? "ask";
}

export function parsePreferences(text: string | null): Preferences {
	try {
		const saved = JSON.parse(text ?? "{}") as Partial<Preferences>;
		const modes = typeof saved.modes === "object" && saved.modes !== null ? saved.modes : {};
		return { ...DEFAULT_PREFERENCES, ...saved, modes };
	} catch {
		return DEFAULT_PREFERENCES;
	}
}
