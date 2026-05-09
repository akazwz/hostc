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

test("host classification follows app, staging tunnel, local, and unknown rules", () => {
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
	assert.deepEqual(classifyHost("dev.localhost", "hostc.dev"), { kind: "app" });
	assert.deepEqual(classifyHost("example.com", "hostc.dev"), {
		kind: "unknown",
	});
	assert.deepEqual(classifyHost("api.hostc.dev", "hostc.dev"), {
		kind: "unknown",
	});
	assert.deepEqual(classifyHost("UPPER.envoq.dev", "envoq.dev"), {
		kind: "unknown",
	});
	assert.deepEqual(classifyHost("t-valid.envoq.dev:443", "envoq.dev"), {
		kind: "tunnel",
		tunnelId: "t-valid",
	});
});

test("API path parser covers create, refresh, control, data and method errors", () => {
	assert.deepEqual(
		parseApiRoute("POST", new URL("https://hostc.dev/api/tunnels")),
		{
			kind: "create",
		},
	);
	assert.deepEqual(
		parseApiRoute("GET", new URL("https://hostc.dev/api/tunnels")),
		{ kind: "method-not-allowed", allow: "POST" },
	);
	assert.deepEqual(
		parseApiRoute(
			"POST",
			new URL("https://hostc.dev/api/tunnels/t-abc/refresh"),
		),
		{ kind: "refresh", tunnelId: "t-abc" },
	);
	assert.deepEqual(
		parseApiRoute(
			"GET",
			new URL(
				"https://hostc.dev/api/tunnels/t-abc/control?connectionId=c1&dataChannels=2",
			),
		),
		{
			kind: "control",
			tunnelId: "t-abc",
			connectionId: "c1",
			dataChannels: 2,
		},
	);
	assert.deepEqual(
		parseApiRoute(
			"GET",
			new URL(
				"https://hostc.dev/api/tunnels/t-abc/data?channel=1&connectionId=c1",
			),
		),
		{
			kind: "data",
			tunnelId: "t-abc",
			channelId: 1,
			connectionId: "c1",
		},
	);
	assert.equal(
		parseApiRoute(
			"GET",
			new URL("https://hostc.dev/api/tunnels/t-abc/data?channel=99"),
		).kind,
		"invalid",
	);
	assert.equal(
		parseApiRoute(
			"POST",
			new URL("https://hostc.dev/api/tunnels/foo.bar/refresh"),
		).kind,
		"invalid",
	);
	assert.deepEqual(parseApiRoute("GET", new URL("https://hostc.dev/health")), {
		kind: "health",
	});
	assert.deepEqual(parseApiRoute("POST", new URL("https://hostc.dev/health")), {
		kind: "method-not-allowed",
		allow: "GET",
	});
	assert.deepEqual(
		parseApiRoute(
			"GET",
			new URL("https://hostc.dev/api/tunnels/t-abc/data?channel=missing"),
		),
		{ kind: "invalid", status: 400, message: "Invalid channel" },
	);
	assert.deepEqual(
		parseApiRoute(
			"GET",
			new URL("https://hostc.dev/api/tunnels/t-abc/control?dataChannels=99"),
		),
		{
			kind: "control",
			tunnelId: "t-abc",
			connectionId: null,
			dataChannels: null,
		},
	);
});

test("WebSocket upgrade validation is strict and case-insensitive", () => {
	assert.equal(
		isWebSocketUpgrade(
			new Request("https://hostc.dev/api/tunnels/t/control", {
				headers: { connection: "Upgrade", upgrade: "websocket" },
			}),
		),
		true,
	);
	assert.equal(
		isWebSocketUpgrade(
			new Request("https://hostc.dev/api/tunnels/t/control", {
				headers: { connection: "keep-alive, Upgrade", upgrade: "WebSocket" },
			}),
		),
		true,
	);
	assert.equal(
		isWebSocketUpgrade(new Request("https://hostc.dev/api/tunnels/t/control")),
		false,
	);
	assert.equal(
		isWebSocketUpgrade(
			new Request("https://hostc.dev/api/tunnels/t/control", {
				headers: { upgrade: "websocket" },
			}),
		),
		false,
	);
});

test("token sign/verify enforces expiration, audience, tunnel, connection and signature", async () => {
	const payload = createTokenPayload("connect", "t-abc", 60, "c1", 1000);
	const token = await signToken(secret, payload);
	assert.equal(
		(
			await verifyToken(secret, token, {
				audience: "connect",
				tunnelId: "t-abc",
				connectionId: "c1",
				now: 1001,
			})
		)?.tunnelId,
		"t-abc",
	);
	assert.equal(
		await verifyToken(secret, token, {
			audience: "refresh",
			tunnelId: "t-abc",
			now: 1001,
		}),
		null,
	);
	assert.equal(
		await verifyToken(secret, token, {
			audience: "connect",
			tunnelId: "wrong",
			connectionId: "c1",
			now: 1001,
		}),
		null,
	);
	assert.equal(
		await verifyToken(secret, token, {
			audience: "connect",
			tunnelId: "t-abc",
			connectionId: "wrong",
			now: 1001,
		}),
		null,
	);
	assert.equal(
		await verifyToken(secret, token, {
			audience: "connect",
			tunnelId: "t-abc",
			connectionId: "c1",
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
			connectionId: "c1",
			now: 1001,
		}),
		null,
	);
});

test("token redaction hides signed token-like values", () => {
	assert.equal(
		redactToken("Authorization: Bearer abc.def"),
		"Authorization: Bearer [redacted-token]",
	);
});

test("structured JSON log redaction hides Authorization, token and secret fields", () => {
	assert.deepEqual(
		redactLogFields({
			event: "protocol.error",
			authorization: "Bearer abc.def",
			connectToken: "abc.def",
			message: "refresh failed with Bearer raw-token-value",
			nested: {
				TOKEN_SECRET: "server-test-secret-with-at-least-32-bytes",
				reason: "bad token signedpayload.signedsignature",
			},
		}),
		{
			event: "protocol.error",
			authorization: "[redacted]",
			connectToken: "[redacted]",
			message: "refresh failed with Bearer [redacted-token]",
			nested: {
				TOKEN_SECRET: "[redacted]",
				reason: "bad token [redacted-token]",
			},
		},
	);
});

test("server runtime boundary stays Worker-native and tunnel-only", () => {
	const forbiddenSourcePatterns = [
		[/from\s+["']node:/, "Node built-in imports"],
		[/\bBuffer\b/, "Node Buffer"],
		[/\bprocess\./, "process globals"],
		[/\brequire\s*\(/, "CommonJS require"],
		[/\bHono\b/, "Hono"],
		[/waitlist/i, "waitlist API"],
		[/cli-error/i, "cli-error API"],
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

test("Durable Object aborts blocked outbound credit waits after stream cleanup", () => {
	const tunnel = readFileSync(
		new URL("../src/durable/tunnel.ts", import.meta.url),
		"utf8",
	);
	const credit = readFileSync(
		new URL("../src/durable/credit.ts", import.meta.url),
		"utf8",
	);
	assert.match(tunnel, /private canSendForStream/);
	assert.match(tunnel, /this\.credit\.waitForOutbound/);
	assert.match(tunnel, /Boolean\(this\.streams\.has\(stream\.id\)/);
	assert.match(tunnel, /this\.getControlSocket\(\)/);
	assert.match(credit, /canWait: \(\) => boolean/);
	assert.match(credit, /if \(!canWait\(\)\)/);
	assert.match(credit, /throw new Error\("Stream unavailable"\)/);
});

test("Durable Object lifecycle is backed by tags, attachments and storage state", () => {
	const tunnel = readFileSync(
		new URL("../src/durable/tunnel.ts", import.meta.url),
		"utf8",
	);
	assert.match(tunnel, /const STORAGE_CONNECTION_ID = "currentConnectionId"/);
	assert.match(tunnel, /const STORAGE_DATA_CHANNELS = "expectedDataChannels"/);
	assert.match(
		tunnel,
		/this\.ctx\.acceptWebSocket\(server, \["control", `conn:\$\{connectionId\}`\]\)/,
	);
	assert.match(tunnel, /server\.serializeAttachment\(\{\s*kind: "control"/);
	assert.match(
		tunnel,
		/this\.ctx\.acceptWebSocket\(server, \[\s*"data",\s*`conn:\$\{connectionId\}`,\s*`ch:\$\{channelId\}`/,
	);
	assert.match(tunnel, /server\.serializeAttachment\(\{\s*kind: "data"/);
	assert.match(tunnel, /this\.ctx\.getWebSockets\("control"\)/);
	assert.match(
		tunnel,
		/this\.ctx\.getWebSockets\(\s*`conn:\$\{this\.currentConnectionId\}`/,
	);
	assert.match(tunnel, /this\.ctx\.getWebSockets\(`ch:\$\{channelId\}`\)/);
	assert.match(
		tunnel,
		/this\.ctx\.storage\.put\(STORAGE_CONNECTION_ID, connectionId\)/,
	);
	assert.match(tunnel, /this\.ctx\.storage\.delete\(STORAGE_CONNECTION_ID\)/);
	assert.match(
		tunnel,
		/this\.ctx\.storage\.get<string>\(STORAGE_CONNECTION_ID\)/,
	);
});

test("Durable Object applies strict connection replacement and close policy", () => {
	const tunnel = readFileSync(
		new URL("../src/durable/tunnel.ts", import.meta.url),
		"utf8",
	);
	assert.match(tunnel, /private async replaceConnection/);
	assert.match(
		tunnel,
		/this\.closeConnectionSockets\(\s*this\.currentConnectionId,\s*CLOSE_TUNNEL_REPLACED/,
	);
	assert.match(tunnel, /this\.abortAllStreams\("Tunnel connection replaced"\)/);
	assert.match(tunnel, /this\.resetConnectionCredits\(\)/);
	assert.match(
		tunnel,
		/attachment\.kind === "control"[\s\S]*await this\.failConnection\("control\.close"/,
	);
	assert.match(
		tunnel,
		/attachment\.kind === "data"[\s\S]*await this\.failConnection\("data\.close"/,
	);
	assert.match(tunnel, /ws\.close\(CLOSE_TUNNEL_REPLACED, "Old connection"\)/);
	assert.match(tunnel, /private async failConnection/);
	assert.match(tunnel, /this\.currentConnectionId = null/);
	assert.match(tunnel, /this\.expectedDataChannels = 0/);
	assert.match(
		tunnel,
		/this\.closeConnectionSockets\(connectionId, code, reason\)/,
	);
});

test("Durable Object bounds pending data globally and aborts timed-out pending frames", () => {
	const tunnel = readFileSync(
		new URL("../src/durable/tunnel.ts", import.meta.url),
		"utf8",
	);
	assert.match(tunnel, /private pendingDataBytes = 0/);
	assert.match(tunnel, /this\.pendingDataBytes \+ frame\.payload\.byteLength/);
	assert.match(tunnel, /private armPendingFrameTimeout/);
	assert.match(tunnel, /limits\.pendingDataTimeoutMs/);
	assert.match(tunnel, /Pending data timeout exceeded/);
});

test("Durable Object sends request.abort when public response stream is cancelled", () => {
	const tunnel = readFileSync(
		new URL("../src/durable/tunnel.ts", import.meta.url),
		"utf8",
	);
	assert.match(tunnel, /cancel:\s*\(\) =>\s*this\.abortPublicStream/);
	assert.match(tunnel, /private async abortPublicStream/);
	assert.match(tunnel, /type:\s*"request\.abort"/);
	assert.match(tunnel, /this\.abortStream\(stream, reason\)/);
});

test("Durable Object grants WebSocket receive credit after public socket backpressure", () => {
	const tunnel = readFileSync(
		new URL("../src/durable/tunnel.ts", import.meta.url),
		"utf8",
	);
	assert.match(
		tunnel,
		/await waitForSocketCapacity\(stream\.publicSocket\);[\s\S]*this\.credit\.grantInbound\(stream\.id, frame\.kind, frame\.payload\.byteLength\)/,
	);
});

test("Durable Object closes the connection on invalid data frames and credit violations", () => {
	const tunnel = readFileSync(
		new URL("../src/durable/tunnel.ts", import.meta.url),
		"utf8",
	);
	const credit = readFileSync(
		new URL("../src/durable/credit.ts", import.meta.url),
		"utf8",
	);
	assert.match(tunnel, /const frame = decodeDataFrameView/);
	assert.match(
		tunnel,
		/await this\.failConnection\(\s*"protocol\.error",\s*CLOSE_PROTOCOL_ERROR,\s*"Invalid data frame"/,
	);
	assert.match(tunnel, /!this\.credit\.consumeInbound/);
	assert.match(
		credit,
		/consumeInbound\(streamId: number, kind: DataKind, bytes: number\): boolean/,
	);
	assert.match(
		credit,
		/this\.inboundConnectionCredit < bytes \|\| streamCredit < bytes/,
	);
	assert.match(
		tunnel,
		/await this\.failConnection\(\s*"credit\.violation",\s*CLOSE_PROTOCOL_ERROR,\s*"Credit violation"/,
	);
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
	assert.match(config, /"env":\s*\{\s*"staging"/);
	assert.match(config, /"compatibility_date":\s*"2026-05-01"/);
	const hostcTunnelBindings = config.match(/"name":\s*"HOSTC_TUNNEL"/g) ?? [];
	assert.equal(hostcTunnelBindings.length, 2);
});

test("local secret files are ignored and only an example dev vars file is committed", () => {
	const gitignore = readFileSync(
		new URL("../../../.gitignore", import.meta.url),
		"utf8",
	);
	const example = readFileSync(
		new URL("../.dev.vars.example", import.meta.url),
		"utf8",
	);
	assert.match(gitignore, /^\.dev\.vars$/m);
	assert.match(gitignore, /^\.env\.local$/m);
	assert.match(gitignore, /^\.wrangler$/m);
	assert.match(
		example,
		/^TOKEN_SECRET=dev-only-change-me-at-least-32-random-bytes$/m,
	);
});

test("Wrangler typegen output is generated and includes staging Durable Object binding", () => {
	const types = readFileSync(
		new URL("../worker-configuration.d.ts", import.meta.url),
		"utf8",
	);
	assert.match(types, /Generated by Wrangler/);
	assert.match(types, /interface StagingEnv/);
	assert.match(types, /HOSTC_TUNNEL: DurableObjectNamespace/);
});

test("staging e2e script covers required staging acceptance scenarios", () => {
	const source = readFileSync(
		new URL("../scripts/e2e-staging.mjs", import.meta.url),
		"utf8",
	);
	assert.match(source, /https:\/\/envoq\.dev/);
	assert.match(source, /require\("ws"\)/);
	assert.doesNotMatch(source, /cli\/node_modules/);
	assert.match(source, /artifacts/);
	assert.match(source, /e2e/);
	assert.match(source, /staging-\$\{new Date\(\)\.toISOString\(\)/);
	assert.match(source, /writeFile\(artifactPath/);
	for (const scenario of [
		"POST /api/tunnels",
		"CLI staging connect",
		"wildcard TLS public URL",
		"HTTP GET",
		"HTTP POST body",
		"streaming response",
		"WebSocket text echo",
		"WebSocket binary echo",
		"public WebSocket close",
		"CLI reconnect",
		"tunnel not ready error",
	]) {
		assert.match(source, new RegExp(escapeRegExp(scenario)));
	}
});

test("staging load script covers required scenarios, metrics, and artifact output", () => {
	const source = readFileSync(
		new URL("../scripts/load-staging.mjs", import.meta.url),
		"utf8",
	);
	for (const scenario of [
		"http-get",
		"large-download",
		"large-upload",
		"websocket-long",
		"websocket-burst",
		"idle-websocket",
		"reconnect-storm",
	]) {
		assert.match(source, new RegExp(escapeRegExp(scenario)));
	}
	for (const metric of [
		"p50Ms",
		"p95Ms",
		"p99Ms",
		"throughputBytesPerSec",
		"activeTunnels",
		"activeStreams",
		"activeWebSockets",
		"reconnectRatePerSec",
		"protocolErrorRate",
		"status429",
		"status502",
		"close1011",
		"close1012",
		"streamAbortRate",
		"dataChannelBufferedAmountWaits",
	]) {
		assert.match(source, new RegExp(metric));
	}
	assert.doesNotMatch(source, /not_available_from_black_box_load_runner/);
	assert.match(source, /black_box_failed_operations_ratio/);
	assert.match(source, /temporary_cli_debug_output/);
	assert.match(source, /HOSTC_DEBUG: "1"/);
	assert.match(source, /artifacts/);
	assert.match(source, /load/);
	assert.match(source, /staging-\$\{new Date\(\)\.toISOString\(\)/);
});

test("staging preflight script is read-only and checks Worker readiness", () => {
	const source = readFileSync(
		new URL("../scripts/preflight-staging.mjs", import.meta.url),
		"utf8",
	);
	assert.match(source, /node_modules", "\.bin", "wrangler"/);
	assert.match(
		source,
		/existsSync\(localWrangler\) \? localWrangler : "wrangler"/,
	);
	assert.match(source, /cwd: serverDir/);
	assert.match(source, /WRANGLER_LOG_PATH/);
	assert.match(source, /hostc-wrangler-logs/);
	assert.match(
		source,
		/spawnSync\(wrangler, \["secret", "list", "--env", "staging"\]/,
	);
	assert.match(source, /TOKEN_SECRET/);
	assert.match(source, /let stagingWorkerReady = false/);
	assert.match(source, /stagingWorkerReady = true/);
	assert.match(
		source,
		/skipped because staging Worker or TOKEN_SECRET is not ready/,
	);
	assert.match(source, /new URL\("\/health", serverUrl\)/);
	assert.doesNotMatch(source, /secret put/);
	assert.doesNotMatch(source, /wrangler", \["deploy"/);
});

test("staging package commands build required artifacts before running scripts", () => {
	const manifest = JSON.parse(
		readFileSync(new URL("../package.json", import.meta.url), "utf8"),
	);
	assert.match(manifest.scripts["preflight:staging"], /preflight-staging\.mjs/);
	for (const scriptName of [
		"test:e2e:local",
		"test:e2e:staging",
		"load:staging",
	]) {
		const script = manifest.scripts[scriptName];
		assert.match(script, /pnpm -F @hostc\/protocol build/);
		assert.match(script, /pnpm -F @hostc\/server build/);
		assert.match(script, /pnpm -F hostc build/);
	}
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
			entries.push({
				path: url.pathname,
				source: readFileSync(url, "utf8"),
			});
		}
	}
	return entries;
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
