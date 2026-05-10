import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalTunnelHarness } from "./sdk-harness.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const cliBin = fileURLToPath(
	new URL("../apps/cli/dist/index.js", import.meta.url),
);
const tempDir = await mkdtemp(join(tmpdir(), "hostc-cli-e2e-"));
const origin = await startLocalOrigin();
const harness = await createLocalTunnelHarness({ dataChannels: 2 });
const cli = spawn(
	"node",
	[
		cliBin,
		String(origin.port),
		"--server",
		harness.serverUrl,
		"--data-channels",
		"2",
	],
	{
		cwd: repoRoot,
		detached: process.platform !== "win32",
		env: {
			...process.env,
			NO_COLOR: "1",
			HOSTC_CONFIG: join(tempDir, "config.json"),
			HOSTC_DISABLE_UPDATE_CHECK: "1",
			HOSTC_E2E_RECONNECT_STDIN: "1",
		},
		stdio: ["pipe", "pipe", "pipe"],
	},
);
const output = collectChildOutput(cli);

try {
	await waitForReadyCount(output, 1, 20_000);
	await harness.ready;
	assertOutput(output.text, /Success\s+Tunnel ready/, "ready success line");
	assertOutput(
		output.text,
		/Public URL:\s+http:\/\/public\.localhost:/,
		"public URL line",
	);
	assertOutput(
		output.text,
		new RegExp(`Local:\\s+http://localhost:${origin.port}/`),
		"local line",
	);
	assertOutput(output.text, /Tunnel:\s+t-local-bench/, "tunnel id line");
	assertOutput(output.text, /Channels:\s+2/, "channels line");

	await harness.sendHttpRequest({ method: "GET", path: "/cli/get" });
	await harness.sendHttpRequest({
		method: "POST",
		path: "/cli/post",
		bodyBytes: 128,
	});

	const readyBeforeReconnect = countReadyLines(output.text);
	cli.stdin.write("reconnect\n");
	await waitForReadyCount(output, readyBeforeReconnect + 1, 20_000);
	await sleep(500);
	await harness.sendHttpRequest({ method: "GET", path: "/cli/reconnect" });

	await stopChild(cli, "SIGTERM");
	const result = {
		ok: true,
		date: new Date().toISOString(),
		checks: [
			"CLI process starts",
			"CLI prints ready output",
			"CLI passes server and data channel options to SDK",
			"CLI proxies HTTP GET through SDK",
			"CLI proxies HTTP POST through SDK",
			"CLI stdin reconnect creates a new tunnel session",
			"CLI exits on SIGTERM",
		],
		originPort: origin.port,
		serverUrl: harness.serverUrl,
		harness: harness.snapshot(),
	};
	const artifactPath = join(
		repoRoot,
		"artifacts",
		"e2e",
		`cli-${new Date().toISOString().replaceAll(/[-:]/g, "").slice(0, 13)}.json`,
	);
	await mkdir(dirname(artifactPath), { recursive: true });
	await writeFile(artifactPath, `${JSON.stringify(result, null, 2)}\n`);
	console.log(JSON.stringify({ ...result, artifactPath }, null, 2));
} finally {
	await stopChild(cli, "SIGTERM").catch(() => undefined);
	await harness.close();
	await origin.close();
	await rm(tempDir, { recursive: true, force: true });
}

async function startLocalOrigin() {
	const server = createServer(async (request, response) => {
		for await (const _chunk of request) {
			// Drain request bodies so POST proxying exercises the full path.
		}
		response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
		response.end("ok");
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	return {
		port: server.address().port,
		close: () => new Promise((resolve) => server.close(resolve)),
	};
}

function collectChildOutput(child) {
	const output = { text: "" };
	child.stdout.on("data", (chunk) => {
		output.text += chunk.toString();
	});
	child.stderr.on("data", (chunk) => {
		output.text += chunk.toString();
	});
	return output;
}

async function waitForReadyCount(output, expectedCount, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (countReadyLines(output.text) >= expectedCount) {
			return;
		}
		if (output.text.includes("create tunnel failed")) {
			throw new Error(`CLI failed before ready:\n${output.text}`);
		}
		await sleep(100);
	}
	throw new Error(`Timed out waiting for CLI ready:\n${output.text}`);
}

function countReadyLines(text) {
	return text.match(/Tunnel ready/g)?.length ?? 0;
}

function assertOutput(text, pattern, label) {
	if (!pattern.test(text)) {
		throw new Error(`CLI output missing ${label}:\n${text}`);
	}
}

async function stopChild(child, signal) {
	if (child.exitCode !== null || child.signalCode !== null) {
		return;
	}
	if (process.platform !== "win32" && child.pid) {
		try {
			process.kill(-child.pid, signal);
		} catch {
			child.kill(signal);
		}
	} else {
		child.kill(signal);
	}
	await Promise.race([
		once(child, "exit"),
		sleep(5000).then(() => {
			child.kill("SIGKILL");
			throw new Error("CLI did not exit after SIGTERM");
		}),
	]);
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
