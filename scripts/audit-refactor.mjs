import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const checks = [];

check("docs/refactor contains the active v4 spec", () => {
	for (const file of [
		"README.md",
		"protocol-v4.md",
		"client-sdk.md",
		"server.md",
		"cli.md",
		"testing.md",
		"staging.md",
		"deployment.md",
		"acceptance.md",
	]) {
		assertFile(join("docs", "refactor", file));
	}
	assert(
		!existsSync("docs/refactor/protocol.md"),
		"legacy protocol.md must not exist",
	);
	const readme = readText("docs/refactor/README.md");
	for (const text of [
		"hostc v4 tunnel architecture",
		"protocol-v4.md",
		"packages/protocol",
		"packages/client",
		"clientConnection",
		"dataChannel",
		"stream",
		"createEphemeralTunnel",
	]) {
		assert(readme.includes(text), `docs/refactor/README.md is missing ${text}`);
	}
});

check("workspace includes the current monorepo packages", () => {
	const workspace = readText("pnpm-workspace.yaml");
	for (const text of ["apps/*", "packages/*"]) {
		assert(workspace.includes(text), `pnpm-workspace.yaml is missing ${text}`);
	}
	for (const path of [
		"apps/cli/package.json",
		"apps/server/package.json",
		"packages/client/package.json",
		"packages/protocol/package.json",
	]) {
		assertFile(path);
	}
});

check("@hostc/protocol exposes the v4 wire contract", () => {
	const protocol = readText("packages/protocol/src/index.ts");
	for (const text of [
		"export const PROTOCOL_VERSION = 4;",
		"export const TUNNELS_API_PATH",
		"export interface CreateEphemeralTunnelResponse",
		"export function parseCreateEphemeralTunnelResponse",
		"export function isCreateEphemeralTunnelResponse",
		"export function encodeFrame",
		"export function decodeFrameView",
		"export function chooseNextDataChannel",
		"export function headersToEntries",
		"export const CLOSE_MESSAGE_TOO_BIG = 1009;",
	]) {
		assert(protocol.includes(text), `protocol source is missing ${text}`);
	}
	for (const text of [
		"CreateTunnelResponse",
		"parseCreateTunnelResponse",
		"ControlMessage",
		"encodeControlMessage",
		"decodeControlMessage",
	]) {
		assert(
			!protocol.includes(text),
			`protocol source still contains legacy ${text}`,
		);
	}
});

check("@hostc/client owns SDK transport behavior", () => {
	const manifest = readJson("packages/client/package.json");
	assert(manifest.private !== true, "@hostc/client must be publishable");
	assert(
		manifest.publishConfig?.access === "public",
		"@hostc/client must publish as a public scoped package",
	);
	assert(
		!("@hostc/protocol" in (manifest.dependencies ?? {})),
		"@hostc/client must not require @hostc/protocol at runtime",
	);
	assert(
		manifest.devDependencies?.["@hostc/protocol"] === "workspace:*",
		"@hostc/client source must keep @hostc/protocol as an internal dev dependency",
	);
	const tsupConfig = readText("packages/client/tsup.config.ts");
	for (const text of [
		"bundle: true",
		"clean: true",
		"dts: true",
		'external: ["ws"]',
		'noExternal: ["@hostc/protocol"]',
	]) {
		assert(tsupConfig.includes(text), `client tsup config is missing ${text}`);
	}
	assert(
		manifest.scripts?.build?.includes("tsup --config tsup.config.ts"),
		"@hostc/client build must use the bundled publish build",
	);
	const index = readText("packages/client/src/index.ts");
	for (const text of [
		"HostcClient",
		"createEphemeralTunnel",
		"localOriginAdapter",
		"HostcUpstreamWebSocket",
		"UpstreamAdapter",
	]) {
		assert(index.includes(text), `client index is missing ${text}`);
	}
	assert(
		!index.includes("withJitter"),
		"withJitter must not be exported by @hostc/client",
	);
	assertFile("packages/client/src/client-connection.ts");
	assert(
		!existsSync("packages/client/src/tunnel-session.ts"),
		"legacy tunnel-session.ts must not exist",
	);
	const connection = readText("packages/client/src/client-connection.ts");
	for (const text of [
		"export class ClientConnection",
		"dataChannel",
		"stream",
		"upstreamWebSocket",
	]) {
		assert(
			connection.includes(text),
			`client connection source is missing ${text}`,
		);
	}
	assert(
		!existsSync("packages/client/dist/tunnel-session.d.ts"),
		"legacy client dist tunnel-session.d.ts must not exist",
	);
	if (existsSync("packages/client/dist/index.d.ts")) {
		const distIndex = readText("packages/client/dist/index.d.ts");
		assert(
			!distIndex.includes("@hostc/protocol"),
			"client public declarations must not expose @hostc/protocol",
		);
		for (const legacy of [
			"ClientTunnelSession",
			"HostcWebSocketSession",
			"CreateTunnelResponse",
		]) {
			assert(
				!distIndex.includes(legacy),
				`client dist still contains ${legacy}`,
			);
		}
	}
	if (existsSync("packages/client/dist/index.js")) {
		const distIndex = readText("packages/client/dist/index.js");
		assert(
			!distIndex.includes("@hostc/protocol"),
			"client runtime bundle must not import @hostc/protocol",
		);
	}
});

check("CLI is a thin layer over @hostc/client", () => {
	assert(
		!existsSync("apps/cli/src/api.ts"),
		"legacy CLI api.ts must not exist",
	);
	assert(
		!existsSync("apps/cli/src/runtime.ts"),
		"legacy CLI runtime.ts must not exist",
	);
	assert(
		!existsSync("apps/cli/test/runtime-proxy.test.mjs"),
		"legacy CLI runtime test must not exist",
	);
	const index = readText("apps/cli/src/index.ts");
	for (const text of [
		"HostcClient",
		"localOriginAdapter",
		"maybePrintUpdateNotice",
		"warnIfLocalPortClosed",
		"__HOSTC_CLI_VERSION__",
	]) {
		assert(index.includes(text), `CLI index is missing ${text}`);
	}
});

check("server is v4 Worker + Durable Object only", () => {
	const server = readText("apps/server/src/index.ts");
	const durable = readText("apps/server/src/durable/tunnel.ts");
	for (const text of [
		"CreateEphemeralTunnelResponse",
		"TUNNELS_API_PATH",
		"clientConnectionId",
	]) {
		assert(server.includes(text), `server index is missing ${text}`);
	}
	for (const text of [
		"clientConnectionId",
		"dataChannels",
		"FRAME_TYPE_REQUEST_START",
		"FRAME_TYPE_RESPONSE_END",
		"alarm()",
	]) {
		assert(durable.includes(text), `tunnel Durable Object is missing ${text}`);
	}
	const wrangler = readText("apps/server/wrangler.jsonc");
	for (const forbidden of ["nodejs_compat", "d1_databases", '"assets"']) {
		assert(
			!wrangler.includes(forbidden),
			`server wrangler must not include ${forbidden}`,
		);
	}
});

check(
	"legacy protocol and naming leftovers are absent from active source",
	() => {
		for (const path of [
			"packages/client/src/client-connection.ts",
			"packages/client/src/hostc-client.ts",
			"packages/client/src/upstream.ts",
			"packages/client/src/stream-registry.ts",
			"apps/cli/src/index.ts",
			"apps/server/src/index.ts",
			"apps/server/src/durable/tunnel.ts",
		]) {
			const source = readText(path);
			for (const legacy of [
				"ClientTunnelSession",
				"HostcWebSocketSession",
				"webSocketSession",
				"CreateTunnelResponse",
				"parseCreateTunnelResponse",
				"isCreateTunnelResponse",
				"ControlMessage",
			]) {
				assert(!source.includes(legacy), `${path} still contains ${legacy}`);
			}
		}
	},
);

check("root package exposes required validation commands", () => {
	const scripts = readJson("package.json").scripts;
	for (const name of [
		"build",
		"test",
		"lint",
		"audit:refactor",
		"test:e2e:local",
		"test:stress:local",
		"deploy:server:staging",
		"preflight:staging",
		"test:e2e:staging",
		"load:staging",
	]) {
		assert(
			typeof scripts[name] === "string",
			`package.json is missing script ${name}`,
		);
	}
});

check("staging configuration is documented", () => {
	const staging = readText("docs/refactor/staging.md");
	for (const text of ["staging", "wrangler secret", "preflight", "envoq.dev"]) {
		assert(staging.includes(text), `staging.md is missing ${text}`);
	}
});

run();

function check(name, fn) {
	checks.push({ name, fn });
}

function run() {
	let failed = 0;
	for (const item of checks) {
		try {
			item.fn();
			console.log(`ok - ${item.name}`);
		} catch (error) {
			failed += 1;
			console.error(`not ok - ${item.name}`);
			console.error(
				`  ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	if (failed > 0) {
		process.exitCode = 1;
		console.error(`\n${failed} refactor audit check(s) failed.`);
		return;
	}
	console.log(`\n${checks.length} refactor audit checks passed.`);
}

function assertFile(path) {
	assert(existsSync(path), `${path} must exist`);
}

function readText(path) {
	return readFileSync(path, "utf8");
}

function readJson(path) {
	return JSON.parse(readText(path));
}

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}
