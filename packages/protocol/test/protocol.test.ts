import { describe, expect, it } from "vitest";

import {
	decodeClose,
	decodeFrame,
	decodeHead,
	decodeOpen,
	decodeText,
	decodeWindow,
	encodeClose,
	encodeFrame,
	encodeHead,
	encodeOpen,
	encodeText,
	encodeWindow,
	FrameType,
	isTunnelId,
	parseSubprotocols,
	responseHasBody,
	ProtocolError,
	sendableCloseCode,
	sendableCloseReason,
	stripHopByHop,
	stripWebSocketHandshake,
} from "../src/index.ts";

describe("frames", () => {
	it("round-trips type, stream id and payload", () => {
		const payload = encodeText("hello");
		const frame = decodeFrame(encodeFrame(FrameType.Data, 0xffff_fffe, payload));
		expect(frame.type).toBe(FrameType.Data);
		expect(frame.stream).toBe(0xffff_fffe);
		expect(decodeText(frame.payload)).toBe("hello");
	});

	it("decodes frames that sit at an offset inside a larger buffer", () => {
		const encoded = encodeFrame(FrameType.End, 7);
		const padded = new Uint8Array(encoded.byteLength + 3);
		padded.set(encoded, 3);
		const frame = decodeFrame(padded.subarray(3));
		expect(frame.stream).toBe(7);
		expect(frame.payload.byteLength).toBe(0);
	});

	it("rejects malformed frames", () => {
		expect(() => decodeFrame(new Uint8Array(4))).toThrow(ProtocolError);
		expect(() => decodeFrame(new Uint8Array([99, 0, 0, 0, 1]))).toThrow(ProtocolError);
		expect(() => decodeFrame(new Uint8Array([FrameType.Data, 0, 0, 0, 0]))).toThrow(ProtocolError);
		expect(() => encodeFrame(FrameType.Data, 0)).toThrow(ProtocolError);
	});
});

describe("messages", () => {
	it("round-trips OPEN", () => {
		const open = {
			method: "GET",
			path: "/socket?x=1",
			headers: [["cookie", "a=1"]] as [string, string][],
			body: false,
			websocket: ["chat"],
		};
		expect(decodeOpen(encodeOpen(open))).toEqual(open);
	});

	it("rejects OPEN with a non origin-form path", () => {
		const bytes = encodeText(JSON.stringify({ method: "GET", path: "http://x", headers: [], body: false }));
		expect(() => decodeOpen(bytes)).toThrow(ProtocolError);
	});

	it("round-trips HEAD and validates status", () => {
		const head = { status: 101, headers: [], body: false, protocol: "chat" };
		expect(decodeHead(encodeHead(head))).toEqual(head);
		expect(() => decodeHead(encodeHead({ ...head, status: 42 }))).toThrow(ProtocolError);
		expect(() => decodeHead(encodeText("[]"))).toThrow(ProtocolError);
	});

	it("round-trips close and window payloads", () => {
		expect(decodeClose(encodeClose({ code: 4321, reason: "bye" }))).toEqual({ code: 4321, reason: "bye" });
		expect(decodeClose(new Uint8Array(0))).toEqual({ code: 1005, reason: "" });
		expect(decodeWindow(encodeWindow(65_536))).toBe(65_536);
		expect(() => decodeWindow(encodeWindow(0))).toThrow(ProtocolError);
		expect(() => decodeWindow(new Uint8Array(3))).toThrow(ProtocolError);
	});

	it("rejects invalid UTF-8", () => {
		expect(() => decodeText(new Uint8Array([0xff]))).toThrow(ProtocolError);
	});
});

describe("helpers", () => {
	it("normalizes close codes and reasons", () => {
		expect(sendableCloseCode(1006)).toBe(1000);
		expect(sendableCloseCode(1005)).toBe(1000);
		expect(sendableCloseCode(1011)).toBe(1011);
		expect(sendableCloseCode(4000)).toBe(4000);
		expect(sendableCloseCode(5000)).toBe(1000);
		expect(new TextEncoder().encode(sendableCloseReason("é".repeat(100))).byteLength).toBeLessThanOrEqual(123);
	});

	it("strips hop-by-hop headers including ones named by Connection", () => {
		const headers: [string, string][] = [
			["Connection", "keep-alive, X-Secret"],
			["Keep-Alive", "timeout=5"],
			["x-secret", "1"],
			["Transfer-Encoding", "chunked"],
			["content-type", "text/plain"],
		];
		expect(stripHopByHop(headers)).toEqual([["content-type", "text/plain"]]);
		expect(stripHopByHop([["host", "a"]], ["host"])).toEqual([]);
		expect(
			stripWebSocketHandshake([
				["Sec-WebSocket-Key", "k"],
				["origin", "o"],
			]),
		).toEqual([["origin", "o"]]);
	});

	it("rejects close codes the ws library refuses", () => {
		expect(sendableCloseCode(1004)).toBe(1000);
		expect(sendableCloseCode(1015)).toBe(1000);
	});

	it("parses subprotocol headers strictly", () => {
		expect(parseSubprotocols(null)).toEqual([]);
		expect(parseSubprotocols("chat, v2.json")).toEqual(["chat", "v2.json"]);
		expect(parseSubprotocols("a, a")).toBeNull();
		expect(parseSubprotocols("a b")).toBeNull();
		expect(parseSubprotocols("a,,b")).toBeNull();
	});

	it("knows which responses have bodies", () => {
		expect(responseHasBody("GET", 200)).toBe(true);
		expect(responseHasBody("HEAD", 200)).toBe(false);
		expect(responseHasBody("GET", 205)).toBe(false);
		expect(responseHasBody("GET", 304)).toBe(false);
	});

	it("validates tunnel ids", () => {
		expect(isTunnelId("abcdefghijk2")).toBe(true);
		expect(isTunnelId("abcdefghijk1")).toBe(false);
		expect(isTunnelId("abc")).toBe(false);
	});
});
