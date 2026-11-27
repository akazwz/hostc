import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { API_TUNNELS_PATH, CLOSE_LIMIT_REACHED } from "@hostc/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";

import { Tunnel, TunnelError } from "../src/index.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) {
		cleanup();
	}
});

describe("Tunnel limit close handling", () => {
	it("stops without reconnecting or creating a new tunnel when closed with CLOSE_LIMIT_REACHED", async () => {
		let creates = 0;
		let connects = 0;
		const server = http.createServer((req, res) => {
			if (req.method === "POST" && req.url === API_TUNNELS_PATH) {
				creates += 1;
				const port = (server.address() as AddressInfo).port;
				res.writeHead(201, { "content-type": "application/json" });
				res.end(
					JSON.stringify({
						id: "abcdefghijkmnpqr",
						url: "https://abcdefghijkmnpqr.hostc.test",
						connectUrl: `ws://127.0.0.1:${port}/api/tunnels/abcdefghijkmnpqr/connect`,
						token: "token",
					}),
				);
				return;
			}
			res.writeHead(404);
			res.end();
		});
		const wss = new WebSocketServer({ noServer: true });
		server.on("upgrade", (req, socket, head) => {
			connects += 1;
			wss.handleUpgrade(req, socket, head, (ws) => {
				setTimeout(() => ws.close(CLOSE_LIMIT_REACHED, "Tunnel WebSocket message limit reached."), 25);
			});
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		cleanups.push(() => {
			for (const client of wss.clients) {
				client.terminate();
			}
			wss.close();
			server.close();
		});

		const port = (server.address() as AddressInfo).port;
		const tunnel = await Tunnel.open({
			server: `http://127.0.0.1:${port}`,
			target: "http://127.0.0.1:9",
		});

		const failed = new Promise<TunnelError>((resolve) => tunnel.once("failed", resolve));
		const closed = new Promise<void>((resolve) => tunnel.once("closed", resolve));
		let reconnecting = 0;
		tunnel.on("reconnecting", () => {
			reconnecting += 1;
		});

		const error = await failed;
		await closed;
		expect(error).toBeInstanceOf(TunnelError);
		expect(error.code).toBe("limit_reached");
		expect(error.message).toBe("Tunnel WebSocket message limit reached.");

		// Wait long enough to be certain no backoff reconnect or replacement tunnel creation fires.
		await new Promise((resolve) => setTimeout(resolve, 400));
		expect(reconnecting).toBe(0);
		expect(creates).toBe(1);
		expect(connects).toBe(1);
	});
});
