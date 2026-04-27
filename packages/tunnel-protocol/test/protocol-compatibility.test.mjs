import assert from "node:assert/strict";
import test from "node:test";

import {
	parseTunnelClientMessage,
	parseTunnelServerMessage,
} from "../dist/index.js";

const PROTOCOL_VERSION = 2;
const BINARY_PAYLOAD_CAPABILITY = "binary-payload";
const RESPONSE_BODY_CREDIT_CAPABILITY = "response-body-credit";
const SUPPORTED_CAPABILITIES = [
	BINARY_PAYLOAD_CAPABILITY,
	RESPONSE_BODY_CREDIT_CAPABILITY,
];

test("simulates v2 CLI and v2 Worker protocol negotiation", () => {
	const worker = new V2WorkerSimulator();
	const cli = new V2CliSimulator();

	const clientReady = cli.receive(worker.readyMessage());

	assert.deepStrictEqual(clientReady, {
		type: "client-ready",
		protocolVersion: PROTOCOL_VERSION,
		capabilities: SUPPORTED_CAPABILITIES,
	});

	const accepted = worker.receive(clientReady);

	assert.deepStrictEqual(accepted, {
		type: "tunnel-accepted",
		subdomain: "test",
		publicUrl: "https://test.example.com",
		protocolVersion: PROTOCOL_VERSION,
		capabilities: SUPPORTED_CAPABILITIES,
	});
	assert.equal(cli.receive(accepted), null);
	assert.equal(cli.ready, true);

	assert.deepStrictEqual(cli.receive(worker.startHttpRequest()), {
		binaryPayload: true,
		responseBodyCredit: true,
	});
	assert.deepStrictEqual(cli.receive(worker.startWebSocket()), {
		binaryPayload: true,
	});
});

test("simulates a legacy CLI connecting to a v2 Worker", () => {
	const worker = new V2WorkerSimulator();
	const legacyCli = new LegacyCliSimulator();

	const clientCapabilities = legacyCli.receive(worker.readyMessage());

	assert.equal(legacyCli.ready, true);
	assert.deepStrictEqual(clientCapabilities, {
		type: "client-capabilities",
		capabilities: SUPPORTED_CAPABILITIES,
	});
	assert.equal(worker.receive(clientCapabilities), null);
	assert.deepStrictEqual([...worker.capabilities], SUPPORTED_CAPABILITIES);

	assert.equal(
		legacyCli.canReceiveLegacyRequest(worker.startHttpRequest()),
		true,
	);
	assert.equal(
		legacyCli.canReceiveLegacyWebSocket(worker.startWebSocket()),
		true,
	);
});

test("simulates a v2 CLI connecting to a legacy server", () => {
	const legacyServer = new LegacyServerSimulator();
	const cli = new V2CliSimulator();

	const clientCapabilities = cli.receive(legacyServer.readyMessage());

	assert.equal(cli.ready, true);
	assert.deepStrictEqual(clientCapabilities, {
		type: "client-capabilities",
		capabilities: SUPPORTED_CAPABILITIES,
	});
	assert.equal(legacyServer.receive(clientCapabilities), null);

	assert.deepStrictEqual(cli.receive(legacyServer.startHttpRequest()), {
		binaryPayload: true,
		responseBodyCredit: true,
	});
	assert.deepStrictEqual(cli.receive(legacyServer.startWebSocket()), {
		binaryPayload: true,
	});
});

class V2WorkerSimulator {
	constructor() {
		this.ready = true;
		this.capabilities = new Set();
	}

	readyMessage() {
		return parseServerMessage({
			type: "tunnel-ready",
			subdomain: "test",
			publicUrl: "https://test.example.com",
			protocolVersion: PROTOCOL_VERSION,
			capabilities: SUPPORTED_CAPABILITIES,
		});
	}

	receive(message) {
		const parsed = parseClientMessage(message);

		if (parsed.type === "client-ready") {
			assert.equal(parsed.protocolVersion, PROTOCOL_VERSION);
			this.capabilities = new Set(negotiateCapabilities(parsed.capabilities));
			this.ready = true;

			return parseServerMessage({
				type: "tunnel-accepted",
				subdomain: "test",
				publicUrl: "https://test.example.com",
				protocolVersion: PROTOCOL_VERSION,
				capabilities: [...this.capabilities],
			});
		}

		if (parsed.type === "client-capabilities") {
			this.capabilities = new Set(negotiateCapabilities(parsed.capabilities));
			this.ready = true;
			return null;
		}

		throw new Error(`Unexpected client message: ${parsed.type}`);
	}

	startHttpRequest() {
		assert.equal(this.ready, true);

		return parseServerMessage({
			type: "request-start",
			requestId: "req-http",
			method: "GET",
			url: "/",
			headers: [],
			hasBody: false,
			binaryPayload: this.capabilities.has(BINARY_PAYLOAD_CAPABILITY),
			responseBodyCredit: this.capabilities.has(
				RESPONSE_BODY_CREDIT_CAPABILITY,
			),
		});
	}

	startWebSocket() {
		assert.equal(this.ready, true);

		return parseServerMessage({
			type: "websocket-connect",
			requestId: "req-ws",
			url: "/socket",
			headers: [],
			protocols: [],
			binaryPayload: this.capabilities.has(BINARY_PAYLOAD_CAPABILITY),
		});
	}
}

class LegacyServerSimulator {
	constructor() {
		this.capabilities = new Set();
	}

	readyMessage() {
		return parseServerMessage({
			type: "tunnel-ready",
			subdomain: "test",
			publicUrl: "https://test.example.com",
			capabilities: SUPPORTED_CAPABILITIES,
		});
	}

	receive(message) {
		const parsed = parseClientMessage(message);

		assert.equal(parsed.type, "client-capabilities");
		this.capabilities = new Set(negotiateCapabilities(parsed.capabilities));
		return null;
	}

	startHttpRequest() {
		return parseServerMessage({
			type: "request-start",
			requestId: "req-http",
			method: "GET",
			url: "/",
			headers: [],
			hasBody: false,
		});
	}

	startWebSocket() {
		return parseServerMessage({
			type: "websocket-connect",
			requestId: "req-ws",
			url: "/socket",
			headers: [],
			protocols: [],
		});
	}
}

class V2CliSimulator {
	constructor() {
		this.ready = false;
		this.legacyCapabilities = new Set();
	}

	receive(message) {
		const parsed = parseServerMessage(message);

		if (parsed.type === "tunnel-ready") {
			const capabilities = negotiateCapabilities(parsed.capabilities ?? []);

			if (parsed.protocolVersion === undefined) {
				this.ready = true;
				this.legacyCapabilities = new Set(capabilities);

				return parseClientMessage({
					type: "client-capabilities",
					capabilities,
				});
			}

			assert.equal(parsed.protocolVersion, PROTOCOL_VERSION);

			return parseClientMessage({
				type: "client-ready",
				protocolVersion: PROTOCOL_VERSION,
				capabilities,
			});
		}

		if (parsed.type === "tunnel-accepted") {
			assert.equal(parsed.protocolVersion, PROTOCOL_VERSION);
			this.ready = true;
			this.legacyCapabilities = new Set(parsed.capabilities);
			return null;
		}

		if (parsed.type === "request-start") {
			return {
				binaryPayload:
					parsed.binaryPayload ??
					this.legacyCapabilities.has(BINARY_PAYLOAD_CAPABILITY),
				responseBodyCredit:
					parsed.responseBodyCredit ??
					this.legacyCapabilities.has(RESPONSE_BODY_CREDIT_CAPABILITY),
			};
		}

		if (parsed.type === "websocket-connect") {
			return {
				binaryPayload:
					parsed.binaryPayload ??
					this.legacyCapabilities.has(BINARY_PAYLOAD_CAPABILITY),
			};
		}

		throw new Error(`Unexpected server message: ${parsed.type}`);
	}
}

class LegacyCliSimulator {
	constructor() {
		this.ready = false;
	}

	receive(message) {
		const parsed = parseServerMessage(message);

		assert.equal(parsed.type, "tunnel-ready");
		this.ready = true;

		return parseClientMessage({
			type: "client-capabilities",
			capabilities: negotiateCapabilities(parsed.capabilities ?? []),
		});
	}

	canReceiveLegacyRequest(message) {
		const parsed = parseServerMessage(message);
		return (
			parsed.type === "request-start" &&
			typeof parsed.requestId === "string" &&
			typeof parsed.hasBody === "boolean"
		);
	}

	canReceiveLegacyWebSocket(message) {
		const parsed = parseServerMessage(message);
		return (
			parsed.type === "websocket-connect" && Array.isArray(parsed.protocols)
		);
	}
}

function negotiateCapabilities(capabilities) {
	return SUPPORTED_CAPABILITIES.filter((capability) =>
		capabilities.includes(capability),
	);
}

function parseServerMessage(message) {
	const parsed = parseTunnelServerMessage(JSON.stringify(message));

	assert.notEqual(parsed, null);
	return parsed;
}

function parseClientMessage(message) {
	const parsed = parseTunnelClientMessage(JSON.stringify(message));

	assert.notEqual(parsed, null);
	return parsed;
}
