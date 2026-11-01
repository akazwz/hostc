import { once } from "node:events";
import type { AddressInfo } from "node:net";

import { decodeClose, decodeFrame, encodeFrame, encodeOpen, type Frame, FrameType } from "@hostc/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { type RawData, WebSocket, WebSocketServer } from "ws";

import { Connection } from "../src/connection.ts";
import { createStream } from "../src/streams.ts";

const MESSAGE_BYTES = 512 * 1024;
const STREAM = 1;

type Setup = {
	connection: Connection;
	/** The tunnel server's end of the client connection. */
	tunnel: WebSocket;
	/** The local server's end of the bridged WebSocket. */
	local: WebSocket;
	frames: Frame[];
};

const cleanups: (() => void)[] = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) {
		cleanup();
	}
});

async function listen(): Promise<{ server: WebSocketServer; port: number }> {
	const server = new WebSocketServer({ host: "127.0.0.1", port: 0, maxPayload: 2 * 1024 * 1024 });
	await once(server, "listening");
	cleanups.push(() => {
		for (const client of server.clients) {
			client.terminate();
		}
		server.close();
	});
	return { server, port: (server.address() as AddressInfo).port };
}

function toBytes(data: RawData): Uint8Array {
	return Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? new Uint8Array(data) : data;
}

async function until(condition: () => boolean, what: string): Promise<void> {
	const deadline = Date.now() + 15_000;
	while (!condition()) {
		if (Date.now() > deadline) {
			throw new Error(`timed out waiting for ${what}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 100));

/** A real Connection between a fake tunnel server and a local WebSocket server, with one bridged stream. */
async function bridge(): Promise<Setup> {
	const tunnelServer = await listen();
	const localServer = await listen();
	const accepted = once(tunnelServer.server, "connection") as Promise<[WebSocket]>;
	const connection = await Connection.open({
		tunnel: {
			id: "abcdefghijkm",
			url: "https://abcdefghijkm.hostc.test",
			connectUrl: `ws://127.0.0.1:${tunnelServer.port}/`,
			token: "token",
		},
		target: new URL(`http://127.0.0.1:${localServer.port}`),
		onRequest: () => {},
	});
	cleanups.push(() => connection.close(1000, "test over"));
	const [tunnel] = await accepted;

	const frames: Frame[] = [];
	tunnel.on("message", (data, isBinary) => {
		if (isBinary) {
			frames.push(decodeFrame(toBytes(data)));
		}
	});

	const opened = once(localServer.server, "connection") as Promise<[WebSocket]>;
	tunnel.send(
		encodeFrame(
			FrameType.Open,
			STREAM,
			encodeOpen({ method: "GET", path: "/", headers: [], body: false, websocket: [] }),
		),
	);
	const [local] = await opened;
	await until(() => frames.some((frame) => frame.type === FrameType.Head), "the WebSocket to be accepted");
	return { connection, tunnel, local, frames };
}

describe("WebSocket backpressure", () => {
	it("stops reading a local socket while the tunnel is congested, and loses nothing", async () => {
		const { tunnel, local, frames } = await bridge();
		const count = 200;

		tunnel.pause();
		for (let index = 0; index < count; index++) {
			local.send(Buffer.alloc(MESSAGE_BYTES, index));
		}

		// Whatever the client refuses to read stays with the local server. Without backpressure the
		// client drains it all into its own memory and the local server has nothing left to send.
		await new Promise((resolve) => setTimeout(resolve, 500));
		expect(local.bufferedAmount).toBeGreaterThan((count * MESSAGE_BYTES) / 2);

		tunnel.resume();
		const data = () => frames.filter((frame) => frame.type === FrameType.Data);
		await until(() => data().length === count, "every message to arrive");
		expect(data().map((frame) => frame.payload[0])).toEqual(Array.from({ length: count }, (_, index) => index));
	}, 30_000);

	it("reads a paused local socket again only after all of its messages are written", async () => {
		const { server, port } = await listen();
		const accepted = once(server, "connection") as Promise<[WebSocket]>;
		const flushes: (() => void)[] = [];
		const stream = createStream(
			{
				target: new URL(`http://127.0.0.1:${port}`),
				publicOrigin: "https://abcdefghijkm.hostc.test",
				send: (type, _id, _payload, flushed) => {
					if (type === FrameType.Data && flushed) {
						flushes.push(flushed);
					}
				},
				log: () => {},
				remove: () => {},
			},
			STREAM,
			{ method: "GET", path: "/", headers: [], body: false, websocket: [] },
		);
		stream.start();
		cleanups.push(() => stream.abort());
		const [local] = await accepted;

		const count = 20_000;
		for (let index = 0; index < count; index++) {
			local.send(Buffer.alloc(4 * 1024));
		}
		await until(() => flushes.length > 0, "the first message");
		await settled();
		const firstRead = flushes.length;
		expect(firstRead).toBeLessThan(count);

		flushes[0]?.();
		await settled();
		expect(flushes.length).toBe(firstRead);

		for (const flushed of flushes.slice(1, firstRead)) {
			flushed();
		}
		await until(() => flushes.length > firstRead, "reading to resume");
	}, 30_000);

	it("closes a stream whose local server stops reading, and keeps the tunnel", async () => {
		const { tunnel, local, frames } = await bridge();
		local.pause();

		const payload = Buffer.alloc(MESSAGE_BYTES);
		const end = () => frames.find((frame) => frame.type === FrameType.End);
		let sent = 0;
		while (!end() && sent < 400) {
			tunnel.send(encodeFrame(FrameType.Data, STREAM, payload));
			sent++;
			await new Promise((resolve) => setTimeout(resolve, 2));
		}

		const frame = end();
		expect(frame, `no END after ${sent} messages`).toBeDefined();
		expect(decodeClose((frame as Frame).payload).code).toBe(1013);
		expect(tunnel.readyState).toBe(WebSocket.OPEN);
		// The queue is only freed if the local socket goes away too.
		local.resume();
		await until(() => local.readyState === WebSocket.CLOSED, "the local socket to close");
	}, 30_000);

	it("finishes the close handshake with a paused local socket", async () => {
		const { tunnel, local, frames } = await bridge();

		tunnel.pause();
		for (let index = 0; index < 200; index++) {
			local.send(Buffer.alloc(MESSAGE_BYTES));
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
		const closed = once(local, "close");
		const started = Date.now();
		tunnel.send(encodeFrame(FrameType.End, STREAM, new Uint8Array([0x03, 0xe8])));
		await closed;
		// ws destroys a socket that never finishes the handshake after 30 seconds.
		expect(Date.now() - started).toBeLessThan(10_000);
		expect(frames.some((frame) => frame.type === FrameType.End)).toBe(false);
	}, 30_000);
});
