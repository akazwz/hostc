import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(
	new URL("../packages/client/package.json", import.meta.url),
);
const { WebSocketServer, WebSocket } = require("ws");

const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));
const CLI_BIN = fileURLToPath(
	new URL("../apps/cli/dist/index.js", import.meta.url),
);
const SERVER_URL = process.env.HOSTC_E2E_SERVER_URL ?? "http://127.0.0.1:8787";
const SERVER_PORT = Number(new URL(SERVER_URL).port || 8787);
const TIMEOUT_MS = 60_000;
const LOCAL_TOKEN_SECRET =
	process.env.TOKEN_SECRET ?? "hostc-local-e2e-secret-32-bytes-minimum";

const origin = createOriginServer();
await origin.start();

const wrangler = spawn(
	"pnpm",
	[
		"-F",
		"@hostc/server",
		"exec",
		"wrangler",
		"dev",
		"--port",
		String(SERVER_PORT),
		"--var",
		`TOKEN_SECRET:${LOCAL_TOKEN_SECRET}`,
		"--var",
		"PUBLIC_BASE_DOMAIN:hostc.dev",
		"--var",
		"ALLOW_LOCAL_TUNNEL_HEADER:1",
	],
	{
		stdio: ["ignore", "pipe", "pipe"],
		cwd: ROOT_DIR,
		detached: process.platform !== "win32",
		env: {
			...process.env,
			TOKEN_SECRET: LOCAL_TOKEN_SECRET,
			ALLOW_LOCAL_TUNNEL_HEADER: "1",
		},
	},
);

try {
	await waitForHttp(`${SERVER_URL}/health`, TIMEOUT_MS);

	const cli = spawn(
		"node",
		[
			CLI_BIN,
			String(origin.port),
			"--server",
			SERVER_URL,
			"--data-channels",
			"2",
		],
		{
			stdio: ["ignore", "pipe", "pipe"],
			detached: process.platform !== "win32",
		},
	);

	try {
		const publicUrl = await waitForCliPublicUrl(cli, TIMEOUT_MS);
		const publicHost = new URL(publicUrl).host;

		const getResponse = await publicFetch(publicHost, "/hello?from=e2e");
		assert(
			getResponse.status === 200,
			`GET expected 200, got ${getResponse.status}`,
		);
		assert(
			getResponse.body.includes("GET /hello?from=e2e"),
			"GET body did not come from local origin",
		);

		const postResponse = await publicFetch(publicHost, "/echo", {
			method: "POST",
			body: "payload",
			headers: { "content-type": "text/plain" },
		});
		assert(
			postResponse.status === 200,
			`POST expected 200, got ${postResponse.status}`,
		);
		assert(
			postResponse.body.includes("payload"),
			"POST body did not roundtrip through local origin",
		);

		await assertWebSocketEcho(publicHost, "/ws", "hostc-local-e2e");

		console.log(
			JSON.stringify(
				{
					name: "hostc-local-e2e",
					serverUrl: SERVER_URL,
					publicUrl,
					originPort: origin.port,
					checks: ["http-get", "http-post", "websocket-echo"],
				},
				null,
				2,
			),
		);
	} finally {
		terminate(cli);
	}
} finally {
	terminate(wrangler);
	await origin.close();
}

function createOriginServer() {
	const server = createServer(async (request, response) => {
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		const body = Buffer.concat(chunks).toString();
		response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
		response.end(`${request.method} ${request.url}\n${body}`);
	});
	const wss = new WebSocketServer({ noServer: true });

	server.on("upgrade", (request, socket, head) => {
		wss.handleUpgrade(request, socket, head, (webSocket) => {
			webSocket.on("message", (message) => webSocket.send(message));
		});
	});

	return {
		port: undefined,
		async start() {
			await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
			this.port = server.address().port;
		},
		async close() {
			wss.close();
			server.close();
			await once(server, "close").catch(() => undefined);
		},
	};
}

async function publicFetch(publicHost, path, init = {}) {
	const response = await fetch(new URL(path, SERVER_URL), {
		...init,
		headers: {
			...(init.headers ?? {}),
			"x-hostc-local-tunnel-host": publicHost,
		},
	});
	return {
		status: response.status,
		body: await response.text(),
	};
}

async function assertWebSocketEcho(publicHost, path, message) {
	const url = new URL(path, SERVER_URL);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	const socket = new WebSocket(url, {
		headers: { "x-hostc-local-tunnel-host": publicHost },
	});

	await new Promise((resolve, reject) => {
		socket.once("open", resolve);
		socket.once("error", reject);
	});

	const echoed = new Promise((resolve, reject) => {
		const timeout = setTimeout(
			() => reject(new Error("websocket echo timed out")),
			10_000,
		);
		socket.once("message", (data) => {
			clearTimeout(timeout);
			const text =
				typeof data === "string" ? data : Buffer.from(data).toString();
			if (text !== message) {
				reject(new Error(`unexpected websocket echo: ${text}`));
				return;
			}
			resolve();
		});
		socket.once("error", reject);
	});

	socket.send(message);
	await echoed;
	socket.close(1000, "done");
}

async function waitForHttp(url, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(url);
			if (response.ok) return;
		} catch {}
		await delay(500);
	}
	throw new Error(`server did not become ready: ${url}`);
}

async function waitForCliPublicUrl(child, timeoutMs) {
	return new Promise((resolve, reject) => {
		let output = "";
		const timeout = setTimeout(
			() =>
				reject(new Error(`CLI did not print a public URL\n${output.trim()}`)),
			timeoutMs,
		);
		const onData = (chunk) => {
			const text = chunk.toString();
			output += text;
			const match = text.match(
				/https?:\/\/[A-Za-z0-9_-]+\.(?:hostc\.dev|envoq\.dev)[^\s]*/,
			);
			if (match) {
				clearTimeout(timeout);
				resolve(match[0]);
			}
		};
		child.stdout.on("data", onData);
		child.stderr.on("data", onData);
		child.once("exit", (code) => {
			clearTimeout(timeout);
			reject(
				new Error(
					`CLI exited before ready with code ${code}\n${output.trim()}`,
				),
			);
		});
		child.once("error", reject);
	});
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function terminate(child) {
	if (child.killed) return;
	if (process.platform !== "win32" && child.pid) {
		try {
			process.kill(-child.pid, "SIGTERM");
			return;
		} catch {}
	}
	child.kill("SIGTERM");
}

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
