import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const config = require("../dist-test/config.js");
const api = require("../dist-test/api.js");
const runtime = require("../dist-test/runtime.js");
const redact = require("../dist-test/redact.js");

const limits = {
	maxFrameBytes: 1048576,
	maxWebSocketMessageBytes: 1048576,
	maxControlBytes: 65536,
	streamCreditBytes: 1048576,
	connectionCreditBytes: 4194304,
	pendingDataBytes: 262144,
	pendingDataTimeoutMs: 5000,
};

test("config path, read, set and unset use HOSTC_CONFIG", async () => {
	const dir = await mkdtemp(join(tmpdir(), "hostc-config-"));
	try {
		const env = { HOSTC_CONFIG: join(dir, "config.json") };
		assert.equal(config.getConfigPath(env), env.HOSTC_CONFIG);
		assert.deepEqual(await config.readConfig(env), {});
		await config.setConfigValue("serverUrl", "https://envoq.dev/", env);
		await config.setConfigValue("dataChannels", "3", env);
		assert.deepEqual(await config.readConfig(env), {
			serverUrl: "https://envoq.dev",
			dataChannels: 3,
		});
		await config.unsetConfigValue("serverUrl", env);
		assert.deepEqual(await config.readConfig(env), { dataChannels: 3 });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("config write uses private mode and does not persist token-like fields", async () => {
	const dir = await mkdtemp(join(tmpdir(), "hostc-private-config-"));
	try {
		const env = { HOSTC_CONFIG: join(dir, "config.json") };
		await config.writeConfig(
			{
				serverUrl: "https://envoq.dev",
				connectToken: "connect.secret",
				refreshToken: "refresh.secret",
			},
			env,
		);
		const raw = await readFile(env.HOSTC_CONFIG, "utf8");
		assert.match(raw, /"serverUrl": "https:\/\/envoq\.dev"/);
		assert.doesNotMatch(raw, /connectToken|refreshToken|secret/);
		assert.equal((await stat(env.HOSTC_CONFIG)).mode & 0o777, 0o600);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("config priority is CLI args, env, config file, defaults", async () => {
	const dir = await mkdtemp(join(tmpdir(), "hostc-priority-"));
	try {
		const env = {
			HOSTC_CONFIG: join(dir, "config.json"),
			HOSTC_SERVER_URL: "https://env.example",
			HOSTC_DEBUG: "1",
		};
		await config.writeConfig(
			{
				serverUrl: "https://file.example",
				localHost: "127.0.0.1",
				dataChannels: 4,
				qr: true,
			},
			env,
		);
		const resolved = await config.resolveConfig(
			{ serverUrl: "http://cli.example/", dataChannels: 2 },
			env,
		);
		assert.equal(resolved.serverUrl, "http://cli.example");
		assert.equal(resolved.localHost, "127.0.0.1");
		assert.equal(resolved.dataChannels, 2);
		assert.equal(resolved.qr, true);
		assert.equal(resolved.debug, true);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("server URL, local host and dataChannels validation", () => {
	assert.equal(
		config.normalizeServerUrl("https://envoq.dev/"),
		"https://envoq.dev",
	);
	assert.throws(() => config.normalizeServerUrl("ftp://envoq.dev"));
	assert.equal(config.validateLocalHost("localhost"), "localhost");
	assert.throws(() => config.validateLocalHost("http://localhost"));
	assert.equal(config.validateDataChannels(8), 8);
	assert.throws(() => config.validateDataChannels(9));
	assert.equal(config.parseConfigKey("server-url"), "serverUrl");
});

test("createTunnel and refreshTunnel parse protocol responses", async () => {
	const createResponse = {
		tunnelId: "t-test",
		publicUrl: "https://t-test.envoq.dev",
		connectionId: "c1",
		controlUrl: "wss://envoq.dev/api/tunnels/t-test/control",
		dataUrl: "wss://envoq.dev/api/tunnels/t-test/data",
		connectToken: "connect.token",
		refreshToken: "refresh.token",
		dataChannels: 2,
		limits,
	};
	const fetches = [];
	const fetcher = async (url, init) => {
		fetches.push({ url: String(url), init });
		return new Response(JSON.stringify(createResponse), { status: 201 });
	};
	assert.deepEqual(
		await api.createTunnel("https://envoq.dev", 2, fetcher),
		createResponse,
	);
	assert.equal(fetches[0].url, "https://envoq.dev/api/tunnels");
	assert.match(fetches[0].init.body, /"dataChannels":2/);

	const refreshResponse = {
		connectionId: "c2",
		controlUrl: "wss://envoq.dev/api/tunnels/t-test/control",
		dataUrl: "wss://envoq.dev/api/tunnels/t-test/data",
		connectToken: "connect2.token",
		refreshToken: "refresh2.token",
		dataChannels: 2,
		limits,
	};
	const refreshFetcher = async () =>
		new Response(JSON.stringify(refreshResponse), { status: 200 });
	assert.deepEqual(
		await api.refreshTunnel(
			"https://envoq.dev",
			"t-test",
			"refresh.token",
			2,
			refreshFetcher,
		),
		refreshResponse,
	);
});

test("API client times out and honors external abort signals", async () => {
	const never = async (_url, init) =>
		new Promise((_resolve, reject) => {
			init.signal.addEventListener("abort", () => {
				reject(new DOMException("aborted", "AbortError"));
			});
		});

	await assert.rejects(
		() => api.createTunnel("https://envoq.dev", 2, never, { timeoutMs: 5 }),
		/create tunnel timed out/,
	);

	const controller = new AbortController();
	const pending = api.refreshTunnel(
		"https://envoq.dev",
		"t-test",
		"refresh.token",
		2,
		never,
		{ signal: controller.signal, timeoutMs: 10_000 },
	);
	controller.abort();
	await assert.rejects(pending, /aborted/i);
});

test("API errors redact tokens", async () => {
	const fetcher = async () =>
		new Response('{"connectToken":"abc.def","refreshToken":"ghi.jkl"}', {
			status: 403,
		});
	await assert.rejects(
		() => api.createTunnel("https://envoq.dev", 2, fetcher),
		/\[redacted-token\]/,
	);
	assert.equal(redact.redactToken("Bearer abc.def"), "Bearer [redacted-token]");
});

test("reconnect jitter stays within the configured range", () => {
	for (let index = 0; index < 100; index += 1) {
		const value = runtime.withJitter(1000, 0.2);
		assert.ok(value >= 800 && value <= 1200);
	}
});
