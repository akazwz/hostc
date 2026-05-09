import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const checks = [];

check("docs/refactor is present and complete", () => {
	for (const file of [
		"README.md",
		"protocol.md",
		"server.md",
		"cli.md",
		"testing.md",
		"deployment.md",
	]) {
		assertFile(join("docs", "refactor", file));
	}
	const readme = readText(join("docs", "refactor", "README.md"));
	for (const text of [
		"本目录是 hostc 重构的唯一规格来源",
		"packages/tunnel-protocol",
		"packages/protocol",
		"@hostc/protocol",
		"@hostc/server",
		"1 条 control WebSocket + N 条 dataChannel WebSocket",
		"pnpm build",
		"pnpm test",
		"pnpm lint",
		"pnpm -F @hostc/protocol bench",
		"pnpm -F @hostc/server test:e2e:staging",
		"pnpm -F @hostc/server load:staging",
		"推荐 one-shot prompt",
	]) {
		assert(readme.includes(text), `docs/refactor/README.md is missing ${text}`);
	}
});

check("workspace points at the refactored packages", () => {
	const workspace = readText("pnpm-workspace.yaml");
	for (const entry of [
		"- apps/cli",
		"- apps/server",
		"- apps/web",
		"- packages/protocol",
	]) {
		assert(
			workspace.includes(entry),
			`pnpm-workspace.yaml is missing ${entry}`,
		);
	}
	assert(
		!workspace.includes("apps/workers") &&
			!workspace.includes("packages/tunnel-protocol"),
		"workspace must not include legacy packages",
	);
});

check("lockfile importers match the refactored workspace", () => {
	const lockfile = readText("pnpm-lock.yaml");
	for (const text of [
		"  .:",
		"  apps/cli:",
		"  apps/server:",
		"  apps/web:",
		"  packages/protocol:",
	]) {
		assert(
			lockfile.includes(text),
			`pnpm-lock.yaml is missing importer ${text}`,
		);
	}
	for (const text of ["  apps/workers:", "  packages/tunnel-protocol:"]) {
		assert(!lockfile.includes(text), `pnpm-lock.yaml contains ${text}`);
	}
});

check("non-refactor docs do not contradict the tunnel-server split", () => {
	const webReadme = readText("apps/web/README.md");
	for (const text of [
		"predate the tunnel-server refactor",
		"does not serve static assets, waitlist routes, or web UI",
		"docs/refactor",
		"not deployed by the refactored tunnel server",
		"no Static Assets binding",
	]) {
		assert(webReadme.includes(text), `apps/web/README.md is missing ${text}`);
	}
	for (const text of ["apps/workers", "pnpm -F workers"]) {
		assert(
			!webReadme.includes(text),
			`apps/web/README.md still references ${text}`,
		);
	}
	const legacyDoc = readText("docs/websocket-tunnel-best-practices.md");
	for (const text of [
		"重构前的评审笔记",
		"唯一规格来源是 [`docs/refactor/`](./refactor/)",
		"重构前状态",
	]) {
		assert(
			legacyDoc.includes(text),
			`websocket-tunnel-best-practices.md is missing ${text}`,
		);
	}
});

check("active docs and manifests do not point at legacy packages", () => {
	for (const path of [
		"README.md",
		"AGENTS.md",
		"apps/cli/README.md",
		"apps/cli/AGENTS.md",
		"apps/server/README.md",
		"apps/server/AGENTS.md",
		"apps/web/README.md",
		"package.json",
		"pnpm-workspace.yaml",
	]) {
		const text = readText(path);
		for (const legacy of [
			"apps/workers",
			"packages/tunnel-protocol",
			"pnpm -F workers",
			"dev:workers",
			"deploy:workers",
		]) {
			assert(!text.includes(legacy), `${path} still references ${legacy}`);
		}
	}
	const rootReadme = readText("README.md");
	assert(
		rootReadme.includes("deploy the Worker once, set `TOKEN_SECRET`"),
		"README.md must document first staging deploy before setting TOKEN_SECRET",
	);
	const serverReadme = readText("apps/server/README.md");
	assert(
		serverReadme.indexOf("pnpm -F @hostc/server deploy:staging") <
			serverReadme.indexOf(
				"pnpm -F @hostc/server exec wrangler secret put TOKEN_SECRET --env staging",
			),
		"apps/server/README.md must list first staging deploy before TOKEN_SECRET",
	);
});

check("package identities match the refactor spec", () => {
	assertEqual(
		readJson("packages/protocol/package.json").name,
		"@hostc/protocol",
	);
	assertEqual(readJson("apps/server/package.json").name, "@hostc/server");
	assertEqual(readJson("apps/cli/package.json").name, "hostc");
});

check("package dependencies match the refactored boundaries", () => {
	const protocolManifest = readJson("packages/protocol/package.json");
	assertDeepEqual(protocolManifest.dependencies ?? {}, {});
	const serverManifest = readJson("apps/server/package.json");
	assertDeepEqual(serverManifest.dependencies ?? {}, {
		"@hostc/protocol": "workspace:*",
	});
	const cliManifest = readJson("apps/cli/package.json");
	assertEqual(cliManifest.dependencies?.["@hostc/protocol"], "workspace:*");
	const manifests = [
		["package.json", readJson("package.json")],
		["apps/server/package.json", serverManifest],
		["apps/cli/package.json", cliManifest],
		["packages/protocol/package.json", protocolManifest],
	];
	for (const [path, manifest] of manifests) {
		const dependencyNames = Object.keys({
			...(manifest.dependencies ?? {}),
			...(manifest.devDependencies ?? {}),
		});
		for (const forbidden of [
			"hono",
			"@hono/node-server",
			"@cloudflare/d1",
			"@cloudflare/vite-plugin",
		]) {
			assert(
				!dependencyNames.includes(forbidden),
				`${path} must not depend on ${forbidden}`,
			);
		}
	}
});

check("@hostc/protocol exposes the documented wire contract", () => {
	const protocol = readText("packages/protocol/src/index.ts");
	for (const text of [
		"export const PROTOCOL_VERSION = 3;",
		"export const DEFAULT_DATA_CHANNELS = 2;",
		"export const MAX_DATA_CHANNELS = 8;",
		"export const DEFAULT_MAX_WEBSOCKET_MESSAGE_BYTES = 1024 * 1024;",
		"export const DEFAULT_MAX_FRAME_BYTES = DEFAULT_MAX_WEBSOCKET_MESSAGE_BYTES;",
		"export const DEFAULT_MAX_CONTROL_BYTES = 64 * 1024;",
		"export const DEFAULT_STREAM_CREDIT_BYTES = DEFAULT_MAX_WEBSOCKET_MESSAGE_BYTES;",
		"export const DEFAULT_CONNECTION_CREDIT_BYTES = 4 * 1024 * 1024;",
		"export const DEFAULT_PENDING_DATA_BYTES = DEFAULT_CONNECTION_CREDIT_BYTES;",
		"export const DEFAULT_PENDING_DATA_TIMEOUT_MS = 120_000;",
		"export const DATA_FRAME_HEADER_BYTES = 17;",
		"export const DATA_KIND_REQUEST_BODY = 1;",
		"export const DATA_KIND_RESPONSE_BODY = 2;",
		"export const DATA_KIND_WS_CLIENT = 3;",
		"export const DATA_KIND_WS_SERVER = 4;",
		"export const DATA_FLAG_WS_TEXT = 0x01;",
		"export const DATA_FLAG_WS_BINARY = 0x02;",
		"export const CLOSE_MESSAGE_TOO_BIG = 1009;",
		"export type CreateTunnelResponse",
		"export type RefreshTunnelResponse",
		"export type ControlMessage",
		"| RequestStartMessage",
		"| RequestEndMessage",
		"| RequestAbortMessage",
		"| ResponseStartMessage",
		"| ResponseEndMessage",
		"| ResponseAbortMessage",
		"| CreditMessage",
		"export function encodeControlMessage",
		"export function decodeControlMessage",
		"export function isControlMessage",
		"export function encodeDataFrame(",
		"export function encodeDataFrameHeader(",
		"export function decodeDataFrame(",
		"export function decodeDataFrameView(",
		"payload: bytes.subarray(DATA_FRAME_HEADER_BYTES)",
		"view.setUint32(5, meta.id, false);",
		"view.setUint32(9, meta.seq, false);",
		"view.setUint32(13, meta.payloadLength, false);",
		"return streamId % dataChannels;",
		"export function filterHttpRequestHeaders",
		"export function filterWebSocketRequestHeaders",
		"export function filterResponseHeaders",
		"export function normalizeWebSocketCloseCode",
		"export function normalizeWebSocketCloseReason",
		"export function parseCreateTunnelResponse",
		"export function parseRefreshTunnelResponse",
	]) {
		assert(protocol.includes(text), `protocol source is missing ${text}`);
	}
});

check("root acceptance scripts are exposed", () => {
	const scripts = readJson("package.json").scripts;
	for (const name of [
		"dev:server",
		"build",
		"test",
		"lint",
		"test:e2e:local",
		"test:stress:local",
		"preflight:staging",
		"test:e2e:staging",
		"load:staging",
		"deploy:server:staging",
		"audit:refactor",
		"cleanup:legacy",
	]) {
		assert(scripts[name], `package.json is missing script ${name}`);
	}
	assertMatch(scripts.build, /@hostc\/protocol/);
	assertMatch(scripts.build, /@hostc\/server/);
	assertMatch(scripts.build, /hostc build/);
	assertMatch(scripts.test, /@hostc\/protocol/);
	assertMatch(scripts.test, /@hostc\/server/);
	assertMatch(scripts.test, /hostc test/);
	assertMatch(scripts["test:e2e:local"], /@hostc\/server/);
	assertMatch(scripts["test:stress:local"], /@hostc\/protocol/);
	assertMatch(scripts["preflight:staging"], /@hostc\/server/);
	assertMatch(scripts["test:e2e:staging"], /@hostc\/server/);
	assertMatch(scripts["load:staging"], /@hostc\/server/);
	assertMatch(scripts["deploy:server:staging"], /@hostc\/server/);

	const protocolScripts = readJson("packages/protocol/package.json").scripts;
	for (const name of ["build", "test", "bench", "stress:local"]) {
		assert(
			protocolScripts[name],
			`packages/protocol/package.json is missing script ${name}`,
		);
	}
	const serverScripts = readJson("apps/server/package.json").scripts;
	for (const name of [
		"build",
		"dev",
		"deploy",
		"deploy:staging",
		"test",
		"test:e2e:local",
		"preflight:staging",
		"test:e2e:staging",
		"load:staging",
	]) {
		assert(
			serverScripts[name],
			`apps/server/package.json is missing script ${name}`,
		);
	}
	assertMatch(serverScripts["deploy:staging"], /wrangler deploy --env staging/);
	assertMatch(serverScripts["preflight:staging"], /preflight-staging\.mjs/);
	assertMatch(serverScripts["test:e2e:staging"], /e2e-staging\.mjs/);
	assertMatch(serverScripts["load:staging"], /load-staging\.mjs/);
	const cliScripts = readJson("apps/cli/package.json").scripts;
	for (const name of ["build", "test"]) {
		assert(cliScripts[name], `apps/cli/package.json is missing script ${name}`);
	}
});

check("generated artifacts and local secrets are ignored", () => {
	const gitignore = readText(".gitignore");
	for (const text of [
		".dev.vars",
		".env.local",
		".wrangler",
		"dist-test",
		"artifacts",
	]) {
		assert(gitignore.includes(text), `.gitignore is missing ${text}`);
	}
	const devVarsExample = readText("apps/server/.dev.vars.example");
	assert(
		devVarsExample.includes(
			"TOKEN_SECRET=dev-only-change-me-at-least-32-random-bytes",
		),
		"apps/server/.dev.vars.example must contain only the documented dev TOKEN_SECRET placeholder",
	);
});

check("legacy cleanup helper is guarded", () => {
	const cleanup = readText("scripts/cleanup-legacy.mjs");
	for (const text of [
		'process.argv.includes("--yes")',
		'process.argv.includes("--dry-run")',
		"printCleanupPlan",
		'git(["rm", "-r", "--", ...legacyPaths]',
		"rmSync(path, { recursive: true, force: true })",
		"legacyBiomeIncludes",
		"pnpm run cleanup:legacy -- --dry-run",
		"pnpm run cleanup:legacy -- --yes",
	]) {
		assert(cleanup.includes(text), `cleanup-legacy.mjs is missing ${text}`);
	}
});

check("@hostc/protocol stays runtime agnostic", () => {
	const manifest = readJson("packages/protocol/package.json");
	assertDeepEqual(manifest.dependencies ?? {}, {});
	for (const source of readSources("packages/protocol/src")) {
		for (const pattern of [
			/from\s+["']node:/,
			/\bBuffer\b/,
			/cloudflare:/,
			/\bHono\b/,
			/\bWebSocket\b/,
			/\bfetch\s*\(/,
		]) {
			assert(!pattern.test(source.text), `${source.path} matches ${pattern}`);
		}
	}
});

check(
	"@hostc/protocol tests cover codec, validator, and state-machine scenarios",
	() => {
		const tests = [
			readText("packages/protocol/test/protocol.test.mjs"),
			readText("packages/protocol/test/state-machine.test.mjs"),
			readText("packages/protocol/test/runtime-boundary.test.mjs"),
		].join("\n");
		for (const text of [
			"control JSON encode/decode accepts every message",
			"control JSON rejects invalid type, fields, size, headers, URL and reason",
			"credit validator requires stream id/kind only for stream scope",
			"dataFrame encodes and decodes HTTP payloads",
			"dataFrame encodes websocket text and binary flags",
			"dataFrame rejects invalid magic, version, kind, flags, id, seq and length",
			"dataFrame header API is low-copy compatible",
			"random payload roundtrip",
			"selectDataChannel and id validators",
			"credit grant and consume helper",
			"close code and reason normalization",
			"header filters drop hop-by-hop and WebSocket handshake headers",
			"API response parsers validate shared response shapes",
			"state model requires control and all data channels before public proxy",
			"state model handles data before start and end before final data",
			"state model blocks data without stream and connection credit",
			"state model rejects old connection data and fails on socket closes",
			"state model detects seq gaps and lastSeq mismatch",
			"state model releases stream state on abort and ignores later data",
			"runtime has no forbidden platform dependencies",
			"package exposes only the runtime-agnostic build",
		]) {
			assert(
				tests.includes(text),
				`protocol tests are missing named scenario ${text}`,
			);
		}
	},
);

check("@hostc/server stays Worker-native and tunnel-only", () => {
	const wrangler = readText("apps/server/wrangler.jsonc");
	for (const text of [
		'"assets"',
		'"d1_databases"',
		"nodejs_compat",
		"waitlist",
		"cli-error",
	]) {
		assert(!wrangler.includes(text), `wrangler config contains ${text}`);
	}
	for (const text of [
		'"HOSTC_TUNNEL"',
		'"envoq.dev/*"',
		'"*.envoq.dev/*"',
		'"observability"',
	]) {
		assert(wrangler.includes(text), `wrangler config is missing ${text}`);
	}
	for (const source of readSources("apps/server/src")) {
		for (const pattern of [
			/from\s+["']node:/,
			/\bBuffer\b/,
			/\bprocess\./,
			/\brequire\s*\(/,
			/\bHono\b/,
			/waitlist/i,
			/cli-error/i,
		]) {
			assert(!pattern.test(source.text), `${source.path} matches ${pattern}`);
		}
	}
});

check("@hostc/server wrangler config matches deployment spec", () => {
	const config = readJson("apps/server/wrangler.jsonc");
	assertEqual(config.name, "hostc-server");
	assertEqual(config.main, "src/index.ts");
	assertEqual(config.compatibility_date, "2026-05-01");
	assertEqual(config.vars?.PUBLIC_BASE_DOMAIN, "hostc.dev");
	assertEqual(config.vars?.TOKEN_SECRET, undefined);
	assertDeepEqual(config.durable_objects?.bindings, [
		{ name: "HOSTC_TUNNEL", class_name: "HostcTunnel" },
	]);
	assertDeepEqual(config.migrations, [
		{ tag: "v1", new_sqlite_classes: ["HostcTunnel"] },
	]);
	assertEqual(config.observability?.enabled, true);
	assertEqual(config.observability?.head_sampling_rate, 0.1);
	assertDeepEqual(config.routes, [
		{ pattern: "hostc.dev/*", zone_name: "hostc.dev" },
		{ pattern: "*.hostc.dev/*", zone_name: "hostc.dev" },
	]);
	const staging = config.env?.staging;
	assertEqual(staging?.name, "hostc-server-staging");
	assertEqual(staging?.vars?.PUBLIC_BASE_DOMAIN, "envoq.dev");
	assertEqual(staging?.vars?.TOKEN_SECRET, undefined);
	assertDeepEqual(staging?.durable_objects?.bindings, [
		{ name: "HOSTC_TUNNEL", class_name: "HostcTunnel" },
	]);
	assertEqual(staging?.observability?.enabled, true);
	assertEqual(staging?.observability?.head_sampling_rate, 1);
	assertDeepEqual(staging?.routes, [
		{ pattern: "envoq.dev/*", zone_name: "envoq.dev" },
		{ pattern: "*.envoq.dev/*", zone_name: "envoq.dev" },
	]);
});

check("@hostc/server token contract matches the refactor spec", () => {
	const token = readText("apps/server/src/token.ts");
	for (const text of [
		"base64UrlEncodeBytes",
		"base64UrlDecodeBytes",
		"crypto.subtle.sign",
		"crypto.subtle.verify",
		'{ name: "HMAC", hash: "SHA-256" }',
		"keyCache",
		"crypto.randomUUID()",
		"TOKEN_SECRET must be at least 32 bytes",
		"record.v === 1",
		'record.aud === "connect" || record.aud === "refresh"',
		'typeof record.nonce === "string"',
	]) {
		assert(token.includes(text), `token.ts is missing ${text}`);
	}
	assert(
		!/\bJWT\b|\bjose\b|jsonwebtoken/.test(token),
		"token.ts must not use JWT",
	);
	const server = readText("apps/server/src/index.ts");
	for (const text of [
		"const CONNECT_TOKEN_TTL_SECONDS = 60;",
		"const REFRESH_TOKEN_TTL_SECONDS = 10 * 60;",
		"authorization",
		"getBearerToken",
		"verifyToken(env.TOKEN_SECRET",
		"signToken(",
	]) {
		assert(server.includes(text), `server index is missing ${text}`);
	}
});

check("@hostc/server logs are structured and redact sensitive values", () => {
	const log = readText("apps/server/src/log.ts");
	for (const text of [
		"JSON.stringify(redactLogFields(fields))",
		"SENSITIVE_KEY_PATTERN",
		"authorization|token|secret",
		"SIGNED_TOKEN_PATTERN",
		"Bearer [redacted-token]",
	]) {
		assert(log.includes(text), `log.ts is missing ${text}`);
	}
	const server = readText("apps/server/src/index.ts");
	const tunnel = readText("apps/server/src/durable/tunnel.ts");
	for (const [name, source] of [
		["index.ts", server],
		["tunnel.ts", tunnel],
	]) {
		assert(
			source.includes('from "../log"') || source.includes('from "./log"'),
			`${name} must import shared log`,
		);
		assert(
			!/console\.log\(JSON\.stringify\(fields\)\)/.test(source),
			`${name} must not bypass log redaction`,
		);
	}
	const tests = readText("apps/server/test/router-token.test.mjs");
	for (const text of [
		"structured JSON log redaction hides Authorization, token and secret fields",
		"redactLogFields",
		"Authorization",
		"TOKEN_SECRET",
	]) {
		assert(tests.includes(text), `server tests are missing ${text}`);
	}
});

check("@hostc/server tests cover the named Worker and DO scenarios", () => {
	const tests = readText("apps/server/test/router-token.test.mjs");
	for (const text of [
		"host classification",
		"hostc.dev",
		"envoq.dev",
		"abc.envoq.dev",
		"foo.bar.envoq.dev",
		"localhost",
		"unknown",
		"API path parser",
		"create",
		"refresh",
		"control",
		"data",
		"method-not-allowed",
		"Invalid channel",
		"token sign/verify",
		"audience",
		"connection",
		"signature",
		"WebSocket upgrade validation",
		"tags, attachments and storage state",
		"replaceConnection",
		"control\\.close",
		"data\\.close",
		"Old connection",
		"pending data",
		"Pending data timeout exceeded",
		"request.abort",
		"WebSocket receive credit",
		"Invalid data frame",
		"credit\\.violation",
	]) {
		assert(
			tests.includes(text),
			`server tests are missing named scenario ${text}`,
		);
	}
});

check(
	"CLI tests cover config, API, reconnect, proxy, credit, and redaction",
	() => {
		const tests = [
			readText("apps/cli/test/config-api.test.mjs"),
			readText("apps/cli/test/runtime-proxy.test.mjs"),
		].join("\n");
		for (const text of [
			"config path, read, set and unset use HOSTC_CONFIG",
			"config write uses private mode and does not persist token-like fields",
			"config priority is CLI args, env, config file, defaults",
			"server URL, local host and dataChannels validation",
			"createTunnel and refreshTunnel parse protocol responses",
			"API client times out and honors external abort signals",
			"API errors redact tokens",
			"reconnect jitter stays within the configured range",
			"RuntimeCreditController aborts credit waits when a stream is removed",
			"PendingDataBuffer enforces global pending data limit and clears pending state",
			"TunnelClient aborts local fetch when request.abort arrives",
			"TunnelClient proxies HTTP response over control/data protocol",
			"TunnelClient proxies WebSocket text frames over data channels",
			"TunnelClient filters public WebSocket handshake headers before local proxy",
			"TunnelClient delivers pending WebSocket data after local socket opens",
			"TunnelClient sends response.abort without response.end when local WebSocket connect fails",
			"DATA_FLAG_WS_BINARY",
			"TunnelClient grants stream and connection credit after inbound WebSocket data",
			"TunnelClient fails the connection on data frames from the wrong channel",
			"TunnelClient debug output redacts token-like refresh failures",
		]) {
			assert(
				tests.includes(text),
				`CLI tests are missing named scenario ${text}`,
			);
		}
	},
);

check("CLI persists only non-sensitive config", () => {
	const config = readText("apps/cli/src/config.ts");
	for (const text of [
		"HOSTC_CONFIG",
		"HOSTC_SERVER_URL",
		"HOSTC_DEBUG",
		"HOSTC_DISABLE_UPDATE_CHECK",
		"mode: 0o600",
		"sanitizeStoredConfig",
	]) {
		assert(config.includes(text), `config.ts is missing ${text}`);
	}
	assert(
		!config.includes("connectToken") && !config.includes("refreshToken"),
		"config.ts must not persist tunnel tokens",
	);
});

check("CLI command and runtime surface matches the refactor spec", () => {
	const index = readText("apps/cli/src/index.ts");
	for (const text of [
		'.argument("<port>"',
		'"--local-host <host>"',
		'"--server <url>"',
		'"--data-channels <count>"',
		'"--qr"',
		'.command("path")',
		'.command("get")',
		'.command("set")',
		'.command("unset")',
		"createTunnel(resolved.serverUrl, resolved.dataChannels)",
		"new TunnelClient",
	]) {
		assert(index.includes(text), `CLI index is missing ${text}`);
	}
	const api = readText("apps/cli/src/api.ts");
	for (const text of [
		"parseCreateTunnelResponse",
		"parseRefreshTunnelResponse",
		"authorization: `Bearer",
		"refreshToken",
		"create tunnel timed out",
		"refresh tunnel timed out",
		"redactToken(raw)",
	]) {
		assert(api.includes(text), `CLI API client is missing ${text}`);
	}
	const runtime = readText("apps/cli/src/runtime.ts");
	for (const text of [
		"decodeControlMessage",
		"decodeDataFrameView",
		"encodeControlMessage",
		"encodeDataFrame",
		"selectDataChannel",
		"bufferedAmount",
		"Tunnel ready",
		"Public URL:",
		"request.abort",
		"response.start",
		"response.end",
		"response.abort",
		"refreshTunnel(",
		"withJitter",
		"abortAllStreams",
	]) {
		assert(runtime.includes(text), `CLI runtime is missing ${text}`);
	}
	const runtimeCredit = readText("apps/cli/src/runtime-credit.ts");
	for (const text of [
		"RuntimeCreditController",
		'type: "credit"',
		"waitFor(",
		"grant(",
	]) {
		assert(
			runtimeCredit.includes(text),
			`CLI runtime credit controller is missing ${text}`,
		);
	}
	const runtimePending = readText("apps/cli/src/runtime-pending.ts");
	for (const text of [
		"PendingDataBuffer",
		"byteLength",
		"addFrame(",
		"clearAll(",
	]) {
		assert(
			runtimePending.includes(text),
			`CLI runtime pending buffer is missing ${text}`,
		);
	}
	const runtimeQueue = readText("apps/cli/src/runtime-queue.ts");
	for (const text of ["DataChannelQueue", "enqueue(", "chains"]) {
		assert(
			runtimeQueue.includes(text),
			`CLI runtime data channel queue is missing ${text}`,
		);
	}
});

check("staging and load harnesses exist", () => {
	for (const file of [
		"scripts/e2e-local.mjs",
		"apps/server/scripts/preflight-staging.mjs",
		"apps/server/scripts/e2e-staging.mjs",
		"apps/server/scripts/load-staging.mjs",
		"packages/protocol/scripts/bench.mjs",
		"packages/protocol/scripts/stress-local.mjs",
	]) {
		assertFile(file);
	}
	const load = readText("apps/server/scripts/load-staging.mjs");
	const stagingE2e = readText("apps/server/scripts/e2e-staging.mjs");
	for (const [name, source] of [
		["e2e-staging.mjs", stagingE2e],
		["load-staging.mjs", load],
	]) {
		for (const text of [
			"fileURLToPath",
			'new URL("../../..", import.meta.url)',
			"repoRoot",
			'join(\n\t\trepoRoot,\n\t\t"artifacts"',
		]) {
			assert(source.includes(text), `${name} is missing ${text}`);
		}
	}
	for (const text of [
		"http-get",
		"large-download",
		"large-upload",
		"websocket-long",
		"websocket-burst",
		"idle-websocket",
		"reconnect-storm",
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
		assert(load.includes(text), `load-staging.mjs is missing ${text}`);
	}
});

check(
	"bench, local E2E, staging E2E, and stress harnesses cover named scenarios",
	() => {
		const bench = readText("packages/protocol/scripts/bench.mjs");
		for (const text of [
			"dataFrame encode 1 KiB",
			"dataFrame encode 64 KiB",
			"dataFrame decode 1 KiB",
			"dataFrame decode 64 KiB",
			"decode low-copy allocation check",
			"control JSON parse/validate",
			"selectDataChannel",
			"credit helper",
			"header filter",
			"nodeVersion",
			"opsPerSec",
			"payloadSize",
			"memory",
		]) {
			assert(bench.includes(text), `bench.mjs is missing ${text}`);
		}
		const localE2e = readText("scripts/e2e-local.mjs");
		for (const text of [
			"HTTP GET",
			"HTTP POST body",
			"large upload",
			"streaming response",
			"slow response start",
			"public client cancel",
			"local upstream error",
			"WebSocket text echo",
			"WebSocket binary echo",
			"WebSocket subprotocol selection",
			"public WebSocket close",
			"CLI reconnect",
			"tunnel not ready error",
			"protocol invalid data frame",
			"protocol credit violation",
			"control close invalidates tunnel",
			"data close invalidates tunnel",
		]) {
			assert(localE2e.includes(text), `e2e-local.mjs is missing ${text}`);
		}
		const stagingE2e = readText("apps/server/scripts/e2e-staging.mjs");
		for (const text of [
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
			assert(stagingE2e.includes(text), `e2e-staging.mjs is missing ${text}`);
		}
		const stress = readText("packages/protocol/scripts/stress-local.mjs");
		for (const text of [
			"const STREAMS = 1000;",
			"const RESPONSE_BYTES_PER_STREAM = 64 * 1024;",
			"pendingDataEvents",
			"endBeforeLastDataEvents",
			"oldConnectionIgnored",
			"protocolErrors",
			"assertConverged",
			"credit went negative",
		]) {
			assert(stress.includes(text), `stress-local.mjs is missing ${text}`);
		}
	},
);

check("staging preflight is read-only", () => {
	const preflight = readText("apps/server/scripts/preflight-staging.mjs");
	for (const text of [
		'node_modules", ".bin", "wrangler"',
		'existsSync(localWrangler) ? localWrangler : "wrangler"',
		"cwd: serverDir",
		"WRANGLER_LOG_PATH",
		"hostc-wrangler-logs",
		'spawnSync(wrangler, ["secret", "list", "--env", "staging"]',
		"TOKEN_SECRET",
		'new URL("/health", serverUrl)',
	]) {
		assert(
			preflight.includes(text),
			`preflight-staging.mjs is missing ${text}`,
		);
	}
	for (const forbidden of ["secret put", 'wrangler", ["deploy"']) {
		assert(
			!preflight.includes(forbidden),
			`preflight-staging.mjs must not contain ${forbidden}`,
		);
	}
});

check("legacy tracked packages have been removed", () => {
	const output = git(["ls-files", "apps/workers", "packages/tunnel-protocol"]);
	assert(
		output.trim() === "",
		`legacy tracked files remain:\n${output.trim()}`,
	);
});

check("legacy directories have been removed from the workspace", () => {
	for (const path of ["apps/workers", "packages/tunnel-protocol"]) {
		assert(!existsSync(path), `legacy directory still exists: ${path}`);
	}
});

check("legacy lint exclusions have been removed", () => {
	const biome = readText("biome.json");
	for (const legacyPath of [
		"!apps/workers",
		"!apps/workers/worker-configuration.d.ts",
		"!packages/tunnel-protocol",
	]) {
		assert(
			!biome.includes(legacyPath),
			`biome.json still excludes legacy path ${legacyPath}`,
		);
	}
});

check("staging acceptance evidence exists", () => {
	const e2eArtifacts = readJsonArtifacts(
		join("artifacts", "e2e"),
		/^staging-\d{8}T\d{4}\.json$/,
	);
	const loadArtifacts = readJsonArtifacts(
		join("artifacts", "load"),
		/^staging-\d{8}T\d{4}\.json$/,
	);
	const missing = [];
	if (!e2eArtifacts.some(isValidStagingE2eArtifact)) {
		missing.push(
			"missing valid artifacts/e2e/staging-YYYYMMDDTHHMM.json from envoq.dev staging E2E",
		);
	}
	if (!loadArtifacts.some(isValidStagingLoadArtifact)) {
		missing.push(
			"missing valid artifacts/load/staging-YYYYMMDDTHHMM.json from envoq.dev staging load test",
		);
	}
	assert(missing.length === 0, missing.join("\n"));
});

const failed = checks.filter((item) => item.status === "fail");
console.log(
	JSON.stringify(
		{
			ok: failed.length === 0,
			checks,
			nextCommands: failed.length > 0 ? nextCommandsFor(failed) : [],
		},
		null,
		2,
	),
);
if (failed.length > 0) {
	process.exitCode = 1;
}

function nextCommandsFor(failedChecks) {
	const names = new Set(failedChecks.map((item) => item.name));
	const commands = [];
	if (
		names.has("legacy tracked packages have been removed") ||
		names.has("legacy directories have been removed from the workspace") ||
		names.has("legacy lint exclusions have been removed")
	) {
		commands.push(
			"pnpm run cleanup:legacy -- --dry-run",
			"pnpm run cleanup:legacy -- --yes",
		);
	}
	if (names.has("staging acceptance evidence exists")) {
		commands.push(
			"pnpm -F @hostc/server deploy:staging",
			"pnpm -F @hostc/server exec wrangler secret put TOKEN_SECRET --env staging",
			"pnpm preflight:staging",
			"pnpm -F @hostc/server test:e2e:staging",
			"pnpm -F @hostc/server load:staging",
		);
	}
	if (commands.length > 0) {
		commands.push("pnpm run audit:refactor");
	}
	return commands;
}

function check(name, run) {
	try {
		run();
		checks.push({ name, status: "pass" });
	} catch (error) {
		checks.push({
			name,
			status: "fail",
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

function assertFile(path) {
	assert(existsSync(path), `missing ${path}`);
}

function readText(path) {
	assertFile(path);
	return readFileSync(path, "utf8");
}

function readJson(path) {
	return JSON.parse(readText(path));
}

function readSources(directory) {
	const entries = [];
	for (const name of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, name.name);
		if (name.isDirectory()) {
			entries.push(...readSources(path));
		} else if (name.isFile() && path.endsWith(".ts")) {
			entries.push({ path, text: readText(path) });
		}
	}
	return entries;
}

function listFiles(directory) {
	if (!existsSync(directory)) {
		return [];
	}
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => entry.name);
}

function readJsonArtifacts(directory, pattern) {
	return listFiles(directory)
		.filter((file) => pattern.test(file))
		.map((file) => {
			try {
				return readJson(join(directory, file));
			} catch {
				return null;
			}
		})
		.filter((value) => value !== null);
}

function isValidStagingE2eArtifact(value) {
	return (
		value?.ok === true &&
		typeof value.date === "string" &&
		value.serverUrl === "https://envoq.dev" &&
		isEnvoqPublicUrl(value.publicUrl) &&
		includesAll(value.scenarios, [
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
		])
	);
}

function isValidStagingLoadArtifact(value) {
	return (
		value?.serverUrl === "https://envoq.dev" &&
		typeof value.date === "string" &&
		Array.isArray(value.publicUrls) &&
		value.publicUrls.every(isEnvoqPublicUrl) &&
		Array.isArray(value.scenarioResults) &&
		includesAll(value.scenarios, [
			"http-get",
			"large-download",
			"large-upload",
			"websocket-long",
			"websocket-burst",
			"idle-websocket",
			"reconnect-storm",
		]) &&
		typeof value.durationMs === "number" &&
		typeof value.ok === "number" &&
		typeof value.failed === "number" &&
		typeof value.p50Ms === "number" &&
		typeof value.p95Ms === "number" &&
		typeof value.p99Ms === "number" &&
		typeof value.throughputBytesPerSec === "number" &&
		(typeof value.activeTunnels === "number" ||
			value.activeTunnels === "external") &&
		typeof value.activeStreams === "number" &&
		typeof value.activeWebSockets === "number" &&
		typeof value.reconnectRatePerSec === "number" &&
		typeof value.protocolErrorRate === "number" &&
		typeof value.status429 === "number" &&
		typeof value.status502 === "number" &&
		typeof value.close1011 === "number" &&
		typeof value.close1012 === "number" &&
		typeof value.streamAbortRate === "number" &&
		typeof value.dataChannelBufferedAmountWaits === "number"
	);
}

function includesAll(actual, expected) {
	return (
		Array.isArray(actual) && expected.every((item) => actual.includes(item))
	);
}

function isEnvoqPublicUrl(value) {
	if (typeof value !== "string") {
		return false;
	}
	try {
		const url = new URL(value);
		return (
			url.protocol === "https:" && /^[^.]+\.envoq\.dev$/.test(url.hostname)
		);
	} catch {
		return false;
	}
}

function git(args) {
	const result = spawnSync("git", args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (result.status !== 0) {
		throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
	}
	return result.stdout;
}

function assert(value, message) {
	if (!value) {
		throw new Error(message);
	}
}

function assertMatch(value, pattern) {
	assert(
		typeof value === "string" && pattern.test(value),
		`expected ${JSON.stringify(value)} to match ${pattern}`,
	);
}

function assertEqual(actual, expected) {
	if (actual !== expected) {
		throw new Error(
			`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
		);
	}
}

function assertDeepEqual(actual, expected) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(
			`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
		);
	}
}
