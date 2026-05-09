import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const serverUrl = process.env.HOSTC_SERVER_URL ?? "https://envoq.dev";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const serverDir = join(scriptDir, "..");
const localWrangler = join(serverDir, "node_modules", ".bin", "wrangler");
const wrangler = existsSync(localWrangler) ? localWrangler : "wrangler";
const checks = [];
let stagingWorkerReady = false;

await check("staging Worker exists and TOKEN_SECRET is configured", () => {
	const result = spawnSync(wrangler, ["secret", "list", "--env", "staging"], {
		cwd: serverDir,
		encoding: "utf8",
		env: {
			...process.env,
			WRANGLER_LOG_PATH:
				process.env.WRANGLER_LOG_PATH ?? join(tmpdir(), "hostc-wrangler-logs"),
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (result.status !== 0) {
		throw new Error(
			result.error?.message ||
				result.stderr?.trim() ||
				"wrangler secret list failed",
		);
	}
	if (!result.stdout.includes("TOKEN_SECRET")) {
		throw new Error("TOKEN_SECRET is not configured for staging");
	}
	stagingWorkerReady = true;
});

await check("staging health endpoint responds", async () => {
	if (!stagingWorkerReady) {
		throw new Error(
			"skipped because staging Worker or TOKEN_SECRET is not ready",
		);
	}
	const response = await fetch(new URL("/health", serverUrl), {
		signal: AbortSignal.timeout(10_000),
	});
	if (!response.ok) {
		throw new Error(`health returned ${response.status}`);
	}
	const body = await response.json();
	if (body?.ok !== true) {
		throw new Error("health response did not contain ok=true");
	}
});

const failed = checks.filter((item) => item.status === "fail");
console.log(
	JSON.stringify({ ok: failed.length === 0, serverUrl, checks }, null, 2),
);
if (failed.length > 0) {
	process.exitCode = 1;
}

async function check(name, run) {
	try {
		await run();
		checks.push({ name, status: "pass" });
	} catch (error) {
		checks.push({
			name,
			status: "fail",
			error: error instanceof Error ? error.message : String(error),
		});
	}
}
