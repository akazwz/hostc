import { performance } from "node:perf_hooks";
import {
	decodeFrameView,
	decodeMetadata,
	defaultTunnelLimits,
	encodeFrame,
	encodeMetadata,
	FRAME_FLAG_NONE,
	FRAME_TYPE_CHANNEL_CREDIT,
	FRAME_TYPE_REQUEST_DATA,
	FRAME_TYPE_REQUEST_START,
	FRAME_TYPE_RESPONSE_DATA,
	FRAME_TYPE_RESPONSE_START,
	FRAME_TYPE_STREAM_CREDIT,
} from "../dist/index.js";

const ITERATIONS = Number.parseInt(process.env.ITERATIONS ?? "100000", 10);
const PAYLOAD_BYTES = Number.parseInt(process.env.PAYLOAD_BYTES ?? "1024", 10);
const payload = new Uint8Array(PAYLOAD_BYTES);
payload.fill(42);

const requestStart = {
	kind: "http",
	method: "POST",
	target: "/bench",
	headers: [["content-type", "application/octet-stream"]],
	hasBody: true,
};
const responseStart = {
	status: 200,
	headers: [["content-type", "application/octet-stream"]],
	hasBody: true,
};
const streamCredit = {
	kind: "request.body",
	bytes: defaultTunnelLimits().streamCreditBytes,
};
const channelCredit = { bytes: defaultTunnelLimits().channelCreditBytes };

function bench(name, fn) {
	const started = performance.now();
	let checksum = 0;
	for (let index = 0; index < ITERATIONS; index += 1) {
		checksum += fn(index);
	}
	const elapsedMs = performance.now() - started;
	const opsPerSecond = Math.round((ITERATIONS / elapsedMs) * 1000);
	console.log(
		`${name}: ${opsPerSecond.toLocaleString()} ops/sec (${elapsedMs.toFixed(1)} ms, checksum ${checksum})`,
	);
}

const requestStartPayload = encodeMetadata(
	FRAME_TYPE_REQUEST_START,
	requestStart,
);
const responseStartPayload = encodeMetadata(
	FRAME_TYPE_RESPONSE_START,
	responseStart,
);
const streamCreditPayload = encodeMetadata(
	FRAME_TYPE_STREAM_CREDIT,
	streamCredit,
);
const channelCreditPayload = encodeMetadata(
	FRAME_TYPE_CHANNEL_CREDIT,
	channelCredit,
);
const requestFrame = encodeFrame({
	frameType: FRAME_TYPE_REQUEST_DATA,
	streamId: 1n,
	seq: 0n,
	flags: FRAME_FLAG_NONE,
	payload,
});
const responseFrame = encodeFrame({
	frameType: FRAME_TYPE_RESPONSE_DATA,
	streamId: 1n,
	seq: 0n,
	flags: FRAME_FLAG_NONE,
	payload,
});

bench(
	"metadata encode request.start",
	() => encodeMetadata(FRAME_TYPE_REQUEST_START, requestStart).byteLength,
);
bench(
	"metadata decode request.start",
	() =>
		decodeMetadata(FRAME_TYPE_REQUEST_START, requestStartPayload).headers
			.length,
);
bench(
	"metadata encode response.start",
	() => encodeMetadata(FRAME_TYPE_RESPONSE_START, responseStart).byteLength,
);
bench(
	"metadata decode response.start",
	() => decodeMetadata(FRAME_TYPE_RESPONSE_START, responseStartPayload).status,
);
bench(
	"metadata encode stream.credit",
	() => encodeMetadata(FRAME_TYPE_STREAM_CREDIT, streamCredit).byteLength,
);
bench(
	"metadata decode stream.credit",
	() => decodeMetadata(FRAME_TYPE_STREAM_CREDIT, streamCreditPayload).bytes,
);
bench(
	"metadata encode channel.credit",
	() => encodeMetadata(FRAME_TYPE_CHANNEL_CREDIT, channelCredit).byteLength,
);
bench(
	"metadata decode channel.credit",
	() => decodeMetadata(FRAME_TYPE_CHANNEL_CREDIT, channelCreditPayload).bytes,
);
bench(
	"frame encode request.data",
	(index) =>
		encodeFrame({
			frameType: FRAME_TYPE_REQUEST_DATA,
			streamId: 1n,
			seq: BigInt(index),
			payload,
		}).byteLength,
);
bench(
	"frame decode request.data",
	() => decodeFrameView(requestFrame).payload.byteLength,
);
bench(
	"frame encode response.data",
	(index) =>
		encodeFrame({
			frameType: FRAME_TYPE_RESPONSE_DATA,
			streamId: 1n,
			seq: BigInt(index),
			payload,
		}).byteLength,
);
bench(
	"frame decode response.data",
	() => decodeFrameView(responseFrame).payload.byteLength,
);
