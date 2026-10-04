/**
 * End to end: a real `wrangler dev` tunnel server, the built CLI, and a local origin server.
 * Run with `pnpm test:e2e` (builds the CLI first).
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";

const CLI_DIR = path.resolve(import.meta.dirname, "..");
const SERVER_DIR = path.resolve(CLI_DIR, "../server");
const persistDir = mkdtempSync(path.join(tmpdir(), "hostc-e2e-"));

let originPort: number;
let serverPort: number;
let origin: http.Server;
let wrangler: ChildProcess | null = null;
let cli: Cli;

const download = randomBytes(8 * 1024 * 1024);

beforeAll(async () => {
	execFileSync("pnpm", ["build"], { cwd: CLI_DIR, stdio: "ignore" });
	origin = await startOrigin();
	originPort = (origin.address() as AddressInfo).port;
	serverPort = await freePort();
	await startWrangler();
	cli = startCli(String(originPort));
	await cli.waitFor(/https?:\/\/\S+/);
}, 120_000);

afterAll(async () => {
	cli?.process.kill("SIGKILL");
	stopWrangler();
	await new Promise<void>((resolve) => origin?.close(() => resolve()));
	rmSync(persistDir, { recursive: true, force: true });
});

describe("HTTP", () => {
	it("forwards requests with the local host and origin", async () => {
		const response = await publicRequest("/echo-headers?x=1", {
			headers: { origin: tunnelOrigin(), "x-test": "yes" },
		});
		expect(response.status).toBe(200);
		const seen = JSON.parse(response.body.toString()) as Record<string, string>;
		expect(seen.url).toBe("/echo-headers?x=1");
		expect(seen.host).toBe(`localhost:${originPort}`);
		expect(seen.origin).toBe(`http://localhost:${originPort}`);
		expect(seen["x-test"]).toBe("yes");
	});

	it("uploads large bodies intact", async () => {
		const body = randomBytes(5 * 1024 * 1024);
		const response = await publicRequest("/hash", { method: "POST", body });
		expect(response.body.toString()).toBe(sha256(body));
	});

	it("downloads large bodies intact", async () => {
		const response = await publicRequest("/download");
		expect(response.body.byteLength).toBe(download.byteLength);
		expect(sha256(response.body)).toBe(sha256(download));
	});

	it("passes compressed responses through untouched", async () => {
		const response = await publicRequest("/gzip");
		expect(response.headers["content-encoding"]).toBe("gzip");
		expect(gunzipSync(response.body).toString()).toBe("compressed hello");
	});

	it("streams responses as they are produced", async () => {
		const started = Date.now();
		const firstChunk = await new Promise<number>((resolve, reject) => {
			const request = http.request(publicOptions("/events"), (response) => {
				response.once("data", () => {
					resolve(Date.now() - started);
					response.destroy();
				});
			});
			request.on("error", reject);
			request.end();
		});
		// The origin sends one event immediately and the next after 2 s.
		expect(firstChunk).toBeLessThan(1500);
	});

	it("rewrites redirects to the local server", async () => {
		const response = await publicRequest("/redirect");
		expect(response.status).toBe(302);
		expect(response.headers.location).toBe(`${tunnelOrigin()}/target`);
	});

	it("fails only the request when the local server sends an invalid status", async () => {
		expect((await publicRequest("/bad-status")).status).toBe(502);
		expect((await publicRequest("/echo-headers")).status).toBe(200);
	});

	it("returns 502 when the local server fails", async () => {
		const response = await publicRequest("/crash", { headers: { accept: "text/html" } });
		expect(response.status).toBe(502);
		expect(response.body.toString()).toContain("Local server unavailable");
	});
});

describe("WebSocket", () => {
	it("preserves cookies from the local handshake", async () => {
		const socket = new WebSocket(`ws://127.0.0.1:${serverPort}/ws-cookies`, {
			headers: { host: tunnelHost() },
			perMessageDeflate: false,
		});
		let headers: http.IncomingHttpHeaders | undefined;
		socket.on("upgrade", (response) => {
			headers = response.headers;
		});
		try {
			await new Promise((resolve, reject) => {
				socket.once("open", resolve);
				socket.once("error", reject);
			});
			expect(headers?.["set-cookie"]).toEqual(["session=abc; Path=/; HttpOnly", "theme=dark; Path=/"]);
			expect(headers?.["x-app"]).toBe("local");
			expect(headers?.["sec-websocket-extensions"]).toBeUndefined();
			const message = new Promise<string>((resolve) => socket.once("message", (data) => resolve(data.toString())));
			socket.send("cookie-session");
			expect(await message).toBe("echo:cookie-session");
		} finally {
			socket.terminate();
		}
	});

	it("echoes text and binary messages and negotiates subprotocols", async () => {
		const socket = new WebSocket(`ws://127.0.0.1:${serverPort}/ws`, ["chat", "other"], {
			headers: { host: tunnelHost() },
		});
		await new Promise((resolve, reject) => {
			socket.once("open", resolve);
			socket.once("error", reject);
		});
		expect(socket.protocol).toBe("chat");

		const messages: { data: string; binary: boolean }[] = [];
		socket.on("message", (data, binary) => messages.push({ data: data.toString(), binary }));
		socket.send("hello");
		socket.send(Buffer.from("bytes"), { binary: true });
		await waitFor(() => messages.length === 2);
		expect(messages).toEqual([
			{ data: "echo:hello", binary: false },
			{ data: "echo:bytes", binary: true },
		]);

		const closed = new Promise<number>((resolve) => socket.once("close", resolve));
		socket.send("close-me");
		expect(await closed).toBe(4001);
	});

	it("never connects to a host other than the target", async () => {
		const other = new WebSocketServer({ port: 0, host: "127.0.0.1" });
		await new Promise((resolve) => other.once("listening", resolve));
		let reached = false;
		other.on("connection", () => {
			reached = true;
		});
		const otherPort = (other.address() as AddressInfo).port;
		try {
			for (const escapePath of [`//127.0.0.1:${otherPort}/`, "//[/x"]) {
				const socket = new WebSocket(`ws://127.0.0.1:${serverPort}${escapePath}`, { headers: { host: tunnelHost() } });
				const outcome = await new Promise<string>((resolve) => {
					socket.once("open", () => resolve("open"));
					socket.once("unexpected-response", (_request, response) => resolve(String(response.statusCode)));
					socket.once("error", () => resolve("error"));
				});
				socket.terminate();
				// The path is forwarded to the target itself, which accepts WebSockets on any path.
				expect(outcome).toBe("open");
			}
			expect(reached).toBe(false);
			expect(cli.process.exitCode).toBeNull();
			expect((await publicRequest("/echo-headers")).status).toBe(200);
		} finally {
			other.close();
		}
	});
});

describe("lifecycle", () => {
	it("keeps the same URL when the server restarts", async () => {
		const url = cli.url();
		const exited = new Promise((resolve) => wrangler?.once("exit", resolve));
		stopWrangler();
		await exited;
		await cli.waitFor(/Connection lost/);
		await startWrangler();
		await cli.waitFor(/Reconnected\./, 30_000);
		expect(cli.url()).toBe(url);
		expect((await publicRequest("/echo-headers")).status).toBe(200);
	}, 60_000);

	it("warns when nothing is listening and reports local failures as 502", async () => {
		const port = await freePort();
		const other = startCli(String(port));
		try {
			await other.waitFor(/Nothing is listening/);
			await other.waitFor(/https?:\/\/\S+/);
			const response = await publicRequest("/", {}, other.url());
			expect(response.status).toBe(502);
		} finally {
			other.process.kill("SIGKILL");
		}
	});

	it("releases the tunnel on Ctrl+C", async () => {
		const url = cli.url();
		const exited = new Promise<number | null>((resolve) => cli.process.once("exit", resolve));
		cli.process.kill("SIGINT");
		expect(await exited).toBe(0);
		await waitFor(async () => (await publicRequest("/", {}, url)).status === 404, 5000);
	});
});

// -----------------------------------------------------------------------------

type Cli = {
	process: ChildProcess;
	output: () => string;
	url: () => string;
	waitFor: (pattern: RegExp, timeoutMs?: number) => Promise<void>;
};

function startCli(target: string): Cli {
	// FORCE_COLOR would override NO_COLOR and wrap the printed URL in escape codes.
	const { FORCE_COLOR: _forceColor, ...env } = process.env;
	const child = spawn(process.execPath, ["dist/hostc.mjs", target, "--server", `http://127.0.0.1:${serverPort}`], {
		cwd: CLI_DIR,
		env: { ...env, NO_COLOR: "1" },
	});
	let output = "";
	child.stdout.on("data", (chunk: Buffer) => {
		output += chunk.toString();
	});
	child.stderr.on("data", (chunk: Buffer) => {
		output += chunk.toString();
	});
	return {
		process: child,
		output: () => output,
		url: () => {
			const urls = output.match(/https?:\/\/[a-z2-9]{12}\.\S+/g);
			if (!urls) {
				throw new Error(`no URL in output:\n${output}`);
			}
			return urls[urls.length - 1] as string;
		},
		waitFor: (pattern, timeoutMs = 15_000) =>
			waitFor(() => pattern.test(output), timeoutMs).catch(() => {
				throw new Error(`timed out waiting for ${pattern}; output:\n${output}`);
			}),
	};
}

async function startWrangler(): Promise<void> {
	wrangler = spawn(
		"pnpm",
		[
			"exec",
			"wrangler",
			"dev",
			"--experimental-new-config",
			"--ip",
			"127.0.0.1",
			"--port",
			String(serverPort),
			"--inspector-port",
			String(await freePort()),
			"--persist-to",
			persistDir,
			"--var",
			`TUNNEL_DOMAIN:localhost:${serverPort}`,
			"--show-interactive-dev-session=false",
			"--log-level",
			"warn",
		],
		// Own process group, so stopping it also stops workerd.
		{ cwd: SERVER_DIR, stdio: "ignore", detached: true },
	);
	await waitFor(async () => {
		try {
			const response = await fetch(`http://127.0.0.1:${serverPort}/api/health`);
			return response.ok;
		} catch {
			return false;
		}
	}, 60_000);
}

function stopWrangler(): void {
	if (wrangler?.pid) {
		try {
			process.kill(-wrangler.pid, "SIGTERM");
		} catch {
			// Already gone.
		}
	}
}

function startOrigin(): Promise<http.Server> {
	const server = http.createServer((request, response) => {
		const url = request.url ?? "/";
		if (url.startsWith("/echo-headers")) {
			response.setHeader("content-type", "application/json");
			response.end(JSON.stringify({ url, ...request.headers }));
		} else if (url === "/hash") {
			const hash = createHash("sha256");
			request.on("data", (chunk: Buffer) => hash.update(chunk));
			request.on("end", () => response.end(hash.digest("hex")));
		} else if (url === "/download") {
			response.setHeader("content-length", download.byteLength);
			response.end(download);
		} else if (url === "/gzip") {
			response.setHeader("content-encoding", "gzip");
			response.end(gzipSync("compressed hello"));
		} else if (url === "/events") {
			response.setHeader("content-type", "text/event-stream");
			response.write("data: first\n\n");
			const timer = setTimeout(() => response.end("data: second\n\n"), 2000);
			response.on("close", () => clearTimeout(timer));
		} else if (url === "/redirect") {
			response.writeHead(302, { location: `http://localhost:${originPort}/target` });
			response.end();
		} else if (url === "/bad-status") {
			request.socket.end("HTTP/1.1 600 Weird\r\ncontent-length: 0\r\n\r\n");
		} else if (url === "/crash") {
			request.socket.destroy();
		} else {
			response.end("ok");
		}
	});
	const sockets = new WebSocketServer({
		server,
		handleProtocols: (protocols) => (protocols.has("chat") ? "chat" : false),
	});
	sockets.on("headers", (headers, request) => {
		if (request.url === "/ws-cookies") {
			headers.push(
				"Set-Cookie: session=abc; Domain=localhost; Path=/; HttpOnly",
				"Set-Cookie: theme=dark; Path=/",
				"X-App: local",
			);
		}
	});
	sockets.on("connection", (socket) => {
		socket.on("message", (data, binary) => {
			if (data.toString() === "close-me") {
				socket.close(4001, "bye");
				return;
			}
			socket.send(Buffer.concat([Buffer.from("echo:"), data as Buffer]), { binary });
		});
	});
	return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function tunnelHost(url = cli.url()): string {
	return new URL(url).host;
}

function tunnelOrigin(url = cli.url()): string {
	return new URL(url).origin;
}

function publicOptions(pathname: string, url = cli.url()): http.RequestOptions {
	return { host: "127.0.0.1", port: serverPort, path: pathname, headers: { host: tunnelHost(url) } };
}

type PublicResponse = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };

function publicRequest(
	pathname: string,
	options: { method?: string; headers?: Record<string, string>; body?: Buffer } = {},
	url = cli.url(),
): Promise<PublicResponse> {
	return new Promise((resolve, reject) => {
		const base = publicOptions(pathname, url);
		const request = http.request(
			{ ...base, method: options.method ?? "GET", headers: { ...base.headers, ...options.headers } },
			(response) => {
				const chunks: Buffer[] = [];
				response.on("data", (chunk: Buffer) => chunks.push(chunk));
				response.on("end", () =>
					resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }),
				);
				response.on("error", reject);
			},
		);
		request.on("error", reject);
		request.end(options.body);
	});
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!(await check())) {
		if (Date.now() > deadline) {
			throw new Error("timed out");
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

function freePort(): Promise<number> {
	return new Promise((resolve) => {
		const server = http.createServer();
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address() as AddressInfo;
			server.close(() => resolve(port));
		});
	});
}

function sha256(data: Buffer): string {
	return createHash("sha256").update(data).digest("hex");
}
