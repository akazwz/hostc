import { mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { connect as connectTcp } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { Bridge } from "../src/codex/bridge.ts";
import { CodexProcess } from "../src/codex/process.ts";

const FAKE = path.resolve(import.meta.dirname, "fake-codex.mjs");
const TOKEN = "a".repeat(64);
const COOKIE = `__Host-hostc-codex=${TOKEN}`;

type Frame = { t: string; [key: string]: unknown };

let assets: string;
let codex: CodexProcess;
let bridge: Bridge;
let origin: string;
const open: WebSocket[] = [];

beforeEach(async () => {
	assets = mkdtempSync(path.join(tmpdir(), "hostc-assets-"));
	writeFileSync(path.join(assets, "index.html"), "<!doctype html>page");
	codex = new CodexProcess(process.execPath, [FAKE], assets);
	await codex.request("initialize", {});
	bridge = new Bridge({ codex, token: TOKEN, assets, cwd: "/work", here: true });
	origin = (await bridge.listen()).origin;
});

afterEach(() => {
	for (const socket of open.splice(0)) {
		socket.terminate();
	}
	bridge.close();
	codex.kill();
	rmSync(assets, { recursive: true, force: true });
});

const upload = (headers: Record<string, string>, body = "png-bytes") =>
	fetch(`${origin}/api/upload`, { method: "POST", body, headers });

/** A page's connection, reassembling parts and collecting frames. */
function connect(query = ""): Promise<{ socket: WebSocket; frames: Frame[] }> {
	const socket = new WebSocket(`${origin.replace("http", "ws")}/ws${query}`, {
		headers: { origin, cookie: COOKIE },
	});
	open.push(socket);
	const frames: Frame[] = [];
	let partial = "";
	socket.on("message", (data) => {
		const parsed = JSON.parse(data.toString()) as Frame[] | { part: number; parts: number; text: string };
		if (Array.isArray(parsed)) {
			frames.push(...parsed);
			return;
		}
		partial += parsed.text;
		if (parsed.part === parsed.parts - 1) {
			frames.push(...(JSON.parse(partial) as Frame[]));
			partial = "";
		}
	});
	return new Promise((resolve, reject) => {
		socket.once("open", () => resolve({ socket, frames }));
		socket.once("error", reject);
	});
}

async function until<T>(read: () => T | undefined, what: string): Promise<T> {
	const deadline = Date.now() + 5000;
	for (;;) {
		const value = read();
		if (value) {
			return value;
		}
		if (Date.now() > deadline) {
			throw new Error(`timed out waiting for ${what}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

function upgradeStatus(headers: Record<string, string>): Promise<number | "open"> {
	const socket = new WebSocket(`${origin.replace("http", "ws")}/ws`, { headers });
	open.push(socket);
	return new Promise((resolve) => {
		socket.once("open", () => resolve("open"));
		socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
		socket.once("error", () => {
			// `unexpected-response` reports the status.
		});
	});
}

const request = (socket: WebSocket, id: number, method: string, params?: unknown) =>
	socket.send(JSON.stringify({ t: "request", id, method, params }));
const responseTo = (frames: Frame[], id: number) => frames.find((frame) => frame.t === "response" && frame.id === id);
const event = (frames: Frame[], method: string) =>
	frames.find((frame) => frame.t === "event" && (frame.message as { method: string }).method === method);
const warnings = (frames: Frame[], prefix: string) =>
	frames
		.filter((frame) => frame.t === "event" && (frame.message as { method: string }).method === "warning")
		.map((frame) => (frame.message as { params: { message: string } }).params.message)
		.filter((message) => message.startsWith(prefix));
const postSession = (body: string, from: string) =>
	fetch(`${origin}/api/session`, { method: "POST", body, headers: { origin: from } });
const sessionStatus = async (cookie?: string) =>
	(await fetch(`${origin}/api/session`, cookie ? { headers: { cookie } } : {})).status;
/** Makes the thread known to the bridge, then starts a turn in it. */
const startTurn = async (socket: WebSocket, frames: Frame[]) => {
	request(socket, 90, "thread/start", {});
	await until(() => responseTo(frames, 90), "the thread");
	request(socket, 1, "turn/start", { threadId: "t1", input: [{ type: "text", text: "one two three" }] });
};

describe("access", () => {
	it("exchanges the token for a cookie, only from its own origin", async () => {
		expect((await postSession("wrong", origin)).status).toBe(401);
		expect((await postSession(TOKEN, "https://other.hostc.app")).status).toBe(403);
		const signedIn = await postSession(TOKEN, origin);
		expect(signedIn.status).toBe(204);
		const cookie = signedIn.headers.get("set-cookie") ?? "";
		expect(cookie).toContain(COOKIE);
		for (const attribute of ["Path=/", "Secure", "HttpOnly", "SameSite=Strict"]) {
			expect(cookie).toContain(attribute);
		}
		expect(cookie).not.toContain("Domain");
	});

	it("reports whether the browser is signed in", async () => {
		expect(await sessionStatus()).toBe(401);
		expect(await sessionStatus(`__Host-hostc-codex=${"b".repeat(64)}`)).toBe(401);
		expect(await sessionStatus(COOKIE)).toBe(204);
	});

	it("opens the WebSocket only with the cookie and from its own origin", async () => {
		expect(await upgradeStatus({ origin })).toBe(403);
		expect(await upgradeStatus({ cookie: COOKIE })).toBe(403);
		expect(await upgradeStatus({ cookie: COOKIE, origin: "https://other.hostc.app" })).toBe(403);
		expect(await upgradeStatus({ cookie: COOKIE, origin: `${origin}.evil.example` })).toBe(403);
		expect(await upgradeStatus({ cookie: COOKIE, origin })).toBe("open");
	});

	it("serves the page to anyone, and nothing outside its directory", async () => {
		const page = await fetch(`${origin}/some/address`);
		expect(page.status).toBe(200);
		expect(await page.text()).toContain("page");
		expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");
		const escaped = await fetch(`${origin}/%2e%2e/%2e%2e/%2e%2e/etc/passwd`);
		expect(await escaped.text()).toContain("page");
	});
});

describe("hostile input", () => {
	it("survives malformed addresses from anyone", async () => {
		const raw = (target: string) =>
			new Promise<number>((resolve, reject) => {
				const socket = connectTcp(Number(new URL(origin).port), "127.0.0.1", () => {
					socket.write(`GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
				});
				let text = "";
				socket.on("data", (chunk) => {
					text += chunk.toString();
				});
				socket.on("end", () => resolve(Number(text.split(" ")[1])));
				socket.on("error", reject);
			});
		for (const target of ["/%ff", "/a/%zz", "//", "/%", "/api/file?path=%ff"]) {
			expect(await raw(target)).toBeGreaterThan(0);
		}
		expect((await fetch(`${origin}/`)).status).toBe(200);
	});

	it("survives malformed messages from a signed-in page", async () => {
		const { socket, frames } = await connect();
		for (const text of ["null", "1", "[]", '"x"', '{"t":"request","id":1,"method":"thread/list","params":"x"}', "{"]) {
			socket.send(text);
		}
		request(socket, 2, "thread/list", {});
		await until(() => responseTo(frames, 2), "a later answer");
	});

	it("does not follow a symlink out of its directory", async () => {
		const own = mkdtempSync(path.join(tmpdir(), "hostc-root-"));
		symlinkSync("/etc/hosts", path.join(own, "x.png"));
		const scoped = new Bridge({ codex, token: TOKEN, assets, cwd: own, here: true });
		const scopedOrigin = (await scoped.listen()).origin;
		try {
			const response = await fetch(`${scopedOrigin}/api/file?path=${encodeURIComponent(path.join(own, "x.png"))}`, {
				headers: { cookie: COOKIE },
			});
			expect(response.status).toBe(404);
		} finally {
			scoped.close();
			rmSync(own, { recursive: true, force: true });
		}
	});

	it("does not show images to another site's page", async () => {
		const own = mkdtempSync(path.join(tmpdir(), "hostc-root-"));
		writeFileSync(path.join(own, "a.png"), "x");
		const scoped = new Bridge({ codex, token: TOKEN, assets, cwd: own, here: true });
		const scopedOrigin = (await scoped.listen()).origin;
		const url = `${scopedOrigin}/api/file?path=${encodeURIComponent(path.join(own, "a.png"))}`;
		try {
			expect((await fetch(url, { headers: { cookie: COOKIE, "sec-fetch-site": "same-site" } })).status).toBe(404);
			const shown = await fetch(url, { headers: { cookie: COOKIE, "sec-fetch-site": "same-origin" } });
			expect(shown.status).toBe(200);
			expect(shown.headers.get("cross-origin-resource-policy")).toBe("same-origin");
		} finally {
			scoped.close();
			rmSync(own, { recursive: true, force: true });
		}
	});
});

describe("delivery", () => {
	it("answers a ping, so a page can tell a dead connection from a quiet one", async () => {
		const { socket, frames } = await connect();
		socket.send(JSON.stringify({ t: "ping", id: 9 }));
		await until(() => frames.find((frame) => frame.t === "pong" && frame.id === 9), "the pong");
	});

	it("sends a long replay in pieces, so that a page's progress survives a drop", async () => {
		const first = await connect();
		const hello = await until(() => first.frames.find((frame) => frame.t === "hello"), "hello");
		await startTurn(first.socket, first.frames);
		const big = "x".repeat(100 * 1024);
		first.socket.terminate();
		for (let index = 0; index < 8; index++) {
			codex.emit("message", { method: "warning", params: { message: big } });
		}
		const messages: string[] = [];
		const back = await connect(`?boot=${hello.boot}&since=0`);
		back.socket.on("message", (data) => messages.push(data.toString()));
		await until(() => warnings(back.frames, "x").length === 8, "the whole replay");
		const arrays = messages.filter((text) => text.startsWith("["));
		expect(arrays.length).toBeGreaterThan(2);
		for (const text of arrays) {
			expect(text.length).toBeLessThan(400 * 1024);
		}
	});
});

describe("images", () => {
	it("leaves nothing behind when an upload is cut off", async () => {
		const good = { origin, cookie: COOKIE, "content-type": "image/png" };
		const { path: kept } = (await (await upload(good)).json()) as { path: string };
		const folder = path.dirname(kept);
		await new Promise<void>((resolve) => {
			const cutOff = httpRequest(`${origin}/api/upload`, {
				method: "POST",
				headers: { ...good, "content-length": "1000" },
			});
			cutOff.on("error", () => resolve());
			cutOff.on("close", () => resolve());
			cutOff.write("partial", () => {
				setTimeout(() => cutOff.destroy(), 30);
			});
		});
		await new Promise((resolve) => setTimeout(resolve, 80));
		expect(readdirSync(folder)).toEqual([path.basename(kept)]);
	});

	it("stores an upload only for a signed-in page of its own origin", async () => {
		const good = { origin, cookie: COOKIE, "content-type": "image/png" };
		expect((await upload({ ...good, cookie: "" })).status).toBe(403);
		expect((await upload({ ...good, origin: "https://other.hostc.app" })).status).toBe(403);
		expect((await upload({ ...good, "content-type": "text/html" })).status).toBe(415);
		const response = await upload(good);
		expect(response.status).toBe(200);
		const { path: file } = (await response.json()) as { path: string };
		const shown = await fetch(`${origin}/api/file?path=${encodeURIComponent(file)}`, { headers: { cookie: COOKIE } });
		expect(shown.headers.get("content-type")).toBe("image/png");
		expect(await shown.text()).toBe("png-bytes");
		const anonymous = await fetch(`${origin}/api/file?path=${encodeURIComponent(file)}`);
		expect(anonymous.status).toBe(404);
	});

	it("shows images only from its directory", async () => {
		const outside = await fetch(`${origin}/api/file?path=${encodeURIComponent("/etc/hosts.png")}`, {
			headers: { cookie: COOKIE },
		});
		expect(outside.status).toBe(404);
		const notImage = await fetch(`${origin}/api/file?path=${encodeURIComponent(`${assets}/index.html`)}`, {
			headers: { cookie: COOKIE },
		});
		expect(notImage.status).toBe(404);
	});
});

describe("requests", () => {
	it("refuses methods the page has no use for", async () => {
		const { socket, frames } = await connect();
		for (const [id, method] of [
			[1, "command/exec"],
			[2, "fs/writeFile"],
			[3, "config/value/write"],
			[4, "account/logout"],
		] as const) {
			request(socket, id, method);
		}
		const refused = await until(() => responseTo(frames, 4), "the refusal");
		expect(refused.error).toMatchObject({ code: -32601 });
		expect(responseTo(frames, 1)?.error).toMatchObject({ code: -32601 });
	});

	it("stays in its directory", async () => {
		const { socket, frames } = await connect();
		request(socket, 1, "thread/list", { cwd: "/somewhere/else" });
		const list = (await until(() => responseTo(frames, 1), "the list")).result as { data: { cwd: string }[] };
		expect(list.data[0]?.cwd).toBe("/work");
		request(socket, 2, "thread/start", { cwd: "/somewhere/else" });
		const started = (await until(() => responseTo(frames, 2), "the thread")).result as {
			thread: { safety: { cwd: string } };
		};
		expect(started.thread.safety.cwd).toBe("/work");
		for (const [id, method] of [
			[3, "thread/resume"],
			[4, "thread/turns/list"],
			[5, "turn/start"],
		] as const) {
			request(socket, id, method, { threadId: "another-project" });
		}
		const refused = await until(() => responseTo(frames, 5), "the refusals");
		expect(refused.error).toMatchObject({ code: -32602 });
		expect(responseTo(frames, 3)?.error).toMatchObject({ code: -32602 });
		request(socket, 6, "thread/resume", { threadId: "t1" });
		expect((await until(() => responseTo(frames, 6), "the resume")).error).toBeUndefined();
	});

	it("asks before acting unless the page chose otherwise, and never leaves its directory", async () => {
		const { socket, frames } = await connect();
		request(socket, 1, "thread/start", {});
		const asks = (await until(() => responseTo(frames, 1), "the thread")).result as { thread: { safety: object } };
		expect(asks.thread.safety).toMatchObject({ approvalPolicy: "on-request", permissions: ":workspace", cwd: "/work" });
		request(socket, 2, "thread/start", { approvalPolicy: "never", permissions: ":danger-full-access", cwd: "/" });
		const chose = (await until(() => responseTo(frames, 2), "the second thread")).result as {
			thread: { safety: object };
		};
		expect(chose.thread.safety).toMatchObject({
			approvalPolicy: "never",
			permissions: ":danger-full-access",
			cwd: "/work",
		});
		request(socket, 3, "turn/start", { threadId: "t1", input: [{ type: "text", text: "hi" }], cwd: "/" });
		const turn = (await until(() => responseTo(frames, 3), "the turn")).result as { turn: { received: object } };
		expect(turn.turn.received).not.toHaveProperty("cwd");
	});

	it("reads files only in its directory", async () => {
		const { socket, frames } = await connect();
		request(socket, 1, "fs/readFile", { path: "/etc/passwd" });
		request(socket, 2, "fs/readDirectory", { path: `${assets}/../` });
		expect((await until(() => responseTo(frames, 2), "the refusals")).error).toMatchObject({ code: -32602 });
		expect(responseTo(frames, 1)?.error).toMatchObject({ code: -32602 });
	});

	it("splits a response longer than a tunnel message", async () => {
		const { socket, frames } = await connect();
		request(socket, 1, "thread/list", { size: 3 * 1024 * 1024 });
		const response = await until(() => responseTo(frames, 1), "the big response");
		const list = response.result as { data: { preview: string }[] };
		expect(list.data[0]?.preview.length).toBe(3 * 1024 * 1024);
	});
});

describe("events", () => {
	it("forwards what the page renders and drops the rest", async () => {
		const { socket, frames } = await connect();
		await startTurn(socket, frames);
		await until(() => event(frames, "item/commandExecution/requestApproval"), "the approval");
		expect(event(frames, "turn/started")).toBeDefined();
		expect(event(frames, "rawResponseItem/completed")).toBeUndefined();
	});

	it("refuses requests the page cannot answer, and passes an answer back once", async () => {
		const { socket, frames } = await connect();
		await startTurn(socket, frames);
		await until(() => warnings(frames, "answered 501")[0], "the refusal");
		socket.send(JSON.stringify({ t: "answer", id: 500, result: { decision: "accept" } }));
		socket.send(JSON.stringify({ t: "answer", id: 500, result: { decision: "decline" } }));
		await until(() => warnings(frames, "answered 500")[0], "the answer");
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(warnings(frames, "answered 500")).toHaveLength(1);
		expect(warnings(frames, "answered 500")[0]).toContain("accept");
	});

	it("keeps going without a page, and replays what a returning page missed", async () => {
		const first = await connect();
		const hello = await until(() => first.frames.find((frame) => frame.t === "hello"), "hello");
		await startTurn(first.socket, first.frames);
		const started = await until(() => event(first.frames, "turn/started"), "the turn");
		const seen = started.seq as number;
		first.socket.terminate();

		// Everything after the turn started arrives again, in order, with the approval still open.
		const back = await connect(`?boot=${hello.boot}&since=${seen}`);
		const again = await until(() => back.frames.find((frame) => frame.t === "hello"), "hello again");
		expect(again.resumed).toBe(true);
		await until(() => event(back.frames, "item/commandExecution/requestApproval"), "the replay");
		const seqs = back.frames.filter((frame) => frame.t === "event").map((frame) => frame.seq as number);
		expect(seqs[0]).toBe(seen + 1);
		expect(seqs).toEqual(seqs.toSorted((a, b) => a - b));
		expect(again.pending).toEqual([expect.objectContaining({ id: 500 })]);
	});

	it("tells a page from before a restart to reload", async () => {
		const { frames } = await connect("?boot=stale&since=5");
		const hello = await until(() => frames.find((frame) => frame.t === "hello"), "hello");
		expect(hello.resumed).toBe(false);
	});
});

const startOpen = async () => {
	const openBridge = new Bridge({ codex, token: TOKEN, assets, cwd: "/work", here: false });
	const { origin: openOrigin } = await openBridge.listen();
	const socket = new WebSocket(`${openOrigin.replace("http", "ws")}/ws`, {
		headers: { cookie: COOKIE, origin: openOrigin },
	});
	const frames: Frame[] = [];
	socket.on("message", (data) => {
		const parsed = JSON.parse(String(data));
		if (Array.isArray(parsed)) {
			frames.push(...(parsed as Frame[]));
		}
	});
	await new Promise((resolve, reject) => {
		socket.once("open", resolve);
		socket.once("error", reject);
	});
	return { openBridge, openOrigin, socket, frames };
};

describe("without --here", () => {
	it("lists every folder and starts work where the page says", async () => {
		const { openBridge, socket, frames } = await startOpen();
		try {
			request(socket, 1, "thread/list", {});
			const list = (await until(() => responseTo(frames, 1), "the list")).result as { data: { cwd?: string }[] };
			expect(list.data[0]?.cwd).toBeUndefined();
			request(socket, 2, "thread/start", { cwd: "/elsewhere" });
			const elsewhere = (await until(() => responseTo(frames, 2), "the thread")).result as {
				thread: { safety: { cwd: string } };
			};
			expect(elsewhere.thread.safety.cwd).toBe("/elsewhere");
			request(socket, 3, "thread/start", {});
			const here = (await until(() => responseTo(frames, 3), "the second thread")).result as {
				thread: { safety: { cwd: string } };
			};
			expect(here.thread.safety.cwd).toBe("/work");
		} finally {
			socket.close();
			openBridge.close();
		}
	});

	it("keeps config and environments out of what the page can set", async () => {
		const { openBridge, socket, frames } = await startOpen();
		try {
			request(socket, 1, "thread/start", {
				config: { a: 1 },
				environments: [{ cwd: "/" }],
				runtimeWorkspaceRoots: ["/"],
			});
			const { thread } = (await until(() => responseTo(frames, 1), "the thread")).result as {
				thread: { safety: object };
			};
			expect(thread.safety).not.toHaveProperty("config");
			expect(thread.safety).not.toHaveProperty("environments");
			expect(thread.safety).not.toHaveProperty("runtimeWorkspaceRoots");
		} finally {
			socket.close();
			openBridge.close();
		}
	});

	it("keeps the page from changing where a running thread works", async () => {
		const { openBridge, socket, frames } = await startOpen();
		try {
			request(socket, 1, "turn/start", { threadId: "any", input: [{ type: "text", text: "hi" }], cwd: "/" });
			const turn = (await until(() => responseTo(frames, 1), "the turn")).result as { turn: { received: object } };
			expect(turn.turn.received).not.toHaveProperty("cwd");
		} finally {
			socket.close();
			openBridge.close();
		}
	});

	it("refuses to read a file too large to show", async () => {
		const { openBridge, socket, frames } = await startOpen();
		const own = mkdtempSync(path.join(tmpdir(), "hostc-big-"));
		try {
			const big = path.join(own, "big.bin");
			writeFileSync(big, Buffer.alloc(5 * 1024 * 1024 + 1));
			request(socket, 1, "fs/readFile", { path: big });
			const reply = await until(() => responseTo(frames, 1), "the refusal");
			expect(reply.error).toMatchObject({ code: -32602 });
		} finally {
			rmSync(own, { recursive: true });
			socket.close();
			openBridge.close();
		}
	});

	it("searches, reads and shows files where the page says", async () => {
		const { openBridge, openOrigin, socket, frames } = await startOpen();
		try {
			request(socket, 1, "fuzzyFileSearch", { query: "x", roots: ["/elsewhere"] });
			const search = (await until(() => responseTo(frames, 1), "the search")).result as {
				received: { roots: string[] };
			};
			expect(search.received.roots).toEqual(["/elsewhere"]);
			request(socket, 2, "skills/list", {});
			const skills = (await until(() => responseTo(frames, 2), "the skills")).result as {
				received: { cwds: string[] };
			};
			expect(skills.received.cwds).toEqual(["/work"]);
			request(socket, 3, "fs/readFile", { path: "/elsewhere/a.ts" });
			expect((await until(() => responseTo(frames, 3), "the file")).error).toBeUndefined();
			const own = mkdtempSync(path.join(tmpdir(), "hostc-open-"));
			writeFileSync(path.join(own, "a.png"), "x");
			const image = await fetch(`${openOrigin}/api/file?path=${encodeURIComponent(path.join(own, "a.png"))}`, {
				headers: { cookie: COOKIE },
			});
			expect(image.status).toBe(200);
			rmSync(own, { recursive: true });
		} finally {
			socket.close();
			openBridge.close();
		}
	});
});

describe("with --here", () => {
	it("lets the page look at a thread Codex asks about, such as a sub-agent's", async () => {
		const { socket, frames } = await connect();
		request(socket, 1, "fs/readDirectory", { path: "/" });
		request(socket, 2, "thread/compact/start", { threadId: "agent" });
		expect((await until(() => responseTo(frames, 2), "the refusal")).error).toMatchObject({ code: -32602 });
		codex.emit("message", {
			id: 700,
			method: "item/fileChange/requestApproval",
			params: { threadId: "agent", itemId: "i" },
		});
		await until(() => event(frames, "item/fileChange/requestApproval"), "the question");
		request(socket, 3, "thread/compact/start", { threadId: "agent" });
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(responseTo(frames, 3)?.error).toBeUndefined();
	});
});
