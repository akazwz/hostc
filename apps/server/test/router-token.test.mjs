import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { redactLogFields } from "../dist/log.js";
import {
	classifyHost,
	isWebSocketUpgrade,
	parseApiRoute,
} from "../dist/router.js";
import {
	createTokenPayload,
	redactToken,
	signToken,
	verifyToken,
} from "../dist/token.js";

const secret = "server-test-secret-with-at-least-32-bytes";
const serverSourceFiles = collectSourceFiles(
	new URL("../src/", import.meta.url),
);

test("host classification follows app, tunnel, local, and unknown rules", () => {
	assert.deepEqual(classifyHost("hostc.dev", "hostc.dev"), { kind: "app" });
	assert.deepEqual(classifyHost("envoq.dev", "envoq.dev"), { kind: "app" });
	assert.deepEqual(classifyHost("abc.envoq.dev", "envoq.dev"), {
		kind: "tunnel",
		tunnelId: "abc",
	});
	assert.deepEqual(classifyHost("foo.bar.envoq.dev", "envoq.dev"), {
		kind: "unknown",
	});
	assert.deepEqual(classifyHost("localhost", "hostc.dev"), { kind: "app" });
	assert.deepEqual(classifyHost("api.hostc.dev", "hostc.dev"), {
		kind: "unknown",
	});
	assert.deepEqual(classifyHost("UPPER.envoq.dev", "envoq.dev"), {
		kind: "unknown",
	});
});

test("API path parser covers v4 create and dataChannel routes", () => {
	assert.deepEqual(
		parseApiRoute("POST", new URL("https://hostc.dev/api/tunnels/ephemeral")),
		{ kind: "create" },
	);
	assert.deepEqual(
		parseApiRoute("GET", new URL("https://hostc.dev/api/tunnels/ephemeral")),
		{ kind: "method-not-allowed", allow: "POST" },
	);
	assert.deepEqual(
		parseApiRoute("POST", new URL("https://hostc.dev/api/tunnels")),
		{ kind: "not-found" },
	);
	assert.deepEqual(
		parseApiRoute(
			"GET",
			new URL(
				"https://hostc.dev/api/tunnels/t-abc/channels/1?clientConnectionId=c-test",
			),
		),
		{
			kind: "channel",
			tunnelId: "t-abc",
			channelId: 1,
			clientConnectionId: "c-test",
		},
	);
	assert.deepEqual(
		parseApiRoute(
			"GET",
			new URL(
				"https://hostc.dev/api/tunnels/t-abc/channels/99?clientConnectionId=c-test",
			),
		),
		{ kind: "invalid", status: 400, message: "Invalid channel" },
	);
	assert.deepEqual(
		parseApiRoute(
			"GET",
			new URL(
				"https://hostc.dev/api/tunnels/t-abc/channels/0?clientConnectionId=bad/slash",
			),
		),
		{ kind: "invalid", status: 400, message: "Invalid client connection id" },
	);
	assert.deepEqual(parseApiRoute("GET", new URL("https://hostc.dev/health")), {
		kind: "health",
	});
});

test("WebSocket upgrade validation is strict and case-insensitive", () => {
	assert.equal(
		isWebSocketUpgrade(
			new Request("https://hostc.dev/api/tunnels/t/channels/0", {
				headers: { connection: "Upgrade", upgrade: "websocket" },
			}),
		),
		true,
	);
	assert.equal(
		isWebSocketUpgrade(
			new Request("https://hostc.dev/api/tunnels/t/channels/0", {
				headers: { connection: "keep-alive, Upgrade", upgrade: "WebSocket" },
			}),
		),
		true,
	);
	assert.equal(
		isWebSocketUpgrade(
			new Request("https://hostc.dev/api/tunnels/t/channels/0"),
		),
		false,
	);
});

test("token sign/verify enforces expiration, audience, tunnel, clientConnection and signature", async () => {
	const payload = createTokenPayload("connect", "t-abc", 60, "c1", 1000);
	const token = await signToken(secret, payload);
	assert.equal(
		(
			await verifyToken(secret, token, {
				audience: "connect",
				tunnelId: "t-abc",
				clientConnectionId: "c1",
				now: 1001,
			})
		)?.tunnelId,
		"t-abc",
	);
	assert.equal(
		await verifyToken(secret, token, {
			audience: "connect",
			tunnelId: "wrong",
			clientConnectionId: "c1",
			now: 1001,
		}),
		null,
	);
	assert.equal(
		await verifyToken(secret, token, {
			audience: "connect",
			tunnelId: "t-abc",
			clientConnectionId: "wrong",
			now: 1001,
		}),
		null,
	);
	assert.equal(
		await verifyToken(secret, token, {
			audience: "connect",
			tunnelId: "t-abc",
			clientConnectionId: "c1",
			now: 2000,
		}),
		null,
	);
	const [encodedPayload, encodedSignature] = token.split(".");
	const tamperedSignature = `${encodedSignature[0] === "A" ? "B" : "A"}${encodedSignature.slice(1)}`;
	assert.equal(
		await verifyToken(secret, `${encodedPayload}.${tamperedSignature}`, {
			audience: "connect",
			tunnelId: "t-abc",
			clientConnectionId: "c1",
			now: 1001,
		}),
		null,
	);
});

test("token and structured log redaction hide secrets", () => {
	assert.equal(
		redactToken("Authorization: Bearer abc.def"),
		"Authorization: Bearer [redacted-token]",
	);
	assert.deepEqual(
		redactLogFields({
			authorization: "Bearer abc.def",
			connectToken: "abc.def",
			nested: { TOKEN_SECRET: secret },
		}),
		{
			authorization: "[redacted]",
			connectToken: "[redacted]",
			nested: { TOKEN_SECRET: "[redacted]" },
		},
	);
});

test("server runtime boundary stays Worker-native, tunnel-only, and v4-only", () => {
	const forbiddenSourcePatterns = [
		[/from\s+["']node:/, "Node built-in imports"],
		[/\bBuffer\b/, "Node Buffer"],
		[/\bprocess\./, "process globals"],
		[/\brequire\s*\(/, "CommonJS require"],
		[/\bHono\b/, "Hono"],
		[/waitlist/i, "waitlist API"],
		[/cli-error/i, "cli-error API"],
		[
			/ControlMessage|decodeControlMessage|encodeControlMessage|controlUrl|buildTunnelControlPath/,
			"v3 control protocol",
		],
	];
	for (const [pattern, label] of forbiddenSourcePatterns) {
		const offender = serverSourceFiles.find(({ source }) =>
			pattern.test(source),
		);
		assert.equal(
			offender,
			undefined,
			`server source must not contain ${label}`,
		);
	}
	const config = readFileSync(
		new URL("../wrangler.jsonc", import.meta.url),
		"utf8",
	);
	for (const forbidden of [
		'"assets"',
		'"d1_databases"',
		"nodejs_compat",
		"waitlist",
		"cli-error",
	]) {
		assert.equal(
			config.includes(forbidden),
			false,
			`wrangler config must not contain ${forbidden}`,
		);
	}
});

test("Durable Object lifecycle uses active clientConnection, dataChannel tags, attachments and storage", () => {
	const tunnel = readFileSync(
		new URL("../src/durable/tunnel.ts", import.meta.url),
		"utf8",
	);
	assert.match(
		tunnel,
		/const STORAGE_CLIENT_CONNECTION_ID = "activeClientConnectionId"/,
	);
	assert.match(tunnel, /const STORAGE_DATA_CHANNELS = "expectedDataChannels"/);
	assert.match(tunnel, /this\.ctx\.acceptWebSocket\(server, \[/);
	assert.match(tunnel, /`conn:\$\{clientConnectionId\}`/);
	assert.match(tunnel, /`ch:\$\{channelId\}`/);
	assert.match(tunnel, /server\.serializeAttachment\(\{\s*kind: "data"/);
	assert.match(tunnel, /async alarm\(\)/);
	assert.match(tunnel, /EPHEMERAL_CONNECT_TIMEOUT_MS/);
	assert.match(tunnel, /this\.ctx\.storage\.setAlarm/);
	assert.match(tunnel, /this\.ctx\.storage\.deleteAlarm/);
	assert.match(tunnel, /"connect\.timeout"/);
	assert.match(tunnel, /private async replaceClientConnection/);
	assert.match(tunnel, /this\.closeClientConnectionSockets\(/);
	assert.match(tunnel, /CLOSE_CLIENT_CONNECTION_REPLACED/);
	assert.match(tunnel, /private async failClientConnection/);
	assert.match(tunnel, /this\.activeClientConnectionId = null/);
});

test("Durable Object sends v4 frames, enforces credit, and has no stream-id hash routing", () => {
	const tunnel = readFileSync(
		new URL("../src/durable/tunnel.ts", import.meta.url),
		"utf8",
	);
	const credit = readFileSync(
		new URL("../src/durable/credit.ts", import.meta.url),
		"utf8",
	);
	assert.match(tunnel, /decodeFrameView/);
	assert.match(tunnel, /encodeFrame/);
	assert.match(tunnel, /encodeMetadata/);
	assert.match(tunnel, /chooseNextDataChannel/);
	assert.doesNotMatch(
		tunnel,
		/selectDataChannel|streamId %|% this\.expectedDataChannels/,
	);
	assert.match(tunnel, /stream\.channelId !== attachment\.channelId/);
	assert.match(tunnel, /frame\.streamId < this\.nextStreamId/);
	assert.match(tunnel, /event: "stream\.stale_frame"/);
	assert.match(tunnel, /private async decodeMetadataOrFail/);
	assert.match(tunnel, /"Invalid frame metadata"/);
	assert.match(tunnel, /this\.credit\.waitForOutbound/);
	assert.match(tunnel, /this\.credit\.consumeInbound/);
	assert.match(tunnel, /this\.credit\.grantInbound/);
	assert.match(credit, /outboundChannelCredit/);
	assert.match(credit, /inboundChannelCredit/);
	assert.match(credit, /FRAME_TYPE_CHANNEL_CREDIT/);
});

test("wrangler config excludes static assets, D1 and nodejs_compat and includes staging routes", () => {
	const config = readFileSync(
		new URL("../wrangler.jsonc", import.meta.url),
		"utf8",
	);
	assert.equal(config.includes('"assets"'), false);
	assert.equal(config.includes('"d1_databases"'), false);
	assert.equal(config.includes("nodejs_compat"), false);
	assert.match(config, /"HOSTC_TUNNEL"/);
	assert.match(config, /"envoq\.dev\/\*"/);
	assert.match(config, /"\*\.envoq\.dev\/\*"/);
});

function collectSourceFiles(directoryUrl) {
	const entries = [];
	for (const dirent of readdirSync(directoryUrl, { withFileTypes: true })) {
		const url = new URL(dirent.name, directoryUrl);
		if (dirent.isDirectory()) {
			entries.push(
				...collectSourceFiles(new URL(`${dirent.name}/`, directoryUrl)),
			);
		} else if (dirent.isFile() && dirent.name.endsWith(".ts")) {
			entries.push({ path: url.pathname, source: readFileSync(url, "utf8") });
		}
	}
	return entries;
}
