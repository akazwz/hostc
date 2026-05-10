import assert from "node:assert/strict";
import { test } from "node:test";
import {
	chooseNextDataChannel,
	consumeCredit,
	DEFAULT_CHANNEL_CREDIT_BYTES,
	DEFAULT_DATA_CHANNELS,
	DEFAULT_STREAM_CREDIT_BYTES,
	defaultTunnelLimits,
	FRAME_TYPE_CHANNEL_CREDIT,
	FRAME_TYPE_REQUEST_ABORT,
	FRAME_TYPE_REQUEST_DATA,
	FRAME_TYPE_REQUEST_END,
	FRAME_TYPE_REQUEST_START,
	FRAME_TYPE_RESPONSE_DATA,
	FRAME_TYPE_RESPONSE_END,
	FRAME_TYPE_RESPONSE_START,
	FRAME_TYPE_STREAM_CREDIT,
} from "../dist/index.js";

class V4TunnelModel {
	constructor({
		dataChannels = DEFAULT_DATA_CHANNELS,
		limits = defaultTunnelLimits(),
	} = {}) {
		this.dataChannels = dataChannels;
		this.limits = limits;
		this.clientConnectionId = null;
		this.channels = new Set();
		this.streams = new Map();
		this.closedStreams = new Set();
		this.nextStreamId = 1n;
		this.nextChannelIndex = 0;
		this.channelCredit = limits.channelCreditBytes;
		this.failed = false;
	}

	connectClientConnection(clientConnectionId) {
		this.clientConnectionId = clientConnectionId;
		this.channels.clear();
		this.streams.clear();
		this.closedStreams.clear();
		this.nextStreamId = 1n;
		this.nextChannelIndex = 0;
		this.channelCredit = this.limits.channelCreditBytes;
		this.failed = false;
	}

	connectDataChannel(clientConnectionId, channelId) {
		if (
			clientConnectionId !== this.clientConnectionId ||
			channelId < 0 ||
			channelId >= this.dataChannels
		) {
			return false;
		}
		this.channels.add(channelId);
		return true;
	}

	get ready() {
		return this.channels.size === this.dataChannels && !this.failed;
	}

	startPublicRequest(clientConnectionId) {
		if (clientConnectionId !== this.clientConnectionId || !this.ready) {
			return null;
		}

		const selected = chooseNextDataChannel(
			this.nextChannelIndex,
			this.dataChannels,
		);
		this.nextChannelIndex = selected.nextChannelIndex;
		const streamId = this.nextStreamId;
		this.nextStreamId += 1n;
		this.streams.set(streamId, {
			channelId: selected.channelId,
			requestOpen: true,
			responseOpen: true,
			requestCredit: this.limits.streamCreditBytes,
			responseCredit: this.limits.streamCreditBytes,
		});
		return { streamId, channelId: selected.channelId };
	}

	receiveFrame({
		clientConnectionId,
		channelId,
		streamId,
		frameType,
		payloadBytes = 0,
	}) {
		if (clientConnectionId !== this.clientConnectionId) {
			return "ignored-old-client-connection";
		}
		if (!this.channels.has(channelId) || this.failed) {
			return "closed";
		}
		if (frameType === FRAME_TYPE_CHANNEL_CREDIT) {
			if (streamId !== 0n) {
				this.failed = true;
				return "protocol-error";
			}
			return "ok";
		}
		if (streamId === 0n) {
			this.failed = true;
			return "protocol-error";
		}
		if (this.closedStreams.has(streamId)) {
			return "ignored-closed-stream";
		}

		const stream = this.streams.get(streamId);
		if (!stream) {
			if (frameType !== FRAME_TYPE_REQUEST_START) {
				this.failed = true;
				return "protocol-error";
			}
			this.streams.set(streamId, {
				channelId,
				requestOpen: true,
				responseOpen: true,
				requestCredit: this.limits.streamCreditBytes,
				responseCredit: this.limits.streamCreditBytes,
			});
			return "ok";
		}

		if (stream.channelId !== channelId) {
			this.failed = true;
			return "protocol-error";
		}

		if (frameType === FRAME_TYPE_REQUEST_DATA) {
			if (
				!stream.requestOpen ||
				payloadBytes > stream.requestCredit ||
				payloadBytes > this.channelCredit
			) {
				this.failed = true;
				return "flow-control-error";
			}
			stream.requestCredit = consumeCredit(stream.requestCredit, payloadBytes);
			this.channelCredit = consumeCredit(this.channelCredit, payloadBytes);
			return "ok";
		}

		if (frameType === FRAME_TYPE_RESPONSE_DATA) {
			if (
				!stream.responseOpen ||
				payloadBytes > stream.responseCredit ||
				payloadBytes > this.channelCredit
			) {
				this.failed = true;
				return "flow-control-error";
			}
			stream.responseCredit = consumeCredit(
				stream.responseCredit,
				payloadBytes,
			);
			this.channelCredit = consumeCredit(this.channelCredit, payloadBytes);
			return "ok";
		}

		if (frameType === FRAME_TYPE_STREAM_CREDIT) {
			return "ok";
		}

		if (frameType === FRAME_TYPE_REQUEST_END) {
			stream.requestOpen = false;
			return "ok";
		}

		if (frameType === FRAME_TYPE_RESPONSE_END) {
			stream.responseOpen = false;
			this.closeStream(streamId);
			return "ok";
		}

		if (frameType === FRAME_TYPE_REQUEST_ABORT) {
			this.closeStream(streamId);
			return "ok";
		}

		if (frameType === FRAME_TYPE_RESPONSE_START) {
			return stream.responseOpen ? "ok" : "protocol-error";
		}

		return "ok";
	}

	closeStream(streamId) {
		this.streams.delete(streamId);
		this.closedStreams.add(streamId);
	}

	closeChannel(channelId) {
		this.channels.delete(channelId);
		this.failed = true;
	}
}

test("a v4 client connection becomes ready when all data channels are attached", () => {
	const model = new V4TunnelModel({ dataChannels: 2 });
	model.connectClientConnection("client-a");
	assert.equal(model.ready, false);
	assert.equal(model.connectDataChannel("client-a", 0), true);
	assert.equal(model.ready, false);
	assert.equal(model.connectDataChannel("client-a", 1), true);
	assert.equal(model.ready, true);

	assert.equal(model.connectDataChannel("old-client", 0), false);
});

test("streams are assigned to data channels once and stay pinned", () => {
	const model = new V4TunnelModel({ dataChannels: 2 });
	model.connectClientConnection("client-a");
	model.connectDataChannel("client-a", 0);
	model.connectDataChannel("client-a", 1);

	const first = model.startPublicRequest("client-a");
	const second = model.startPublicRequest("client-a");
	assert.deepEqual([first.channelId, second.channelId], [0, 1]);

	assert.equal(
		model.receiveFrame({
			clientConnectionId: "client-a",
			channelId: first.channelId,
			streamId: first.streamId,
			frameType: FRAME_TYPE_RESPONSE_START,
		}),
		"ok",
	);
	assert.equal(
		model.receiveFrame({
			clientConnectionId: "client-a",
			channelId: second.channelId,
			streamId: first.streamId,
			frameType: FRAME_TYPE_RESPONSE_DATA,
		}),
		"protocol-error",
	);
});

test("unknown data before stream start is a protocol error", () => {
	const model = new V4TunnelModel();
	model.connectClientConnection("client-a");
	model.connectDataChannel("client-a", 0);
	model.connectDataChannel("client-a", 1);

	assert.equal(
		model.receiveFrame({
			clientConnectionId: "client-a",
			channelId: 0,
			streamId: 99n,
			frameType: FRAME_TYPE_RESPONSE_DATA,
		}),
		"protocol-error",
	);
	assert.equal(model.ready, false);
});

test("stream abort closes only that stream and ignores late frames", () => {
	const model = new V4TunnelModel();
	model.connectClientConnection("client-a");
	model.connectDataChannel("client-a", 0);
	model.connectDataChannel("client-a", 1);
	const stream = model.startPublicRequest("client-a");
	const next = model.startPublicRequest("client-a");

	assert.equal(
		model.receiveFrame({
			clientConnectionId: "client-a",
			channelId: stream.channelId,
			streamId: stream.streamId,
			frameType: FRAME_TYPE_REQUEST_ABORT,
		}),
		"ok",
	);
	assert.equal(
		model.receiveFrame({
			clientConnectionId: "client-a",
			channelId: stream.channelId,
			streamId: stream.streamId,
			frameType: FRAME_TYPE_RESPONSE_DATA,
		}),
		"ignored-closed-stream",
	);
	assert.equal(
		model.receiveFrame({
			clientConnectionId: "client-a",
			channelId: next.channelId,
			streamId: next.streamId,
			frameType: FRAME_TYPE_RESPONSE_START,
		}),
		"ok",
	);
	assert.equal(model.failed, false);
});

test("flow control is enforced at stream and channel level", () => {
	const model = new V4TunnelModel({
		dataChannels: 1,
		limits: {
			...defaultTunnelLimits(),
			streamCreditBytes: 10,
			channelCreditBytes: 15,
		},
	});
	model.connectClientConnection("client-a");
	model.connectDataChannel("client-a", 0);
	const stream = model.startPublicRequest("client-a");

	assert.equal(
		model.receiveFrame({
			clientConnectionId: "client-a",
			channelId: 0,
			streamId: stream.streamId,
			frameType: FRAME_TYPE_RESPONSE_DATA,
			payloadBytes: 10,
		}),
		"ok",
	);
	assert.equal(
		model.receiveFrame({
			clientConnectionId: "client-a",
			channelId: 0,
			streamId: stream.streamId,
			frameType: FRAME_TYPE_RESPONSE_DATA,
			payloadBytes: 1,
		}),
		"flow-control-error",
	);

	const channelModel = new V4TunnelModel({
		dataChannels: 1,
		limits: {
			...defaultTunnelLimits(),
			streamCreditBytes: DEFAULT_STREAM_CREDIT_BYTES,
			channelCreditBytes: 5,
		},
	});
	channelModel.connectClientConnection("client-a");
	channelModel.connectDataChannel("client-a", 0);
	const channelStream = channelModel.startPublicRequest("client-a");
	assert.equal(
		channelModel.receiveFrame({
			clientConnectionId: "client-a",
			channelId: 0,
			streamId: channelStream.streamId,
			frameType: FRAME_TYPE_RESPONSE_DATA,
			payloadBytes: 6,
		}),
		"flow-control-error",
	);
});

test("new client connections replace old ones", () => {
	const model = new V4TunnelModel();
	model.connectClientConnection("client-a");
	model.connectDataChannel("client-a", 0);
	model.connectDataChannel("client-a", 1);
	const oldStream = model.startPublicRequest("client-a");

	model.connectClientConnection("client-b");
	model.connectDataChannel("client-b", 0);
	model.connectDataChannel("client-b", 1);
	assert.equal(
		model.receiveFrame({
			clientConnectionId: "client-a",
			channelId: oldStream.channelId,
			streamId: oldStream.streamId,
			frameType: FRAME_TYPE_RESPONSE_START,
		}),
		"ignored-old-client-connection",
	);

	const newStream = model.startPublicRequest("client-b");
	assert.equal(newStream.streamId, 1n);
});

test("channel close invalidates the active client connection", () => {
	const model = new V4TunnelModel();
	model.connectClientConnection("client-a");
	model.connectDataChannel("client-a", 0);
	model.connectDataChannel("client-a", 1);
	assert.equal(model.ready, true);
	model.closeChannel(0);
	assert.equal(model.ready, false);
	assert.equal(model.failed, true);
	assert.equal(DEFAULT_CHANNEL_CREDIT_BYTES > 0, true);
});
