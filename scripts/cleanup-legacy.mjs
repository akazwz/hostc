import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const legacyPaths = ["apps/workers", "packages/tunnel-protocol"];
const legacyBiomeIncludes = [
	"!apps/workers/worker-configuration.d.ts",
	"!apps/workers",
	"!packages/tunnel-protocol",
];

const confirmed = process.argv.includes("--yes");
const dryRun = process.argv.includes("--dry-run");

if (dryRun) {
	printCleanupPlan();
} else if (!confirmed) {
	console.error(
		[
			"This command removes legacy refactor directories, including untracked leftovers, and stale Biome exclusions.",
			"Preview with --dry-run:",
			"pnpm run cleanup:legacy -- --dry-run",
			"Re-run with --yes after explicit approval:",
			"pnpm run cleanup:legacy -- --yes",
		].join("\n"),
	);
	process.exitCode = 1;
} else {
	cleanupTrackedLegacyFiles();
	cleanupLegacyDirectories();
	cleanupBiomeExclusions();
	console.log("Legacy refactor cleanup complete.");
}

function printCleanupPlan() {
	const tracked = listTrackedLegacyFiles();
	const existingDirectories = legacyPaths.filter((path) => existsSync(path));
	const biomeExclusions = listLegacyBiomeExclusions();
	console.log(
		JSON.stringify(
			{
				ok: true,
				dryRun: true,
				wouldRun: [
					"git rm -r -- apps/workers packages/tunnel-protocol",
					"remove leftover legacy directories",
					"remove legacy Biome exclusions",
				],
				trackedFiles: tracked,
				existingDirectories,
				biomeExclusions,
			},
			null,
			2,
		),
	);
}

function cleanupTrackedLegacyFiles() {
	if (listTrackedLegacyFiles().length === 0) {
		return;
	}
	git(["rm", "-r", "--", ...legacyPaths], { stdio: "inherit" });
}

function cleanupLegacyDirectories() {
	for (const path of legacyPaths) {
		if (existsSync(path)) {
			rmSync(path, { recursive: true, force: true });
		}
	}
}

function cleanupBiomeExclusions() {
	const path = "biome.json";
	const config = JSON.parse(readFileSync(path, "utf8"));
	config.files.includes = config.files.includes.filter(
		(include) => !legacyBiomeIncludes.includes(include),
	);
	writeFileSync(path, `${JSON.stringify(config, null, "\t")}\n`);
}

function listTrackedLegacyFiles() {
	return git(["ls-files", ...legacyPaths])
		.split("\n")
		.filter((path) => path.length > 0);
}

function listLegacyBiomeExclusions() {
	const config = JSON.parse(readFileSync("biome.json", "utf8"));
	return (config.files?.includes ?? []).filter((include) =>
		legacyBiomeIncludes.includes(include),
	);
}

function git(args, options = {}) {
	const result = spawnSync("git", args, {
		encoding: "utf8",
		stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
	});
	if (result.status !== 0) {
		throw new Error(result.stderr?.trim() || `git ${args.join(" ")} failed`);
	}
	return result.stdout ?? "";
}
