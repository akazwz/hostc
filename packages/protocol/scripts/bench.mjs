import {
	consumeCredit,
	createCreditWindow,
	DATA_FLAG_WS_BINARY,
	decodeControlMessage,
	decodeDataFrameView,
	encodeControlMessage,
	encodeDataFrame,
	filterHttpRequestHeaders,
	grantCredit,
	selectDataChannel,
} from "../dist/index.js";

const nodeVersion = process.version;
const date = new Date().toISOString();
const payload1k = new Uint8Array(1024).fill(1);
const payload64k = new Uint8Array(64 * 1024).fill(2);
const frame1k = encodeDataFrame({
	kind: "ws.client",
	id: 1,
	seq: 1,
	flags: DATA_FLAG_WS_BINARY,
	payload: payload1k,
});
const frame64k = encodeDataFrame({
	kind: "response.body",
	id: 1,
	seq: 1,
	payload: payload64k,
});
const controlRaw = encodeControlMessage({
	type: "request.start",
	id: 1,
	kind: "http",
	method: "GET",
	url: "/bench",
	headers: [["accept", "*/*"]],
	body: false,
});
const creditWindow = createCreditWindow(1024);
const headers = [
	["connection", "x-drop"],
	["x-drop", "1"],
	["content-type", "text/plain"],
	["host", "example.com"],
];

const cases = [
	bench("dataFrame encode 1 KiB", 100_000, () => {
		encodeDataFrame({
			kind: "response.body",
			id: 1,
			seq: 1,
			payload: payload1k,
		});
	}),
	bench("dataFrame encode 64 KiB", 10_000, () => {
		encodeDataFrame({
			kind: "response.body",
			id: 1,
			seq: 1,
			payload: payload64k,
		});
	}),
	bench("dataFrame decode 1 KiB", 100_000, () => {
		decodeDataFrameView(frame1k);
	}),
	bench("dataFrame decode 64 KiB", 10_000, () => {
		decodeDataFrameView(frame64k);
	}),
	bench("decode low-copy allocation check", 100_000, () => {
		const decoded = decodeDataFrameView(frame1k);
		if (decoded.payload.buffer !== frame1k.buffer) {
			throw new Error("payload copied");
		}
	}),
	bench("control JSON parse/validate", 100_000, () => {
		decodeControlMessage(controlRaw);
	}),
	bench("selectDataChannel", 1_000_000, () => {
		selectDataChannel(1234567, 2);
	}),
	bench("credit helper", 1_000_000, () => {
		const consumed = consumeCredit(creditWindow, 64);
		if (!consumed.ok) {
			throw new Error("credit failed");
		}
		grantCredit(consumed.window, 64);
	}),
	bench("header filter", 100_000, () => {
		filterHttpRequestHeaders(headers);
	}),
];

console.log(JSON.stringify({ nodeVersion, date, cases }, null, 2));

function bench(name, iterations, fn) {
	const start = performance.now();
	for (let index = 0; index < iterations; index += 1) {
		fn();
	}
	const durationMs = performance.now() - start;
	return {
		name,
		iterations,
		durationMs: Number(durationMs.toFixed(3)),
		opsPerSec: Math.round((iterations / durationMs) * 1000),
		payloadSize: name.includes("64 KiB")
			? "64 KiB"
			: name.includes("1 KiB")
				? "1 KiB"
				: "n/a",
		memory: name.includes("low-copy")
			? "payload is a subarray of source frame"
			: "baseline only",
	};
}
