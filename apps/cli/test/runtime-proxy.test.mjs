import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import test from "node:test";
import {
	CLOSE_PROTOCOL_ERROR,
	DATA_FLAG_WS_BINARY,
	DATA_FLAG_WS_TEXT,
	decodeDataFrameView,
	defaultTunnelLimits,
	encodeControlMessage,
	encodeDataFrame,
	utf8Decode,
	utf8Encode,
} from "@hostc/protocol";

const require = createRequire(import.meta.url);
const { WebSocketServer } = require("../node_modules/ws");
const { TunnelClient } = require("../dist-test/runtime.js");
const { RuntimeCreditController } = require("../dist-test/runtime-credit.js");
const { PendingDataBuffer } = require("../dist-test/runtime-pending.js");

test("RuntimeCreditController aborts credit waits when a stream is removed", async () => {
	let streamExists = true;
	const credit = new RuntimeCreditController(
		10,
		async () => undefined,
		() => undefined,
	);
	credit.reset(0);
	credit.seedStream(99, 0);

	const pending = credit.waitFor(99, "response.body", 1, () => streamExists);
	await Promise.resolve();
	streamExists = false;
	credit.wakeWaiters();
	await assert.rejects(pending, /stream unavailable/);
});

test("PendingDataBuffer enforces global pending data limit and clears pending state", () => {
	const pending = new PendingDataBuffer(
		4,
		10_000,
		() => false,
		() => undefined,
	);
	pending.addFrame(1, {
		kind: "request.body",
		seq: 0,
		flags: 0,
		payload: new Uint8Array(3),
	});
	assert.equal(pending.byteLength, 3);
	assert.throws(
		() =>
			pending.addFrame(2, {
				kind: "request.body",
				seq: 0,
				flags: 0,
				payload: new Uint8Array(2),
			}),
		/pending data limit exceeded/,
	);
	pending.clearAll();
	assert.equal(pending.byteLength, 0);
});

test("TunnelClient aborts local fetch when request.abort arrives", async () => {
	let requestClosedResolve;
	const requestClosed = new Promise((resolve) => {
		requestClosedResolve = resolve;
	});
	const local = await startLocalHttpServer((request, response) => {
		request.on("close", requestClosedResolve);
		response.writeHead(200, { "content-type": "text/plain" });
	});
	const fake = await startFakeTunnelServer();
	const client = new TunnelClient(makeOptions(fake, local.port));
	const run = client.run();

	try {
		await fake.waitReady();
		fake.control.send(
			encodeControlMessage({
				type: "request.start",
				id: 1,
				kind: "http",
				method: "GET",
				url: "/",
				headers: [],
				body: false,
			}),
		);
		await waitForRequest(local);
		fake.control.send(
			encodeControlMessage({
				type: "request.abort",
				id: 1,
				reason: "client cancelled",
			}),
		);
		await withTimeout(requestClosed, 3000, "local request was not aborted");
	} finally {
		client.close();
		await run.catch(() => undefined);
		await fake.close();
		await local.close();
	}
});

test("TunnelClient proxies HTTP response over control/data protocol", async () => {
	const local = await startLocalHttpServer((_request, response) => {
		response.writeHead(200, { "content-type": "text/plain" });
		response.end("ok");
	});
	const fake = await startFakeTunnelServer();
	const client = new TunnelClient(makeOptions(fake, local.port));
	const run = client.run();

	try {
		await fake.waitReady();
		const controlMessages = collectControlMessages(fake.control);
		fake.control.send(
			encodeControlMessage({
				type: "request.start",
				id: 1,
				kind: "http",
				method: "GET",
				url: "/",
				headers: [],
				body: false,
			}),
		);
		fake.control.send(
			encodeControlMessage({
				type: "request.end",
				id: 1,
				kind: "request.body",
				lastSeq: -1,
			}),
		);
		const responseStart = await waitForControl(
			controlMessages,
			"response.start",
		);
		const [rawFrame] = await once(fake.data, "message");
		const frame = decodeDataFrameView(new Uint8Array(rawFrame));
		const responseEnd = await waitForControl(controlMessages, "response.end");

		assert.equal(responseStart.status, 200);
		assert.equal(frame.kind, "response.body");
		assert.equal(utf8Decode(frame.payload), "ok");
		assert.equal(responseEnd.lastSeq, 0);
	} finally {
		client.close();
		await run.catch(() => undefined);
		await fake.close();
		await local.close();
	}
});

test("TunnelClient rewrites public Origin and Referer for local HTTP proxy", async () => {
	let seenHeaders;
	const local = await startLocalHttpServer((request, response) => {
		seenHeaders = {
			origin: request.headers.origin,
			referer: request.headers.referer,
		};
		response.writeHead(200, { "content-type": "text/plain" });
		response.end("ok");
	});
	const fake = await startFakeTunnelServer();
	const client = new TunnelClient(makeOptions(fake, local.port));
	const run = client.run();

	try {
		await fake.waitReady();
		fake.control.send(
			encodeControlMessage({
				type: "request.start",
				id: 1,
				kind: "http",
				method: "POST",
				url: "/_root.data?index",
				headers: [
					["origin", "https://t-test.envoq.dev"],
					["referer", "https://t-test.envoq.dev/?index"],
					["content-type", "application/x-www-form-urlencoded;charset=UTF-8"],
				],
				body: false,
			}),
		);
		await waitForRequest(local);

		assert.equal(seenHeaders.origin, `http://127.0.0.1:${local.port}`);
		assert.equal(seenHeaders.referer, `http://127.0.0.1:${local.port}/?index`);
	} finally {
		client.close();
		await run.catch(() => undefined);
		await fake.close();
		await local.close();
	}
});

test("TunnelClient proxies local HTTP redirects without following them", async () => {
	const local = await startLocalHttpServer((_request, response) => {
		response.writeHead(302, {
			location: "/login",
			"content-type": "text/plain",
		});
		response.end("redirecting");
	});
	const fake = await startFakeTunnelServer();
	const client = new TunnelClient(makeOptions(fake, local.port));
	const run = client.run();

	try {
		await fake.waitReady();
		const controlMessages = collectControlMessages(fake.control);
		fake.control.send(
			encodeControlMessage({
				type: "request.start",
				id: 1,
				kind: "http",
				method: "POST",
				url: "/submit",
				headers: [],
				body: false,
			}),
		);
		const responseStart = await waitForControl(
			controlMessages,
			"response.start",
		);

		assert.equal(responseStart.status, 302);
		const headers = Object.fromEntries(responseStart.headers);
		assert.equal(headers.location, "/login");
		assert.equal(headers["content-type"], "text/plain");
	} finally {
		client.close();
		await run.catch(() => undefined);
		await fake.close();
		await local.close();
	}
});

test("TunnelClient proxies WebSocket text frames over data channels", async () => {
	const local = await startLocalWebSocketEchoServer();
	const fake = await startFakeTunnelServer();
	const client = new TunnelClient(makeOptions(fake, local.port));
	const run = client.run();

	try {
		await fake.waitReady();
		const controlMessages = collectControlMessages(fake.control);
		fake.control.send(
			encodeControlMessage({
				type: "request.start",
				id: 1,
				kind: "websocket",
				method: "GET",
				url: "/socket",
				headers: [],
				body: false,
				protocols: [],
			}),
		);
		const responseStart = await waitForControl(
			controlMessages,
			"response.start",
		);
		assert.equal(responseStart.status, 101);

		fake.data.send(
			encodeDataFrame({
				kind: "ws.client",
				id: 1,
				seq: 0,
				flags: DATA_FLAG_WS_TEXT,
				payload: utf8Encode("hello"),
			}),
		);
		const frame = await waitForDataFrame(fake.data, "ws.server");
		assert.equal(frame.flags, DATA_FLAG_WS_TEXT);
		assert.equal(utf8Decode(frame.payload), "hello");

		fake.data.send(
			encodeDataFrame({
				kind: "ws.client",
				id: 1,
				seq: 1,
				flags: DATA_FLAG_WS_BINARY,
				payload: new Uint8Array([1, 2, 3]),
			}),
		);
		const binaryFrame = await waitForDataFrame(fake.data, "ws.server");
		assert.equal(binaryFrame.flags, DATA_FLAG_WS_BINARY);
		assert.deepEqual([...binaryFrame.payload], [1, 2, 3]);
	} finally {
		client.close();
		await run.catch(() => undefined);
		await fake.close();
		await local.close();
	}
});

test("TunnelClient filters public WebSocket handshake headers before local proxy", async () => {
	const local = await startLocalWebSocketHeaderServer();
	const fake = await startFakeTunnelServer();
	const client = new TunnelClient(makeOptions(fake, local.port));
	const run = client.run();

	try {
		await fake.waitReady();
		const controlMessages = collectControlMessages(fake.control);
		fake.control.send(
			encodeControlMessage({
				type: "request.start",
				id: 1,
				kind: "websocket",
				method: "GET",
				url: "/socket",
				headers: [
					["x-keep", "ok"],
					["connection", "x-remove"],
					["x-remove", "bad"],
					["sec-websocket-key", "public-key"],
					["host", "public.example"],
					["origin", "https://t-test.envoq.dev"],
					["referer", "https://t-test.envoq.dev/ws"],
				],
				body: false,
				protocols: [],
			}),
		);
		const responseStart = await waitForControl(
			controlMessages,
			"response.start",
		);
		const headers = await local.waitForHeaders();
		assert.equal(responseStart.status, 101);
		assert.equal(headers["x-keep"], "ok");
		assert.equal(headers["x-remove"], undefined);
		assert.notEqual(headers["sec-websocket-key"], "public-key");
		assert.notEqual(headers.host, "public.example");
		assert.equal(headers.origin, `http://127.0.0.1:${local.port}`);
		assert.equal(headers.referer, `http://127.0.0.1:${local.port}/ws`);
	} finally {
		client.close();
		await run.catch(() => undefined);
		await fake.close();
		await local.close();
	}
});

test("TunnelClient delivers pending WebSocket data after local socket opens", async () => {
	const local = await startDelayedLocalWebSocketEchoServer(75);
	const fake = await startFakeTunnelServer();
	const client = new TunnelClient(makeOptions(fake, local.port));
	const run = client.run();

	try {
		await fake.waitReady();
		await new Promise((resolve) => setTimeout(resolve, 50));
		const controlMessages = collectControlMessages(fake.control);
		fake.data.send(
			encodeDataFrame({
				kind: "ws.client",
				id: 1,
				seq: 0,
				flags: DATA_FLAG_WS_TEXT,
				payload: utf8Encode("queued"),
			}),
		);
		await new Promise((resolve) => setTimeout(resolve, 25));
		fake.control.send(
			encodeControlMessage({
				type: "request.start",
				id: 1,
				kind: "websocket",
				method: "GET",
				url: "/socket",
				headers: [],
				body: false,
				protocols: [],
			}),
		);

		const responseStart = await waitForControl(
			controlMessages,
			"response.start",
		);
		const frame = await withTimeout(
			waitForDataFrame(fake.data, "ws.server"),
			3000,
			"pending WebSocket data was not echoed",
		);
		assert.equal(responseStart.status, 101);
		assert.equal(frame.flags, DATA_FLAG_WS_TEXT);
		assert.equal(utf8Decode(frame.payload), "queued");
	} finally {
		client.close();
		await run.catch(() => undefined);
		await fake.close();
		await local.close();
	}
});

test("TunnelClient sends response.abort without response.end when local WebSocket connect fails", async () => {
	const local = await startRejectingLocalWebSocketServer();
	const fake = await startFakeTunnelServer();
	const client = new TunnelClient(makeOptions(fake, local.port));
	const run = client.run();

	try {
		await fake.waitReady();
		const controlMessages = collectControlMessages(fake.control);
		fake.control.send(
			encodeControlMessage({
				type: "request.start",
				id: 1,
				kind: "websocket",
				method: "GET",
				url: "/socket",
				headers: [],
				body: false,
				protocols: [],
			}),
		);
		const abort = await waitForControl(controlMessages, "response.abort");
		await new Promise((resolve) => setTimeout(resolve, 100));

		assert.equal(abort.id, 1);
		assert.equal(
			controlMessages.messages.some(
				(message) => message.type === "response.end",
			),
			false,
		);
	} finally {
		client.close();
		await run.catch(() => undefined);
		await fake.close();
		await local.close();
	}
});

test("TunnelClient grants stream and connection credit after inbound WebSocket data", async () => {
	const local = await startLocalWebSocketEchoServer();
	const fake = await startFakeTunnelServer();
	const client = new TunnelClient(makeOptions(fake, local.port));
	const run = client.run();

	try {
		await fake.waitReady();
		const controlMessages = collectControlMessages(fake.control);
		fake.control.send(
			encodeControlMessage({
				type: "request.start",
				id: 1,
				kind: "websocket",
				method: "GET",
				url: "/socket",
				headers: [],
				body: false,
				protocols: [],
			}),
		);
		const responseStart = await waitForControl(
			controlMessages,
			"response.start",
		);
		assert.equal(responseStart.status, 101);
		fake.data.send(
			encodeDataFrame({
				kind: "ws.client",
				id: 1,
				seq: 0,
				flags: DATA_FLAG_WS_TEXT,
				payload: utf8Encode("hello"),
			}),
		);
		const credits = [
			await waitForCredit(controlMessages, "stream", "ws.client"),
			await waitForCredit(controlMessages, "connection"),
		];
		assert.deepEqual(
			credits.map((message) => message.bytes),
			[5, 5],
		);
	} finally {
		client.close();
		await run.catch(() => undefined);
		await fake.close();
		await local.close();
	}
});

test("TunnelClient fails the connection on data frames from the wrong channel", async () => {
	const local = await startLocalHttpServer((request, response) => {
		request.resume();
		request.on("end", () => {
			response.writeHead(200, { "content-type": "text/plain" });
			response.end("done");
		});
	});
	const fake = await startFakeTunnelServer({ dataChannels: 2 });
	const client = new TunnelClient(
		makeOptions(fake, local.port, { dataChannels: 2 }),
	);
	const run = client.run();

	try {
		await fake.waitReady();
		fake.control.send(
			encodeControlMessage({
				type: "request.start",
				id: 1,
				kind: "http",
				method: "POST",
				url: "/",
				headers: [],
				body: true,
			}),
		);
		const closed = once(fake.control, "close");
		fake.getData(0).send(
			encodeDataFrame({
				kind: "request.body",
				id: 1,
				seq: 0,
				payload: utf8Encode("wrong"),
			}),
		);
		const [code] = await closed;
		assert.equal(code, CLOSE_PROTOCOL_ERROR);
	} finally {
		client.close();
		await run.catch(() => undefined);
		await fake.close();
		await local.close();
	}
});

test("TunnelClient debug output redacts token-like refresh failures", async () => {
	const local = await startLocalHttpServer((_request, response) => {
		response.writeHead(200);
		response.end("ok");
	});
	const fake = await startFakeTunnelServer({
		requestHandler: (_request, response) => {
			response.writeHead(403, { "content-type": "application/json" });
			response.end(
				JSON.stringify({
					connectToken: "connect.secret",
					refreshToken: "refresh.secret",
				}),
			);
		},
	});
	const output = [];
	const originalError = console.error;
	console.error = (message) => {
		output.push(String(message));
	};
	const client = new TunnelClient(
		makeOptions(fake, local.port, {
			debug: true,
			connectToken: "connect.secret",
			refreshToken: "refresh.secret",
		}),
	);
	const run = client.run();

	try {
		await fake.waitReady();
		fake.control.close(1011, "force refresh");
		await waitForOutput(output, "refresh failed");
		assert.equal(output.join("\n").includes("connect.secret"), false);
		assert.equal(output.join("\n").includes("refresh.secret"), false);
		assert.match(output.join("\n"), /\[redacted-token\]/);
	} finally {
		console.error = originalError;
		client.close();
		await run.catch(() => undefined);
		await fake.close();
		await local.close();
	}
});

function makeOptions(fake, localPort, overrides = {}) {
	return {
		serverUrl: fake.httpUrl,
		localOrigin: new URL(`http://127.0.0.1:${localPort}/`),
		tunnelId: "t-test",
		publicUrl: "https://t-test.envoq.dev",
		connectionId: "c-test",
		controlUrl: `${fake.wsUrl}/control`,
		dataUrl: `${fake.wsUrl}/data`,
		connectToken: overrides.connectToken ?? "connect.token",
		refreshToken: overrides.refreshToken ?? "refresh.token",
		dataChannels: overrides.dataChannels ?? 1,
		limits: overrides.limits ?? defaultTunnelLimits(),
		debug: overrides.debug ?? false,
	};
}

async function startFakeTunnelServer({
	dataChannels = 1,
	requestHandler,
} = {}) {
	const server = createServer(requestHandler);
	const wss = new WebSocketServer({ noServer: true });
	const sockets = { control: null, data: Array(dataChannels).fill(null) };
	let resolveControl;
	const resolveData = Array(dataChannels);
	const ready = Promise.all([
		new Promise((resolve) => {
			resolveControl = resolve;
		}),
		...Array.from(
			{ length: dataChannels },
			(_, channelId) =>
				new Promise((resolve) => {
					resolveData[channelId] = resolve;
				}),
		),
	]);

	server.on("upgrade", (request, socket, head) => {
		wss.handleUpgrade(request, socket, head, (ws) => {
			if (request.url.startsWith("/control")) {
				sockets.control = ws;
				resolveControl();
			} else {
				const url = new URL(request.url, "http://127.0.0.1");
				const channelId = Number(url.searchParams.get("channel") ?? "0");
				sockets.data[channelId] = ws;
				resolveData[channelId]();
			}
		});
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const port = server.address().port;
	return {
		get control() {
			return sockets.control;
		},
		get data() {
			return sockets.data[0];
		},
		getData(channelId) {
			return sockets.data[channelId];
		},
		httpUrl: `http://127.0.0.1:${port}`,
		wsUrl: `ws://127.0.0.1:${port}`,
		waitReady: () => ready,
		close: () =>
			new Promise((resolve) => {
				wss.close(() => server.close(resolve));
			}),
	};
}

async function startLocalHttpServer(handler) {
	const server = createServer(handler);
	let requestCount = 0;
	const requestWaiters = [];
	server.on("request", () => {
		requestCount += 1;
		for (const waiter of requestWaiters.splice(0)) {
			waiter();
		}
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	return {
		port: server.address().port,
		waitForRequest: () => {
			if (requestCount > 0) {
				return Promise.resolve();
			}
			return new Promise((resolve) => requestWaiters.push(resolve));
		},
		close: () => new Promise((resolve) => server.close(resolve)),
	};
}

function waitForRequest(server) {
	return server.waitForRequest();
}

async function startLocalWebSocketEchoServer() {
	const server = createServer();
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

async function startLocalWebSocketHeaderServer() {
	const server = createServer();
	const wss = new WebSocketServer({ noServer: true });
	let resolveHeaders;
	const headers = new Promise((resolve) => {
		resolveHeaders = resolve;
	});
	wss.on("connection", (socket) => {
		socket.close(1000, "headers captured");
	});
	server.on("upgrade", (request, socket, head) => {
		resolveHeaders({ ...request.headers });
		wss.handleUpgrade(request, socket, head, (ws) =>
			wss.emit("connection", ws, request),
		);
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	return {
		port: server.address().port,
		waitForHeaders: () => headers,
		close: () =>
			new Promise((resolve) => {
				wss.close(() => server.close(resolve));
			}),
	};
}

async function startDelayedLocalWebSocketEchoServer(delayMs) {
	const server = createServer();
	const wss = new WebSocketServer({ noServer: true });
	wss.on("connection", (socket) => {
		socket.on("message", (data, isBinary) =>
			socket.send(data, { binary: isBinary }),
		);
	});
	server.on("upgrade", (request, socket, head) => {
		setTimeout(() => {
			wss.handleUpgrade(request, socket, head, (ws) =>
				wss.emit("connection", ws, request),
			);
		}, delayMs);
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

async function startRejectingLocalWebSocketServer() {
	const server = createServer();
	server.on("upgrade", (_request, socket) => {
		socket.write("HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\n\r\n");
		socket.destroy();
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	return {
		port: server.address().port,
		close: () => new Promise((resolve) => server.close(resolve)),
	};
}

function collectControlMessages(socket) {
	const messages = [];
	const waiters = [];
	socket.on("message", (raw) => {
		const parsed = JSON.parse(raw.toString());
		messages.push(parsed);
		for (const waiter of waiters.splice(0)) {
			waiter();
		}
	});
	return { messages, waiters };
}

async function waitForControl(collector, type) {
	for (;;) {
		const message = collector.messages.find((item) => item.type === type);
		if (message) {
			return message;
		}
		await new Promise((resolve) => collector.waiters.push(resolve));
	}
}

async function waitForCredit(collector, scope, kind) {
	for (;;) {
		const message = collector.messages.find(
			(item) =>
				item.type === "credit" &&
				item.scope === scope &&
				(kind === undefined || item.kind === kind),
		);
		if (message) {
			return message;
		}
		await new Promise((resolve) => collector.waiters.push(resolve));
	}
}

async function waitForDataFrame(socket, kind) {
	for (;;) {
		const [raw] = await once(socket, "message");
		const frame = decodeDataFrameView(new Uint8Array(raw));
		if (frame?.kind === kind) {
			return frame;
		}
	}
}

async function waitForOutput(output, pattern) {
	for (let index = 0; index < 100; index += 1) {
		if (output.some((line) => line.includes(pattern))) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`Timed out waiting for output: ${pattern}`);
}

function withTimeout(promise, timeoutMs, message) {
	return Promise.race([
		promise,
		new Promise((_, reject) =>
			setTimeout(() => reject(new Error(message)), timeoutMs),
		),
	]);
}
