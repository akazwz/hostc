import type { CodexEvent, Method, Params, Question, Responses } from "./api.ts";

/** The part of WebSocket this module uses; tests pass a fake. */
export type SocketLike = {
	send(text: string): void;
	close(): void;
	addEventListener(type: "message", listener: (event: { data: string }) => void): void;
	addEventListener(type: "close", listener: () => void): void;
};

export type ConnectionStatus = "connecting" | "online" | "offline";

/** The socket went away before a reply: what was asked may or may not have happened. */
export class ConnectionLost extends Error {
	constructor() {
		super("Connection lost");
	}
}

export type Hello = { cwd: string; here: boolean; resumed: boolean; pending: Question[] };

export type ConnectionHandlers = {
	onStatus(status: ConnectionStatus): void;
	/** Every (re)connect. When `resumed` is false, events were missed and state must be reloaded. */
	onHello(hello: Hello): void;
	onEvent(event: CodexEvent): void;
	/** Before a reply is acted on, so that events which came first are also applied first. */
	onBeforeReply?(): void;
};

export type ConnectionPlatform = {
	open(url: string): SocketLike;
	setTimer(callback: () => void, ms: number): unknown;
	clearTimer(timer: unknown): void;
};

type Frame =
	| ({ t: "hello"; boot: string; seq: number } & Hello)
	| { t: "event"; seq: number; message: CodexEvent }
	| { t: "response"; id: number; result?: unknown; error?: { message: string } }
	| { t: "pong"; id: number };

type Waiting = { resolve: (result: never) => void; reject: (error: Error) => void };

/** The tunnel closes WebSocket messages over 1 MiB. */
const MAX_MESSAGE_BYTES = 1000 * 1024;
/** How long a socket that looks open has to prove it is alive when the page comes back. */
const PROBE_MS = 8000;
const CONNECT_TIMEOUT_MS = 12_000;

/** A message too long for the tunnel. Refused here: over the limit, the connection would drop. */
export class MessageTooLong extends Error {}

const RETRY_MIN_MS = 300;
const RETRY_MAX_MS = 5000;

/**
 * The page's connection to the bridge. Reconnects for as long as the page is open and asks for the
 * events it missed, so a phone that locks its screen picks up where it left off.
 */
export class CodexConnection {
	private readonly platform: ConnectionPlatform;
	private readonly handlers: ConnectionHandlers;
	private readonly waiting = new Map<number, Waiting>();
	private socket: SocketLike | null = null;
	private timer: unknown = null;
	private retryMs = RETRY_MIN_MS;
	private nextId = 1;
	private boot = "";
	private seq = 0;
	private parts = "";
	/** The bridge has said hello on this socket. Until then a request would hit a socket still opening. */
	private ready = false;
	private unsent: string[] = [];
	private probe: unknown = null;
	private connecting: unknown = null;
	private stopped = false;

	constructor(platform: ConnectionPlatform, handlers: ConnectionHandlers) {
		this.platform = platform;
		this.handlers = handlers;
	}

	connect(): void {
		if (this.socket || this.stopped) {
			return;
		}
		this.handlers.onStatus("connecting");
		const query = this.boot ? `?boot=${this.boot}&since=${this.seq}` : "";
		const socket = this.platform.open(`/ws${query}`);
		this.socket = socket;
		socket.addEventListener("message", (event) => this.receive(event.data));
		socket.addEventListener("close", () => this.closed(socket));
		// A socket can sit in "connecting" for minutes on a bad network without ever failing.
		this.connecting = this.platform.setTimer(() => {
			this.connecting = null;
			socket.close();
			this.closed(socket);
		}, CONNECT_TIMEOUT_MS);
	}

	/** For good: the session this page belongs to is over. */
	stop(): void {
		this.stopped = true;
		if (this.timer !== null) {
			this.platform.clearTimer(this.timer);
			this.timer = null;
		}
		const socket = this.socket;
		if (socket) {
			socket.close();
			this.closed(socket);
		}
	}

	/**
	 * The page came back to the foreground or the network returned: don't wait for the backoff. A phone
	 * can come back with a socket that looks open and is dead, so an open one has to answer a ping.
	 */
	wake(): void {
		const socket = this.socket;
		if (!socket) {
			if (this.timer !== null) {
				this.platform.clearTimer(this.timer);
				this.timer = null;
			}
			this.retryMs = RETRY_MIN_MS;
			this.connect();
			return;
		}
		this.checkAlive(socket);
	}

	/** Asks the socket to prove it is alive. Anything arriving counts as an answer. */
	private checkAlive(socket: SocketLike): void {
		if (this.ready && this.probe === null) {
			this.probe = this.platform.setTimer(() => {
				this.probe = null;
				socket.close();
				// The browser may take minutes to report a dead socket closed.
				this.closed(socket);
			}, PROBE_MS);
			socket.send(JSON.stringify({ t: "ping", id: this.nextId++ }));
		}
	}

	request<M extends Method>(method: M, params: Params<M>): Promise<Responses[M]> {
		const socket = this.socket;
		if (!socket) {
			return Promise.reject(new Error("Not connected"));
		}
		const id = this.nextId++;
		const text = JSON.stringify({ t: "request", id, method, params });
		if (new TextEncoder().encode(text).length > MAX_MESSAGE_BYTES) {
			return Promise.reject(new MessageTooLong());
		}
		return new Promise((resolve, reject) => {
			this.waiting.set(id, { resolve: resolve as Waiting["resolve"], reject });
			if (this.ready) {
				socket.send(text);
				// A request is when it matters whether anyone is on the other end.
				this.checkAlive(socket);
			} else {
				this.unsent.push(text);
			}
		});
	}

	/** Whether the answer went out. A question stays open until it has. */
	answer(id: number | string, result: unknown): boolean {
		if (!this.ready || !this.socket) {
			return false;
		}
		this.socket.send(JSON.stringify({ t: "answer", id, result }));
		return true;
	}

	private receive(text: string): void {
		if (this.probe !== null) {
			this.platform.clearTimer(this.probe);
			this.probe = null;
		}
		const data = JSON.parse(text) as Frame[] | { part: number; parts: number; text: string };
		if (!Array.isArray(data)) {
			this.parts += data.text;
			if (data.part === data.parts - 1) {
				const whole = this.parts;
				this.parts = "";
				this.frames(JSON.parse(whole) as Frame[]);
			}
			return;
		}
		this.frames(data);
	}

	private frames(frames: Frame[]): void {
		for (const frame of frames) {
			switch (frame.t) {
				case "hello":
					if (this.connecting !== null) {
						this.platform.clearTimer(this.connecting);
						this.connecting = null;
					}
					this.retryMs = RETRY_MIN_MS;
					this.boot = frame.boot;
					if (!frame.resumed) {
						this.seq = frame.seq;
					}
					this.ready = true;
					this.handlers.onStatus("online");
					this.handlers.onBeforeReply?.();
					this.handlers.onHello(frame);
					for (const text of this.unsent.splice(0)) {
						this.socket?.send(text);
					}
					break;
				case "pong":
					break;
				case "event":
					this.seq = frame.seq;
					this.handlers.onEvent(frame.message);
					break;
				case "response": {
					this.handlers.onBeforeReply?.();
					const waiting = this.waiting.get(frame.id);
					this.waiting.delete(frame.id);
					if (frame.error) {
						waiting?.reject(new Error(frame.error.message));
					} else {
						waiting?.resolve(frame.result as never);
					}
					break;
				}
			}
		}
	}

	private closed(socket: SocketLike): void {
		if (socket !== this.socket) {
			return;
		}
		if (this.probe !== null) {
			this.platform.clearTimer(this.probe);
			this.probe = null;
		}
		if (this.connecting !== null) {
			this.platform.clearTimer(this.connecting);
			this.connecting = null;
		}
		this.socket = null;
		this.ready = false;
		this.unsent = [];
		this.parts = "";
		for (const { reject } of this.waiting.values()) {
			reject(new ConnectionLost());
		}
		this.waiting.clear();
		this.handlers.onStatus("offline");
		if (this.stopped) {
			return;
		}
		this.timer = this.platform.setTimer(() => {
			this.timer = null;
			this.connect();
		}, this.retryMs);
		this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS);
	}
}
