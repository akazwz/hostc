import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, request as httpRequest } from "node:http";
import { createRequire } from "node:module";
import {
	CLOSE_PROTOCOL_ERROR,
	encodeDataFrame,
} from "../packages/protocol/dist/index.js";

const require = createRequire(
	new URL("../apps/server/package.json", import.meta.url),
);
const { WebSocket, WebSocketServer } = require("ws");

const REPO_ROOT = new URL("..", import.meta.url);
const SERVER_URL = process.env.HOSTC_SERVER_URL ?? "http://127.0.0.1:8787";
const SERVER_PORT = Number(new URL(SERVER_URL).port || "8787");

const local = await startLocalEchoServer();
const processes = [];

try {
	const wrangler = spawn(
		"pnpm",
		[
			"-F",
			"@hostc/server",
			"dev",
			"--port",
			String(SERVER_PORT),
			"--var",
			"TOKEN_SECRET:dev-only-local-e2e-secret-at-least-32-bytes",
			"--var",
			"ALLOW_LOCAL_TUNNEL_HEADER:1",
		],
		{ cwd: REPO_ROOT, detached: true, stdio: ["ignore", "pipe", "pipe"] },
	);
	processes.push(wrangler);
	await waitForHttp(`${SERVER_URL}/health`, 30_000);
	const publicBase = new URL(SERVER_URL);
	await assertTunnelNotReady(publicBase);
	await assertProtocolInvalidDataFrame(publicBase);
	await assertProtocolCreditViolation(publicBase);
	await assertProtocolControlClose(publicBase);
	await assertProtocolDataClose(publicBase);

	const cli = spawn(
		"node",
		[
			"apps/cli/dist/index.js",
			String(local.port),
			"--server",
			SERVER_URL,
			"--data-channels",
			"2",
		],
		{
			cwd: REPO_ROOT,
			detached: true,
			env: {
				...process.env,
				HOSTC_E2E_RECONNECT_SIGNAL: "1",
				HOSTC_E2E_RECONNECT_STDIN: "1",
			},
			stdio: ["pipe", "pipe", "pipe"],
		},
	);
	processes.push(cli);
	const cliOutput = collectChildOutput(cli);
	const publicUrl = await waitForPublicUrl(cliOutput, 30_000);
	const publicHost = new URL(publicUrl).host;

	await assertHttpGet(publicBase, publicHost);
	await assertHttpPost(publicBase, publicHost);
	await assertLargeUpload(publicBase, publicHost);
	await assertStreaming(publicBase, publicHost);
	await assertSlowResponseStart(publicBase, publicHost);
	await assertPublicClientCancel(publicBase, publicHost);
	await assertLocalUpstreamError(publicBase, publicHost);
	await assertWebSocket(publicBase, publicHost, false);
	await assertWebSocket(publicBase, publicHost, true);
	await assertWebSocketSubprotocol(publicBase, publicHost);
	await assertPublicWebSocketClose(publicBase, publicHost);
	await assertCliReconnect(cli, cliOutput, publicBase, publicHost);

	console.log(
		JSON.stringify(
			{
				ok: true,
				serverUrl: SERVER_URL,
				publicUrl,
				scenarios: [
					"HTTP GET",
					"HTTP POST body",
					"large upload",
					"streaming response",
					"slow response start",
					"public client cancel",
					"local upstream error",
					"WebSocket text echo",
					"WebSocket binary echo",
					"WebSocket subprotocol selection",
					"public WebSocket close",
					"CLI reconnect",
					"tunnel not ready error",
					"protocol invalid data frame",
					"protocol credit violation",
					"control close invalidates tunnel",
					"data close invalidates tunnel",
				],
			},
			null,
			2,
		),
	);
} finally {
	for (const child of processes.reverse()) {
		await stopChild(child);
	}
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
		if (request.url === "/slow-start") {
			setTimeout(() => {
				response.writeHead(200, { "content-type": "text/plain" });
				response.end("slow");
			}, 100);
			return;
		}
		if (request.url === "/slow-cancel") {
			response.writeHead(200, { "content-type": "text/plain" });
			response.write("first");
			setTimeout(() => {
				if (!response.destroyed) {
					response.end("second");
				}
			}, 500);
			return;
		}
		if (request.url === "/upstream-error") {
			request.socket.destroy();
			return;
		}
		if (request.method === "POST") {
			const chunks = [];
			request.on("data", (chunk) => chunks.push(chunk));
			request.on("end", () => {
				response.writeHead(200, { "content-type": "application/octet-stream" });
				response.end(Buffer.concat(chunks));
			});
			return;
		}
		response.writeHead(200, { "content-type": "text/plain" });
		response.end("ok");
	});
	const wss = new WebSocketServer({
		noServer: true,
		handleProtocols: (protocols) =>
			protocols.has("hostc-test") ? "hostc-test" : false,
	});
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
	const address = server.address();
	return {
		port: address.port,
		close: () =>
			new Promise((resolve) => {
				wss.close(() => server.close(resolve));
			}),
	};
}

async function waitForHttp(url, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(url);
			if (response.ok) {
				return;
			}
		} catch {
			// Retry while wrangler boots.
		}
		await sleep(250);
	}
	throw new Error(`Timed out waiting for ${url}`);
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

async function assertTunnelNotReady(publicBase) {
	const response = await fetch(new URL("/api/tunnels", publicBase), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ dataChannels: 1 }),
	});
	if (!response.ok) {
		throw new Error(`create unconnected tunnel returned ${response.status}`);
	}
	const body = await response.json();
	const publicHost = new URL(body.publicUrl).host;
	await assertPublicTunnelNotReady(publicBase, publicHost);
}

async function assertProtocolInvalidDataFrame(publicBase) {
	const tunnel = await createProtocolTunnel(publicBase, 1);
	const connection = await openProtocolConnection(tunnel);
	try {
		const dataClosed = waitForSocketClose(connection.data[0]);
		connection.data[0].send(Buffer.from([0, 1, 2]), { binary: true });
		const dataClose = await dataClosed;
		if (dataClose.code !== CLOSE_PROTOCOL_ERROR) {
			throw new Error(
				`invalid data frame closed data socket with ${dataClose.code}`,
			);
		}
		await assertPublicTunnelNotReady(
			publicBase,
			new URL(tunnel.publicUrl).host,
		);
	} finally {
		closeProtocolConnection(connection);
	}
}

async function assertProtocolCreditViolation(publicBase) {
	const tunnel = await createProtocolTunnel(publicBase, 1);
	const connection = await openProtocolConnection(tunnel);
	try {
		const publicHost = new URL(tunnel.publicUrl).host;
		const publicResponse = publicRequest(publicBase, publicHost, "/credit");
		const requestStart = await waitForControlMessage(
			connection.control,
			"request.start",
		);
		const closed = waitForSocketClose(connection.data[0]);
		const payload = Buffer.alloc(64 * 1024, "x");
		for (let seq = 0; seq < 17; seq += 1) {
			connection.data[0].send(
				encodeDataFrame({
					kind: "response.body",
					id: requestStart.id,
					seq,
					payload,
				}),
			);
		}
		const dataClose = await closed;
		if (dataClose.code !== CLOSE_PROTOCOL_ERROR) {
			throw new Error(
				`credit violation closed with ${dataClose.code}: ${dataClose.reason}`,
			);
		}
		const response = await publicResponse;
		if (response.status !== 502) {
			throw new Error(
				`credit violation public response was ${response.status}`,
			);
		}
	} finally {
		closeProtocolConnection(connection);
	}
}

async function assertProtocolControlClose(publicBase) {
	const tunnel = await createProtocolTunnel(publicBase, 1);
	const connection = await openProtocolConnection(tunnel);
	try {
		connection.control.close(1000, "test control close");
		await waitForPublicTunnelNotReady(
			publicBase,
			new URL(tunnel.publicUrl).host,
		);
	} finally {
		closeProtocolConnection(connection);
	}
}

async function assertProtocolDataClose(publicBase) {
	const tunnel = await createProtocolTunnel(publicBase, 1);
	const connection = await openProtocolConnection(tunnel);
	try {
		connection.data[0].close(1000, "test data close");
		await waitForPublicTunnelNotReady(
			publicBase,
			new URL(tunnel.publicUrl).host,
		);
	} finally {
		closeProtocolConnection(connection);
	}
}

async function createProtocolTunnel(publicBase, dataChannels) {
	const response = await fetch(new URL("/api/tunnels", publicBase), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ dataChannels }),
	});
	if (!response.ok) {
		throw new Error(`create protocol tunnel returned ${response.status}`);
	}
	return response.json();
}

async function openProtocolConnection(tunnel) {
	const control = new WebSocket(rewriteLocalWsUrl(tunnel.controlUrl), {
		headers: { authorization: `Bearer ${tunnel.connectToken}` },
	});
	await once(control, "open");
	const data = await Promise.all(
		Array.from({ length: tunnel.dataChannels }, async (_, channelId) => {
			const url = new URL(rewriteLocalWsUrl(tunnel.dataUrl));
			url.searchParams.set("channel", String(channelId));
			url.searchParams.set("connectionId", tunnel.connectionId);
			const socket = new WebSocket(url, {
				headers: { authorization: `Bearer ${tunnel.connectToken}` },
			});
			await once(socket, "open");
			return socket;
		}),
	);
	return { control, data };
}

function rewriteLocalWsUrl(rawUrl) {
	const url = new URL(rawUrl);
	const local = new URL(SERVER_URL);
	url.protocol = local.protocol === "https:" ? "wss:" : "ws:";
	url.hostname = local.hostname;
	url.port = local.port;
	return url.toString();
}

function closeProtocolConnection(connection) {
	for (const socket of [connection.control, ...connection.data]) {
		if (socket.readyState === WebSocket.OPEN) {
			socket.close();
		}
	}
}

async function assertPublicTunnelNotReady(publicBase, publicHost) {
	const probe = await publicRequest(publicBase, publicHost, "/", {
		headers: { accept: "application/json" },
	});
	if (probe.status !== 502 || !probe.body.includes("Tunnel not ready")) {
		throw new Error(`tunnel not ready returned ${probe.status}: ${probe.body}`);
	}
}

async function waitForPublicTunnelNotReady(publicBase, publicHost) {
	const deadline = Date.now() + 5000;
	let lastError;
	while (Date.now() < deadline) {
		try {
			await assertPublicTunnelNotReady(publicBase, publicHost);
			return;
		} catch (error) {
			lastError = error;
		}
		await sleep(100);
	}
	throw new Error(
		`Timed out waiting for tunnel not ready: ${
			lastError?.message ?? "unknown"
		}`,
	);
}

async function waitForControlMessage(socket, type) {
	for (;;) {
		const [raw] = await onceWithTimeout(
			socket,
			"message",
			5000,
			`Timed out waiting for ${type}`,
		);
		const parsed = JSON.parse(raw.toString());
		if (parsed.type === type) {
			return parsed;
		}
	}
}

async function waitForSocketClose(socket) {
	const [code, reason] = await onceWithTimeout(
		socket,
		"close",
		5000,
		"Timed out waiting for socket close",
	);
	return { code, reason: reason.toString() };
}

function onceWithTimeout(target, eventName, timeoutMs, message) {
	return Promise.race([
		once(target, eventName),
		sleep(timeoutMs).then(() => {
			throw new Error(message);
		}),
	]);
}

async function assertHttpGet(publicBase, publicHost) {
	const response = await publicRequest(publicBase, publicHost, "/");
	if (response.body !== "ok") {
		throw new Error(`HTTP GET failed (${response.status}): ${response.body}`);
	}
}

async function assertHttpPost(publicBase, publicHost) {
	const response = await publicRequest(publicBase, publicHost, "/upload", {
		method: "POST",
		body: "hello",
	});
	if (response.body !== "hello") {
		throw new Error("HTTP POST body failed");
	}
}

async function assertLargeUpload(publicBase, publicHost) {
	const payload = Buffer.alloc(192 * 1024, "a");
	const response = await publicRequest(
		publicBase,
		publicHost,
		"/large-upload",
		{
			method: "POST",
			body: payload,
		},
	);
	if (!response.bodyBuffer.equals(payload)) {
		throw new Error("large upload failed");
	}
}

async function assertStreaming(publicBase, publicHost) {
	const response = await publicRequest(publicBase, publicHost, "/stream");
	if (response.body !== "ab") {
		throw new Error("streaming response failed");
	}
}

async function assertSlowResponseStart(publicBase, publicHost) {
	const response = await publicRequest(publicBase, publicHost, "/slow-start");
	if (response.body !== "slow") {
		throw new Error("slow response start failed");
	}
}

async function assertPublicClientCancel(publicBase, publicHost) {
	await new Promise((resolve, reject) => {
		const request = publicRawRequest(publicBase, publicHost, "/slow-cancel");
		request.on("response", (response) => {
			response.once("data", () => {
				request.destroy();
				resolve();
			});
		});
		request.on("error", (error) => {
			if (error.code === "ECONNRESET") {
				resolve();
			} else {
				reject(error);
			}
		});
		request.end();
	});
}

async function assertLocalUpstreamError(publicBase, publicHost) {
	const response = await publicRequest(
		publicBase,
		publicHost,
		"/upstream-error",
	);
	if (response.status !== 502) {
		throw new Error(`local upstream error returned ${response.status}`);
	}
}

async function assertWebSocket(publicBase, publicHost, binary, protocols = []) {
	const url = new URL("/socket", publicBase);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	const socket = new WebSocket(url, protocols, {
		headers: { "x-hostc-local-tunnel-host": publicHost },
	});
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
	return socket.protocol;
}

async function assertWebSocketSubprotocol(publicBase, publicHost) {
	const protocol = await assertWebSocket(publicBase, publicHost, false, [
		"hostc-test",
	]);
	if (protocol !== "hostc-test") {
		throw new Error(`WebSocket subprotocol failed: ${protocol}`);
	}
}

async function assertPublicWebSocketClose(publicBase, publicHost) {
	const url = new URL("/socket", publicBase);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	const socket = new WebSocket(url, {
		headers: { "x-hostc-local-tunnel-host": publicHost },
	});
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

async function assertCliReconnect(child, output, publicBase, publicHost) {
	const readyCountBefore = countReadyLines(output.text);
	child.stdin.write("reconnect\n");
	await waitForReadyCount(output, readyCountBefore + 1, 20_000);
	const deadline = Date.now() + 10_000;
	let lastError;
	while (Date.now() < deadline) {
		try {
			const response = await publicRequest(publicBase, publicHost, "/");
			if (response.status === 200 && response.body === "ok") {
				return;
			}
			lastError = new Error(
				`reconnect probe returned ${response.status}: ${response.body}`,
			);
		} catch (error) {
			lastError = error;
		}
		await sleep(250);
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

function publicRequest(publicBase, publicHost, pathname, init = {}) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		const request = publicRawRequest(publicBase, publicHost, pathname, init);
		request.on("response", (response) => {
			response.on("data", (chunk) => chunks.push(chunk));
			response.on("end", () => {
				const bodyBuffer = Buffer.concat(chunks);
				resolve({
					status: response.statusCode,
					headers: response.headers,
					body: bodyBuffer.toString("utf8"),
					bodyBuffer,
				});
			});
		});
		request.on("error", reject);
		if (init.body) {
			request.write(init.body);
		}
		request.end();
	});
}

function publicRawRequest(publicBase, publicHost, pathname, init = {}) {
	return httpRequest({
		hostname: publicBase.hostname,
		port: publicBase.port,
		path: pathname,
		method: init.method ?? "GET",
		headers: {
			...(init.headers ?? {}),
			"x-hostc-local-tunnel-host": publicHost,
		},
	});
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
