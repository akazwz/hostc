import assert from "node:assert/strict";
import test from "node:test";

class ProtocolStateModel {
	constructor(dataChannels = 2) {
		this.dataChannels = dataChannels;
		this.connectionId = null;
		this.controlConnected = false;
		this.channels = new Set();
		this.failed = false;
		this.nextStreamId = 1;
		this.streams = new Map();
		this.pendingData = new Map();
		this.streamCredit = new Map();
		this.connectionCredit = 0;
	}

	connectControl(connectionId) {
		this.connectionId = connectionId;
		this.controlConnected = true;
		this.channels.clear();
		this.failed = false;
		this.streams.clear();
		this.pendingData.clear();
		this.connectionCredit = 1024;
	}

	connectData(connectionId, channelId) {
		if (connectionId !== this.connectionId) {
			this.failed = true;
			return "old-connection";
		}
		this.channels.add(channelId);
		return "ok";
	}

	isReady() {
		return (
			!this.failed &&
			this.controlConnected &&
			this.channels.size === this.dataChannels &&
			Array.from({ length: this.dataChannels }, (_, id) =>
				this.channels.has(id),
			).every(Boolean)
		);
	}

	startPublicRequest() {
		if (!this.isReady()) {
			throw new Error("not ready");
		}
		const stream = {
			id: this.nextStreamId++,
			aborted: false,
			recvNext: new Map(),
			lastSeq: new Map(),
			ended: new Set(),
		};
		this.streams.set(stream.id, stream);
		for (const kind of [
			"request.body",
			"response.body",
			"ws.client",
			"ws.server",
		]) {
			this.streamCredit.set(key(stream.id, kind), 256);
		}
		this.flushPending(stream.id);
		return stream.id;
	}

	sendData(streamId, kind, bytes) {
		if ((this.streamCredit.get(key(streamId, kind)) ?? 0) < bytes) {
			return "blocked";
		}
		if (this.connectionCredit < bytes) {
			return "blocked";
		}
		this.streamCredit.set(
			key(streamId, kind),
			this.streamCredit.get(key(streamId, kind)) - bytes,
		);
		this.connectionCredit -= bytes;
		return "sent";
	}

	grantCredit(streamId, kind, bytes) {
		this.streamCredit.set(
			key(streamId, kind),
			(this.streamCredit.get(key(streamId, kind)) ?? 0) + bytes,
		);
		this.connectionCredit += bytes;
	}

	receiveData(connectionId, streamId, kind, seq) {
		if (connectionId !== this.connectionId) {
			return "old-connection";
		}
		const stream = this.streams.get(streamId);
		if (!stream) {
			const pending = this.pendingData.get(streamId) ?? [];
			pending.push({ kind, seq });
			this.pendingData.set(streamId, pending);
			return "pending";
		}
		if (stream.aborted) {
			return "ignored";
		}
		const expected = stream.recvNext.get(kind) ?? 0;
		if (seq !== expected) {
			return "seq-error";
		}
		stream.recvNext.set(kind, expected + 1);
		this.finishIfComplete(stream, kind);
		return "received";
	}

	receiveEnd(streamId, kind, lastSeq) {
		const stream = this.streams.get(streamId);
		if (!stream) {
			const pending = this.pendingData.get(streamId) ?? [];
			pending.push({ kind, end: true, lastSeq });
			this.pendingData.set(streamId, pending);
			return "pending";
		}
		stream.lastSeq.set(kind, lastSeq);
		return this.finishIfComplete(stream, kind);
	}

	abort(streamId) {
		const stream = this.streams.get(streamId);
		if (stream) {
			stream.aborted = true;
			this.streams.delete(streamId);
			for (const kind of [
				"request.body",
				"response.body",
				"ws.client",
				"ws.server",
			]) {
				this.streamCredit.delete(key(streamId, kind));
			}
		}
	}

	closeDataChannel() {
		this.failed = true;
		this.controlConnected = false;
		this.channels.clear();
		this.streams.clear();
		this.pendingData.clear();
	}

	closeControl() {
		this.failed = true;
		this.controlConnected = false;
		this.channels.clear();
		this.streams.clear();
		this.pendingData.clear();
	}

	flushPending(streamId) {
		const pending = this.pendingData.get(streamId) ?? [];
		for (const item of pending) {
			if (item.end) {
				this.receiveEnd(streamId, item.kind, item.lastSeq);
			} else {
				this.receiveData(this.connectionId, streamId, item.kind, item.seq);
			}
		}
		this.pendingData.delete(streamId);
	}

	finishIfComplete(stream, kind) {
		const lastSeq = stream.lastSeq.get(kind);
		if (lastSeq === undefined) {
			return "waiting";
		}
		const next = stream.recvNext.get(kind) ?? 0;
		if (lastSeq === -1 || next > lastSeq) {
			stream.ended.add(kind);
			return "ended";
		}
		return "waiting";
	}
}

test("state model requires control and all data channels before public proxy", () => {
	const model = new ProtocolStateModel(2);
	assert.equal(model.isReady(), false);
	model.connectControl("c1");
	model.connectData("c1", 0);
	assert.equal(model.isReady(), false);
	assert.throws(() => model.startPublicRequest(), /not ready/);
	model.connectData("c1", 1);
	assert.equal(model.isReady(), true);
	assert.equal(model.startPublicRequest(), 1);
});

test("state model handles data before start and end before final data", () => {
	const model = readyModel();
	assert.equal(model.receiveData("c1", 1, "response.body", 0), "pending");
	assert.equal(model.receiveEnd(1, "response.body", 1), "pending");
	const streamId = model.startPublicRequest();
	assert.equal(streamId, 1);
	assert.equal(model.receiveData("c1", 1, "response.body", 1), "received");
	assert.equal(model.streams.get(1).ended.has("response.body"), true);
});

test("state model blocks data without stream and connection credit", () => {
	const model = readyModel();
	const streamId = model.startPublicRequest();
	assert.equal(model.sendData(streamId, "request.body", 128), "sent");
	assert.equal(model.streamCredit.get(key(streamId, "request.body")), 128);
	assert.equal(model.sendData(streamId, "request.body", 200), "blocked");
	model.grantCredit(streamId, "request.body", 200);
	assert.equal(model.sendData(streamId, "request.body", 200), "sent");
	model.connectionCredit = 0;
	assert.equal(model.sendData(streamId, "request.body", 1), "blocked");
});

test("state model rejects old connection data and fails on socket closes", () => {
	const model = readyModel();
	const streamId = model.startPublicRequest();
	assert.equal(
		model.receiveData("old", streamId, "response.body", 0),
		"old-connection",
	);
	model.closeDataChannel();
	assert.equal(model.failed, true);
	assert.equal(model.isReady(), false);

	const second = readyModel();
	second.startPublicRequest();
	second.closeControl();
	assert.equal(second.failed, true);
	assert.equal(second.streams.size, 0);
});

test("state model detects seq gaps and lastSeq mismatch", () => {
	const model = readyModel();
	const streamId = model.startPublicRequest();
	assert.equal(
		model.receiveData("c1", streamId, "response.body", 1),
		"seq-error",
	);
	assert.equal(model.receiveEnd(streamId, "response.body", 2), "waiting");
	assert.equal(
		model.receiveData("c1", streamId, "response.body", 0),
		"received",
	);
	assert.equal(
		model.receiveData("c1", streamId, "response.body", 1),
		"received",
	);
	assert.equal(model.streams.get(streamId).ended.has("response.body"), false);
	assert.equal(
		model.receiveData("c1", streamId, "response.body", 2),
		"received",
	);
	assert.equal(model.streams.get(streamId).ended.has("response.body"), true);
});

test("state model releases stream state on abort and ignores later data", () => {
	const model = readyModel();
	const streamId = model.startPublicRequest();
	model.abort(streamId);
	assert.equal(model.streams.has(streamId), false);
	assert.equal(model.streamCredit.has(key(streamId, "request.body")), false);
	assert.equal(
		model.receiveData("c1", streamId, "response.body", 0),
		"pending",
	);
});

function readyModel() {
	const model = new ProtocolStateModel(2);
	model.connectControl("c1");
	model.connectData("c1", 0);
	model.connectData("c1", 1);
	return model;
}

function key(streamId, kind) {
	return `${streamId}:${kind}`;
}
