import http from "node:http";
import type { AddressInfo } from "node:net";

import {
	decodeWindow,
	FrameType,
	MAX_CHUNK_BYTES,
	STREAM_WINDOW_BYTES,
	WINDOW_BUDGET_BYTES,
	WindowBudget,
} from "@hostc/protocol";
import { describe, expect, it } from "vitest";

import { createStream } from "../src/streams.ts";

describe("request body window", () => {
	it("widens the window of an upload held back by the round trip, and returns it when the request ends", async () => {
		const total = 8 * 1024 * 1024;
		let received = 0;
		const server = http.createServer((request, response) => {
			request.on("data", (chunk: Buffer) => {
				received += chunk.byteLength;
			});
			request.on("end", () => response.writeHead(204).end());
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

		try {
			const budget = new WindowBudget();
			let credit = STREAM_WINDOW_BYTES;
			let largestGrant = 0;
			let wake: (() => void) | null = null;
			let status = 0;
			const done = new Promise<void>((resolve) => {
				const stream = createStream(
					{
						target: new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
						publicOrigin: "https://abcdefghijkm.hostc.test",
						send: (type, _id, payload) => {
							if (type !== FrameType.Window || !payload) {
								return;
							}
							const bytes = decodeWindow(payload);
							largestGrant = Math.max(largestGrant, bytes);
							// The grant reaches the server one 20 ms round trip later.
							setTimeout(() => {
								credit += bytes;
								wake?.();
							}, 20);
						},
						log: (entry) => {
							status = entry.status;
							resolve();
						},
						remove: () => {},
						windowBudget: budget,
					},
					1,
					{ method: "POST", path: "/upload", headers: [], body: true },
				);
				stream.start();

				void (async () => {
					const chunk = new Uint8Array(MAX_CHUNK_BYTES).fill(9);
					// Like the server: send while there is credit, otherwise wait for a grant.
					for (let sent = 0; sent < total; sent += chunk.byteLength) {
						while (credit < chunk.byteLength) {
							await new Promise<void>((granted) => {
								wake = granted;
							});
						}
						credit -= chunk.byteLength;
						stream.receive({ type: FrameType.Data, stream: 1, payload: chunk });
					}
					stream.receive({ type: FrameType.End, stream: 1, payload: new Uint8Array(0) });
				})();
			});

			await done;
			expect(status).toBe(204);
			expect(received).toBe(total);
			expect(largestGrant).toBeGreaterThan(MAX_CHUNK_BYTES);
			expect(budget.available).toBe(WINDOW_BUDGET_BYTES);
		} finally {
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	}, 30_000);
});
