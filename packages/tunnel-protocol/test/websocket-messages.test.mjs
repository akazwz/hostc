import assert from "node:assert/strict";
import test from "node:test";

import {
	parseTunnelClientMessage,
	parseTunnelServerMessage,
} from "../dist/index.js";

test("parses websocket tunnel server messages", () => {
	assert.deepStrictEqual(
		parseTunnelServerMessage(
			JSON.stringify({
				type: "tunnel-ready",
				subdomain: "test",
				publicUrl: "https://test.example.com",
			}),
		),
		{
			type: "tunnel-ready",
			subdomain: "test",
			publicUrl: "https://test.example.com",
		},
	);

	assert.deepStrictEqual(
		parseTunnelServerMessage(
			JSON.stringify({
				type: "tunnel-ready",
				subdomain: "test",
				publicUrl: "https://test.example.com",
				capabilities: ["binary-payload"],
			}),
		),
		{
			type: "tunnel-ready",
			subdomain: "test",
			publicUrl: "https://test.example.com",
			capabilities: ["binary-payload"],
		},
	);

	assert.deepStrictEqual(
		parseTunnelServerMessage(
			JSON.stringify({
				type: "websocket-connect",
				requestId: "req-1",
				url: "/socket?room=demo",
				headers: [["authorization", "Bearer demo"]],
				protocols: ["chat", "json"],
			}),
		),
		{
			type: "websocket-connect",
			requestId: "req-1",
			url: "/socket?room=demo",
			headers: [["authorization", "Bearer demo"]],
			protocols: ["chat", "json"],
		},
	);

	assert.deepStrictEqual(
		parseTunnelServerMessage(
			JSON.stringify({
				type: "websocket-frame",
				requestId: "req-1",
				chunk: "aGVsbG8=",
				isBinary: false,
			}),
		),
		{
			type: "websocket-frame",
			requestId: "req-1",
			chunk: "aGVsbG8=",
			isBinary: false,
		},
	);

	assert.deepStrictEqual(
		parseTunnelServerMessage(
			JSON.stringify({
				type: "binary-payload",
				requestId: "req-1",
				stream: "request-body",
			}),
		),
		{
			type: "binary-payload",
			requestId: "req-1",
			stream: "request-body",
		},
	);

	assert.deepStrictEqual(
		parseTunnelServerMessage(
			JSON.stringify({
				type: "response-body-credit",
				requestId: "req-1",
				credit: 32768,
			}),
		),
		{
			type: "response-body-credit",
			requestId: "req-1",
			credit: 32768,
		},
	);

	assert.deepStrictEqual(
		parseTunnelServerMessage(
			JSON.stringify({
				type: "websocket-close",
				requestId: "req-1",
				code: 1000,
				reason: "done",
			}),
		),
		{
			type: "websocket-close",
			requestId: "req-1",
			code: 1000,
			reason: "done",
		},
	);
});

test("parses websocket tunnel client messages", () => {
	assert.deepStrictEqual(
		parseTunnelClientMessage(
			JSON.stringify({
				type: "websocket-accept",
				requestId: "req-2",
				protocol: "chat",
			}),
		),
		{
			type: "websocket-accept",
			requestId: "req-2",
			protocol: "chat",
		},
	);

	assert.deepStrictEqual(
		parseTunnelClientMessage(
			JSON.stringify({
				type: "websocket-reject",
				requestId: "req-2",
				message: "upgrade failed",
			}),
		),
		{
			type: "websocket-reject",
			requestId: "req-2",
			message: "upgrade failed",
		},
	);

	assert.deepStrictEqual(
		parseTunnelClientMessage(
			JSON.stringify({
				type: "binary-payload",
				requestId: "req-2",
				stream: "response-body",
			}),
		),
		{
			type: "binary-payload",
			requestId: "req-2",
			stream: "response-body",
		},
	);

	assert.deepStrictEqual(
		parseTunnelClientMessage(
			JSON.stringify({
				type: "client-capabilities",
				capabilities: ["binary-payload"],
			}),
		),
		{
			type: "client-capabilities",
			capabilities: ["binary-payload"],
		},
	);

	assert.deepStrictEqual(
		parseTunnelClientMessage(
			JSON.stringify({
				type: "websocket-frame",
				requestId: "req-2",
				chunk: "AQIDBA==",
				isBinary: true,
			}),
		),
		{
			type: "websocket-frame",
			requestId: "req-2",
			chunk: "AQIDBA==",
			isBinary: true,
		},
	);

	assert.deepStrictEqual(
		parseTunnelClientMessage(
			JSON.stringify({
				type: "websocket-close",
				requestId: "req-2",
				reason: "bye",
			}),
		),
		{
			type: "websocket-close",
			requestId: "req-2",
			reason: "bye",
		},
	);
});

test("rejects malformed websocket messages", () => {
	assert.equal(
		parseTunnelServerMessage(
			JSON.stringify({
				type: "websocket-connect",
				requestId: "req-3",
				url: "/socket",
				headers: [["x-test", "1"]],
				protocols: [123],
			}),
		),
		null,
	);

	assert.equal(
		parseTunnelClientMessage(
			JSON.stringify({
				type: "websocket-frame",
				requestId: "req-3",
				chunk: "AQIDBA==",
				isBinary: "nope",
			}),
		),
		null,
	);

	assert.equal(
		parseTunnelClientMessage(
			JSON.stringify({
				type: "binary-payload",
				requestId: "req-3",
				stream: "something-else",
			}),
		),
		null,
	);

	assert.equal(
		parseTunnelClientMessage(
			JSON.stringify({
				type: "client-capabilities",
				capabilities: "binary-payload",
			}),
		),
		null,
	);

	assert.equal(
		parseTunnelServerMessage(
			JSON.stringify({
				type: "response-body-credit",
				requestId: "req-3",
				credit: 0,
			}),
		),
		null,
	);

	assert.equal(
		parseTunnelServerMessage(
			JSON.stringify({
				type: "tunnel-ready",
				subdomain: "test",
				publicUrl: "https://test.example.com",
				capabilities: "binary-payload",
			}),
		),
		null,
	);

	assert.equal(
		parseTunnelClientMessage(
			JSON.stringify({
				type: "websocket-close",
				requestId: "req-3",
				code: "1000",
				reason: "bye",
			}),
		),
		null,
	);
});
