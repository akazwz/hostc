import { describe, expect, it } from "vitest";

import {
	GrowingWindow,
	MAX_CHUNK_BYTES,
	MAX_STREAM_WINDOW_BYTES,
	STREAM_WINDOW_BYTES,
	WINDOW_BUDGET_BYTES,
	WindowBudget,
} from "../src/index.ts";

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

/** When a piece sent at `t` arrives: the network delivers in 30 ms clumps. */
const clump = (t: number) => Math.ceil(t / 30) * 30;

/**
 * A window-limited stream over a 270 ms round trip, in 1 ms steps: the sender sends 48 KiB pieces
 * while it has credit (they do not divide the window), the network delivers them in 30 ms clumps,
 * and the next hop takes one piece every 2 ms, much faster than the stream moves. Returns the
 * window size after `seconds`.
 */
function pipeline(window: GrowingWindow, seconds: number): number {
	const rtt = 270;
	const piece = 48 * 1024;
	const grants: { at: number; bytes: number }[] = [];
	const arrivals: number[] = [];
	let credit = STREAM_WINDOW_BYTES;
	let queued = 0;
	for (let t = 0; t < seconds * 1000; t += 2) {
		while (grants.length > 0 && (grants[0] as { at: number }).at <= t) {
			credit += (grants.shift() as { bytes: number }).bytes;
		}
		for (; credit >= piece; credit -= piece) {
			arrivals.push(clump(t + rtt / 2));
		}
		while (arrivals.length > 0 && (arrivals[0] as number) <= t) {
			arrivals.shift();
			queued += 1;
		}
		if (queued > 0) {
			queued -= 1;
			const extra = window.delivered(piece, queued === 0, 1_000_000 + t);
			grants.push({ at: t + rtt / 2, bytes: piece + extra });
		}
	}
	return window.size;
}

describe("GrowingWindow over a real path", () => {
	it("widens a window whose end falls inside a clump of arrivals", () => {
		// The end of a window often comes with pieces still queued, although the next hop empties every
		// clump long before the next one. Judging only that moment kept this window at 2 MiB after 10 s.
		expect(pipeline(new GrowingWindow(new WindowBudget()), 4)).toBe(MAX_STREAM_WINDOW_BYTES);
	});

	it("never widens a window whose next hop never catches up", () => {
		const window = new GrowingWindow(new WindowBudget());
		let now = 1_000_000;
		for (let index = 0; index < 400; index += 1) {
			now += 5;
			window.delivered(MAX_CHUNK_BYTES, false, now);
		}
		expect(window.size).toBe(STREAM_WINDOW_BYTES);
	});
});
