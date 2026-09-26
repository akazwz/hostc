import {
	CLIENT_STALE_MS,
	CLOSE_PROTOCOL_ERROR,
	CLOSE_REPLACED,
	CLOSE_SHUTDOWN,
	CONNECT_GRACE_MS,
	decodeClose,
	decodeFrame,
	decodeHead,
	decodeText,
	decodeWindow,
	encodeClose,
	encodeFrame,
	encodeOpen,
	encodeText,
	encodeWindow,
	type Frame,
	FrameType,
	type HeaderList,
	type HeadMessage,
	MAX_CHUNK_BYTES,
	MAX_STREAMS,
	MAX_WEBSOCKET_MESSAGE_BYTES,
	PING,
	PONG,
	parseSubprotocols,
	ProtocolError,
	RECONNECT_GRACE_MS,
	RESPONSE_TIMEOUT_MS,
	sendableCloseCode,
	sendableCloseReason,
	STREAM_WINDOW_BYTES,
	stripHopByHop,
	stripWebSocketHandshake,
} from "@hostc/protocol";
import { DurableObject } from "cloudflare:workers";

import { errorResponse, type PageOptions, pages } from "./pages.ts";

/** The Worker forwards authenticated connect requests to this URL. Public requests never have this host. */
export const CONNECT_URL = "http://hostc.internal/connect";

const TUNNEL_KEY = "tunnel";
/** Stream ids at or above this value have not been handed out yet. Reserved in blocks to avoid a write per request. */
const STREAM_CEILING_KEY = "streamCeiling";
const STREAM_ID_BLOCK = 1024;

/**
 * Everything needed to route WebSocket traffic lives in socket attachments and
 * tags, so the object can hibernate while a tunnel or a public WebSocket is idle.
 */
type ClientAttachment = { kind: "client"; since: number; retired?: true };
type PublicAttachment = { kind: "public"; stream: number };
type Attachment = ClientAttachment | PublicAttachment;

type HeadResult = { ok: true; head: HeadMessage } | { ok: false; page: PageOptions };

/** In-flight public HTTP request. Lives only in memory: the object stays awake while it runs. */
type HttpStream = {
	id: number;
	settleHead: (result: HeadResult) => void;
	headReceived: boolean;
	/** Request body bytes we may still send to the client. */
	sendCredit: number;
	wakeUploader: (() => void) | null;
	uploading: boolean;
	/** Response body bytes the client may still send to us. */
	receiveCredit: number;
	queue: Uint8Array[];
	pulling: boolean;
	ended: boolean;
	controller: ReadableStreamDefaultController<Uint8Array> | null;
	done: boolean;
};

/** Public WebSocket upgrade waiting for the local server to accept or reject it. */
type PendingWebSocket = {
	offered: string[];
	settle: (response: Response) => void;
};

/** One Durable Object per tunnel. */
export class Tunnel extends DurableObject<Env> {
	private alive: boolean | undefined;
	private streamIdsLoaded: Promise<void> | undefined;
	private nextStream = 1;
	private streamCeiling = 0;
	private readonly http = new Map<number, HttpStream>();
	private readonly pendingWebSockets = new Map<number, PendingWebSocket>();

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		// Heartbeats are answered by the runtime without waking the object.
		ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
	}

	/** Called by the Worker right after it picks a new tunnel id. */
	async init(): Promise<void> {
		await this.ctx.storage.put(TUNNEL_KEY, { createdAt: Date.now() });
		await this.ctx.storage.setAlarm(Date.now() + CONNECT_GRACE_MS);
		this.alive = true;
	}

	override async fetch(request: Request): Promise<Response> {
		const isConnect = request.url === CONNECT_URL;
		if (!(await this.isAlive())) {
			return isConnect
				? Response.json({ error: "Tunnel not found" }, { status: 404 })
				: errorResponse(request, pages.notFound);
		}
		if (isConnect) {
			return this.acceptClient();
		}
		return request.headers.get("upgrade")?.toLowerCase() === "websocket"
			? this.proxyWebSocket(request)
			: this.proxyHttp(request);
	}

	override async alarm(): Promise<void> {
		const client = this.client();
		if (client && !isStale(this.ctx, client)) {
			// Connected: check the heartbeat again later.
			await this.ctx.storage.setAlarm(Date.now() + RECONNECT_GRACE_MS);
			return;
		}
		if (client) {
			// The connection looks open but the client stopped pinging.
			this.retire(client, 1001, "heartbeat timeout");
			await this.clientGone(1001);
			return;
		}
		await this.expire();
	}

	override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		const attachment = attachmentOf(ws);
		if (attachment?.kind === "public") {
			this.fromPublic(ws, attachment.stream, message);
			return;
		}
		if (attachment?.kind !== "client" || attachment.retired || typeof message === "string") {
			return;
		}
		try {
			this.fromClient(decodeFrame(new Uint8Array(message)));
		} catch (error) {
			if (!(error instanceof ProtocolError)) {
				throw error;
			}
			this.retire(ws, CLOSE_PROTOCOL_ERROR, error.message);
			await this.clientGone(CLOSE_PROTOCOL_ERROR);
		}
	}

	override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
		await this.socketGone(ws, code, reason);
	}

	override async webSocketError(ws: WebSocket): Promise<void> {
		await this.socketGone(ws, 1006, "");
	}

	private async socketGone(ws: WebSocket, code: number, reason: string): Promise<void> {
		// Complete the close handshake; hibernatable sockets are left in CLOSING otherwise.
		safeClose(ws, code, reason);
		const attachment = attachmentOf(ws);
		if (attachment?.kind === "public") {
			this.sendFrame(FrameType.End, attachment.stream, encodeClose({ code, reason }));
			return;
		}
		if (attachment?.kind === "client" && !attachment.retired) {
			ws.serializeAttachment({ ...attachment, retired: true } satisfies ClientAttachment);
			await this.clientGone(code);
		}
	}

	// ---------------------------------------------------------------------------
	// Client connection

	private async acceptClient(): Promise<Response> {
		for (const old of this.ctx.getWebSockets("client")) {
			this.retire(old, CLOSE_REPLACED, "replaced by a new connection");
		}
		this.failAll();

		const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
		this.ctx.acceptWebSocket(server, ["client"]);
		server.serializeAttachment({ kind: "client", since: Date.now() } satisfies ClientAttachment);
		await this.ctx.storage.setAlarm(Date.now() + RECONNECT_GRACE_MS);
		return new Response(null, { status: 101, webSocket: client });
	}

	/** The current client socket, if any. */
	private client(): WebSocket | undefined {
		return this.ctx.getWebSockets("client").find((ws) => {
			const attachment = attachmentOf(ws);
			return attachment?.kind === "client" && !attachment.retired && ws.readyState === WebSocket.OPEN;
		});
	}

	/** The current client, unless it has stopped answering heartbeats. */
	private async liveClient(): Promise<WebSocket | undefined> {
		const client = this.client();
		if (client && isStale(this.ctx, client)) {
			this.retire(client, 1001, "heartbeat timeout");
			await this.clientGone(1001);
			return undefined;
		}
		return client;
	}

	/** Marks a client socket as no longer current, then closes it. Its later events are ignored. */
	private retire(ws: WebSocket, code: number, reason: string): void {
		const attachment = attachmentOf(ws);
		if (attachment?.kind === "client") {
			ws.serializeAttachment({ ...attachment, retired: true } satisfies ClientAttachment);
		}
		safeClose(ws, code, reason);
	}

	private async clientGone(code: number): Promise<void> {
		this.failAll();
		if (code === CLOSE_SHUTDOWN) {
			await this.expire();
			return;
		}
		await this.ctx.storage.setAlarm(Date.now() + RECONNECT_GRACE_MS);
	}

	private async expire(): Promise<void> {
		for (const ws of this.ctx.getWebSockets()) {
			this.retire(ws, 1001, "tunnel expired");
		}
		this.failAll();
		this.alive = false;
		// Also deletes the alarm (compatibility date >= 2026-02-24).
		await this.ctx.storage.deleteAll();
	}

	/** Ends every stream. The client's local sockets and requests are gone with its connection. */
	private failAll(): void {
		for (const stream of this.http.values()) {
			this.fail(stream, pages.offline);
		}
		for (const [id, pending] of this.pendingWebSockets) {
			this.pendingWebSockets.delete(id);
			pending.settle(new Response("Tunnel offline", { status: 502 }));
		}
		for (const ws of this.ctx.getWebSockets("public")) {
			safeClose(ws, 1001, "tunnel disconnected");
		}
	}

	private fromClient(frame: Frame): void {
		const { stream: id, payload } = frame;
		const http = this.http.get(id);
		switch (frame.type) {
			case FrameType.Open:
				throw new ProtocolError("OPEN is server-to-client only");
			case FrameType.Head: {
				let head: HeadMessage;
				try {
					head = decodeHead(payload);
				} catch {
					// A bad response from one local request fails that request, not the whole tunnel.
					this.sendFrame(FrameType.Reset, id, encodeText("invalid response head"));
					if (http) {
						this.fail(http, pages.upstreamFailed);
					}
					this.pendingWebSockets.get(id)?.settle(new Response("Invalid response from local server", { status: 502 }));
					this.pendingWebSockets.delete(id);
					return;
				}
				if (http) {
					if (http.headReceived) {
						throw new ProtocolError("duplicate HEAD");
					}
					http.headReceived = true;
					http.settleHead({ ok: true, head });
				} else {
					this.settleWebSocket(id, head);
				}
				return;
			}
			case FrameType.Data:
			case FrameType.Text: {
				if (http) {
					this.receiveBody(http, frame);
					return;
				}
				const publicSocket = this.publicSocket(id);
				if (publicSocket?.readyState === WebSocket.OPEN) {
					publicSocket.send(frame.type === FrameType.Text ? decodeText(payload) : payload);
				}
				return;
			}
			case FrameType.End: {
				if (http) {
					http.ended = true;
					this.flush(http);
					return;
				}
				const close = decodeClose(payload);
				const publicSocket = this.publicSocket(id);
				if (publicSocket) {
					safeClose(publicSocket, close.code, close.reason);
				}
				return;
			}
			case FrameType.Reset: {
				if (http) {
					this.fail(http, pages.upstreamFailed);
					return;
				}
				const pending = this.pendingWebSockets.get(id);
				if (pending) {
					this.pendingWebSockets.delete(id);
					pending.settle(new Response("Local WebSocket unavailable", { status: 502 }));
					return;
				}
				const publicSocket = this.publicSocket(id);
				if (publicSocket) {
					safeClose(publicSocket, 1011, decodeText(payload));
				}
				return;
			}
			case FrameType.Window: {
				const bytes = decodeWindow(payload);
				if (http) {
					http.sendCredit += bytes;
					http.wakeUploader?.();
				}
				return;
			}
		}
	}

	private sendFrame(type: FrameType, id: number, payload?: Uint8Array): void {
		const client = this.client();
		if (client) {
			client.send(encodeFrame(type, id, payload));
		}
	}

	/**
	 * Stream ids only ever increase for the lifetime of the tunnel, including across hibernation,
	 * so a late frame can never be mistaken for a newer stream.
	 */
	private async allocateStream(): Promise<number> {
		// One shared load, so concurrent first requests after waking cannot both start from the same id.
		this.streamIdsLoaded ??= this.ctx.storage.get<number>(STREAM_CEILING_KEY).then((ceiling = 1) => {
			this.nextStream = ceiling;
			this.streamCeiling = ceiling;
		});
		await this.streamIdsLoaded;
		const id = this.nextStream++;
		if (id >= this.streamCeiling) {
			this.streamCeiling = id + STREAM_ID_BLOCK;
			// Not awaited: the output gate holds our response until the write is durable.
			void this.ctx.storage.put(STREAM_CEILING_KEY, this.streamCeiling);
		}
		return id;
	}

	private streamCount(): number {
		return this.http.size + this.pendingWebSockets.size + this.ctx.getWebSockets("public").length;
	}

	private async isAlive(): Promise<boolean> {
		this.alive ??= (await this.ctx.storage.get(TUNNEL_KEY)) !== undefined;
		return this.alive;
	}

	// ---------------------------------------------------------------------------
	// Public HTTP

	private async proxyHttp(request: Request): Promise<Response> {
		if (!(await this.liveClient())) {
			return errorResponse(request, pages.offline);
		}
		if (this.streamCount() >= MAX_STREAMS) {
			return errorResponse(request, pages.busy);
		}

		const id = await this.allocateStream();
		let settleHead!: (result: HeadResult) => void;
		const headResult = new Promise<HeadResult>((resolve) => {
			settleHead = resolve;
		});
		const stream: HttpStream = {
			id,
			settleHead,
			headReceived: false,
			sendCredit: STREAM_WINDOW_BYTES,
			wakeUploader: null,
			uploading: request.body !== null,
			receiveCredit: STREAM_WINDOW_BYTES,
			queue: [],
			pulling: false,
			ended: false,
			controller: null,
			done: false,
		};
		this.http.set(id, stream);

		const url = new URL(request.url);
		this.sendFrame(
			FrameType.Open,
			id,
			encodeOpen({
				method: request.method,
				path: url.pathname + url.search,
				headers: forwardedRequestHeaders(request.headers),
				body: request.body !== null,
			}),
		);
		if (request.body) {
			void this.upload(stream, request.body);
		}
		request.signal.addEventListener("abort", () => this.reset(stream, "public client went away"));

		const result = await withTimeout(headResult, RESPONSE_TIMEOUT_MS);
		if (!result) {
			this.reset(stream, "response timeout");
			return errorResponse(request, pages.timeout);
		}
		if (!result.ok) {
			return errorResponse(request, result.page);
		}

		const { head } = result;
		if (head.status < 200) {
			this.reset(stream, `unsupported status ${head.status}`);
			return errorResponse(request, pages.upstreamFailed);
		}
		const headers = publicResponseHeaders(head.headers, head.body);
		if (!head.body || NULL_BODY_STATUSES.has(head.status)) {
			this.finish(stream);
			return new Response(null, { status: head.status, headers });
		}

		const body = new ReadableStream<Uint8Array>(
			{
				start: (controller) => {
					stream.controller = controller;
				},
				pull: () => {
					stream.pulling = true;
					this.flush(stream);
				},
				cancel: () => this.reset(stream, "public client went away"),
			},
			{ highWaterMark: 0 },
		);
		return new Response(body, {
			status: head.status,
			headers,
			// Compressed bodies from the local server are passed through untouched.
			encodeBody: headers.has("content-encoding") ? "manual" : "automatic",
		});
	}

	/** Streams the public request body to the client, never exceeding the granted window. */
	private async upload(stream: HttpStream, body: ReadableStream<Uint8Array>): Promise<void> {
		const reader = body.getReader();
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				for (let offset = 0; offset < value.byteLength; offset += MAX_CHUNK_BYTES) {
					const chunk = value.subarray(offset, offset + MAX_CHUNK_BYTES);
					while (!stream.done && stream.sendCredit < chunk.byteLength) {
						await new Promise<void>((resolve) => {
							stream.wakeUploader = resolve;
						});
					}
					if (stream.done) {
						await reader.cancel();
						return;
					}
					stream.sendCredit -= chunk.byteLength;
					this.sendFrame(FrameType.Data, stream.id, chunk);
				}
			}
			stream.uploading = false;
			if (!stream.done) {
				this.sendFrame(FrameType.End, stream.id);
			}
		} catch {
			this.reset(stream, "public request body failed");
		}
	}

	private receiveBody(stream: HttpStream, frame: Frame): void {
		if (frame.type !== FrameType.Data || !stream.headReceived || stream.ended) {
			throw new ProtocolError("unexpected response body frame");
		}
		if (frame.payload.byteLength > stream.receiveCredit) {
			throw new ProtocolError("response body exceeded the flow control window");
		}
		stream.receiveCredit -= frame.payload.byteLength;
		// The frame buffer is reused by nothing else, so the payload view can be queued as is.
		stream.queue.push(frame.payload);
		this.flush(stream);
	}

	/** Hands queued chunks to the public response as it pulls, returning window to the client. */
	private flush(stream: HttpStream): void {
		const { controller } = stream;
		if (!controller || stream.done) {
			return;
		}
		while (stream.pulling && stream.queue.length > 0) {
			const chunk = stream.queue.shift() as Uint8Array;
			stream.pulling = false;
			controller.enqueue(chunk);
			stream.receiveCredit += chunk.byteLength;
			this.sendFrame(FrameType.Window, stream.id, encodeWindow(chunk.byteLength));
		}
		if (stream.ended && stream.queue.length === 0) {
			controller.close();
			this.finish(stream);
		}
	}

	/** Normal completion of the response. */
	private finish(stream: HttpStream): void {
		if (stream.done) {
			return;
		}
		if (stream.uploading) {
			// The local server answered without reading the whole request body.
			this.sendFrame(FrameType.Reset, stream.id, encodeText("response finished"));
		}
		this.close(stream);
	}

	/** Aborts a stream from our side and tells the client. */
	private reset(stream: HttpStream, reason: string): void {
		if (stream.done) {
			return;
		}
		this.sendFrame(FrameType.Reset, stream.id, encodeText(reason));
		this.fail(stream, pages.upstreamFailed);
	}

	/** Aborts a stream without telling the client (it reset it, or it is gone). */
	private fail(stream: HttpStream, page: PageOptions): void {
		if (stream.done) {
			return;
		}
		stream.settleHead({ ok: false, page });
		try {
			stream.controller?.error(new Error(page.title));
		} catch {
			// Already closed or errored.
		}
		this.close(stream);
	}

	private close(stream: HttpStream): void {
		stream.done = true;
		stream.queue = [];
		this.http.delete(stream.id);
		stream.wakeUploader?.();
	}

	// ---------------------------------------------------------------------------
	// Public WebSockets

	private async proxyWebSocket(request: Request): Promise<Response> {
		if (!(await this.liveClient())) {
			return new Response("Tunnel offline", { status: 502 });
		}
		if (this.streamCount() >= MAX_STREAMS) {
			return new Response("Tunnel busy", { status: 503 });
		}

		const offered = parseSubprotocols(request.headers.get("sec-websocket-protocol"));
		if (!offered) {
			return new Response("Invalid Sec-WebSocket-Protocol header", { status: 400 });
		}
		const id = await this.allocateStream();
		const accepted = new Promise<Response>((settle) => {
			this.pendingWebSockets.set(id, { offered, settle });
		});

		const url = new URL(request.url);
		this.sendFrame(
			FrameType.Open,
			id,
			encodeOpen({
				method: request.method,
				path: url.pathname + url.search,
				headers: stripWebSocketHandshake(forwardedRequestHeaders(request.headers)),
				body: false,
				websocket: offered,
			}),
		);

		const response = await withTimeout(accepted, RESPONSE_TIMEOUT_MS);
		if (response) {
			return response;
		}
		this.pendingWebSockets.delete(id);
		this.sendFrame(FrameType.Reset, id, encodeText("response timeout"));
		return new Response("Local server timed out", { status: 504 });
	}

	/**
	 * Runs inside the HEAD frame handler, so the public socket is accepted before
	 * any following DATA frame for this stream is processed.
	 */
	private settleWebSocket(id: number, head: HeadMessage): void {
		const pending = this.pendingWebSockets.get(id);
		if (!pending) {
			return;
		}
		this.pendingWebSockets.delete(id);

		if (head.status !== 101) {
			const status = head.status >= 200 && !NULL_BODY_STATUSES.has(head.status) ? head.status : 502;
			pending.settle(new Response(null, { status, headers: publicResponseHeaders(head.headers, false) }));
			return;
		}
		if (head.protocol !== undefined && !pending.offered.includes(head.protocol)) {
			this.sendFrame(FrameType.Reset, id, encodeText("server selected a subprotocol that was not offered"));
			pending.settle(new Response("Invalid WebSocket subprotocol", { status: 502 }));
			return;
		}

		const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
		this.ctx.acceptWebSocket(server, ["public", `s:${id}`]);
		server.serializeAttachment({ kind: "public", stream: id } satisfies PublicAttachment);
		const headers = new Headers();
		if (head.protocol) {
			headers.set("sec-websocket-protocol", head.protocol);
		}
		pending.settle(new Response(null, { status: 101, webSocket: client, headers }));
	}

	private fromPublic(ws: WebSocket, id: number, message: string | ArrayBuffer): void {
		if (!this.client()) {
			safeClose(ws, 1001, "tunnel disconnected");
			return;
		}
		const text = typeof message === "string";
		const payload = text ? encodeText(message) : new Uint8Array(message);
		if (payload.byteLength > MAX_WEBSOCKET_MESSAGE_BYTES) {
			safeClose(ws, 1009, "message too big");
			this.sendFrame(FrameType.End, id, encodeClose({ code: 1009, reason: "message too big" }));
			return;
		}
		this.sendFrame(text ? FrameType.Text : FrameType.Data, id, payload);
	}

	private publicSocket(id: number): WebSocket | undefined {
		return this.ctx.getWebSockets(`s:${id}`)[0];
	}
}

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/** Headers of the public request, as the local server should see them. */
export function forwardedRequestHeaders(headers: Headers): HeaderList {
	const list: HeaderList = [];
	for (const [name, value] of headers) {
		if (!name.startsWith("cf-") && name !== "cdn-loop" && name !== "host") {
			list.push([name, value]);
		}
	}
	return stripHopByHop(list);
}

/**
 * Headers of the local response, as the public client should see them.
 * Cookies lose their Domain attribute so a tunnel can only set cookies for its own host.
 */
export function publicResponseHeaders(list: HeaderList, streamed: boolean): Headers {
	const headers = new Headers();
	for (const [name, value] of stripHopByHop(list, streamed ? ["content-length"] : [])) {
		if (name.toLowerCase() === "set-cookie") {
			headers.append(name, withoutCookieDomain(value));
			continue;
		}
		headers.append(name, value);
	}
	return headers;
}

/** Drops the Domain attribute, parsed the way browsers do (RFC 6265 §5.2: names are trimmed, case-insensitive). */
export function withoutCookieDomain(cookie: string): string {
	const [pair = "", ...attributes] = cookie.split(";");
	const kept = attributes.filter((attribute) => attribute.split("=")[0]?.trim().toLowerCase() !== "domain");
	return [pair, ...kept].join(";");
}

function attachmentOf(ws: WebSocket): Attachment | null {
	return ws.deserializeAttachment() as Attachment | null;
}

function isStale(ctx: DurableObjectState, client: WebSocket): boolean {
	const attachment = attachmentOf(client);
	const lastSeen =
		ctx.getWebSocketAutoResponseTimestamp(client)?.getTime() ?? (attachment?.kind === "client" ? attachment.since : 0);
	return Date.now() - lastSeen > CLIENT_STALE_MS;
}

function safeClose(ws: WebSocket, code: number, reason: string): void {
	try {
		ws.close(sendableCloseCode(code), sendableCloseReason(reason));
	} catch {
		// Already closing or closed.
	}
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => resolve(undefined), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}
