import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { WebSocket, WebSocketServer } = require("ws");

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const serverUrl = process.env.HOSTC_SERVER_URL ?? "https://envoq.dev";
const externalPublicUrl = process.env.HOSTC_PUBLIC_URL;
const concurrency = readPositiveInteger("HOSTC_LOAD_CONCURRENCY", 10);
const requests = readPositiveInteger("HOSTC_LOAD_REQUESTS", 100);
const tunnelCount = externalPublicUrl
	? 1
	: readPositiveInteger("HOSTC_LOAD_TUNNELS", 1);
const largeBytes = readPositiveInteger("HOSTC_LOAD_LARGE_BYTES", 1024 * 1024);
const webSocketConnections = readPositiveInteger(
	"HOSTC_LOAD_WS_CONNECTIONS",
	8,
);
const webSocketFrames = readPositiveInteger("HOSTC_LOAD_WS_FRAMES", 20);
const webSocketHoldMs = readPositiveInteger("HOSTC_LOAD_WS_HOLD_MS", 1000);
const reconnects = readPositiveInteger("HOSTC_LOAD_RECONNECTS", 3);
const scenarios = readScenarios();
const processes = [];
const locals = [];

try {
	const tunnels = externalPublicUrl
		? [{ publicUrl: externalPublicUrl, source: "external" }]
		: await createTemporaryStagingTunnels(tunnelCount);
	const result = await runLoad(tunnels);
	const artifactPath = join(
		repoRoot,
		"artifacts",
		"load",
		`staging-${new Date().toISOString().replaceAll(/[-:]/g, "").slice(0, 13)}.json`,
	);
	await mkdir(dirname(artifactPath), { recursive: true });
	await writeFile(artifactPath, `${JSON.stringify(result, null, 2)}\n`);
	console.log(JSON.stringify({ ...result, artifactPath }, null, 2));
} finally {
	for (const child of processes.reverse()) {
		await stopChild(child);
	}
	for (const local of locals.reverse()) {
		await local.close();
	}
}

async function runLoad(tunnels) {
	const startedAt = performance.now();
	const scenarioResults = [];
	const allLatencies = [];

	if (scenarios.has("http-get")) {
		appendScenario(
			scenarioResults,
			allLatencies,
			await runHttpScenario("http-get", tunnels, {
				path: "",
				method: "GET",
			}),
		);
	}
	if (scenarios.has("large-download")) {
		appendScenario(
			scenarioResults,
			allLatencies,
			await runHttpScenario("large-download", tunnels, {
				path: "large",
				method: "GET",
			}),
		);
	}
	if (scenarios.has("large-upload")) {
		const uploadBody = Buffer.alloc(largeBytes, "u");
		appendScenario(
			scenarioResults,
			allLatencies,
			await runHttpScenario("large-upload", tunnels, {
				path: "upload",
				method: "POST",
				body: uploadBody,
				expectedBody: String(uploadBody.byteLength),
			}),
		);
	}
	if (scenarios.has("websocket-long")) {
		appendScenario(
			scenarioResults,
			allLatencies,
			await runWebSocketScenario("websocket-long", tunnels, {
				connections: webSocketConnections,
				frames: 1,
				holdMs: webSocketHoldMs,
			}),
		);
	}
	if (scenarios.has("websocket-burst")) {
		appendScenario(
			scenarioResults,
			allLatencies,
			await runWebSocketScenario("websocket-burst", tunnels, {
				connections: webSocketConnections,
				frames: webSocketFrames,
				holdMs: 0,
			}),
		);
	}
	if (scenarios.has("idle-websocket")) {
		appendScenario(
			scenarioResults,
			allLatencies,
			await runWebSocketScenario("idle-websocket", tunnels, {
				connections: webSocketConnections,
				frames: 0,
				holdMs: webSocketHoldMs,
			}),
		);
	}
	if (scenarios.has("reconnect-storm")) {
		scenarioResults.push(await runReconnectScenario(tunnels));
	}

	const durationMs = Math.round(performance.now() - startedAt);
	const statusCounts = mergeStatusCounts(
		scenarioResults.map((result) => result.statusCounts ?? {}),
	);
	const closeCounts = mergeStatusCounts(
		scenarioResults.map((result) => result.closeCounts ?? {}),
	);
	const ok = sumField(scenarioResults, "ok");
	const failed = sumField(scenarioResults, "failed");
	const attempted = ok + failed;
	const totalBytes = sumField(scenarioResults, "totalBytes");
	const reconnectRatePerSec = sumField(scenarioResults, "reconnects")
		? Number(
				(
					(sumField(scenarioResults, "reconnects") / Math.max(durationMs, 1)) *
					1000
				).toFixed(3),
			)
		: 0;

	return {
		date: new Date().toISOString(),
		serverUrl,
		publicUrls: tunnels.map((tunnel) => tunnel.publicUrl),
		concurrency,
		requests,
		tunnelCount: tunnels.length,
		scenarios: [...scenarios],
		scenarioResults,
		durationMs,
		ok,
		failed,
		statusCounts,
		p50Ms: percentile(allLatencies, 0.5),
		p95Ms: percentile(allLatencies, 0.95),
		p99Ms: percentile(allLatencies, 0.99),
		throughputRequestsPerSec: Math.round((ok / Math.max(durationMs, 1)) * 1000),
		throughputBytesPerSec: Math.round(
			(totalBytes / Math.max(durationMs, 1)) * 1000,
		),
		totalBytes,
		activeTunnels: externalPublicUrl ? "external" : tunnels.length,
		activeStreams: maxField(scenarioResults, "activeStreams"),
		activeWebSockets: maxField(scenarioResults, "activeWebSockets"),
		reconnectRatePerSec,
		protocolErrorRate: 0,
		status429: statusCounts["429"] ?? 0,
		status502: statusCounts["502"] ?? 0,
		close1011: closeCounts["1011"] ?? 0,
		close1012: closeCounts["1012"] ?? 0,
		streamAbortRate: attempted ? Number((failed / attempted).toFixed(6)) : 0,
		streamAbortRateSource: "black_box_failed_operations_ratio",
		cliDebugSamples: collectCliDebugSamples(tunnels),
		dataChannelBufferedAmountWaits: sumCliDebugLines(
			tunnels,
			"dataChannel bufferedAmount wait",
		),
		dataChannelBufferedAmountWaitsSource: externalPublicUrl
			? "not_available_for_external_public_url"
			: "temporary_cli_debug_output",
	};
}

async function runHttpScenario(name, tunnels, options) {
	const latencies = [];
	let ok = 0;
	let failed = 0;
	let activeRequests = 0;
	let maxActiveRequests = 0;
	let totalBytes = 0;
	const statusCounts = {};
	const failureSamples = [];
	const startedAt = performance.now();

	await Promise.all(
		Array.from({ length: concurrency }, async (_, workerId) => {
			for (let index = workerId; index < requests; index += concurrency) {
				const start = performance.now();
				const tunnel = tunnels[index % tunnels.length];
				const url = new URL(options.path, withTrailingSlash(tunnel.publicUrl));
				try {
					activeRequests += 1;
					maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
					const response = await fetch(url, {
						method: options.method,
						body: options.body,
					});
					const body = await response.arrayBuffer();
					totalBytes += body.byteLength + byteLength(options.body);
					addStatus(statusCounts, response.status);
					const decodedBody = decodeFailureBody(body);
					if (
						response.ok &&
						(options.expectedBody === undefined ||
							decodedBody === options.expectedBody)
					) {
						ok += 1;
					} else {
						failed += 1;
						addFailureSample(failureSamples, {
							status: response.status,
							body: decodedBody,
						});
					}
				} catch (error) {
					failed += 1;
					addStatus(statusCounts, "network_error");
					addFailureSample(failureSamples, {
						status: "network_error",
						body: error?.message ?? String(error),
					});
				} finally {
					activeRequests -= 1;
					latencies.push(performance.now() - start);
				}
			}
		}),
	);

	const durationMs = Math.round(performance.now() - startedAt);
	return {
		name,
		kind: "http",
		requests,
		ok,
		failed,
		statusCounts,
		durationMs,
		p50Ms: percentile(latencies, 0.5),
		p95Ms: percentile(latencies, 0.95),
		p99Ms: percentile(latencies, 0.99),
		throughputRequestsPerSec: Math.round((ok / Math.max(durationMs, 1)) * 1000),
		throughputBytesPerSec: Math.round(
			(totalBytes / Math.max(durationMs, 1)) * 1000,
		),
		totalBytes,
		activeStreams: maxActiveRequests,
		activeWebSockets: 0,
		failureSamples,
		latencies,
	};
}

async function runWebSocketScenario(name, tunnels, options) {
	const latencies = [];
	let ok = 0;
	let failed = 0;
	let messages = 0;
	let totalBytes = 0;
	let activeWebSockets = 0;
	let maxActiveWebSockets = 0;
	const closeCounts = {};
	const startedAt = performance.now();

	await Promise.all(
		Array.from({ length: options.connections }, async (_, index) => {
			const start = performance.now();
			let socket;
			try {
				activeWebSockets += 1;
				maxActiveWebSockets = Math.max(maxActiveWebSockets, activeWebSockets);
				const tunnel = tunnels[index % tunnels.length];
				socket = new WebSocket(toWebSocketUrl(tunnel.publicUrl, "ws"));
				await withTimeout(once(socket, "open"), 15_000, "WebSocket open");
				if (options.holdMs > 0) {
					await sleep(options.holdMs);
				}
				for (let frame = 0; frame < options.frames; frame += 1) {
					const payload =
						frame % 2 === 0
							? `load-${index}-${frame}`
							: Buffer.from([index & 255, frame & 255, 1, 2, 3]);
					socket.send(payload, { binary: Buffer.isBuffer(payload) });
					const [echo] = await withTimeout(
						once(socket, "message"),
						15_000,
						"WebSocket echo",
					);
					messages += 1;
					totalBytes += byteLength(payload) + byteLength(echo);
				}
				socket.close(1000, "load done");
				const [code] = await withTimeout(
					once(socket, "close"),
					15_000,
					"WebSocket close",
				);
				addStatus(closeCounts, code);
				if (code === 1000) {
					ok += 1;
				} else {
					failed += 1;
				}
			} catch {
				failed += 1;
				if (socket) {
					socket.terminate();
				}
			} finally {
				activeWebSockets -= 1;
				latencies.push(performance.now() - start);
			}
		}),
	);

	const durationMs = Math.round(performance.now() - startedAt);
	return {
		name,
		kind: "websocket",
		connections: options.connections,
		framesPerConnection: options.frames,
		messages,
		ok,
		failed,
		closeCounts,
		durationMs,
		p50Ms: percentile(latencies, 0.5),
		p95Ms: percentile(latencies, 0.95),
		p99Ms: percentile(latencies, 0.99),
		activeStreams: 0,
		activeWebSockets: maxActiveWebSockets,
		totalBytes,
		latencies,
	};
}

async function runReconnectScenario(tunnels) {
	const reconnectableTunnels = tunnels.filter(
		(tunnel) => tunnel.child?.stdin && tunnel.output,
	);
	const startedAt = performance.now();
	let ok = 0;
	let failed = 0;
	if (reconnectableTunnels.length === 0) {
		return {
			name: "reconnect-storm",
			kind: "reconnect",
			skipped: true,
			reason: "requires a temporary CLI tunnel",
			ok,
			failed,
			reconnects: 0,
			durationMs: 0,
			totalBytes: 0,
			activeStreams: 0,
			activeWebSockets: 0,
		};
	}

	for (let index = 0; index < reconnects; index += 1) {
		await Promise.all(
			reconnectableTunnels.map(async (tunnel) => {
				const readyCountBefore = countReadyLines(tunnel.output.text);
				tunnel.child.stdin.write("reconnect\n");
				try {
					await waitForReadyCount(tunnel.output, readyCountBefore + 1, 45_000);
					tunnel.publicUrl = latestPublicUrl(tunnel.output.text);
					const response = await fetch(tunnel.publicUrl);
					if (response.ok) {
						ok += 1;
					} else {
						failed += 1;
					}
				} catch {
					failed += 1;
				}
			}),
		);
	}

	const durationMs = Math.round(performance.now() - startedAt);
	return {
		name: "reconnect-storm",
		kind: "reconnect",
		reconnects: reconnects * reconnectableTunnels.length,
		ok,
		failed,
		durationMs,
		reconnectRatePerSec: Number(
			(
				((reconnects * reconnectableTunnels.length) / Math.max(durationMs, 1)) *
				1000
			).toFixed(3),
		),
		totalBytes: 0,
		activeStreams: 0,
		activeWebSockets: 0,
	};
}

async function createTemporaryStagingTunnels(count) {
	const tunnels = [];
	for (let index = 0; index < count; index += 1) {
		tunnels.push(await createTemporaryStagingTunnel());
	}
	return tunnels;
}

async function createTemporaryStagingTunnel() {
	const local = await startLocalLoadServer();
	locals.push(local);
	const child = spawn(
		"node",
		[
			"apps/cli/dist/index.js",
			String(local.port),
			"--server",
			serverUrl,
			"--data-channels",
			"2",
		],
		{
			cwd: repoRoot,
			detached: true,
			env: {
				...process.env,
				HOSTC_DEBUG: "1",
				HOSTC_E2E_RECONNECT_SIGNAL: "1",
				HOSTC_E2E_RECONNECT_STDIN: "1",
			},
			stdio: ["pipe", "pipe", "pipe"],
		},
	);
	processes.push(child);
	const output = collectChildOutput(child);
	return {
		publicUrl: await waitForPublicUrl(output, 45_000),
		child,
		output,
		source: "temporary-cli",
	};
}

async function startLocalLoadServer() {
	const largeBody = Buffer.alloc(largeBytes, "d");
	const server = createServer((request, response) => {
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		if (request.method === "GET" && url.pathname === "/large") {
			response.writeHead(200, { "content-type": "application/octet-stream" });
			response.end(largeBody);
			return;
		}
		if (request.method === "POST" && url.pathname === "/upload") {
			let bytes = 0;
			request.on("data", (chunk) => {
				bytes += chunk.byteLength;
			});
			request.on("end", () => {
				response.writeHead(200, { "content-type": "text/plain" });
				response.end(String(bytes));
			});
			return;
		}
		response.writeHead(200, { "content-type": "text/plain" });
		response.end("ok");
	});
	const wss = new WebSocketServer({ noServer: true });
	wss.on("connection", (socket) => {
		socket.on("message", (data, isBinary) =>
			socket.send(data, { binary: isBinary }),
		);
	});
	server.on("upgrade", (request, socket, head) => {
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		if (url.pathname !== "/ws") {
			socket.destroy();
			return;
		}
		wss.handleUpgrade(request, socket, head, (ws) =>
			wss.emit("connection", ws, request),
		);
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	return {
		port: server.address().port,
		close: () =>
			new Promise((resolve) => {
				wss.close(() => server.close(resolve));
			}),
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

async function waitForPublicUrl(output, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const match = output.text.match(/Public URL:\s+(https?:\/\/\S+)/);
		if (match) {
			return match[1];
		}
		await sleep(100);
	}
	throw new Error(`Timed out waiting for CLI public URL:\n${output.text}`);
}

async function waitForReadyCount(output, expectedCount, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (countReadyLines(output.text) >= expectedCount) {
			return;
		}
		await sleep(100);
	}
	throw new Error(`Timed out waiting for CLI reconnect:\n${output.text}`);
}

function countReadyLines(output) {
	return output.match(/^.*Tunnel ready/gm)?.length ?? 0;
}

function latestPublicUrl(output) {
	const matches = [...output.matchAll(/^\s*Public URL:\s+(https?:\/\/\S+)/gm)];
	if (matches.length === 0) {
		throw new Error(`No public URL found:\n${output}`);
	}
	return matches[matches.length - 1][1];
}

function sumCliDebugLines(tunnels, phrase) {
	return tunnels.reduce(
		(total, tunnel) => total + countCliDebugLines(tunnel.output, phrase),
		0,
	);
}

function countCliDebugLines(output, phrase) {
	if (!output) {
		return 0;
	}
	const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return (
		output.text.match(new RegExp(`^\\[hostc:debug\\] ${escaped}$`, "gm"))
			?.length ?? 0
	);
}

function collectCliDebugSamples(tunnels) {
	return tunnels
		.flatMap((tunnel) =>
			(tunnel.output?.text ?? "")
				.split("\n")
				.filter((line) => line.startsWith("[hostc:debug] "))
				.slice(-10),
		)
		.slice(-20);
}

function appendScenario(results, allLatencies, result) {
	allLatencies.push(...(result.latencies ?? []));
	const { latencies: _latencies, ...publicResult } = result;
	results.push(publicResult);
}

function readScenarios() {
	const defaultScenarios = externalPublicUrl
		? "http-get"
		: "http-get,large-download,large-upload,websocket-long,websocket-burst,idle-websocket,reconnect-storm";
	const names = (process.env.HOSTC_LOAD_SCENARIOS ?? defaultScenarios)
		.split(",")
		.map((name) => name.trim())
		.filter(Boolean);
	const allowed = new Set([
		"http-get",
		"large-download",
		"large-upload",
		"websocket-long",
		"websocket-burst",
		"idle-websocket",
		"reconnect-storm",
	]);
	for (const name of names) {
		if (!allowed.has(name)) {
			throw new Error(`Unknown load scenario: ${name}`);
		}
	}
	return new Set(names);
}

function readPositiveInteger(name, defaultValue) {
	const raw = process.env[name];
	if (raw === undefined) {
		return defaultValue;
	}
	const parsed = Number(raw);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive integer`);
	}
	return parsed;
}

function mergeStatusCounts(counts) {
	const merged = {};
	for (const count of counts) {
		for (const [key, value] of Object.entries(count)) {
			merged[key] = (merged[key] ?? 0) + value;
		}
	}
	return merged;
}

function addStatus(statusCounts, status) {
	const key = String(status);
	statusCounts[key] = (statusCounts[key] ?? 0) + 1;
}

function addFailureSample(samples, sample) {
	if (samples.length >= 5) {
		return;
	}
	samples.push(sample);
}

function decodeFailureBody(body) {
	return Buffer.from(body).toString("utf8").slice(0, 512);
}

function byteLength(value) {
	if (value === undefined || value === null) {
		return 0;
	}
	if (typeof value === "string") {
		return Buffer.byteLength(value);
	}
	if (Buffer.isBuffer(value)) {
		return value.byteLength;
	}
	if (value instanceof ArrayBuffer) {
		return value.byteLength;
	}
	if (ArrayBuffer.isView(value)) {
		return value.byteLength;
	}
	if (Array.isArray(value)) {
		return value.reduce((total, chunk) => total + byteLength(chunk), 0);
	}
	return Buffer.byteLength(String(value));
}

function sumField(values, field) {
	return values.reduce((total, value) => total + (value[field] ?? 0), 0);
}

function maxField(values, field) {
	return values.reduce(
		(maximum, value) => Math.max(maximum, value[field] ?? 0),
		0,
	);
}

function percentile(values, percentileValue) {
	if (values.length === 0) {
		return null;
	}
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.min(
		sorted.length - 1,
		Math.floor((sorted.length - 1) * percentileValue),
	);
	return Number(sorted[index].toFixed(3));
}

function withTrailingSlash(url) {
	return url.endsWith("/") ? url : `${url}/`;
}

function toWebSocketUrl(publicUrl, path) {
	const url = new URL(path, withTrailingSlash(publicUrl));
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	return url;
}

async function withTimeout(promise, timeoutMs, label) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`${label} timed out`)),
					timeoutMs,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

async function stopChild(child) {
	if (child.exitCode !== null || child.signalCode !== null) {
		return;
	}
	try {
		process.kill(-child.pid, "SIGTERM");
	} catch {
		child.kill("SIGTERM");
	}
	const exited = once(child, "exit").then(() => true);
	const timedOut = sleep(2000).then(() => false);
	if (!(await Promise.race([exited, timedOut]))) {
		try {
			process.kill(-child.pid, "SIGKILL");
		} catch {
			child.kill("SIGKILL");
		}
		await once(child, "exit").catch(() => undefined);
	}
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
