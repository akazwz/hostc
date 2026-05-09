import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
	byteLength,
	CLOSE_NORMAL,
	canConsumeCredit,
	consumeCredit,
	createCreditWindow,
	DATA_FLAG_NONE,
	DATA_FLAG_WS_BINARY,
	DATA_FLAG_WS_TEXT,
	DEFAULT_MAX_CONTROL_BYTES,
	DEFAULT_MAX_FRAME_BYTES,
	DEFAULT_MAX_WEBSOCKET_MESSAGE_BYTES,
	decodeControlMessage,
	decodeDataFrameView,
	defaultTunnelLimits,
	encodeControlMessage,
	encodeDataFrame,
	encodeDataFrameHeader,
	filterHttpRequestHeaders,
	filterResponseHeaders,
	filterWebSocketRequestHeaders,
	grantCredit,
	headersToEntries,
	isControlMessage,
	isValidChannelId,
	isValidSeq,
	isValidStreamId,
	MAX_DATA_CHANNELS,
	normalizeWebSocketCloseCode,
	normalizeWebSocketCloseReason,
	parseCreateTunnelResponse,
	parseRefreshTunnelResponse,
	selectDataChannel,
} from "../dist/index.js";

const limits = defaultTunnelLimits();

test("default limits allow a 1 MiB WebSocket message as one data frame", () => {
	assert.equal(DEFAULT_MAX_WEBSOCKET_MESSAGE_BYTES, 1024 * 1024);
	assert.equal(DEFAULT_MAX_FRAME_BYTES, DEFAULT_MAX_WEBSOCKET_MESSAGE_BYTES);
	assert.equal(
		limits.maxWebSocketMessageBytes,
		DEFAULT_MAX_WEBSOCKET_MESSAGE_BYTES,
	);
	assert.equal(limits.maxFrameBytes, DEFAULT_MAX_WEBSOCKET_MESSAGE_BYTES);
	assert.equal(limits.streamCreditBytes, DEFAULT_MAX_WEBSOCKET_MESSAGE_BYTES);
});

const messages = [
	{
		type: "request.start",
		id: 1,
		kind: "http",
		method: "POST",
		url: "/upload?x=1",
		headers: [["content-type", "application/octet-stream"]],
		body: true,
	},
	{
		type: "request.start",
		id: 2,
		kind: "websocket",
		method: "GET",
		url: "/socket",
		headers: [],
		body: false,
		protocols: ["chat"],
	},
	{ type: "request.end", id: 1, kind: "request.body", lastSeq: 7 },
	{
		type: "request.end",
		id: 2,
		kind: "ws.client",
		lastSeq: 12,
		code: 1000,
		reason: "done",
	},
	{ type: "request.abort", id: 3, reason: "cancelled" },
	{
		type: "response.start",
		id: 1,
		status: 200,
		headers: [["content-type", "text/plain"]],
		body: true,
	},
	{
		type: "response.start",
		id: 2,
		status: 101,
		headers: [],
		body: false,
		protocol: "chat",
	},
	{ type: "response.end", id: 1, kind: "response.body", lastSeq: 3 },
	{ type: "response.end", id: 2, kind: "ws.server", lastSeq: -1 },
	{ type: "response.abort", id: 4, reason: "local failed" },
	{
		type: "credit",
		scope: "stream",
		id: 1,
		kind: "response.body",
		bytes: 65536,
	},
	{ type: "credit", scope: "connection", bytes: 1048576 },
];

test("control JSON encode/decode accepts every message", () => {
	for (const message of messages) {
		assert.equal(isControlMessage(message), true);
		assert.deepEqual(
			decodeControlMessage(encodeControlMessage(message)),
			message,
		);
	}
});

test("control JSON rejects invalid type, fields, size, headers, URL and reason", () => {
	assert.equal(decodeControlMessage(JSON.stringify({ type: "unknown" })), null);
	assert.equal(
		decodeControlMessage(
			JSON.stringify({
				type: "request.abort",
				id: 1,
				reason: "x",
				extra: true,
			}),
		),
		null,
	);
	assert.equal(
		decodeControlMessage(
			JSON.stringify({
				type: "request.abort",
				id: 1,
				reason: "x".repeat(DEFAULT_MAX_CONTROL_BYTES),
			}),
		),
		null,
	);
	assert.equal(
		isControlMessage({
			type: "request.start",
			id: 1,
			kind: "http",
			method: "GET",
			url: "not-a-path",
			headers: [],
			body: false,
		}),
		false,
	);
	assert.equal(
		isControlMessage({
			type: "request.start",
			id: 1,
			kind: "http",
			method: "GET",
			url: "/",
			headers: [["bad name", "value"]],
			body: false,
		}),
		false,
	);
	assert.equal(
		isControlMessage({ type: "request.abort", id: 1, reason: "x".repeat(600) }),
		false,
	);
});

test("credit validator requires stream id/kind only for stream scope", () => {
	assert.equal(
		isControlMessage({ type: "credit", scope: "stream", bytes: 1 }),
		false,
	);
	assert.equal(
		isControlMessage({
			type: "credit",
			scope: "connection",
			id: 1,
			bytes: 1,
		}),
		false,
	);
	assert.equal(
		isControlMessage({
			type: "credit",
			scope: "stream",
			id: 1,
			kind: "request.body",
			bytes: 1,
		}),
		true,
	);
});

test("dataFrame encodes and decodes HTTP payloads", () => {
	const payload = new Uint8Array([1, 2, 3, 4]);
	const encoded = encodeDataFrame({
		kind: "request.body",
		id: 42,
		seq: 7,
		flags: DATA_FLAG_NONE,
		payload,
	});
	const decoded = decodeDataFrameView(encoded);
	assert.deepEqual(decoded, {
		kind: "request.body",
		id: 42,
		seq: 7,
		flags: DATA_FLAG_NONE,
		payloadLength: 4,
		payload: encoded.subarray(17),
	});
	assert.equal(decoded?.payload.buffer, encoded.buffer);
	assert.equal(decoded?.payload.byteOffset, encoded.byteOffset + 17);
});

test("dataFrame encodes websocket text and binary flags", () => {
	for (const flags of [DATA_FLAG_WS_TEXT, DATA_FLAG_WS_BINARY]) {
		const encoded = encodeDataFrame({
			kind: "ws.server",
			id: 2,
			seq: 0,
			flags,
			payload: new Uint8Array([5]),
		});
		assert.equal(decodeDataFrameView(encoded)?.flags, flags);
	}
});

test("dataFrame rejects invalid magic, version, kind, flags, id, seq and length", () => {
	const valid = encodeDataFrame({
		kind: "response.body",
		id: 1,
		seq: 0,
		payload: new Uint8Array([1]),
	});

	for (const [offset, value] of [
		[0, 0],
		[2, 9],
		[3, 99],
	]) {
		const copy = valid.slice();
		copy[offset] = value;
		assert.equal(decodeDataFrameView(copy), null);
	}

	assert.throws(() =>
		encodeDataFrame({
			kind: "request.body",
			id: 1,
			seq: 0,
			flags: DATA_FLAG_WS_TEXT,
			payload: new Uint8Array(),
		}),
	);
	assert.throws(() =>
		encodeDataFrame({
			kind: "request.body",
			id: 0,
			seq: 0,
			payload: new Uint8Array(),
		}),
	);
	assert.throws(() =>
		encodeDataFrame({
			kind: "request.body",
			id: 1,
			seq: 0x100000000,
			payload: new Uint8Array(),
		}),
	);

	const truncated = valid.slice(0, valid.length - 1);
	assert.equal(decodeDataFrameView(truncated), null);

	const invalidFlags = valid.slice();
	invalidFlags[4] = DATA_FLAG_WS_TEXT;
	assert.equal(decodeDataFrameView(invalidFlags), null);

	const invalidId = valid.slice();
	new DataView(
		invalidId.buffer,
		invalidId.byteOffset,
		invalidId.byteLength,
	).setUint32(5, 0, false);
	assert.equal(decodeDataFrameView(invalidId), null);

	const invalidLength = valid.slice();
	new DataView(
		invalidLength.buffer,
		invalidLength.byteOffset,
		invalidLength.byteLength,
	).setUint32(13, DEFAULT_MAX_FRAME_BYTES + 1, false);
	assert.equal(decodeDataFrameView(invalidLength), null);

	assert.equal(decodeDataFrameView(valid, { maxFrameBytes: 0 }), null);

	const tooLarge = new Uint8Array(DEFAULT_MAX_FRAME_BYTES + 1);
	assert.throws(() =>
		encodeDataFrame({
			kind: "request.body",
			id: 1,
			seq: 0,
			payload: tooLarge,
		}),
	);
});

test("dataFrame header API is low-copy compatible", () => {
	const header = encodeDataFrameHeader({
		kind: "ws.client",
		id: 9,
		seq: 2,
		flags: DATA_FLAG_WS_BINARY,
		payloadLength: 3,
	});
	const payload = new Uint8Array([7, 8, 9]);
	const combined = new Uint8Array(header.byteLength + payload.byteLength);
	combined.set(header);
	combined.set(payload, header.byteLength);
	const decoded = decodeDataFrameView(combined);
	assert.equal(decoded?.payload.buffer, combined.buffer);
	assert.deepEqual([...decoded.payload], [7, 8, 9]);
});

test("random payload roundtrip", () => {
	for (const size of [0, 1, 127, 1024, 64 * 1024]) {
		const payload = new Uint8Array(randomBytes(size));
		const decoded = decodeDataFrameView(
			encodeDataFrame({ kind: "response.body", id: 1, seq: size, payload }),
		);
		assert.deepEqual(decoded?.payload, payload);
	}
});

test("selectDataChannel and id validators", () => {
	assert.equal(selectDataChannel(1, 2), 1);
	assert.equal(selectDataChannel(2, 2), 0);
	assert.equal(selectDataChannel(9, MAX_DATA_CHANNELS), 1);
	assert.throws(() => selectDataChannel(0, 2));
	assert.equal(isValidStreamId(1), true);
	assert.equal(isValidStreamId(0), false);
	assert.equal(isValidChannelId(1, 2), true);
	assert.equal(isValidChannelId(2, 2), false);
	assert.equal(isValidSeq(0xffffffff), true);
	assert.equal(isValidSeq(0x100000000), false);
});

test("credit grant and consume helper", () => {
	let window = createCreditWindow(10);
	assert.equal(canConsumeCredit(window, 8), true);
	let consumed = consumeCredit(window, 8);
	assert.equal(consumed.ok, true);
	window = consumed.window;
	assert.equal(window.available, 2);
	consumed = consumeCredit(window, 3);
	assert.equal(consumed.ok, false);
	window = grantCredit(window, 5);
	assert.equal(window.available, 7);
});

test("close code and reason normalization", () => {
	assert.equal(normalizeWebSocketCloseCode(1000), 1000);
	assert.equal(normalizeWebSocketCloseCode(1005), CLOSE_NORMAL);
	assert.equal(normalizeWebSocketCloseCode(999), CLOSE_NORMAL);
	const longReason = "é".repeat(200);
	const normalized = normalizeWebSocketCloseReason(longReason);
	assert.ok(byteLength(normalized) <= 123);
});

test("header filters drop hop-by-hop and WebSocket handshake headers", () => {
	const headers = [
		["Connection", "x-test, keep-alive"],
		["x-test", "drop"],
		["host", "example.com"],
		["content-length", "10"],
		["content-type", "text/plain"],
		["sec-websocket-key", "secret"],
		["transfer-encoding", "chunked"],
	];
	assert.deepEqual(filterHttpRequestHeaders(headers), [
		["content-type", "text/plain"],
		["sec-websocket-key", "secret"],
	]);
	assert.deepEqual(filterWebSocketRequestHeaders(headers), [
		["content-type", "text/plain"],
	]);
	assert.deepEqual(
		filterResponseHeaders([
			["content-encoding", "gzip"],
			["content-length", "4"],
			["x", "y"],
		]),
		[["x", "y"]],
	);
});

test("headersToEntries preserves multiple Set-Cookie values when available", () => {
	const headers = {
		forEach(callback) {
			callback("text/plain", "content-type");
			callback("a=1, b=2", "set-cookie");
		},
		getSetCookie() {
			return ["a=1; Path=/", "b=2; Expires=Wed, 21 Oct 2030 07:28:00 GMT"];
		},
	};
	assert.deepEqual(headersToEntries(headers), [
		["content-type", "text/plain"],
		["set-cookie", "a=1; Path=/"],
		["set-cookie", "b=2; Expires=Wed, 21 Oct 2030 07:28:00 GMT"],
	]);
});

test("API response parsers validate shared response shapes", () => {
	const createResponse = {
		tunnelId: "t-test",
		publicUrl: "https://t-test.hostc.dev",
		connectionId: "c1",
		controlUrl: "wss://hostc.dev/api/tunnels/t-test/control",
		dataUrl: "wss://hostc.dev/api/tunnels/t-test/data",
		connectToken: "connect",
		refreshToken: "refresh",
		dataChannels: 2,
		limits,
	};
	assert.deepEqual(
		parseCreateTunnelResponse(JSON.stringify(createResponse)),
		createResponse,
	);
	assert.equal(
		parseCreateTunnelResponse({ ...createResponse, tunnelId: "foo.bar" }),
		null,
	);
	const legacyLimits = { ...limits };
	delete legacyLimits.maxWebSocketMessageBytes;
	assert.deepEqual(
		parseCreateTunnelResponse({ ...createResponse, limits: legacyLimits })
			?.limits,
		{
			...legacyLimits,
			maxWebSocketMessageBytes: legacyLimits.maxFrameBytes,
		},
	);
	const refreshResponse = {
		connectionId: "c2",
		controlUrl: "wss://hostc.dev/api/tunnels/t-test/control",
		dataUrl: "wss://hostc.dev/api/tunnels/t-test/data",
		connectToken: "connect",
		refreshToken: "refresh",
		dataChannels: 2,
		limits,
	};
	assert.deepEqual(
		parseRefreshTunnelResponse(JSON.stringify(refreshResponse)),
		refreshResponse,
	);
	assert.equal(
		parseRefreshTunnelResponse({ ...refreshResponse, dataChannels: 99 }),
		null,
	);
});
