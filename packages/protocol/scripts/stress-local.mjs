import assert from "node:assert/strict";
import {
	chooseNextDataChannel,
	consumeCredit,
	defaultTunnelLimits,
	FRAME_TYPE_CHANNEL_CREDIT,
	FRAME_TYPE_REQUEST_ABORT,
	FRAME_TYPE_REQUEST_DATA,
	FRAME_TYPE_REQUEST_END,
	FRAME_TYPE_RESPONSE_DATA,
	FRAME_TYPE_RESPONSE_END,
	FRAME_TYPE_RESPONSE_START,
} from "../dist/index.js";

const ITERATIONS = Number.parseInt(process.env.ITERATIONS ?? "10000", 10);
const DATA_CHANNELS = Number.parseInt(process.env.DATA_CHANNELS ?? "2", 10);
const limits = defaultTunnelLimits();

class TunnelStressModel {
	constructor() {
		this.clientConnectionId = "client-0";
		this.channels = new Set(
			Array.from({ length: DATA_CHANNELS }, (_, index) => index),
		);
		this.streams = new Map();
		this.closedStreams = new Set();
		this.nextStreamId = 1n;
		this.nextChannelIndex = 0;
		this.channelCredit = limits.channelCreditBytes;
		this.protocolErrors = 0;
		this.ignoredOldFrames = 0;
		this.closedStreamsCount = 0;
	}

	createStream() {
		const selected = chooseNextDataChannel(
			this.nextChannelIndex,
			DATA_CHANNELS,
		);
		this.nextChannelIndex = selected.nextChannelIndex;
		const streamId = this.nextStreamId;
		this.nextStreamId += 1n;
		this.streams.set(streamId, {
			channelId: selected.channelId,
			requestCredit: limits.streamCreditBytes,
			responseCredit: limits.streamCreditBytes,
			requestOpen: true,
			responseOpen: true,
		});
		return { streamId, channelId: selected.channelId };
	}

	receive({ clientConnectionId, channelId, streamId, frameType, bytes = 0 }) {
		if (clientConnectionId !== this.clientConnectionId) {
			this.ignoredOldFrames += 1;
			return;
		}
		if (!this.channels.has(channelId)) {
			this.protocolErrors += 1;
			return;
		}
		if (frameType === FRAME_TYPE_CHANNEL_CREDIT) {
			if (streamId !== 0n) {
				this.protocolErrors += 1;
			}
			return;
		}
		if (this.closedStreams.has(streamId)) {
			return;
		}

		const stream = this.streams.get(streamId);
		if (!stream || stream.channelId !== channelId) {
			this.protocolErrors += 1;
			return;
		}

		if (frameType === FRAME_TYPE_REQUEST_DATA) {
			if (bytes > stream.requestCredit || bytes > this.channelCredit) {
				this.protocolErrors += 1;
				return;
			}
			stream.requestCredit = consumeCredit(stream.requestCredit, bytes);
			this.channelCredit = consumeCredit(this.channelCredit, bytes);
			return;
		}

		if (frameType === FRAME_TYPE_RESPONSE_DATA) {
			if (bytes > stream.responseCredit || bytes > this.channelCredit) {
				this.protocolErrors += 1;
				return;
			}
			stream.responseCredit = consumeCredit(stream.responseCredit, bytes);
			this.channelCredit = consumeCredit(this.channelCredit, bytes);
			return;
		}

		if (
			frameType === FRAME_TYPE_REQUEST_ABORT ||
			frameType === FRAME_TYPE_RESPONSE_END
		) {
			this.closeStream(streamId);
			return;
		}

		if (frameType === FRAME_TYPE_REQUEST_END) {
			stream.requestOpen = false;
			return;
		}

		if (frameType === FRAME_TYPE_RESPONSE_START) {
			return;
		}
	}

	closeStream(streamId) {
		if (this.streams.delete(streamId)) {
			this.closedStreams.add(streamId);
			this.closedStreamsCount += 1;
		}
	}

	reconnect() {
		this.clientConnectionId = `client-${this.nextStreamId}`;
		this.streams.clear();
		this.closedStreams.clear();
		this.nextStreamId = 1n;
		this.nextChannelIndex = 0;
		this.channelCredit = limits.channelCreditBytes;
	}
}

const model = new TunnelStressModel();

for (let index = 0; index < ITERATIONS; index += 1) {
	if (index > 0 && index % 2500 === 0) {
		const oldClientConnectionId = model.clientConnectionId;
		model.reconnect();
		model.receive({
			clientConnectionId: oldClientConnectionId,
			channelId: 0,
			streamId: 1n,
			frameType: FRAME_TYPE_RESPONSE_DATA,
			bytes: 1,
		});
	}

	const stream = model.createStream();
	model.receive({
		clientConnectionId: model.clientConnectionId,
		channelId: stream.channelId,
		streamId: stream.streamId,
		frameType: FRAME_TYPE_RESPONSE_START,
	});
	model.receive({
		clientConnectionId: model.clientConnectionId,
		channelId: stream.channelId,
		streamId: stream.streamId,
		frameType: FRAME_TYPE_REQUEST_DATA,
		bytes: 64,
	});
	model.receive({
		clientConnectionId: model.clientConnectionId,
		channelId: stream.channelId,
		streamId: stream.streamId,
		frameType: FRAME_TYPE_RESPONSE_DATA,
		bytes: 64,
	});

	if (index % 17 === 0) {
		model.receive({
			clientConnectionId: model.clientConnectionId,
			channelId: stream.channelId,
			streamId: stream.streamId,
			frameType: FRAME_TYPE_REQUEST_ABORT,
		});
	} else {
		model.receive({
			clientConnectionId: model.clientConnectionId,
			channelId: stream.channelId,
			streamId: stream.streamId,
			frameType: FRAME_TYPE_REQUEST_END,
		});
		model.receive({
			clientConnectionId: model.clientConnectionId,
			channelId: stream.channelId,
			streamId: stream.streamId,
			frameType: FRAME_TYPE_RESPONSE_END,
		});
	}

	if (index % 101 === 0) {
		model.receive({
			clientConnectionId: model.clientConnectionId,
			channelId: (stream.channelId + 1) % DATA_CHANNELS,
			streamId: stream.streamId,
			frameType: FRAME_TYPE_RESPONSE_DATA,
			bytes: 1,
		});
	}
}

assert.equal(model.ignoredOldFrames > 0, true);
assert.equal(model.closedStreamsCount > 0, true);
console.log(
	JSON.stringify(
		{
			iterations: ITERATIONS,
			dataChannels: DATA_CHANNELS,
			activeStreams: model.streams.size,
			closedStreams: model.closedStreamsCount,
			ignoredOldFrames: model.ignoredOldFrames,
			intentionalProtocolErrors: model.protocolErrors,
		},
		null,
		2,
	),
);
