import assert from "node:assert/strict";
import { test } from "node:test";
import {
	addCredit,
	buildDataChannelUrl,
	buildPublicUrl,
	buildTunnelChannelPath,
	byteLength,
	CLOSE_NORMAL,
	chooseNextDataChannel,
	consumeCredit,
	DEFAULT_CHANNEL_CREDIT_BYTES,
	DEFAULT_DATA_CHANNELS,
	DEFAULT_MAX_FRAME_BYTES,
	DEFAULT_MAX_METADATA_BYTES,
	DEFAULT_MAX_WEBSOCKET_MESSAGE_BYTES,
	DEFAULT_STREAM_CREDIT_BYTES,
	decodeFrame,
	decodeFrameView,
	decodeMetadata,
	defaultTunnelLimits,
	EPHEMERAL_TUNNELS_API_PATH,
	encodeFrame,
	encodeMetadata,
	FRAME_FLAG_NONE,
	FRAME_FLAG_WS_BINARY,
	FRAME_FLAG_WS_TEXT,
	FRAME_HEADER_BYTES,
	FRAME_TYPE_CHANNEL_CREDIT,
	FRAME_TYPE_REQUEST_DATA,
	FRAME_TYPE_REQUEST_END,
	FRAME_TYPE_REQUEST_START,
	FRAME_TYPE_RESPONSE_DATA,
	FRAME_TYPE_RESPONSE_END,
	FRAME_TYPE_RESPONSE_START,
	FRAME_TYPE_STREAM_CREDIT,
	filterHopByHopHeaders,
	getFrameTypeCode,
	getFrameTypeDirection,
	getFrameTypeFromCode,
	hasCredit,
	headersToEntries,
	isCreateEphemeralTunnelResponse,
	isMetadataForFrameType,
	isValidChannelId,
	isValidFrameForDirection,
	isValidHeaders,
	MAX_CLOSE_REASON_BYTES,
	normalizeCloseCode,
	normalizeCloseReason,
	PROTOCOL_VERSION,
	parseCreateEphemeralTunnelResponse,
	TUNNEL_KIND_EPHEMERAL,
	utf8Decode,
	utf8Encode,
} from "../dist/index.js";

test("defines the v4 ephemeral tunnel contract", () => {
	assert.equal(PROTOCOL_VERSION, 4);
	assert.equal(EPHEMERAL_TUNNELS_API_PATH, "/api/tunnels/ephemeral");
	assert.equal(TUNNEL_KIND_EPHEMERAL, "ephemeral");

	const limits = defaultTunnelLimits();
	assert.deepEqual(limits, {
		maxFrameBytes: DEFAULT_MAX_FRAME_BYTES,
		maxMetadataBytes: DEFAULT_MAX_METADATA_BYTES,
		maxWebSocketMessageBytes: DEFAULT_MAX_WEBSOCKET_MESSAGE_BYTES,
		streamCreditBytes: DEFAULT_STREAM_CREDIT_BYTES,
		channelCreditBytes: DEFAULT_CHANNEL_CREDIT_BYTES,
		pendingDataBytes: DEFAULT_CHANNEL_CREDIT_BYTES,
		pendingDataTimeoutMs: 120_000,
	});
	assert.equal(DEFAULT_DATA_CHANNELS, 2);
});

test("parses only strict v4 create tunnel responses", () => {
	const response = {
		kind: TUNNEL_KIND_EPHEMERAL,
		protocolVersion: PROTOCOL_VERSION,
		tunnelId: "abc-123",
		publicUrl: "https://abc-123.envoq.dev",
		clientConnectionId: "client-abc-123",
		dataUrl: "wss://envoq.dev/api/tunnels/abc-123/channels",
		connectToken: "token.header.payload",
		dataChannels: 2,
		limits: defaultTunnelLimits(),
	};

	assert.equal(isCreateEphemeralTunnelResponse(response), true);
	assert.deepEqual(parseCreateEphemeralTunnelResponse(response), response);

	assert.equal(
		isCreateEphemeralTunnelResponse({ ...response, protocolVersion: 3 }),
		false,
	);
	assert.equal(
		isCreateEphemeralTunnelResponse({ ...response, connectionId: "legacy" }),
		false,
	);
	assert.equal(
		isCreateEphemeralTunnelResponse({
			...response,
			controlUrl: "wss://envoq.dev/control",
		}),
		false,
	);
	assert.equal(
		isCreateEphemeralTunnelResponse({ ...response, dataChannels: 0 }),
		false,
	);
	assert.throws(
		() =>
			parseCreateEphemeralTunnelResponse({ ...response, protocolVersion: 3 }),
		/invalid v4 response/,
	);
});

test("encodes and decodes v4 frame headers with uint64 stream ids", () => {
	const payload = utf8Encode("hello");
	const streamId = 2n ** 40n;
	const seq = 7n;
	const encoded = encodeFrame({
		frameType: FRAME_TYPE_REQUEST_DATA,
		streamId,
		seq,
		flags: FRAME_FLAG_NONE,
		payload,
	});

	assert.equal(encoded.byteLength, FRAME_HEADER_BYTES + payload.byteLength);
	const view = decodeFrameView(encoded);
	assert.equal(view.frameType, FRAME_TYPE_REQUEST_DATA);
	assert.equal(view.streamId, streamId);
	assert.equal(view.seq, seq);
	assert.equal(view.flags, FRAME_FLAG_NONE);
	assert.equal(utf8Decode(view.payload), "hello");
	assert.equal(view.payload.buffer, encoded.buffer);

	const copy = decodeFrame(encoded);
	assert.notEqual(copy.payload.buffer, encoded.buffer);
	assert.equal(utf8Decode(copy.payload), "hello");
});

test("rejects malformed frames and wrong stream id scopes", () => {
	assert.throws(
		() =>
			encodeFrame({
				frameType: FRAME_TYPE_REQUEST_START,
				streamId: 0n,
				seq: 0n,
			}),
		/non-zero stream id/,
	);
	assert.throws(
		() =>
			encodeFrame({
				frameType: FRAME_TYPE_CHANNEL_CREDIT,
				streamId: 1n,
				seq: 0n,
			}),
		/stream id 0/,
	);
	assert.throws(
		() =>
			encodeFrame({
				frameType: FRAME_TYPE_CHANNEL_CREDIT,
				streamId: 0n,
				seq: 1n,
			}),
		/sequence number 0/,
	);
	assert.throws(
		() =>
			encodeFrame({
				frameType: FRAME_TYPE_REQUEST_START,
				streamId: 1n,
				seq: 1n,
			}),
		/metadata frame sequence number/,
	);
	assert.throws(
		() =>
			encodeFrame({
				frameType: FRAME_TYPE_REQUEST_DATA,
				streamId: 1n,
				seq: 0n,
				flags: 9,
			}),
		/invalid data frame flags/,
	);

	const encoded = encodeFrame({
		frameType: FRAME_TYPE_REQUEST_DATA,
		streamId: 1n,
		seq: 0n,
	});
	encoded[0] = 0;
	assert.throws(() => decodeFrame(encoded), /invalid frame magic/);
});

test("keeps websocket data flags narrow", () => {
	for (const flags of [
		FRAME_FLAG_NONE,
		FRAME_FLAG_WS_TEXT,
		FRAME_FLAG_WS_BINARY,
	]) {
		const encoded = encodeFrame({
			frameType: FRAME_TYPE_RESPONSE_DATA,
			streamId: 5n,
			seq: 1n,
			flags,
		});
		assert.equal(decodeFrame(encoded).flags, flags);
	}

	assert.throws(
		() =>
			encodeFrame({
				frameType: FRAME_TYPE_RESPONSE_END,
				streamId: 5n,
				seq: 0n,
				flags: FRAME_FLAG_WS_TEXT,
			}),
		/metadata frame flags/,
	);
});

test("maps frame codes and directions explicitly", () => {
	assert.equal(
		getFrameTypeFromCode(getFrameTypeCode(FRAME_TYPE_REQUEST_START)),
		FRAME_TYPE_REQUEST_START,
	);
	assert.equal(
		getFrameTypeDirection(FRAME_TYPE_REQUEST_START),
		"server-to-client",
	);
	assert.equal(
		getFrameTypeDirection(FRAME_TYPE_RESPONSE_START),
		"client-to-server",
	);
	assert.equal(getFrameTypeDirection(FRAME_TYPE_STREAM_CREDIT), "both");
	assert.equal(
		isValidFrameForDirection(FRAME_TYPE_REQUEST_START, "server-to-client"),
		true,
	);
	assert.equal(
		isValidFrameForDirection(FRAME_TYPE_REQUEST_START, "client-to-server"),
		false,
	);
	assert.equal(
		isValidFrameForDirection(FRAME_TYPE_STREAM_CREDIT, "client-to-server"),
		true,
	);
});

test("encodes and validates metadata by frame type", () => {
	const requestStart = {
		kind: "http",
		method: "POST",
		target: "/submit?x=1",
		headers: [["content-type", "text/plain"]],
		hasBody: true,
	};
	const encoded = encodeMetadata(FRAME_TYPE_REQUEST_START, requestStart);
	assert.deepEqual(
		decodeMetadata(FRAME_TYPE_REQUEST_START, encoded),
		requestStart,
	);
	assert.equal(
		isMetadataForFrameType(requestStart, FRAME_TYPE_REQUEST_START),
		true,
	);
	assert.equal(
		isMetadataForFrameType(requestStart, FRAME_TYPE_RESPONSE_START),
		false,
	);

	assert.throws(
		() => encodeMetadata(FRAME_TYPE_REQUEST_DATA, requestStart),
		/does not carry JSON metadata/,
	);
	assert.throws(
		() =>
			encodeMetadata(FRAME_TYPE_REQUEST_START, {
				...requestStart,
				target: "//evil",
			}),
		/invalid metadata/,
	);
	assert.throws(
		() =>
			encodeMetadata(FRAME_TYPE_REQUEST_START, {
				...requestStart,
				headers: [["x", "bad\r\nheader"]],
			}),
		/invalid metadata/,
	);
});

test("validates websocket start and end metadata", () => {
	const requestStart = {
		kind: "websocket",
		method: "GET",
		target: "/ws",
		headers: [["host", "example.com"]],
		hasBody: false,
		protocols: ["chat"],
	};
	assert.deepEqual(
		decodeMetadata(
			FRAME_TYPE_REQUEST_START,
			encodeMetadata(FRAME_TYPE_REQUEST_START, requestStart),
		),
		requestStart,
	);

	const requestEnd = {
		kind: "ws.client",
		lastSeq: 3,
		code: 1000,
		reason: "bye",
	};
	const responseEnd = {
		kind: "ws.server",
		lastSeq: -1,
		code: 1001,
		reason: "done",
	};
	assert.deepEqual(
		decodeMetadata(
			FRAME_TYPE_REQUEST_END,
			encodeMetadata(FRAME_TYPE_REQUEST_END, requestEnd),
		),
		requestEnd,
	);
	assert.deepEqual(
		decodeMetadata(
			FRAME_TYPE_RESPONSE_END,
			encodeMetadata(FRAME_TYPE_RESPONSE_END, responseEnd),
		),
		responseEnd,
	);

	assert.throws(
		() =>
			encodeMetadata(FRAME_TYPE_REQUEST_START, {
				...requestStart,
				hasBody: true,
			}),
		/invalid metadata/,
	);
	assert.throws(
		() =>
			encodeMetadata(FRAME_TYPE_RESPONSE_END, {
				kind: "response.body",
				lastSeq: 1,
				code: 1000,
			}),
		/invalid metadata/,
	);
});

test("validates credit metadata and helpers", () => {
	const streamCredit = { kind: "request.body", bytes: 1024 };
	const channelCredit = { bytes: 2048 };
	assert.deepEqual(
		decodeMetadata(
			FRAME_TYPE_STREAM_CREDIT,
			encodeMetadata(FRAME_TYPE_STREAM_CREDIT, streamCredit),
		),
		streamCredit,
	);
	assert.deepEqual(
		decodeMetadata(
			FRAME_TYPE_CHANNEL_CREDIT,
			encodeMetadata(FRAME_TYPE_CHANNEL_CREDIT, channelCredit),
		),
		channelCredit,
	);

	assert.equal(addCredit(10, 5), 15);
	assert.equal(consumeCredit(10, 5), 5);
	assert.equal(hasCredit(10, 10), true);
	assert.equal(hasCredit(10, 11), false);
	assert.throws(() => consumeCredit(4, 5), /insufficient credit/);
	assert.throws(
		() =>
			encodeMetadata(FRAME_TYPE_STREAM_CREDIT, {
				kind: "request.body",
				bytes: 0,
			}),
		/invalid metadata/,
	);
});

test("uses round-robin data channel selection without stream-id hashing", () => {
	let nextChannelIndex = 0;
	const selected = [];
	for (let index = 0; index < 5; index += 1) {
		const result = chooseNextDataChannel(nextChannelIndex, 3);
		selected.push(result.channelId);
		nextChannelIndex = result.nextChannelIndex;
	}

	assert.deepEqual(selected, [0, 1, 2, 0, 1]);
	assert.equal(isValidChannelId(2, 3), true);
	assert.equal(isValidChannelId(3, 3), false);
});

test("builds v4 urls and channel paths", () => {
	assert.equal(
		buildTunnelChannelPath("abc-123", 2),
		"/api/tunnels/abc-123/channels/2",
	);
	assert.equal(
		buildDataChannelUrl("wss://envoq.dev/api/tunnels/abc-123/channels", 1),
		"wss://envoq.dev/api/tunnels/abc-123/channels/1",
	);
	assert.equal(
		buildPublicUrl("envoq.dev", "abc-123"),
		"https://abc-123.envoq.dev",
	);
	assert.throws(
		() => buildTunnelChannelPath("bad/slash", 0),
		/invalid tunnel id/,
	);
});

test("validates and filters headers", () => {
	const headers = [
		["connection", "x-private, keep-alive"],
		["x-private", "drop"],
		["content-type", "text/plain"],
		["transfer-encoding", "chunked"],
	];
	assert.equal(isValidHeaders(headers), true);
	assert.deepEqual(filterHopByHopHeaders(headers), [
		["content-type", "text/plain"],
	]);
	assert.equal(isValidHeaders([["bad name", "x"]]), false);
	assert.equal(isValidHeaders([["x", "bad\nvalue"]]), false);
});

test("preserves repeated set-cookie headers when available", () => {
	const headers = new Headers({ "content-type": "text/plain" });
	headers.getSetCookie = () => ["a=1; Path=/", "b=2; Path=/"];
	assert.deepEqual(headersToEntries(headers), [
		["content-type", "text/plain"],
		["set-cookie", "a=1; Path=/"],
		["set-cookie", "b=2; Path=/"],
	]);
});

test("normalizes close codes and reasons", () => {
	assert.equal(normalizeCloseCode(1000), CLOSE_NORMAL);
	assert.equal(normalizeCloseCode(1006, 1011), 1011);
	const reason = normalizeCloseReason(`line1\n${"x".repeat(200)}`);
	assert.equal(reason.includes("\n"), false);
	assert.equal(byteLength(reason) <= MAX_CLOSE_REASON_BYTES, true);
});
