import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Bridge } from "./bridge.ts";
import { CodexProcess } from "./process.ts";

export type CodexSession = {
	target: URL;
	/** Appended to the public URL as its fragment, which browsers never send to a server. */
	token: string;
	stop: () => void;
	exited: Promise<string>;
};

const START_TIMEOUT_MS = 30_000;

/** Starts Codex and the local server for its web client. Throws with a message for the user. */
export async function startCodex(version: string, here: boolean, cwd = process.cwd()): Promise<CodexSession> {
	const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), "codex-web");
	if (!existsSync(path.join(assets, "index.html"))) {
		throw new Error(`The web client is missing from this build (${assets}).`);
	}
	const codex = new CodexProcess(process.env.HOSTC_CODEX_BIN ?? "codex", ["app-server", "--listen", "stdio://"], cwd);
	const exited = new Promise<string>((resolve) => {
		codex.once("exit", ({ code, error }) => {
			resolve(
				(error as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
					? "Codex CLI not found. Install it first: https://developers.openai.com/codex"
					: `Codex exited${code === null ? "" : ` with code ${code}`}.${codex.lastError ? ` ${codex.lastError}` : ""}`,
			);
		});
	});
	const failed = exited.then((message) => {
		throw new Error(message);
	});
	let startTimer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			failed,
			new Promise((_, reject) => {
				startTimer = setTimeout(() => reject(new Error("Codex did not start within 30 seconds.")), START_TIMEOUT_MS);
			}),
			codex
				.request("initialize", {
					clientInfo: { name: "hostc", title: "hostc codex", version },
					// Named permission profiles and plan mode are only available to clients that opt in.
					capabilities: { experimentalApi: true, requestAttestation: false },
				})
				.catch(async (error: { message?: string }) => {
					// Codex going away fails this request first; `failed` says why it went.
					await new Promise((resolve) => setImmediate(resolve));
					throw new Error(error.message ?? "Codex could not be started.");
				}),
		]);
	} catch (error) {
		codex.kill();
		throw error;
	} finally {
		clearTimeout(startTimer);
	}
	failed.catch(() => {
		// Reported through `exited` from here on.
	});
	codex.notify("initialized");

	const token = randomBytes(32).toString("hex");
	const bridge = new Bridge({ codex, token, assets, cwd, here });
	const target = await bridge.listen();
	let stopped = false;
	const stop = () => {
		if (!stopped) {
			stopped = true;
			bridge.close();
			codex.kill();
		}
	};
	// However the process ends, uploaded images do not stay behind.
	process.once("exit", stop);
	void exited.then(stop);
	return { target, token, exited, stop };
}
