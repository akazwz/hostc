import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const config = require("../dist-test/config.js");
const packageJson = require("../package.json");
const doctor = require("../dist-test/doctor.js");
const redact = require("../dist-test/redact.js");
const update = require("../dist-test/update.js");

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
			{ serverUrl: "https://envoq.dev", connectToken: "connect.secret" },
			env,
		);
		const raw = await readFile(env.HOSTC_CONFIG, "utf8");
		assert.match(raw, /"serverUrl": "https:\/\/envoq\.dev"/);
		assert.doesNotMatch(raw, /connectToken|secret/);
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

test("token redaction handles bearer and JWT-like values", () => {
	assert.equal(redact.redactToken("Bearer abc.def"), "Bearer [redacted-token]");
	assert.equal(
		redact.redactToken("Bearer abc.def.ghi"),
		"Bearer [redacted-token]",
	);
});

test("doctor local port check detects listening and closed ports", async () => {
	const server = createServer((_request, response) => response.end("ok"));
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const { port } = server.address();
		assert.deepEqual(await doctor.checkLocalPort("127.0.0.1", port), {
			ok: true,
		});
		assert.deepEqual(await doctor.checkLocalPort("127.0.0.1", 9, 25), {
			ok: false,
		});
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
});

test("update check compares semantic versions", () => {
	assert.equal(update.compareVersions("1.2.7", "1.2.6"), 1);
	assert.equal(update.compareVersions("1.2.6", "1.2.6"), 0);
	assert.equal(update.compareVersions("1.2.5", "1.2.6"), -1);
});

test("CLI version is injected from package metadata", () => {
	const source = require("node:fs").readFileSync(
		new URL("../src/index.ts", import.meta.url),
		"utf8",
	);
	assert.equal(packageJson.version, "1.3.0");
	assert.match(source, /__HOSTC_CLI_VERSION__/);
	assert.doesNotMatch(source, /const CLI_VERSION = "1\.3\.0"/);
});
