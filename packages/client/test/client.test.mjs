import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import test from "node:test";
import {
	decodeFrameView,
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
	TUNNEL_KIND_EPHEMERAL,
	utf8Decode,
	utf8Encode,
} from "@hostc/protocol";
import {
	createEphemeralTunnel,
	HostcClient,
	HostcProtocolUpgradeError,
} from "../dist/index.js";

const require = createRequire(import.meta.url);
const { WebSocket, WebSocketServer } = require("../node_modules/ws");

test("createEphemeralTunnel parses strict v4 responses and rewrites local dataUrl", async () => {
	const response = makeTunnelResponse(
		"wss://example.com/api/tunnels/t-test/channels",
	);
	const fetcher = async () =>
		new Response(JSON.stringify(response), { status: 201 });
	const tunnel = await createEphemeralTunnel({
		serverUrl: "http://127.0.0.1:8787",
		dataChannels: 2,
		fetcher,
	});
	assert.equal(tunnel.kind, TUNNEL_KIND_EPHEMERAL);
	assert.equal(tunnel.protocolVersion, 4);
	assert.equal(tunnel.clientConnectionId, "c-test");
	assert.equal(
		tunnel.dataUrl,
		"ws://127.0.0.1:8787/api/tunnels/t-test/channels",
	);
});

test("createEphemeralTunnel reports protocol upgrade hints", async () => {
	const fetcher = async () =>
		new Response(
			JSON.stringify({
				ok: true,
				protocolVersion: 3,
			}),
			{ status: 201 },
		);
	await assert.rejects(
		() =>
			createEphemeralTunnel({
				serverUrl: "https://envoq.dev",
				dataChannels: 2,
				fetcher,
			}),
		(error) => {
			assert.ok(error instanceof HostcProtocolUpgradeError);
			assert.match(
				error.message,
				/incompatible with the tunnel server protocol/,
			);
			assert.match(error.message, /protocolVersion is 3, CLI expects 4/);
			assert.match(error.message, /npm i -g hostc@latest/);
			return true;
		},
	);
});

test("HostcClient connects all v4 data channels and emits ready", async () => {
	const fake = await startFakeTunnelServer({ dataChannels: 2 });
	const client = new HostcClient({
		serverUrl: fake.httpUrl,
		dataChannels: 2,
		upstream: {
			async handleHttp() {
				return { status: 200, body: "ok" };
			},
		},
	});
	const ready = waitForClientEvent(client, "ready");
	const running = client.start();
	try {
		const event = await ready;
		assert.equal(event.tunnelId, "t-test");
		assert.equal(event.clientConnectionId, "c-test");
		assert.equal(fake.dataSockets.filter(Boolean).length, 2);
	} finally {
		await client.stop();
		await running.catch(() => undefined);
		await fake.close();
	}
});

test("HostcClient proxies an HTTP stream over v4 frames", async () => {
	const fake = await startFakeTunnelServer({ dataChannels: 1 });
	const client = new HostcClient({
		serverUrl: fake.httpUrl,
		dataChannels: 1,
		upstream: {
			async handleHttp(request) {
				assert.equal(request.method, "GET");
				assert.equal(request.target, "/hello");
				return {
					status: 200,
					headers: [["content-type", "text/plain"]],
					body: "hello",
				};
			},
		},
	});
	const running = client.start();
	try {
		await waitForClientEvent(client, "ready");
		const messages = collectFrames(fake.dataSockets[0]);
		fake.dataSockets[0].send(
			encodeFrame({
				frameType: FRAME_TYPE_REQUEST_START,
				streamId: 1n,
				seq: 0n,
				payload: encodeMetadata(FRAME_TYPE_REQUEST_START, {
					kind: "http",
					method: "GET",
					target: "/hello",
					headers: [],
					hasBody: false,
				}),
			}),
		);
		fake.dataSockets[0].send(
			encodeFrame({
				frameType: FRAME_TYPE_REQUEST_END,
				streamId: 1n,
				seq: 0n,
				payload: encodeMetadata(FRAME_TYPE_REQUEST_END, {
					kind: "request.body",
					lastSeq: -1,
				}),
			}),
		);

		const responseStart = await waitForMetadata(
			messages,
			FRAME_TYPE_RESPONSE_START,
			1n,
		);
		const responseData = await waitForFrame(
			messages,
			FRAME_TYPE_RESPONSE_DATA,
			1n,
		);
		const responseEnd = await waitForMetadata(
			messages,
			FRAME_TYPE_RESPONSE_END,
			1n,
		);
		assert.equal(responseStart.status, 200);
		assert.equal(utf8Decode(responseData.payload), "hello");
		assert.equal(responseEnd.lastSeq, 0);
	} finally {
		await client.stop();
		await running.catch(() => undefined);
		await fake.close();
	}
});

test("HostcClient accepts reused stream ids after reconnect", async () => {
	const fake = await startFakeTunnelServer({ dataChannels: 1 });
	const client = new HostcClient({
		serverUrl: fake.httpUrl,
		dataChannels: 1,
		upstream: {
			async handleHttp(request) {
				return {
					status: 200,
					headers: [["content-type", "text/plain"]],
					body: request.target,
				};
			},
		},
	});
	const readyEvents = [];
	client.on("ready", (event) => readyEvents.push(event));
	const running = client.start();
	try {
		await waitForReadyCount(readyEvents, 1);
		const firstSocket = fake.dataSockets[0];
		const firstMessages = collectFrames(firstSocket);
		sendHttpRequestFrame(firstSocket, 1n, "/first");
		const firstResponse = await waitForFrame(
			firstMessages,
			FRAME_TYPE_RESPONSE_DATA,
			1n,
		);
		assert.equal(utf8Decode(firstResponse.payload), "/first");

		client.forceReconnect("test reconnect");
		await waitForReadyCount(readyEvents, 2);
		const secondSocket = fake.dataSockets[0];
		assert.notEqual(secondSocket, firstSocket);

		const secondMessages = collectFrames(secondSocket);
		sendHttpRequestFrame(secondSocket, 1n, "/second");
		const secondResponse = await waitForFrame(
			secondMessages,
			FRAME_TYPE_RESPONSE_DATA,
			1n,
		);
		assert.equal(utf8Decode(secondResponse.payload), "/second");
	} finally {
		await client.stop();
		await running.catch(() => undefined);
		await fake.close();
	}
});

test("HostcClient aborts only the failed stream when local request body closes", async () => {
	const fake = await startFakeTunnelServer({ dataChannels: 1 });
	let cancelLocalBody;
	const localBodyCanceled = new Promise((resolve) => {
		cancelLocalBody = resolve;
	});
	const reconnects = [];
	const client = new HostcClient({
		serverUrl: fake.httpUrl,
		dataChannels: 1,
		upstream: {
			async handleHttp(request) {
				await request.body?.cancel(new Error("local body closed"));
				cancelLocalBody();
				await new Promise((_, reject) => {
					request.signal.addEventListener(
						"abort",
						() => reject(request.signal.reason),
						{ once: true },
					);
				});
				return { status: 200, body: "unexpected" };
			},
		},
	});
	client.on("reconnecting", (event) => reconnects.push(event));
	const running = client.start();
	try {
		await waitForClientEvent(client, "ready");
		const messages = collectFrames(fake.dataSockets[0]);
		fake.dataSockets[0].send(
			encodeFrame({
				frameType: FRAME_TYPE_REQUEST_START,
				streamId: 1n,
				seq: 0n,
				payload: encodeMetadata(FRAME_TYPE_REQUEST_START, {
					kind: "http",
					method: "POST",
					target: "/upload",
					headers: [],
					hasBody: true,
				}),
			}),
		);
		await localBodyCanceled;
		fake.dataSockets[0].send(
			encodeFrame({
				frameType: FRAME_TYPE_REQUEST_DATA,
				streamId: 1n,
				seq: 0n,
				payload: utf8Encode("body"),
			}),
		);

		const abort = await waitForMetadata(
			messages,
			FRAME_TYPE_RESPONSE_ABORT,
			1n,
		);
		assert.equal(typeof abort.reason, "string");
		assert.equal(fake.dataSockets[0].readyState, WebSocket.OPEN);
		assert.equal(reconnects.length, 0);
	} finally {
		await client.stop();
		await running.catch(() => undefined);
		await fake.close();
	}
});

test("HostcClient rejects malformed request end as protocol error", async () => {
	const fake = await startFakeTunnelServer({ dataChannels: 1 });
	const reconnects = [];
	let releaseHttpResponse;
	const holdHttpResponse = new Promise((resolve) => {
		releaseHttpResponse = resolve;
	});
	let markHttpStarted;
	const httpStarted = new Promise((resolve) => {
		markHttpStarted = resolve;
	});
	const client = new HostcClient({
		serverUrl: fake.httpUrl,
		dataChannels: 1,
		upstream: {
			async handleHttp() {
				markHttpStarted();
				await holdHttpResponse;
				return { status: 200, body: "unexpected" };
			},
		},
	});
	client.on("reconnecting", (event) => reconnects.push(event));
	const running = client.start();
	try {
		await waitForClientEvent(client, "ready");
		fake.dataSockets[0].send(
			encodeFrame({
				frameType: FRAME_TYPE_REQUEST_START,
				streamId: 1n,
				seq: 0n,
				payload: encodeMetadata(FRAME_TYPE_REQUEST_START, {
					kind: "http",
					method: "GET",
					target: "/bad-end",
					headers: [],
					hasBody: false,
				}),
			}),
		);
		await httpStarted;
		fake.dataSockets[0].send(
			encodeFrame({
				frameType: FRAME_TYPE_REQUEST_END,
				streamId: 1n,
				seq: 0n,
				payload: encodeMetadata(FRAME_TYPE_REQUEST_END, {
					kind: "ws.client",
					lastSeq: -1,
				}),
			}),
		);
		await waitForReadyCount(reconnects, 1);
		assert.match(reconnects[0].reason, /request end kind mismatch/);
	} finally {
		releaseHttpResponse();
		await client.stop();
		await running.catch(() => undefined);
		await fake.close();
	}
});

function makeTunnelResponse(dataUrl) {
	return {
		kind: TUNNEL_KIND_EPHEMERAL,
		protocolVersion: 4,
		tunnelId: "t-test",
		publicUrl: "https://t-test.envoq.dev",
		clientConnectionId: "c-test",
		dataUrl,
		connectToken: "connect.token",
		dataChannels: 2,
		limits: defaultTunnelLimits(),
	};
}

async function startFakeTunnelServer({ dataChannels }) {
	const server = createServer((request, response) => {
		if (request.method === "POST" && request.url === "/api/tunnels/ephemeral") {
			response.writeHead(201, { "content-type": "application/json" });
			response.end(
				JSON.stringify({
					...makeTunnelResponse(
						`ws://127.0.0.1:${server.address().port}/api/tunnels/t-test/channels`,
					),
					dataChannels,
				}),
			);
			return;
		}
		response.writeHead(404);
		response.end();
	});
	const wss = new WebSocketServer({ noServer: true });
	const dataSockets = Array(dataChannels).fill(null);
	const readyWaiters = [];
	server.on("upgrade", (request, socket, head) => {
		const url = new URL(request.url, "http://127.0.0.1");
		const channelId = Number(url.pathname.split("/").at(-1));
		if (
			!Number.isInteger(channelId) ||
			channelId < 0 ||
			channelId >= dataChannels
		) {
			socket.destroy();
			return;
		}
		wss.handleUpgrade(request, socket, head, (ws) => {
			dataSockets[channelId] = ws;
			ws.on("close", () => {
				if (dataSockets[channelId] === ws) {
					dataSockets[channelId] = null;
				}
			});
			resolveReadyWaiters();
		});
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	await Promise.resolve();
	return {
		dataSockets,
		httpUrl: `http://127.0.0.1:${server.address().port}`,
		waitReady,
		close: () =>
			new Promise((resolve) => wss.close(() => server.close(resolve))),
	};

	function waitReady() {
		if (dataSockets.every((socket) => socket?.readyState === WebSocket.OPEN)) {
			return Promise.resolve();
		}
		return new Promise((resolve) => readyWaiters.push(resolve));
	}

	function resolveReadyWaiters() {
		if (!dataSockets.every((socket) => socket?.readyState === WebSocket.OPEN)) {
			return;
		}
		for (const resolve of readyWaiters.splice(0)) {
			resolve();
		}
	}
}

function waitForClientEvent(client, event) {
	return new Promise((resolve) => {
		client.on(event, resolve);
	});
}

function collectFrames(socket) {
	const frames = [];
	const waiters = [];
	socket.on("message", (raw) => {
		frames.push(decodeFrameView(new Uint8Array(raw)));
		for (const waiter of waiters.splice(0)) {
			waiter();
		}
	});
	return { frames, waiters };
}

async function waitForFrame(collector, frameType, streamId, timeoutMs = 2000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const frame = collector.frames.find(
			(item) => item.frameType === frameType && item.streamId === streamId,
		);
		if (frame) {
			return frame;
		}
		await Promise.race([
			new Promise((resolve) => collector.waiters.push(resolve)),
			new Promise((resolve) =>
				setTimeout(resolve, Math.min(50, deadline - Date.now())),
			),
		]);
	}
	throw new Error(`timed out waiting for ${frameType} on stream ${streamId}`);
}

async function waitForMetadata(collector, frameType, streamId) {
	const frame = await waitForFrame(collector, frameType, streamId);
	return decodeMetadata(frameType, frame.payload);
}

async function waitForReadyCount(readyEvents, expectedCount, timeoutMs = 2000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (readyEvents.length >= expectedCount) {
			return readyEvents[expectedCount - 1];
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`timed out waiting for ready count ${expectedCount}`);
}

function sendHttpRequestFrame(socket, streamId, target) {
	socket.send(
		encodeFrame({
			frameType: FRAME_TYPE_REQUEST_START,
			streamId,
			seq: 0n,
			payload: encodeMetadata(FRAME_TYPE_REQUEST_START, {
				kind: "http",
				method: "GET",
				target,
				headers: [],
				hasBody: false,
			}),
		}),
	);
	socket.send(
		encodeFrame({
			frameType: FRAME_TYPE_REQUEST_END,
			streamId,
			seq: 0n,
			payload: encodeMetadata(FRAME_TYPE_REQUEST_END, {
				kind: "request.body",
				lastSeq: -1,
			}),
		}),
	);
}
