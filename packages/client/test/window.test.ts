import http from "node:http";
import type { AddressInfo } from "node:net";

import { decodeWindow, FrameType, MAX_CHUNK_BYTES, STREAM_WINDOW_BYTES } from "@hostc/protocol";
import { describe, expect, it } from "vitest";

import { createStream } from "../src/streams.ts";
import { GrowingWindow, MAX_STREAM_WINDOW_BYTES, WINDOW_BUDGET_BYTES, WindowBudget } from "../src/window.ts";

/** Feeds full windows to `window`, each taking `elapsedMs(size)`, and returns the window sizes seen. */
function run(window: GrowingWindow, windows: number, elapsedMs: (size: number) => number, idle = true): number[] {
	let now = 1_000_000;
	const sizes: number[] = [];
	for (let index = 0; index < windows; index += 1) {
		now += elapsedMs(window.size);
		const size = window.size;
		const extra = window.delivered(size, idle, now);
		sizes.push(size + extra);
	}
	return sizes;
}

describe("GrowingWindow", () => {
	it("doubles a window that holds the stream back, up to the per-stream limit", () => {
		const window = new GrowingWindow(new WindowBudget());
		// Window limited: every window takes one 20 ms round trip, whatever its size.
		const sizes = run(window, 10, () => 20);
		// The first window is not timed; it arrived before any grant.
		expect(sizes[0]).toBe(STREAM_WINDOW_BYTES);
		expect(sizes[1]).toBe(2 * STREAM_WINDOW_BYTES);
		expect(sizes[2]).toBe(4 * STREAM_WINDOW_BYTES);
		expect(window.size).toBe(MAX_STREAM_WINDOW_BYTES);
	});

	it("stops once the link, not the window, is the limit", () => {
		const window = new GrowingWindow(new WindowBudget());
		// A link that carries 256 KiB per 80 ms: a doubled window takes twice as long.
		run(window, 20, (size) => (size / STREAM_WINDOW_BYTES) * 80);
		expect(window.size).toBeLessThanOrEqual(2 * STREAM_WINDOW_BYTES);
	});

	it("never grows a slow stream or one whose local server is behind", () => {
		const slow = new GrowingWindow(new WindowBudget());
		run(slow, 10, () => 1500);
		expect(slow.size).toBe(STREAM_WINDOW_BYTES);

		const behind = new GrowingWindow(new WindowBudget());
		run(behind, 10, () => 20, false);
		expect(behind.size).toBe(STREAM_WINDOW_BYTES);
	});

	it("shares the budget between streams and gets it back when they end", () => {
		const budget = new WindowBudget();
		const windows = Array.from({ length: 6 }, () => new GrowingWindow(budget));
		for (const window of windows) {
			run(window, 10, () => 20);
		}
		const extra = windows.reduce((sum, window) => sum + window.size - STREAM_WINDOW_BYTES, 0);
		expect(extra).toBe(WINDOW_BUDGET_BYTES);
		expect(budget.available).toBe(0);

		for (const window of windows) {
			window.release();
			window.release();
		}
		expect(budget.available).toBe(WINDOW_BUDGET_BYTES);
	});
});

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
