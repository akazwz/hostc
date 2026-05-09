import {
	consumeCredit,
	createCreditWindow,
	decodeDataFrameView,
	encodeDataFrame,
	grantCredit,
	selectDataChannel,
} from "../dist/index.js";

const STREAMS = 1000;
const DATA_CHANNELS = 4;
const RESPONSE_BYTES_PER_STREAM = 64 * 1024;
const CHUNK_BYTES = 4 * 1024;
const SMALL_CREDIT_WINDOW_BYTES = 8 * 1024;
const SEED = 0x5eed1234;

class FakeTunnelModel {
	constructor(dataChannels, creditWindowBytes) {
		this.dataChannels = dataChannels;
		this.creditWindowBytes = creditWindowBytes;
		this.framesPerStream = RESPONSE_BYTES_PER_STREAM / CHUNK_BYTES;
		this.connectionId = null;
		this.nextStreamId = 1;
		this.controlConnected = false;
		this.channels = new Set();
		this.streams = new Map();
		this.pendingData = new Map();
		this.abortedStreamIds = new Set();
		this.connectionCredit = createCreditWindow(creditWindowBytes);
		this.metrics = {
			startedStreams: 0,
			completedStreams: 0,
			abortedStreams: 0,
			reconnects: 0,
			pendingDataEvents: 0,
			endBeforeLastDataEvents: 0,
			oldConnectionIgnored: 0,
			blockedSends: 0,
			protocolErrors: 0,
			maxActiveStreams: 0,
			maxPendingBytes: 0,
			totalBytesDelivered: 0,
		};
	}

	connect(connectionId) {
		this.connectionId = connectionId;
		this.controlConnected = true;
		this.channels.clear();
		this.connectionCredit = createCreditWindow(this.creditWindowBytes);
		this.metrics.reconnects += 1;
	}

	connectDataChannels() {
		for (let channelId = 0; channelId < this.dataChannels; channelId += 1) {
			this.channels.add(channelId);
		}
	}

	assertNotReadyBeforeDataChannels() {
		if (this.isReady()) {
			throw new Error("model was ready before data channels connected");
		}
	}

	assertReady() {
		if (!this.isReady()) {
			throw new Error("model is not ready");
		}
	}

	isReady() {
		return (
			this.controlConnected &&
			this.connectionId !== null &&
			this.channels.size === this.dataChannels
		);
	}

	assertNoCreditBlocksSend() {
		const streamCredit = createCreditWindow(1);
		const attempted = consumeCredit(streamCredit, 2);
		if (attempted.ok) {
			throw new Error("send was allowed without enough credit");
		}
		this.metrics.blockedSends += 1;
	}

	startStream() {
		if (!this.isReady()) {
			throw new Error("public request started before ready");
		}
		const id = this.nextStreamId;
		this.nextStreamId += 1;
		this.abortedStreamIds.delete(id);
		this.streams.set(id, {
			id,
			channelId: selectDataChannel(id, this.dataChannels),
			recvNextSeq: 0,
			lastSeq: null,
			streamCredit: createCreditWindow(this.creditWindowBytes),
			bytes: 0,
			ended: false,
		});
		this.metrics.startedStreams += 1;
		this.metrics.maxActiveStreams = Math.max(
			this.metrics.maxActiveStreams,
			this.streams.size,
		);
		this.flushPending(id);
		return id;
	}

	receiveFrame(connectionId, streamId, seq) {
		if (connectionId !== this.connectionId) {
			this.metrics.oldConnectionIgnored += 1;
			return;
		}
		if (this.abortedStreamIds.has(streamId)) {
			return;
		}

		const encoded = encodeDataFrame({
			kind: "response.body",
			id: streamId,
			seq,
			payload: new Uint8Array(CHUNK_BYTES).fill(seq & 0xff),
		});
		const frame = decodeDataFrameView(encoded);
		if (!frame) {
			this.metrics.protocolErrors += 1;
			throw new Error("failed to decode generated frame");
		}

		const channelId = selectDataChannel(frame.id, this.dataChannels);
		const stream = this.streams.get(streamId);
		if (!stream) {
			this.enqueuePending(streamId, { type: "frame", frame, channelId });
			return;
		}
		this.deliverFrame(stream, frame, channelId);
	}

	receiveEnd(streamId, lastSeq) {
		const stream = this.streams.get(streamId);
		if (!stream) {
			this.enqueuePending(streamId, { type: "end", lastSeq });
			return;
		}
		if ((stream.recvNextSeq ?? 0) <= lastSeq) {
			this.metrics.endBeforeLastDataEvents += 1;
		}
		stream.lastSeq = lastSeq;
		this.finishIfComplete(stream);
	}

	deliverFrame(stream, frame, channelId) {
		if (channelId !== stream.channelId) {
			this.metrics.protocolErrors += 1;
			throw new Error("frame arrived on wrong data channel");
		}
		if (frame.seq !== stream.recvNextSeq) {
			this.metrics.protocolErrors += 1;
			throw new Error(
				`seq discontinuity for ${stream.id}: expected ${stream.recvNextSeq}, got ${frame.seq}`,
			);
		}

		const connectionResult = consumeCredit(
			this.connectionCredit,
			frame.payloadLength,
		);
		const streamResult = consumeCredit(
			stream.streamCredit,
			frame.payloadLength,
		);
		if (!connectionResult.ok || !streamResult.ok) {
			this.metrics.protocolErrors += 1;
			throw new Error("credit violation");
		}
		this.connectionCredit = grantCredit(
			connectionResult.window,
			frame.payloadLength,
		);
		stream.streamCredit = grantCredit(streamResult.window, frame.payloadLength);

		this.assertCreditNonNegative(stream);
		stream.recvNextSeq += 1;
		stream.bytes += frame.payloadLength;
		this.metrics.totalBytesDelivered += frame.payloadLength;
		this.finishIfComplete(stream);
	}

	abortStream(streamId) {
		if (!this.streams.has(streamId)) {
			return;
		}
		this.streams.delete(streamId);
		this.pendingData.delete(streamId);
		this.abortedStreamIds.add(streamId);
		this.metrics.abortedStreams += 1;
	}

	closeDataChannel() {
		this.controlConnected = false;
		this.channels.clear();
		for (const streamId of this.streams.keys()) {
			this.abortedStreamIds.add(streamId);
		}
		this.streams.clear();
		this.pendingData.clear();
		this.connectionId = null;
		this.connectionCredit = createCreditWindow(this.creditWindowBytes);
	}

	enqueuePending(streamId, item) {
		const pending = this.pendingData.get(streamId) ?? [];
		pending.push(item);
		this.pendingData.set(streamId, pending);
		this.metrics.pendingDataEvents += 1;
		this.metrics.maxPendingBytes = Math.max(
			this.metrics.maxPendingBytes,
			pending.reduce(
				(total, entry) =>
					total + (entry.type === "frame" ? entry.frame.payloadLength : 0),
				0,
			),
		);
	}

	flushPending(streamId) {
		const pending = this.pendingData.get(streamId) ?? [];
		for (const item of pending) {
			const stream = this.streams.get(streamId);
			if (!stream) {
				break;
			}
			if (item.type === "frame") {
				this.deliverFrame(stream, item.frame, item.channelId);
			} else {
				this.receiveEnd(streamId, item.lastSeq);
			}
		}
		this.pendingData.delete(streamId);
	}

	finishIfComplete(stream) {
		if (stream.lastSeq === null) {
			return;
		}
		if (stream.recvNextSeq <= stream.lastSeq) {
			return;
		}
		if (stream.bytes !== RESPONSE_BYTES_PER_STREAM) {
			throw new Error(
				`stream ${stream.id} completed with ${stream.bytes} bytes`,
			);
		}
		this.streams.delete(stream.id);
		this.metrics.completedStreams += 1;
	}

	assertCreditNonNegative(stream) {
		if (
			this.connectionCredit.available < 0 ||
			stream.streamCredit.available < 0
		) {
			throw new Error("credit went negative");
		}
	}

	assertConverged() {
		if (this.streams.size !== 0) {
			throw new Error(`${this.streams.size} active streams leaked`);
		}
		if (this.pendingData.size !== 0) {
			throw new Error(`${this.pendingData.size} pending streams leaked`);
		}
		if (this.connectionCredit.available < 0) {
			throw new Error("connection credit went negative");
		}
	}
}

function seededRandom(seed) {
	let value = seed >>> 0;
	return () => {
		value ^= value << 13;
		value ^= value >>> 17;
		value ^= value << 5;
		return (value >>> 0) / 0x100000000;
	};
}

function randomInt(randomFn, min, max) {
	return min + Math.floor(randomFn() * (max - min + 1));
}

function run() {
	const random = seededRandom(SEED);
	const model = new FakeTunnelModel(DATA_CHANNELS, SMALL_CREDIT_WINDOW_BYTES);

	model.connect("c1");
	model.assertNotReadyBeforeDataChannels();
	model.connectDataChannels();
	model.assertReady();
	model.assertNoCreditBlocksSend();

	for (let index = 0; index < STREAMS; index += 1) {
		if (index === Math.floor(STREAMS / 2)) {
			const oldConnectionId = model.connectionId;
			const activeStreamId = model.startStream();
			model.receiveFrame(oldConnectionId, activeStreamId, 0);
			model.closeDataChannel();
			model.assertConverged();
			model.receiveFrame(oldConnectionId, activeStreamId, 1);
			model.connect("c2");
			model.connectDataChannels();
			model.assertReady();
		}

		const streamId = model.nextStreamId;
		const abortAtSeq = random() < 0.07 ? randomInt(random, 2, 12) : null;
		const dataBeforeStart = random() < 0.12;
		const endBeforeLastData = random() < 0.12;

		if (dataBeforeStart) {
			model.receiveFrame(model.connectionId, streamId, 0);
		}

		model.startStream();

		if (endBeforeLastData) {
			model.receiveEnd(streamId, model.framesPerStream - 1);
		}

		const startSeq = dataBeforeStart ? 1 : 0;
		for (let seq = startSeq; seq < model.framesPerStream; seq += 1) {
			if (abortAtSeq === seq) {
				model.abortStream(streamId, "random abort");
				model.receiveFrame(model.connectionId, streamId, seq);
				break;
			}
			model.receiveFrame(model.connectionId, streamId, seq);
		}

		if (abortAtSeq === null && !endBeforeLastData) {
			model.receiveEnd(streamId, model.framesPerStream - 1);
		}
	}

	model.assertConverged();

	console.log(
		JSON.stringify(
			{
				ok: true,
				date: new Date().toISOString(),
				seed: SEED,
				streams: STREAMS,
				dataChannels: DATA_CHANNELS,
				responseBytesPerStream: RESPONSE_BYTES_PER_STREAM,
				chunkBytes: CHUNK_BYTES,
				smallCreditWindowBytes: SMALL_CREDIT_WINDOW_BYTES,
				...model.metrics,
				final: {
					streams: model.streams.size,
					pendingStreams: model.pendingData.size,
					abortedIds: model.abortedStreamIds.size,
					connectionCredit: model.connectionCredit.available,
				},
			},
			null,
			2,
		),
	);
}

run();
