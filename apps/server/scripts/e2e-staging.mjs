import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	HostcClient,
	localOriginAdapter,
} from "../../../packages/client/dist/index.js";

const require = createRequire(import.meta.url);
const { WebSocket, WebSocketServer } = require("ws");

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const serverUrl = process.env.HOSTC_SERVER_URL ?? "https://envoq.dev";
const VIDEO_BYTES = makeVideoFixture(2 * 1024 * 1024);
const local = await startLocalEchoServer();
const client = new HostcClient({
	serverUrl,
	dataChannels: 2,
	upstream: localOriginAdapter({ origin: `http://127.0.0.1:${local.port}/` }),
});
const readyEvents = [];
client.on("ready", (event) => readyEvents.push(event));
const running = client.start();

try {
	const ready = await waitForReadyCount(readyEvents, 1, 45_000);
	const publicUrl = ready.publicUrl;
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
	await assertVideoRangeCancel(publicUrl, readyEvents);
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
	const reconnectPublicUrl = await assertSdkReconnect(client, readyEvents);

	const result = {
		ok: true,
		date: new Date().toISOString(),
		serverUrl,
		publicUrl,
		reconnectPublicUrl,
		scenarios: [
			"POST /api/tunnels/ephemeral",
			"SDK staging connect",
			"wildcard TLS public URL",
			"HTTP GET",
			"HTTP POST body",
			"streaming response",
			"HTTP media Range cancel",
			"WebSocket text echo",
			"WebSocket binary echo",
			"public WebSocket close",
			"SDK reconnect",
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
	await client.stop();
	await Promise.race([running.catch(() => undefined), sleep(1000)]);
	await local.close();
}

async function startLocalEchoServer() {
	const server = createServer((request, response) => {
		if (request.url?.startsWith("/video.mp4")) {
			serveVideoRange(request, response);
			return;
		}
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

async function assertVideoRangeCancel(publicUrl, readyEvents) {
	const readyCountBefore = readyEvents.length;
	const first = await fetch(
		publicTunnelUrl(publicUrl, "video.mp4?case=range"),
		{
			headers: {
				"if-range": '"hostc-video-fixture"',
				range: "bytes=0-1572863",
			},
		},
	);
	if (first.status !== 206) {
		throw new Error(`first video range returned ${first.status}`);
	}
	if (!first.headers.get("content-range")?.startsWith("bytes 0-1572863/")) {
		throw new Error(
			`first video range content-range was ${first.headers.get("content-range")}`,
		);
	}
	const reader = first.body?.getReader();
	if (!reader) {
		throw new Error("first video range response has no body");
	}
	const firstChunk = await reader.read();
	if (firstChunk.done || !firstChunk.value?.byteLength) {
		throw new Error("first video range produced no data before cancel");
	}
	void reader.cancel("simulate browser media seek").catch(() => undefined);
	await sleep(25);

	const second = await fetch(
		publicTunnelUrl(publicUrl, "video.mp4?case=range"),
		{
			headers: {
				"if-range": '"hostc-video-fixture"',
				range: "bytes=1048576-1572863",
			},
		},
	);
	const secondBody = new Uint8Array(await second.arrayBuffer());
	if (second.status !== 206) {
		throw new Error(
			`second video range returned ${second.status}: ${decodeText(secondBody)}`,
		);
	}
	if (secondBody.byteLength !== 524288) {
		throw new Error(
			`second video range returned ${secondBody.byteLength} bytes`,
		);
	}
	await sleep(1000);
	if (readyEvents.length !== readyCountBefore) {
		throw new Error("video range cancel caused SDK reconnect");
	}
}

async function assertTunnelNotReady(baseUrl) {
	const response = await fetch(new URL("/api/tunnels/ephemeral", baseUrl), {
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

async function assertText(url, expected, init) {
	const response = await fetch(url, init);
	const text = await response.text();
	if (!response.ok) {
		throw new Error(`${url} returned ${response.status}: ${text}`);
	}
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

async function assertSdkReconnect(client, readyEvents) {
	const readyCountBefore = readyEvents.length;
	client.forceReconnect("staging e2e reconnect");
	const ready = await waitForReadyCount(
		readyEvents,
		readyCountBefore + 1,
		45_000,
	);
	const publicUrl = ready.publicUrl;
	await sleep(1000);
	await retryUntil(30_000, () =>
		assertText(publicTunnelUrl(publicUrl, ""), "ok"),
	);
	return publicUrl;
}

async function waitForReadyCount(readyEvents, expectedCount, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (readyEvents.length >= expectedCount) {
			return readyEvents[expectedCount - 1];
		}
		await sleep(100);
	}
	throw new Error(`Timed out waiting for SDK ready count ${expectedCount}`);
}

async function retryUntil(timeoutMs, fn) {
	const deadline = Date.now() + timeoutMs;
	let lastError;
	while (Date.now() < deadline) {
		try {
			return await fn();
		} catch (error) {
			lastError = error;
		}
		await sleep(500);
	}
	throw lastError;
}

function publicTunnelUrl(base, pathname) {
	const normalizedBase = base.endsWith("/") ? base : `${base}/`;
	return new URL(pathname, normalizedBase).toString();
}

function serveVideoRange(request, response) {
	const range = parseRange(request.headers.range, VIDEO_BYTES.byteLength);
	if (!range) {
		response.writeHead(200, {
			"accept-ranges": "bytes",
			"content-length": VIDEO_BYTES.byteLength,
			"content-type": "video/mp4",
			etag: '"hostc-video-fixture"',
		});
		streamBytes(response, VIDEO_BYTES);
		return;
	}
	const body = VIDEO_BYTES.subarray(range.start, range.end + 1);
	response.writeHead(206, {
		"accept-ranges": "bytes",
		"content-length": body.byteLength,
		"content-range": `bytes ${range.start}-${range.end}/${VIDEO_BYTES.byteLength}`,
		"content-type": "video/mp4",
		etag: '"hostc-video-fixture"',
	});
	streamBytes(response, body);
}

function parseRange(header, size) {
	const match = /^bytes=(\d+)-(\d*)$/.exec(header ?? "");
	if (!match) {
		return null;
	}
	const start = Number(match[1]);
	const requestedEnd = match[2] ? Number(match[2]) : size - 1;
	if (
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(requestedEnd) ||
		start < 0 ||
		requestedEnd < start ||
		start >= size
	) {
		return null;
	}
	return { start, end: Math.min(requestedEnd, size - 1) };
}

function streamBytes(response, bytes) {
	const chunkBytes = 64 * 1024;
	let offset = 0;
	const interval = setInterval(() => {
		if (offset >= bytes.byteLength) {
			clearInterval(interval);
			response.end();
			return;
		}
		const chunk = bytes.subarray(offset, offset + chunkBytes);
		offset += chunk.byteLength;
		response.write(chunk);
	}, 5);
	response.on("close", () => clearInterval(interval));
}

function makeVideoFixture(size) {
	const bytes = Buffer.alloc(size);
	for (let index = 0; index < bytes.byteLength; index += 1) {
		bytes[index] = index % 251;
	}
	return bytes;
}

function decodeText(bytes) {
	return new TextDecoder().decode(bytes);
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
