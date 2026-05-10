import { Buffer } from "node:buffer";
import { once } from "node:events";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import {
	decodeFrame,
	decodeMetadata,
	defaultTunnelLimits,
	encodeFrame,
	encodeMetadata,
	FRAME_TYPE_REQUEST_DATA,
	FRAME_TYPE_REQUEST_END,
	FRAME_TYPE_REQUEST_START,
	FRAME_TYPE_RESPONSE_ABORT,
	FRAME_TYPE_RESPONSE_DATA,
	FRAME_TYPE_RESPONSE_END,
	FRAME_TYPE_RESPONSE_START,
	PROTOCOL_VERSION,
	TUNNEL_KIND_EPHEMERAL,
} from "../packages/protocol/dist/index.js";

const require = createRequire(
	new URL("../packages/client/package.json", import.meta.url),
);
const { WebSocketServer, WebSocket } = require("ws");

export { WebSocket };

export function readIntEnv(name, fallback) {
	const raw = process.env[name];
	if (!raw) return fallback;
	const value = Number.parseInt(raw, 10);
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function percentile(values, percentileRank) {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.min(
		sorted.length - 1,
		Math.ceil((percentileRank / 100) * sorted.length) - 1,
	);
	return sorted[index];
}

export async function runConcurrent(total, concurrency, task) {
	let next = 0;
	let ok = 0;
	let failed = 0;
	const latenciesMs = [];

	async function worker() {
		while (next < total) {
			const index = next;
			next += 1;
			const started = performance.now();
			try {
				await task(index);
				ok += 1;
			} catch (error) {
				failed += 1;
				if (failed <= 5) {
					console.error(
						`[hostc] request ${index} failed:`,
						error?.message ?? error,
					);
				}
			} finally {
				latenciesMs.push(performance.now() - started);
			}
		}
	}

	const started = performance.now();
	await Promise.all(
		Array.from({ length: Math.min(total, concurrency) }, () => worker()),
	);
	const durationMs = performance.now() - started;

	return {
		ok,
		failed,
		durationMs,
		throughputPerSec: ok / (durationMs / 1000),
		latencyMs: {
			p50: percentile(latenciesMs, 50),
			p95: percentile(latenciesMs, 95),
			p99: percentile(latenciesMs, 99),
			max: latenciesMs.length ? Math.max(...latenciesMs) : 0,
		},
	};
}

export function printJsonSummary(summary) {
	console.log(JSON.stringify(summary, null, 2));
}

export function createEchoUpstream({ body = "ok" } = {}) {
	return {
		async handleHttp(request) {
			const requestBodyBytes = await readBodyBytes(request.body);
			return {
				status: 200,
				headers: [
					["content-type", "text/plain; charset=utf-8"],
					["x-hostc-method", request.method],
					["x-hostc-body-bytes", String(requestBodyBytes)],
				],
				body,
			};
		},
		async handleWebSocket() {
			return new EchoWebSocketSession();
		},
	};
}

async function readBodyBytes(body) {
	if (!body) return 0;
	if (typeof body.arrayBuffer === "function") {
		return (await body.arrayBuffer()).byteLength;
	}
	const reader = body.getReader();
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) return total;
		total += value.byteLength;
	}
}

class EchoWebSocketSession {
	#messageListeners = new Set();
	#closeListeners = new Set();

	accept() {}

	send(message) {
		queueMicrotask(() => {
			const binary = typeof message !== "string";
			for (const listener of this.#messageListeners) {
				listener({ data: message, binary });
			}
		});
	}

	close(code = 1000, reason = "") {
		for (const listener of this.#closeListeners) {
			listener({ code, reason });
		}
	}

	onMessage(listener) {
		this.#messageListeners.add(listener);
		return () => this.#messageListeners.delete(listener);
	}

	onClose(listener) {
		this.#closeListeners.add(listener);
		return () => this.#closeListeners.delete(listener);
	}
}

export async function waitForClientReady(client, running) {
	if (client.getSnapshot().state === "ready") return client.getSnapshot();

	const ready = new Promise((resolve, reject) => {
		const cleanup = () => {
			client.off("ready", onReady);
			client.off("error", onError);
		};
		const onReady = () => {
			cleanup();
			resolve(client.getSnapshot());
		};
		const onError = (error) => {
			cleanup();
			reject(error);
		};
		client.on("ready", onReady);
		client.on("error", onError);
	});

	return Promise.race([
		ready,
		running.then(
			() => {
				throw new Error("client stopped before becoming ready");
			},
			(error) => {
				throw error;
			},
		),
	]);
}

export async function settleClient(running, timeoutMs = 1000) {
	await Promise.race([
		running.catch(() => undefined),
		new Promise((resolve) => setTimeout(resolve, timeoutMs)),
	]);
}

export async function createLocalTunnelHarness({
	dataChannels = 2,
	responseBody = "ok",
} = {}) {
	const tunnelId = "t-local-bench";
	const clientConnectionId = "cc-local-bench";
	const token = "local-token";
	const channelIds = Array.from({ length: dataChannels }, (_, index) => index);
	const sockets = new Map();
	const pending = new Map();
	let nextStreamId = 1n;
	let nextChannelIndex = 0;
	let serverUrl;
	let resolveReady;

	const ready = new Promise((resolve) => {
		resolveReady = resolve;
	});

	const server = createServer(async (request, response) => {
		if (request.method === "POST" && request.url === "/api/tunnels/ephemeral") {
			const dataUrl = `${serverUrl.replace("http://", "ws://")}/api/tunnels/${tunnelId}/channels`;
			response.writeHead(200, { "content-type": "application/json" });
			response.end(
				JSON.stringify({
					kind: TUNNEL_KIND_EPHEMERAL,
					protocolVersion: PROTOCOL_VERSION,
					tunnelId,
					publicUrl: `${serverUrl.replace("127.0.0.1", "public.localhost")}/`,
					clientConnectionId,
					dataUrl,
					connectToken: token,
					dataChannels,
					limits: defaultTunnelLimits(),
				}),
			);
			return;
		}

		response.writeHead(404);
		response.end("not found");
	});

	const wss = new WebSocketServer({ noServer: true });

	server.on("upgrade", (request, socket, head) => {
		const url = new URL(request.url ?? "/", serverUrl);
		const match = url.pathname.match(
			/^\/api\/tunnels\/([^/]+)\/channels\/([^/]+)$/,
		);
		const channelId = match ? Number(match[2]) : Number.NaN;
		if (
			!match ||
			match[1] !== tunnelId ||
			!Number.isSafeInteger(channelId) ||
			!channelIds.includes(channelId)
		) {
			socket.destroy();
			return;
		}

		wss.handleUpgrade(request, socket, head, (webSocket) => {
			sockets.set(channelId, webSocket);
			webSocket.on("close", () => {
				if (sockets.get(channelId) === webSocket) {
					sockets.delete(channelId);
				}
			});
			webSocket.on("message", (data) => handleClientFrame(data));
			if (sockets.size === channelIds.length) resolveReady();
		});
	});

	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	serverUrl = `http://127.0.0.1:${address.port}`;

	function handleClientFrame(data) {
		const bytes = data instanceof Buffer ? data : Buffer.from(data);
		const frame = decodeFrame(bytes);
		if (frame.streamId === 0n) return;

		const stream = pending.get(frame.streamId.toString());
		if (!stream) return;

		if (frame.frameType === FRAME_TYPE_RESPONSE_START) {
			stream.metadata = decodeMetadata(
				FRAME_TYPE_RESPONSE_START,
				frame.payload,
			);
			return;
		}
		if (frame.frameType === FRAME_TYPE_RESPONSE_DATA) {
			stream.chunks.push(Buffer.from(frame.payload));
			return;
		}
		if (frame.frameType === FRAME_TYPE_RESPONSE_END) {
			pending.delete(frame.streamId.toString());
			stream.resolve({
				metadata: stream.metadata,
				body: Buffer.concat(stream.chunks),
			});
			return;
		}
		if (frame.frameType === FRAME_TYPE_RESPONSE_ABORT) {
			pending.delete(frame.streamId.toString());
			const metadata = decodeMetadata(FRAME_TYPE_RESPONSE_ABORT, frame.payload);
			stream.reject(new Error(`stream aborted by client: ${metadata.reason}`));
		}
	}

	async function sendHttpRequest({
		method = "GET",
		path = "/",
		bodyBytes = 0,
	} = {}) {
		await ready;
		const streamId = nextStreamId;
		nextStreamId += 1n;

		const channelId = channelIds[nextChannelIndex % channelIds.length];
		nextChannelIndex += 1;
		const socket = sockets.get(channelId);
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			throw new Error(`data channel ${channelId} is not open`);
		}

		const response = new Promise((resolve, reject) => {
			pending.set(streamId.toString(), {
				resolve,
				reject,
				metadata: undefined,
				chunks: [],
			});
		});

		socket.send(
			encodeFrame({
				frameType: FRAME_TYPE_REQUEST_START,
				streamId,
				seq: 0n,
				payload: encodeMetadata(FRAME_TYPE_REQUEST_START, {
					kind: "http",
					method,
					target: path,
					headers: [
						["host", "public.localhost"],
						["user-agent", "hostc-local-bench"],
					],
					hasBody: bodyBytes > 0,
				}),
			}),
		);

		let lastSeq = -1n;
		if (bodyBytes > 0) {
			lastSeq = 0n;
			socket.send(
				encodeFrame({
					frameType: FRAME_TYPE_REQUEST_DATA,
					streamId,
					seq: lastSeq,
					payload: Buffer.alloc(bodyBytes, "x"),
				}),
			);
		}

		socket.send(
			encodeFrame({
				frameType: FRAME_TYPE_REQUEST_END,
				streamId,
				seq: 0n,
				payload: encodeMetadata(FRAME_TYPE_REQUEST_END, {
					kind: "request.body",
					lastSeq: Number(lastSeq),
				}),
			}),
		);

		const result = await response;
		if (result.metadata?.status !== 200) {
			throw new Error(`unexpected status ${result.metadata?.status}`);
		}
		if (result.body.toString() !== responseBody) {
			throw new Error("unexpected response body");
		}
		return result;
	}

	async function close() {
		for (const socket of sockets.values()) {
			socket.close();
		}
		wss.close();
		server.close();
		await once(server, "close").catch(() => undefined);
	}

	return {
		serverUrl,
		ready,
		sendHttpRequest,
		close,
		snapshot() {
			return {
				openChannels: sockets.size,
				pendingStreams: pending.size,
				nextStreamId: nextStreamId.toString(),
			};
		},
	};
}
