import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream, mkdtempSync, realpathSync, rmSync, type Stats, statSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { WebSocket, WebSocketServer } from "ws";

import type { CodexMessage, CodexProcess, RpcError } from "./process.ts";

/** The page's cookie. `__Host-` keeps other tunnels on the same domain from overwriting it. */
const COOKIE = "__Host-hostc-codex";

/**
 * What the page may ask Codex. Anyone with the link can already approve commands, so this does not
 * contain them; it keeps the page to its own features, and away from accounts, config and plugins.
 */
const ALLOWED_REQUESTS = new Set([
	"thread/start",
	"thread/resume",
	"thread/fork",
	"thread/read",
	"thread/list",
	"thread/turns/list",
	"thread/items/list",
	"thread/name/set",
	"thread/archive",
	"thread/unarchive",
	"thread/compact/start",
	"thread/revert",
	"thread/shellCommand",
	"thread/goal/set",
	"thread/goal/get",
	"thread/goal/clear",
	"turn/start",
	"turn/steer",
	"turn/interrupt",
	"review/start",
	"model/list",
	"permissionProfile/list",
	"collaborationMode/list",
	"skills/list",
	"fuzzyFileSearch",
	"account/read",
	"account/rateLimits/read",
	"config/read",
	"fs/readFile",
	"fs/readDirectory",
	"gitDiffToRemote",
]);

/** What Codex may ask the page. Anything else is refused at once, or the turn would wait forever. */
const ANSWERED_BY_PAGE = new Set([
	"item/commandExecution/requestApproval",
	"item/fileChange/requestApproval",
	"item/permissions/requestApproval",
	"item/tool/requestUserInput",
	"mcpServer/elicitation/request",
]);

/** What the page renders. The rest would only cost tunnel messages. */
const FORWARDED_NOTIFICATIONS = new Set([
	"error",
	"warning",
	"configWarning",
	"guardianWarning",
	"thread/started",
	"thread/status/changed",
	"thread/name/updated",
	"thread/archived",
	"thread/unarchived",
	"thread/closed",
	"thread/compacted",
	"thread/reverted",
	"thread/goal/updated",
	"thread/goal/cleared",
	"thread/settings/updated",
	"thread/tokenUsage/updated",
	"turn/started",
	"turn/completed",
	"turn/plan/updated",
	"turn/diff/updated",
	"item/started",
	"item/completed",
	"item/agentMessage/delta",
	"item/plan/delta",
	"item/reasoning/summaryTextDelta",
	"item/reasoning/summaryPartAdded",
	"item/commandExecution/outputDelta",
	"item/fileChange/patchUpdated",
	"item/mcpToolCall/progress",
	"model/rerouted",
	"account/rateLimits/updated",
	"serverRequest/resolved",
]);

/** A new thread asks before acting unless the page chose otherwise. Local config does not decide this. */
const THREAD_DEFAULTS = { approvalPolicy: "on-request", permissions: ":workspace" };

/** Images a page may upload to attach to a message. */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
/** Files a page may read to show. */
const MAX_READ_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
	"image/png": ".png",
	"image/jpeg": ".jpg",
	"image/webp": ".webp",
	"image/gif": ".gif",
};

/** Events kept for pages that come back. A page that missed more reloads the thread instead. */
const MAX_LOG_BYTES = 16 * 1024 * 1024;
/** Streaming text arrives token by token, and every tunnel message is billed; send it in batches. */
const BATCH_MS = 40;
/** A page that stopped reading is dropped; it catches up from the log when it returns. */
const MAX_PAGE_QUEUE_CHARS = 64 * 1024 * 1024;
/** The tunnel closes WebSocket messages over 1 MiB. A message holds frames up to this many characters. */
const MAX_MESSAGE_CHARS = 256 * 1024;

type LogEntry = { seq: number; message: CodexMessage; bytes: number };

export type BridgeOptions = {
	codex: CodexProcess;
	token: string;
	/** The built web client. */
	assets: string;
	/** Where new work goes unless the page says otherwise. */
	cwd: string;
	/** Keeps the link to `cwd`: its threads and its files only. */
	here: boolean;
};

/** The local server the tunnel points at: the web client, and one WebSocket per open page. */
export class Bridge {
	private readonly options: BridgeOptions;
	private readonly server: http.Server;
	private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 - 64 });
	private readonly pages = new Set<Page>();
	private readonly boot = randomBytes(8).toString("hex");
	private readonly pendingRequests = new Map<number | string, CodexMessage>();
	/** With `here`: threads of this directory seen so far. The link gives access to these only. */
	private readonly threads = new Set<string>();
	private log: LogEntry[] = [];
	private logBytes = 0;
	private seq = 0;
	private origin = "";
	/** Uploaded images live here until the session ends. */
	private readonly uploads = mkdtempSync(path.join(tmpdir(), "hostc-codex-"));
	private readonly roots: string[];
	private readonly onCodexMessage = (message: CodexMessage): void => this.fromCodex(message);

	constructor(options: BridgeOptions) {
		this.options = options;
		this.server = http.createServer((request, response) => this.serve(request, response));
		this.server.on("upgrade", (request, socket, head) => {
			if (parseUrl(request)?.pathname !== "/ws" || !this.authorized(request)) {
				socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
				return;
			}
			this.sockets.handleUpgrade(request, socket, head, (ws) => this.addPage(ws, request));
		});
		options.codex.on("message", this.onCodexMessage);
		// Compared by real path below, so a symlink cannot lead out of them.
		this.roots = [options.cwd, this.uploads].map(realPathOrSelf);
	}

	/** Listens on loopback only and returns the local origin. */
	listen(): Promise<URL> {
		return new Promise((resolve) => {
			this.server.listen(0, "127.0.0.1", () => {
				this.origin = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
				resolve(new URL(this.origin));
			});
		});
	}

	close(): void {
		for (const page of this.pages) {
			page.socket.terminate();
		}
		this.server.close();
		this.options.codex.off("message", this.onCodexMessage);
		rmSync(this.uploads, { recursive: true, force: true });
	}

	// ---------------------------------------------------------------------------
	// Access

	/**
	 * The tunnel rewrites the page's own Origin to this server's origin, so an exact match rejects
	 * every other site, including other tunnels, which count as the same site as this one.
	 */
	private sameOrigin(request: http.IncomingMessage): boolean {
		return request.headers.origin === this.origin;
	}

	private tokenMatches(candidate: string | undefined): boolean {
		const expected = Buffer.from(this.options.token);
		const actual = Buffer.from(candidate ?? "");
		return actual.length === expected.length && timingSafeEqual(actual, expected);
	}

	private hasSession(request: http.IncomingMessage): boolean {
		for (const part of request.headers.cookie?.split(";") ?? []) {
			const [name, value] = part.trim().split("=");
			if (name === COOKIE && this.tokenMatches(value)) {
				return true;
			}
		}
		return false;
	}

	private authorized(request: http.IncomingMessage): boolean {
		return this.sameOrigin(request) && this.hasSession(request);
	}

	// ---------------------------------------------------------------------------
	// HTTP

	private serve(request: http.IncomingMessage, response: http.ServerResponse): void {
		// Anyone with the URL can send anything here, before any token is checked.
		const url = parseUrl(request);
		if (!url) {
			response.writeHead(400).end();
			return;
		}
		const { pathname } = url;
		if (pathname === "/api/session") {
			this.session(request, response);
			return;
		}
		if (pathname === "/api/upload") {
			this.upload(request, response);
			return;
		}
		if (pathname === "/api/file") {
			this.serveLocalImage(request, response);
			return;
		}
		if (request.method !== "GET" && request.method !== "HEAD") {
			response.writeHead(405).end();
			return;
		}
		this.serveFile(pathname, response);
	}

	/** GET says whether this browser is signed in; POST exchanges the token from the link for a cookie. */
	private session(request: http.IncomingMessage, response: http.ServerResponse): void {
		if (request.method === "GET") {
			response.writeHead(this.hasSession(request) ? 204 : 401, { "cache-control": "no-store" }).end();
			return;
		}
		if (request.method !== "POST" || !this.sameOrigin(request)) {
			response.writeHead(403).end();
			return;
		}
		let body = "";
		request.setEncoding("utf8");
		request.on("data", (chunk: string) => {
			body += chunk;
			if (body.length > 1024) {
				request.destroy();
			}
		});
		request.on("end", () => {
			if (!this.tokenMatches(body)) {
				response.writeHead(401).end();
				return;
			}
			response
				.writeHead(204, {
					"cache-control": "no-store",
					"set-cookie": `${COOKIE}=${this.options.token}; Path=/; Secure; HttpOnly; SameSite=Strict`,
				})
				.end();
		});
	}

	/** Stores an image and answers with its path, which a message then refers to as `localImage`. */
	private upload(request: http.IncomingMessage, response: http.ServerResponse): void {
		const extension = IMAGE_TYPES[request.headers["content-type"] ?? ""];
		if (request.method !== "POST" || !this.authorized(request)) {
			response.writeHead(403).end();
			return;
		}
		if (!extension) {
			response.writeHead(415).end();
			return;
		}
		const file = path.join(this.uploads, `${randomBytes(8).toString("hex")}${extension}`);
		const output = createWriteStream(file);
		let bytes = 0;
		const fail = (status: number) => {
			output.destroy();
			rmSync(file, { force: true });
			if (!response.headersSent) {
				response.writeHead(status, { connection: "close" }).end();
			}
			request.destroy();
		};
		request.on("data", (chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes > MAX_UPLOAD_BYTES) {
				fail(413);
			}
		});
		// A page that goes away mid-upload leaves no partial file behind.
		request.on("close", () => {
			if (!request.complete) {
				fail(400);
			}
		});
		output.on("error", () => fail(500));
		request.pipe(output);
		output.on("finish", () => {
			response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ path: file }));
		});
	}

	/** Shows an image from a conversation. With `here`, only from this directory or an upload. */
	private serveLocalImage(request: http.IncomingMessage, response: http.ServerResponse): void {
		const file = parseUrl(request)?.searchParams.get("path") ?? "";
		const type = LOCAL_IMAGE_TYPES[path.extname(file).toLowerCase()];
		const stats = type && this.withinReach(file) ? statOrNull(file) : null;
		// Other tunnels share this site, so the cookie goes along with an <img> on their pages.
		const site = request.headers["sec-fetch-site"];
		const crossSite = site !== undefined && site !== "same-origin" && site !== "none";
		if (request.method !== "GET" || crossSite || !this.hasSession(request) || !stats?.isFile()) {
			response.writeHead(404).end();
			return;
		}
		response.writeHead(200, {
			"content-type": type as string,
			"content-length": stats.size,
			"cache-control": "private, no-cache",
			"content-security-policy": "default-src 'none'; sandbox",
			"cross-origin-resource-policy": "same-origin",
			"x-content-type-options": "nosniff",
		});
		streamFile(file, response);
	}

	private withinReach(file: string): boolean {
		if (!this.options.here) {
			return true;
		}
		let real: string;
		try {
			real = realpathSync(path.resolve(file));
		} catch {
			return false;
		}
		return this.roots.some((root) => real === root || real.startsWith(`${root}${path.sep}`));
	}

	private serveFile(pathname: string, response: http.ServerResponse): void {
		const root = this.options.assets;
		const decoded = decodeOrNull(pathname);
		const candidate = decoded === null ? root : path.join(root, decoded);
		let file = candidate.startsWith(`${root}${path.sep}`) ? candidate : path.join(root, "index.html");
		let stats = statOrNull(file);
		if (!stats?.isFile()) {
			// One page answers every address.
			file = path.join(root, "index.html");
			stats = statOrNull(file);
		}
		if (!stats) {
			response.writeHead(404).end();
			return;
		}
		const hashed = file.includes(`${path.sep}assets${path.sep}`);
		response.writeHead(200, {
			"content-type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
			"content-length": stats.size,
			"cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
			"content-security-policy":
				"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
			"referrer-policy": "no-referrer",
			"x-content-type-options": "nosniff",
		});
		streamFile(file, response);
	}

	// ---------------------------------------------------------------------------
	// Pages

	private addPage(socket: WebSocket, request: http.IncomingMessage): void {
		const query = parseUrl(request)?.searchParams;
		const since = Number(query?.get("since"));
		const first = this.log[0]?.seq ?? this.seq + 1;
		const resumed = query?.get("boot") === this.boot && Number.isInteger(since) && since >= first - 1;

		const page = new Page(socket);
		this.pages.add(page);
		page.send({
			t: "hello",
			boot: this.boot,
			cwd: this.options.cwd,
			here: this.options.here,
			seq: this.seq,
			resumed,
			pending: [...this.pendingRequests.values()],
		});
		if (resumed) {
			for (const entry of this.log) {
				if (entry.seq > since) {
					page.send({ t: "event", seq: entry.seq, message: entry.message });
				}
			}
		}

		socket.on("message", (data, isBinary) => {
			if (!isBinary) {
				this.fromPage(page, data.toString());
			}
		});
		socket.on("close", () => this.pages.delete(page));
		socket.on("error", () => {
			// A close event always follows.
		});
	}

	private fromPage(page: Page, text: string): void {
		let message: { t?: string; id?: number | string; method?: string; params?: unknown; result?: unknown } | null;
		try {
			message = JSON.parse(text);
		} catch {
			return;
		}
		const id = message?.id;
		if (!message || (typeof id !== "number" && typeof id !== "string")) {
			return;
		}
		if (message.t === "ping") {
			page.send({ t: "pong", id });
			return;
		}
		if (message.t === "answer") {
			// Only the requests still open: a stale page cannot answer twice.
			if (this.pendingRequests.delete(id)) {
				this.options.codex.respond(id, { result: message.result });
			}
			return;
		}
		if (message.t !== "request" || typeof message.method !== "string") {
			return;
		}
		if (!ALLOWED_REQUESTS.has(message.method)) {
			page.send({ t: "response", id, error: { code: -32601, message: `${message.method} is not available` } });
			return;
		}
		const params = (typeof message.params === "object" && message.params !== null ? message.params : {}) as Record<
			string,
			unknown
		>;
		if (this.options.here && params.threadId !== undefined && !this.threads.has(params.threadId as string)) {
			page.send({ t: "response", id, error: { code: -32602, message: "That thread is not in this directory" } });
			return;
		}
		if (
			(message.method === "fs/readFile" || message.method === "fs/readDirectory") &&
			!this.withinReach(String(params.path))
		) {
			page.send({ t: "response", id, error: { code: -32602, message: "That path is not in this directory" } });
			return;
		}
		// Over the size of a tunnel's reach, reading it would only end the connection.
		if (message.method === "fs/readFile" && (statOrNull(String(params.path))?.size ?? 0) > MAX_READ_BYTES) {
			page.send({ t: "response", id, error: { code: -32602, message: "That file is too large to show here" } });
			return;
		}
		this.options.codex.request(message.method, this.scoped(message.method, params)).then(
			(result) => {
				this.remember(result);
				page.send({ t: "response", id, result });
			},
			(error: RpcError) => page.send({ t: "response", id, error }),
		);
	}

	/** Pins what is not the page's to choose. With `here`, that includes every directory. */
	private scoped(method: string, params: Record<string, unknown>): unknown {
		const { here } = this.options;
		const cwd = !here && typeof params.cwd === "string" ? params.cwd : this.options.cwd;
		switch (method) {
			case "thread/list":
				return here ? { ...params, cwd } : params;
			case "thread/start":
				return { ...THREAD_DEFAULTS, ...withoutPlacement(params), cwd };
			case "thread/resume":
			case "thread/fork":
				return { ...THREAD_DEFAULTS, ...withoutPlacement(params) };
			case "turn/start":
				return withoutPlacement(params);
			case "fuzzyFileSearch":
				return { ...params, roots: !here && isFilled(params.roots) ? params.roots : [cwd] };
			case "skills/list":
				return { ...params, cwds: !here && isFilled(params.cwds) ? params.cwds : [cwd] };
			case "gitDiffToRemote":
			case "config/read":
			case "permissionProfile/list":
				return { ...params, cwd };
			default:
				return params;
		}
	}

	private remember(result: unknown): void {
		const { data, thread, reviewThreadId } = (result ?? {}) as {
			data?: { id?: string }[];
			thread?: { id?: string };
			reviewThreadId?: string;
		};
		for (const entry of [...(Array.isArray(data) ? data : []), thread, { id: reviewThreadId }]) {
			if (typeof entry?.id === "string") {
				this.threads.add(entry.id);
			}
		}
	}

	private fromCodex(message: CodexMessage): void {
		if (message.id !== undefined) {
			if (!ANSWERED_BY_PAGE.has(message.method)) {
				this.options.codex.respond(message.id, { error: { code: -32601, message: "Not supported by hostc codex" } });
				return;
			}
			this.pendingRequests.set(message.id, message);
			// What Codex asks about, a sub-agent's thread included, the page has to be able to look at.
			const { threadId } = (message.params ?? {}) as { threadId?: unknown };
			if (typeof threadId === "string") {
				this.threads.add(threadId);
			}
		} else if (!FORWARDED_NOTIFICATIONS.has(message.method)) {
			return;
		} else if (message.method === "serverRequest/resolved") {
			this.pendingRequests.delete((message.params as { requestId: number | string }).requestId);
		} else if (message.method === "thread/started") {
			this.remember(message.params);
		}

		const seq = ++this.seq;
		const bytes = JSON.stringify(message).length;
		this.log.push({ seq, message, bytes });
		this.logBytes += bytes;
		let drop = 0;
		while (this.logBytes > MAX_LOG_BYTES && drop < this.log.length) {
			this.logBytes -= (this.log[drop] as LogEntry).bytes;
			drop++;
		}
		if (drop > 0) {
			this.log = this.log.slice(drop);
		}
		for (const page of this.pages) {
			page.send({ t: "event", seq, message });
		}
	}
}

/**
 * One open page. Frames wait a moment so that a burst of events travels as one tunnel message, and
 * one message goes out at a time, as the last one is written. A long replay therefore arrives in
 * order and in pieces: the page records its progress with each piece, so a dropped connection resumes
 * from there instead of starting over.
 */
class Page {
	readonly socket: WebSocket;
	private readonly queue: string[] = [];
	private queuedChars = 0;
	private timer: NodeJS.Timeout | undefined;
	private writing = false;

	constructor(socket: WebSocket) {
		this.socket = socket;
	}

	send(frame: object): void {
		if (this.socket.readyState !== WebSocket.OPEN) {
			return;
		}
		const text = JSON.stringify(frame);
		this.queuedChars += text.length;
		if (this.queuedChars > MAX_PAGE_QUEUE_CHARS) {
			this.socket.terminate();
			return;
		}
		this.queue.push(text);
		if (!this.writing) {
			this.timer ??= setTimeout(() => this.writeNext(), BATCH_MS);
		}
	}

	private writeNext(): void {
		this.timer = undefined;
		if (this.queue.length === 0 || this.socket.readyState !== WebSocket.OPEN) {
			this.writing = false;
			return;
		}
		this.writing = true;
		const next = () => this.writeNext();
		const first = this.queue[0] as string;
		if (first.length > MAX_MESSAGE_CHARS) {
			this.queue.shift();
			this.queuedChars -= first.length;
			const text = `[${first}]`;
			const parts = Math.ceil(text.length / MAX_MESSAGE_CHARS);
			for (let part = 0; part < parts; part++) {
				const piece = text.slice(part * MAX_MESSAGE_CHARS, (part + 1) * MAX_MESSAGE_CHARS);
				this.socket.send(JSON.stringify({ part, parts, text: piece }), part === parts - 1 ? next : undefined);
			}
			return;
		}
		const batch: string[] = [];
		let chars = 0;
		while (this.queue.length > 0 && chars + (this.queue[0] as string).length <= MAX_MESSAGE_CHARS) {
			const frame = this.queue.shift() as string;
			batch.push(frame);
			chars += frame.length;
		}
		this.queuedChars -= chars;
		this.socket.send(`[${batch.join(",")}]`, next);
	}
}

/** What only the bridge decides: where work happens, and the permission model (profiles, not sandboxes). */
function withoutPlacement(params: Record<string, unknown>): Record<string, unknown> {
	const {
		cwd: _cwd,
		path: _path,
		history: _history,
		sandbox: _sandbox,
		sandboxPolicy: _policy,
		config: _config,
		environments: _environments,
		runtimeWorkspaceRoots: _roots,
		...rest
	} = params;
	return rest;
}

function isFilled(value: unknown): boolean {
	return Array.isArray(value) && value.length > 0;
}

function parseUrl(request: http.IncomingMessage): URL | null {
	return URL.parse(request.url ?? "/", "http://x");
}

function decodeOrNull(pathname: string): string | null {
	try {
		return decodeURIComponent(pathname);
	} catch {
		return null;
	}
}

function realPathOrSelf(file: string): string {
	try {
		return realpathSync(file);
	} catch {
		return file;
	}
}

function streamFile(file: string, response: http.ServerResponse): void {
	createReadStream(file)
		.on("error", () => response.destroy())
		.pipe(response);
}

function statOrNull(file: string): Stats | null {
	try {
		return statSync(file);
	} catch {
		return null;
	}
}

const LOCAL_IMAGE_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
};

const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".svg": "image/svg+xml",
	".json": "application/json",
	".png": "image/png",
	".webmanifest": "application/manifest+json",
};
