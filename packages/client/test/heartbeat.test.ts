import { once } from "node:events";
import type { AddressInfo } from "node:net";

import { encodeFrame, encodeWindow, FrameType, PING } from "@hostc/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { type WebSocket, WebSocketServer } from "ws";

import { Connection } from "../src/connection.ts";

// Like the real one (15 s, 10 s): the pong timeout is shorter than the interval.
const HEARTBEAT = { intervalMs: 200, timeoutMs: 100 };

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) {
		cleanup();
	}
});

/** A tunnel server that never answers pings, and a Connection to it. */
async function silentTunnel(): Promise<{ connection: Connection; tunnel: WebSocket; pings: () => number }> {
	const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
	await once(server, "listening");
	cleanups.push(() => {
		for (const client of server.clients) {
			client.terminate();
		}
		server.close();
	});
	const accepted = once(server, "connection") as Promise<[WebSocket]>;
	const connection = await Connection.open({
		tunnel: {
			id: "abcdefghijkm",
			url: "https://abcdefghijkm.hostc.test",
			connectUrl: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/`,
			token: "token",
		},
		target: new URL("http://127.0.0.1:9"),
		onRequest: () => {},
		heartbeat: HEARTBEAT,
	});
	cleanups.push(() => connection.close(1000, "test over"));
	const [tunnel] = await accepted;
	let pings = 0;
	tunnel.on("message", (data, isBinary) => {
		if (!isBinary && data.toString() === PING) {
			pings += 1;
		}
	});
	return { connection, tunnel, pings: () => pings };
}

describe("heartbeat", () => {
	it("drops a connection on which nothing arrives after a ping", async () => {
		const { connection } = await silentTunnel();
		const closed = await Promise.race([
			connection.closed,
			new Promise((resolve) => setTimeout(() => resolve("still open"), 2000)),
		]);
		expect(closed).toEqual({ code: 1006, reason: "connection lost" });
	});

	it("keeps a connection whose pong is late while data keeps arriving", async () => {
		const { connection, tunnel, pings } = await silentTunnel();
		// The pong is stuck behind a slow upload: frames still arrive, the pong does not.
		const feeding = setInterval(() => tunnel.send(encodeFrame(FrameType.Window, 7, encodeWindow(1))), 50);
		cleanups.push(() => clearInterval(feeding));
		let closed = false;
		void connection.closed.then(() => {
			closed = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 1500));
		expect(pings()).toBeGreaterThan(4);
		expect(closed).toBe(false);
	});
});
