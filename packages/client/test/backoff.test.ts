import { describe, expect, it } from "vitest";

import { ReconnectBackoff } from "../src/tunnel.ts";

describe("ReconnectBackoff", () => {
	it("doubles the delay up to 10 s", () => {
		const backoff = new ReconnectBackoff();
		const bases = Array.from({ length: 8 }, () => backoff.next().delayMs);
		const expected = [250, 500, 1000, 2000, 4000, 8000, 10_000, 10_000];
		bases.forEach((delay, index) => {
			expect(delay).toBeGreaterThanOrEqual(expected[index]! * 0.8);
			expect(delay).toBeLessThanOrEqual(expected[index]! * 1.2);
		});
	});

	it("keeps backing off when connections drop right after they open", () => {
		const backoff = new ReconnectBackoff();
		backoff.connected(0);
		backoff.disconnected(1_000);
		expect(backoff.next().attempt).toBe(1);
		backoff.connected(2_000);
		backoff.disconnected(2_500);
		expect(backoff.next().attempt).toBe(2);
		backoff.connected(3_000);
		backoff.disconnected(3_100);
		expect(backoff.next().attempt).toBe(3);
	});

	it("starts over after a stable connection", () => {
		const backoff = new ReconnectBackoff();
		backoff.next();
		backoff.next();
		backoff.connected(0);
		backoff.disconnected(30_000);
		expect(backoff.next().attempt).toBe(1);
	});
});
