import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { WebSocket, WebSocketServer } = require("ws");

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const serverUrl = process.env.HOSTC_SERVER_URL ?? "https://envoq.dev";
const local = await startLocalEchoServer();
const cli = spawn(
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
			HOSTC_E2E_RECONNECT_SIGNAL: "1",
			HOSTC_E2E_RECONNECT_STDIN: "1",
		},
		stdio: ["pipe", "pipe", "pipe"],
	},
);
const cliOutput = collectChildOutput(cli);

try {
	const publicUrl = await waitForPublicUrl(cliOutput, 45_000);
	if (!publicUrl.endsWith(".envoq.dev/") && !publicUrl.includes(".envoq.dev")) {
		throw new Error(`Expected envoq.dev public URL, got ${publicUrl}`);
	}
	await assertTunnelNotReady(serverUrl);
	await assertText(publicTunnelUrl(publicUrl, ""), "ok");
	await assertText(publicTunnelUrl(publicUrl, "stream"), "ab");
	await assertText(publicTunnelUrl(publicUrl, "upload"), "hello", {
		method: "POST",
		body: "hello",
	});
	await assertWebSocket(
		new URL("socket", publicTunnelUrl(publicUrl, "")),
		false,
	);
	await assertWebSocket(
		new URL("socket", publicTunnelUrl(publicUrl, "")),
		true,
	);
	await assertPublicWebSocketClose(
		new URL("socket", publicTunnelUrl(publicUrl, "")),
	);
	await assertCliReconnect(cli, cliOutput, publicUrl);
	const result = {
		ok: true,
		date: new Date().toISOString(),
		serverUrl,
		publicUrl,
		scenarios: [
			"POST /api/tunnels",
			"CLI staging connect",
			"wildcard TLS public URL",
			"HTTP GET",
			"HTTP POST body",
			"streaming response",
			"WebSocket text echo",
			"WebSocket binary echo",
			"public WebSocket close",
			"CLI reconnect",
			"tunnel not ready error",
		],
	};
	const artifactPath = join(
		repoRoot,
		"artifacts",
		"e2e",
		`staging-${new Date().toISOString().replaceAll(/[-:]/g, "").slice(0, 13)}.json`,
	);
	await mkdir(dirname(artifactPath), { recursive: true });
	await writeFile(artifactPath, `${JSON.stringify(result, null, 2)}\n`);
	console.log(JSON.stringify({ ...result, artifactPath }, null, 2));
} finally {
	await stopChild(cli);
	await local.close();
}

async function startLocalEchoServer() {
	const server = createServer((request, response) => {
		if (request.url === "/stream") {
			response.writeHead(200, { "content-type": "text/plain" });
			response.write("a");
			setTimeout(() => response.end("b"), 25);
			return;
		}
		if (request.method === "POST") {
			const chunks = [];
			request.on("data", (chunk) => chunks.push(chunk));
			request.on("end", () => {
				response.writeHead(200, { "content-type": "text/plain" });
				response.end(Buffer.concat(chunks));
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

async function assertTunnelNotReady(baseUrl) {
	const response = await fetch(new URL("/api/tunnels", baseUrl), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ dataChannels: 1 }),
	});
	if (!response.ok) {
		throw new Error(`create unconnected tunnel returned ${response.status}`);
	}
	const body = await response.json();
	if (
		typeof body.publicUrl !== "string" ||
		!body.publicUrl.includes(".envoq.dev")
	) {
		throw new Error(`unexpected unconnected public URL: ${body.publicUrl}`);
	}
	const probe = await fetch(body.publicUrl, {
		headers: { accept: "application/json" },
	});
	if (probe.status !== 502) {
		throw new Error(`unconnected tunnel returned ${probe.status}`);
	}
	const text = await probe.text();
	if (!text.includes("Tunnel not ready")) {
		throw new Error(`unconnected tunnel response was ${text}`);
	}
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

async function assertText(url, expected, init) {
	const response = await fetch(url, init);
	if (!response.ok) {
		throw new Error(`${url} returned ${response.status}`);
	}
	const text = await response.text();
	if (text !== expected) {
		throw new Error(`${url} returned ${text}, expected ${expected}`);
	}
}

async function assertWebSocket(url, binary) {
	const socket = new WebSocket(url);
	await once(socket, "open");
	const expected = binary ? Buffer.from([1, 2, 3]) : "hello";
	socket.send(expected, { binary });
	const [data] = await once(socket, "message");
	socket.close();
	if (binary && !Buffer.from(data).equals(expected)) {
		throw new Error("WebSocket binary echo failed");
	}
	if (!binary && data.toString() !== expected) {
		throw new Error("WebSocket text echo failed");
	}
}

async function assertPublicWebSocketClose(url) {
	const socket = new WebSocket(url);
	await once(socket, "open");
	socket.close(1000, "client done");
	const [code] = await Promise.race([
		once(socket, "close"),
		sleep(5000).then(() => {
			throw new Error("Timed out waiting for public WebSocket close");
		}),
	]);
	if (code !== 1000) {
		throw new Error(`public WebSocket close returned ${code}`);
	}
}

async function assertCliReconnect(child, output, publicUrl) {
	const readyCountBefore = countReadyLines(output.text);
	child.stdin.write("reconnect\n");
	await waitForReadyCount(output, readyCountBefore + 1, 30_000);
	const deadline = Date.now() + 20_000;
	let lastError;
	while (Date.now() < deadline) {
		try {
			await assertText(publicTunnelUrl(publicUrl, ""), "ok");
			return;
		} catch (error) {
			lastError = error;
		}
		await sleep(500);
	}
	throw new Error(
		`CLI reconnect failed: ${lastError?.message ?? "timeout"}\n${output.text}`,
	);
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
	return output.match(/^Tunnel ready /gm)?.length ?? 0;
}

function publicTunnelUrl(base, pathname) {
	const normalizedBase = base.endsWith("/") ? base : `${base}/`;
	return new URL(pathname, normalizedBase).toString();
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
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
