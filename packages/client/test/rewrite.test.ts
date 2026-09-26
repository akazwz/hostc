import { describe, expect, it } from "vitest";

import { fromRawHeaders, toLocalRequestHeaders, toPublicResponseHeaders } from "../src/rewrite.ts";

const target = new URL("http://localhost:3000");
const publicOrigin = "https://abcdefghijkm.hostc.app";

describe("header rewriting", () => {
	it("makes requests look local", () => {
		expect(
			toLocalRequestHeaders(
				[
					["host", "abcdefghijkm.hostc.app"],
					["origin", publicOrigin],
					["referer", `${publicOrigin}/page?x=1`],
					["cookie", "a=1"],
				],
				publicOrigin,
				target,
			),
		).toEqual([
			["host", "localhost:3000"],
			["origin", "http://localhost:3000"],
			["referer", "http://localhost:3000/page?x=1"],
			["cookie", "a=1"],
		]);
	});

	it("leaves foreign origins alone", () => {
		const headers = toLocalRequestHeaders([["origin", "https://example.com"]], publicOrigin, target);
		expect(headers).toContainEqual(["origin", "https://example.com"]);
	});

	it("points local redirects at the public URL", () => {
		const rewrite = (location: string) =>
			toPublicResponseHeaders([["Location", location]], publicOrigin, target)[0]?.[1];
		expect(rewrite("http://localhost:3000/login?next=/")).toBe(`${publicOrigin}/login?next=/`);
		expect(rewrite("http://127.0.0.1:3000")).toBe(publicOrigin);
		expect(rewrite("/relative")).toBe("/relative");
		expect(rewrite("http://localhost:30001/other")).toBe("http://localhost:30001/other");
		expect(rewrite("https://example.com/")).toBe("https://example.com/");
	});

	it("reads Node raw headers", () => {
		expect(fromRawHeaders(["A", "1", "Set-Cookie", "x", "Set-Cookie", "y"])).toEqual([
			["A", "1"],
			["Set-Cookie", "x"],
			["Set-Cookie", "y"],
		]);
	});
});
