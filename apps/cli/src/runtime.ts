import {
	CLOSE_INTERNAL_ERROR,
	CLOSE_MESSAGE_TOO_BIG,
	CLOSE_NORMAL,
	CLOSE_PROTOCOL_ERROR,
	type ControlMessage,
	DATA_FLAG_WS_BINARY,
	DATA_FLAG_WS_TEXT,
	type DataKind,
	decodeControlMessage,
	decodeDataFrameView,
	encodeControlMessage,
	encodeDataFrame,
	filterHttpRequestHeaders,
	filterResponseHeaders,
	filterWebSocketRequestHeaders,
	type HeaderEntry,
	headersToEntries,
	type RefreshTunnelResponse,
	selectDataChannel,
	utf8Decode,
	utf8Encode,
} from "@hostc/protocol";
import WebSocket, { type RawData } from "ws";
import { refreshTunnel } from "./api";
import { formatError } from "./redact";
import { RuntimeCreditController } from "./runtime-credit";
import { PendingDataBuffer, type PendingFrame } from "./runtime-pending";
import { DataChannelQueue } from "./runtime-queue";

type RequestInitWithDuplex = RequestInit & { duplex?: "half" };

export type TunnelClientOptions = {
	serverUrl: string;
	localOrigin: URL;
	tunnelId: string;
	publicUrl: string;
	connectionId: string;
	controlUrl: string;
	dataUrl: string;
	connectToken: string;
	refreshToken: string;
	dataChannels: number;
	limits: RefreshTunnelResponse["limits"];
	debug?: boolean;
};

type StreamState = {
	id: number;
	kind: "http" | "websocket";
	url: string;
	requestWriter: WritableStreamDefaultWriter<Uint8Array> | null;
	requestEndSeq: number | null;
	localWebSocket: WebSocket | null;
	localFetchAbortController: AbortController | null;
	sendNextSeq: Map<DataKind, number>;
	sendChains: Map<DataKind, Promise<void>>;
	receiveNextSeq: Map<DataKind, number>;
	aborted: boolean;
};

const DATA_SOCKET_BACKPRESSURE_HIGH_WATERMARK = 512 * 1024;
const DATA_SOCKET_BACKPRESSURE_LOW_WATERMARK = 128 * 1024;
const DATA_SOCKET_BACKPRESSURE_POLL_MS = 4;
const CONTROL_CREDIT_FLUSH_DELAY_MS = 50;

export class TunnelClient {
	private options: TunnelClientOptions;
	private control: WebSocket | null = null;
	private readonly dataChannels = new Map<number, WebSocket>();
	private readonly dataQueue = new DataChannelQueue();
	private readonly streams = new Map<number, StreamState>();
	private readonly initializingStreams = new Set<number>();
	private readonly pending: PendingDataBuffer;
	private readonly credit: RuntimeCreditController;
	private reconnectAbortController: AbortController | null = null;
	private closed = false;

	constructor(options: TunnelClientOptions) {
		this.options = options;
		this.pending = new PendingDataBuffer(
			options.limits.pendingDataBytes,
			options.limits.pendingDataTimeoutMs,
			(streamId) => this.streams.has(streamId),
			() => this.failConnection("pending data timeout"),
		);
		this.credit = new RuntimeCreditController(
			CONTROL_CREDIT_FLUSH_DELAY_MS,
			(message) => this.sendControl(message),
			(message) => this.debug(message),
		);
		this.resetConnectionCredits();
	}

	async run(): Promise<void> {
		let firstConnect = true;
		while (!this.closed) {
			try {
				await this.connectOnce();
				console.log(
					`Tunnel ready ${this.options.tunnelId} -> ${this.options.localOrigin.href}`,
				);
				if (firstConnect) {
					console.log(`Public URL: ${this.options.publicUrl}`);
					firstConnect = false;
				}
				await this.waitForDisconnect();
			} catch (error) {
				this.debug(`connection failed: ${formatError(error)}`);
			}
			if (!this.closed) {
				await this.reconnect();
			}
		}
	}

	close(): void {
		this.closed = true;
		this.reconnectAbortController?.abort();
		this.closeSockets(CLOSE_NORMAL, "closed");
		this.abortAllStreams("closed");
		this.wakeCreditWaiters();
	}

	forceReconnect(reason = "forced reconnect"): void {
		if (this.closed) {
			return;
		}
		this.closeSockets(CLOSE_INTERNAL_ERROR, reason);
		this.abortAllStreams(reason);
		this.wakeCreditWaiters();
	}

	private async connectOnce(): Promise<void> {
		this.resetConnectionCredits();
		this.control = await openWebSocket(
			this.options.controlUrl,
			this.options.connectToken,
		);
		this.control.on("message", (data, isBinary) => {
			void this.handleControlMessage(data, isBinary).catch((error) => {
				this.failConnection(formatError(error));
			});
		});
		this.control.on("close", (code, reason) =>
			this.failConnection(`control closed ${code} ${reason.toString()}`),
		);
		this.control.on("error", (error) => this.failConnection(error.message));

		await Promise.all(
			Array.from(
				{ length: this.options.dataChannels },
				async (_, channelId) => {
					const url = new URL(this.options.dataUrl);
					url.searchParams.set("channel", String(channelId));
					url.searchParams.set("connectionId", this.options.connectionId);
					const socket = await openWebSocket(
						url.toString(),
						this.options.connectToken,
					);
					socket.on("message", (data, isBinary) => {
						this.enqueueDataMessage(channelId, () =>
							this.handleDataMessage(channelId, data, isBinary),
						);
					});
					socket.on("close", (code, reason) =>
						this.failConnection(
							`data channel ${channelId} closed ${code} ${reason.toString()}`,
						),
					);
					socket.on("error", (error) => this.failConnection(error.message));
					this.dataChannels.set(channelId, socket);
				},
			),
		);
	}

	private waitForDisconnect(): Promise<void> {
		return new Promise((resolve) => {
			const done = () => resolve();
			this.control?.once("close", done);
			for (const socket of this.dataChannels.values()) {
				socket.once("close", done);
			}
		});
	}

	private async reconnect(): Promise<void> {
		this.closeSockets(CLOSE_INTERNAL_ERROR, "reconnect");
		this.abortAllStreams("reconnect");
		let delayMs = 500;
		while (!this.closed) {
			const controller = new AbortController();
			this.reconnectAbortController = controller;
			try {
				const refreshed = await refreshTunnel(
					this.options.serverUrl,
					this.options.tunnelId,
					this.options.refreshToken,
					this.options.dataChannels,
					fetch,
					{ signal: controller.signal },
				);
				this.options = {
					...this.options,
					...refreshed,
				};
				return;
			} catch (error) {
				if (this.closed) {
					return;
				}
				this.debug(`refresh failed: ${formatError(error)}`);
				await sleep(withJitter(delayMs));
				delayMs = Math.min(delayMs * 2, 10_000);
			} finally {
				if (this.reconnectAbortController === controller) {
					this.reconnectAbortController = null;
				}
			}
		}
	}

	private async handleControlMessage(
		data: RawData,
		isBinary: boolean,
	): Promise<void> {
		if (isBinary) {
			throw new Error("binary control message");
		}
		const message = decodeControlMessage(rawDataToString(data), {
			maxControlBytes: this.options.limits.maxControlBytes,
		});
		if (!message) {
			throw new Error("invalid control message");
		}

		switch (message.type) {
			case "request.start":
				await this.handleRequestStart(message);
				return;
			case "request.end":
				await this.handleRequestEnd(message);
				return;
			case "request.abort":
				this.abortStreamById(message.id, message.reason);
				return;
			case "credit":
				this.credit.apply(message);
				return;
			default:
				throw new Error(`unexpected control message ${message.type}`);
		}
	}

	private async handleRequestStart(
		message: Extract<ControlMessage, { type: "request.start" }>,
	): Promise<void> {
		this.initializingStreams.add(message.id);
		const stream: StreamState = {
			id: message.id,
			kind: message.kind,
			url: message.url,
			requestWriter: null,
			requestEndSeq: null,
			localWebSocket: null,
			localFetchAbortController: null,
			sendNextSeq: new Map(),
			sendChains: new Map(),
			receiveNextSeq: new Map(),
			aborted: false,
		};
		this.streams.set(stream.id, stream);
		this.seedStreamCredit(stream.id);

		if (message.kind === "http") {
			await this.startHttpProxy(stream, message);
		} else {
			await this.startWebSocketProxy(stream, message);
		}

		const channelId = selectDataChannel(stream.id, this.options.dataChannels);
		this.enqueueDataMessage(channelId, async () => {
			try {
				const pendingFrames = this.pending.takeFrames(stream.id);
				for (const frame of pendingFrames) {
					await this.dispatchDataFrame(stream, frame);
				}
				const pendingEnds = this.pending.takeEnds(stream.id);
				for (const end of pendingEnds) {
					if (end.type === "request.end") {
						await this.handleRequestEnd(end);
					}
				}
				this.pending.clearTimer(stream.id);
			} finally {
				this.initializingStreams.delete(stream.id);
			}
		});
	}

	private async startHttpProxy(
		stream: StreamState,
		message: Extract<ControlMessage, { type: "request.start" }>,
	): Promise<void> {
		const abortController = new AbortController();
		stream.localFetchAbortController = abortController;
		let body: ReadableStream<Uint8Array> | undefined;
		if (message.body) {
			const bodyStream = new TransformStream<Uint8Array, Uint8Array>();
			stream.requestWriter = bodyStream.writable.getWriter();
			body = bodyStream.readable;
		}
		const requestInit: RequestInitWithDuplex = {
			method: message.method,
			headers: new Headers(
				filterHttpRequestHeaders(
					rewriteLocalRequestHeaders(
						message.headers,
						this.options.publicUrl,
						this.options.localOrigin,
					),
				).map(([name, value]) => [name, value]),
			),
			body,
			signal: abortController.signal,
			duplex: body ? "half" : undefined,
			redirect: "manual",
		};

		void fetch(new URL(message.url, this.options.localOrigin), requestInit)
			.then(async (response) => {
				if (!this.canSendForStream(stream)) {
					return;
				}
				await this.sendControl({
					type: "response.start",
					id: stream.id,
					status: response.status,
					headers: filterResponseHeaders(headersToEntries(response.headers)),
					body: response.body !== null,
				});
				if (response.body) {
					const reader = response.body.getReader();
					for (;;) {
						const { done, value } = await reader.read();
						if (done) {
							break;
						}
						if (!this.canSendForStream(stream)) {
							return;
						}
						await this.sendDataPayload(stream, "response.body", value);
					}
				}
				if (!this.canSendForStream(stream)) {
					return;
				}
				await this.sendControl({
					type: "response.end",
					id: stream.id,
					kind: "response.body",
					lastSeq: this.lastSentSeq(stream, "response.body"),
				});
				this.cleanupStream(stream.id);
			})
			.catch(async (error) => {
				this.debug(`local fetch failed: ${formatError(error)}`);
				if (this.canSendForStream(stream)) {
					await this.sendControl({
						type: "response.abort",
						id: stream.id,
						reason: formatError(error),
					});
				}
				this.cleanupStream(stream.id);
			});
	}

	private async startWebSocketProxy(
		stream: StreamState,
		message: Extract<ControlMessage, { type: "request.start" }>,
	): Promise<void> {
		const url = new URL(message.url, this.options.localOrigin);
		url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
		const socket = new WebSocket(url, message.protocols ?? [], {
			headers: Object.fromEntries(
				filterWebSocketRequestHeaders(
					rewriteLocalRequestHeaders(
						message.headers,
						this.options.publicUrl,
						this.options.localOrigin,
					),
				),
			),
		});
		let opened = false;
		let failed = false;
		stream.localWebSocket = socket;
		socket.on("open", () => {
			opened = true;
			void this.sendControl({
				type: "response.start",
				id: stream.id,
				status: 101,
				headers: [],
				body: false,
				protocol: socket.protocol || undefined,
			}).catch(() => undefined);
		});
		socket.on("message", (data, isBinary) => {
			const payload = rawDataToUint8Array(data);
			if (payload.byteLength > this.options.limits.maxWebSocketMessageBytes) {
				socket.close(CLOSE_MESSAGE_TOO_BIG, "WebSocket message too big");
				return;
			}
			void this.enqueueStreamSend(stream, "ws.server", () =>
				this.sendDataPayload(
					stream,
					"ws.server",
					payload,
					isBinary ? DATA_FLAG_WS_BINARY : DATA_FLAG_WS_TEXT,
				),
			).catch((error) => {
				if (this.canSendForStream(stream)) {
					this.failConnection(formatError(error));
				}
			});
		});
		socket.on("close", (code, reason) => {
			if (opened && !failed && this.canSendForStream(stream)) {
				void this.sendControl({
					type: "response.end",
					id: stream.id,
					kind: "ws.server",
					lastSeq: this.lastSentSeq(stream, "ws.server"),
					code,
					reason: reason.toString(),
				}).catch(() => undefined);
			}
			this.cleanupStream(stream.id);
		});
		socket.on("error", (error) => {
			failed = true;
			if (this.canSendForStream(stream)) {
				void this.sendControl({
					type: "response.abort",
					id: stream.id,
					reason: error.message,
				}).catch(() => undefined);
			}
		});
	}

	private async handleRequestEnd(
		message: Extract<ControlMessage, { type: "request.end" }>,
	): Promise<void> {
		const stream = this.streams.get(message.id);
		if (!stream) {
			this.pending.addEnd(message.id, message);
			return;
		}
		stream.requestEndSeq = message.lastSeq;
		this.finishIncomingDirection(
			stream,
			message.kind,
			message.code,
			message.reason,
		);
	}

	private async handleDataMessage(
		channelId: number,
		data: RawData,
		isBinary: boolean,
	): Promise<void> {
		if (!isBinary) {
			throw new Error("text data channel message");
		}
		const frame = decodeDataFrameView(rawDataToUint8Array(data), {
			maxFrameBytes: this.options.limits.maxFrameBytes,
		});
		if (!frame) {
			throw new Error("invalid data frame");
		}
		if (frame.kind !== "request.body" && frame.kind !== "ws.client") {
			throw new Error("unexpected data kind");
		}
		if (selectDataChannel(frame.id, this.options.dataChannels) !== channelId) {
			throw new Error("data frame on wrong channel");
		}
		const stream = this.streams.get(frame.id);
		const pending: PendingFrame = {
			kind: frame.kind,
			seq: frame.seq,
			flags: frame.flags,
			payload: frame.payload,
		};
		if (!stream || this.initializingStreams.has(frame.id)) {
			this.pending.addFrame(frame.id, pending);
			return;
		}
		await this.dispatchDataFrame(stream, pending);
	}

	private async dispatchDataFrame(
		stream: StreamState,
		frame: PendingFrame,
	): Promise<void> {
		if (!this.checkReceiveSeq(stream, frame.kind, frame.seq)) {
			throw new Error("seq discontinuity");
		}
		if (frame.kind === "request.body") {
			await stream.requestWriter?.write(frame.payload);
			await this.grantCredit(stream.id, frame.kind, frame.payload.byteLength);
			this.finishIncomingDirection(stream, frame.kind);
			return;
		}
		if (frame.kind === "ws.client") {
			const socket = stream.localWebSocket;
			if (!socket) {
				throw new Error("local websocket unavailable");
			}
			await waitForOpenWebSocket(
				socket,
				this.options.limits.pendingDataTimeoutMs,
			);
			if (frame.flags === DATA_FLAG_WS_TEXT) {
				socket.send(utf8Decode(frame.payload));
			} else {
				socket.send(frame.payload);
			}
			if (await waitForSocketCapacity(socket)) {
				this.debug("local websocket bufferedAmount wait");
			}
			if (socket.readyState !== WebSocket.OPEN) {
				throw new Error("local websocket unavailable");
			}
			await this.grantCredit(stream.id, frame.kind, frame.payload.byteLength);
			this.finishIncomingDirection(stream, frame.kind);
		}
	}

	private enqueueDataMessage(
		channelId: number,
		task: () => Promise<void>,
	): Promise<void> {
		const next = this.dataQueue.enqueue(channelId, task);
		void next.catch((error) => {
			this.failConnection(formatError(error));
		});
		return next;
	}

	private finishIncomingDirection(
		stream: StreamState,
		kind: "request.body" | "ws.client",
		code?: number,
		reason?: string,
	): void {
		if (stream.requestEndSeq === null) {
			return;
		}
		const next = stream.receiveNextSeq.get(kind) ?? 0;
		if (stream.requestEndSeq !== -1 && next <= stream.requestEndSeq) {
			return;
		}
		if (kind === "request.body") {
			void stream.requestWriter?.close();
		} else {
			stream.localWebSocket?.close(code ?? CLOSE_NORMAL, reason);
		}
	}

	private async sendDataPayload(
		stream: StreamState,
		kind: DataKind,
		payload: Uint8Array,
		flags = 0,
	): Promise<void> {
		if (
			isWebSocketKind(kind) &&
			payload.byteLength > this.options.limits.maxWebSocketMessageBytes
		) {
			throw new Error("websocket message exceeds max message size");
		}
		for (let offset = 0; offset < payload.byteLength || offset === 0; ) {
			if (!this.canSendForStream(stream)) {
				throw new Error("stream unavailable");
			}
			const chunk =
				payload.byteLength === 0
					? payload
					: payload.subarray(
							offset,
							offset + this.options.limits.maxFrameBytes,
						);
			await this.waitForCredit(stream.id, kind, chunk.byteLength);
			if (!this.canSendForStream(stream)) {
				throw new Error("stream unavailable");
			}
			const channelId = selectDataChannel(stream.id, this.options.dataChannels);
			const socket = this.dataChannels.get(channelId);
			if (!socket || socket.readyState !== WebSocket.OPEN) {
				throw new Error("data channel unavailable");
			}
			if (await waitForSocketCapacity(socket)) {
				this.debug("dataChannel bufferedAmount wait");
			}
			if (socket.readyState !== WebSocket.OPEN) {
				throw new Error("data channel unavailable");
			}
			const seq = stream.sendNextSeq.get(kind) ?? 0;
			socket.send(
				encodeDataFrame({
					kind,
					id: stream.id,
					seq,
					flags,
					payload: chunk,
				}),
			);
			stream.sendNextSeq.set(kind, seq + 1);
			this.credit.consume(stream.id, kind, chunk.byteLength);
			if (payload.byteLength === 0) {
				break;
			}
			offset += chunk.byteLength;
		}
	}

	private enqueueStreamSend(
		stream: StreamState,
		kind: DataKind,
		task: () => Promise<void>,
	): Promise<void> {
		const previous = stream.sendChains.get(kind) ?? Promise.resolve();
		const next = previous.catch(() => undefined).then(task);
		const current = next.finally(() => {
			if (stream.sendChains.get(kind) === current) {
				stream.sendChains.delete(kind);
			}
		});
		stream.sendChains.set(kind, current);
		return next;
	}

	private canSendForStream(stream: StreamState): boolean {
		return (
			!stream.aborted &&
			this.streams.get(stream.id) === stream &&
			this.control?.readyState === WebSocket.OPEN
		);
	}

	private async sendControl(message: ControlMessage): Promise<void> {
		if (!this.control || this.control.readyState !== WebSocket.OPEN) {
			throw new Error("control socket unavailable");
		}
		this.control.send(encodeControlMessage(message));
	}

	private async grantCredit(
		streamId: number,
		kind: DataKind,
		bytes: number,
	): Promise<void> {
		this.credit.grant(streamId, kind, bytes);
	}

	private waitForCredit(
		streamId: number,
		kind: DataKind,
		bytes: number,
	): Promise<void> {
		return this.credit.waitFor(streamId, kind, bytes, () =>
			Boolean(
				!this.closed &&
					this.streams.has(streamId) &&
					this.control?.readyState === WebSocket.OPEN,
			),
		);
	}

	private resetConnectionCredits(): void {
		this.credit.reset(this.options.limits.connectionCreditBytes);
	}

	private seedStreamCredit(streamId: number): void {
		this.credit.seedStream(streamId, this.options.limits.streamCreditBytes);
	}

	private checkReceiveSeq(
		stream: StreamState,
		kind: DataKind,
		seq: number,
	): boolean {
		const expected = stream.receiveNextSeq.get(kind) ?? 0;
		if (seq !== expected) {
			throw new Error(
				`seq discontinuity stream=${stream.id} kind=${kind} expected=${expected} actual=${seq}`,
			);
		}
		stream.receiveNextSeq.set(kind, expected + 1);
		return true;
	}

	private lastSentSeq(stream: StreamState, kind: DataKind): number {
		return (stream.sendNextSeq.get(kind) ?? 0) - 1;
	}

	private clearPendingState(): void {
		this.pending.clearAll();
	}

	private cleanupStream(streamId: number): void {
		this.streams.delete(streamId);
		this.initializingStreams.delete(streamId);
		this.credit.deleteStream(streamId);
	}

	private abortStreamById(streamId: number, reason: string): void {
		const stream = this.streams.get(streamId);
		if (!stream) {
			return;
		}
		stream.aborted = true;
		stream.localFetchAbortController?.abort(new Error(reason));
		stream.localWebSocket?.close(CLOSE_INTERNAL_ERROR, reason);
		void stream.requestWriter?.abort(new Error(reason));
		this.cleanupStream(streamId);
	}

	private abortAllStreams(reason: string): void {
		for (const streamId of this.streams.keys()) {
			this.abortStreamById(streamId, reason);
		}
		this.clearPendingState();
	}

	private failConnection(reason: string): void {
		this.debug(reason);
		this.closeSockets(CLOSE_PROTOCOL_ERROR, reason);
		this.abortAllStreams(reason);
		this.wakeCreditWaiters();
	}

	private closeSockets(code: number, reason: string): void {
		this.control?.close(code, reason);
		this.control = null;
		for (const socket of this.dataChannels.values()) {
			socket.close(code, reason);
		}
		this.dataChannels.clear();
		this.dataQueue.clear();
		this.credit.close();
	}

	private wakeCreditWaiters(): void {
		this.credit.wakeWaiters();
	}

	private debug(message: string): void {
		if (this.options.debug) {
			console.error(`[hostc:debug] ${message}`);
		}
	}
}

export function withJitter(delayMs: number, jitterRatio = 0.2): number {
	const spread = delayMs * jitterRatio;
	return Math.max(0, Math.round(delayMs - spread + Math.random() * spread * 2));
}

function openWebSocket(url: string, token: string): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(url, {
			headers: { authorization: `Bearer ${token}` },
		});
		socket.once("open", () => resolve(socket));
		socket.once("error", reject);
		socket.once("close", (code, reason) => {
			if (socket.readyState !== WebSocket.OPEN) {
				reject(
					new Error(
						`WebSocket closed before open: ${code} ${reason.toString()}`,
					),
				);
			}
		});
	});
}

function rewriteLocalRequestHeaders(
	headers: readonly HeaderEntry[],
	publicUrl: string,
	localOrigin: URL,
): HeaderEntry[] {
	const publicOrigin = new URL(publicUrl).origin;
	let sawAcceptEncoding = false;
	const rewritten: HeaderEntry[] = [];
	for (const [name, value] of headers) {
		const lowerName = name.toLowerCase();
		if (lowerName === "accept-encoding") {
			sawAcceptEncoding = true;
			rewritten.push([name, "identity"]);
			continue;
		}
		if (lowerName === "origin" && value === publicOrigin) {
			rewritten.push([name, localOrigin.origin]);
			continue;
		}
		if (lowerName === "referer") {
			const rewrittenValue = rewriteSameOriginUrl(
				value,
				publicOrigin,
				localOrigin,
			);
			rewritten.push([name, rewrittenValue]);
			continue;
		}
		rewritten.push([name, value]);
	}
	if (!sawAcceptEncoding) {
		rewritten.push(["accept-encoding", "identity"]);
	}
	return rewritten;
}

function rewriteSameOriginUrl(
	value: string,
	publicOrigin: string,
	localOrigin: URL,
): string {
	try {
		const url = new URL(value);
		if (url.origin !== publicOrigin) {
			return value;
		}
		const localUrl = new URL(
			`${url.pathname}${url.search}${url.hash}`,
			localOrigin,
		);
		return localUrl.href;
	} catch {
		return value;
	}
}

function isWebSocketKind(kind: DataKind): boolean {
	return kind === "ws.client" || kind === "ws.server";
}

function rawDataToString(data: RawData): string {
	if (typeof data === "string") {
		return data;
	}
	if (Array.isArray(data)) {
		return Buffer.concat(data).toString("utf8");
	}
	if (data instanceof ArrayBuffer) {
		return Buffer.from(data).toString("utf8");
	}
	return Buffer.from(data).toString("utf8");
}

function rawDataToUint8Array(data: RawData): Uint8Array {
	if (typeof data === "string") {
		return utf8Encode(data);
	}
	if (Array.isArray(data)) {
		return new Uint8Array(Buffer.concat(data));
	}
	if (data instanceof ArrayBuffer) {
		return new Uint8Array(data);
	}
	return new Uint8Array(data);
}

async function waitForSocketCapacity(socket: WebSocket): Promise<boolean> {
	if (socket.bufferedAmount <= DATA_SOCKET_BACKPRESSURE_HIGH_WATERMARK) {
		return false;
	}
	while (
		socket.readyState === WebSocket.OPEN &&
		socket.bufferedAmount > DATA_SOCKET_BACKPRESSURE_LOW_WATERMARK
	) {
		await sleep(DATA_SOCKET_BACKPRESSURE_POLL_MS);
	}
	return true;
}

function waitForOpenWebSocket(
	socket: WebSocket,
	timeoutMs: number,
): Promise<void> {
	if (socket.readyState === WebSocket.OPEN) {
		return Promise.resolve();
	}
	if (socket.readyState !== WebSocket.CONNECTING) {
		return Promise.reject(new Error("local websocket unavailable"));
	}
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error("local websocket unavailable"));
		}, timeoutMs);
		const cleanup = () => {
			clearTimeout(timeout);
			socket.off("open", onOpen);
			socket.off("error", onError);
			socket.off("close", onClose);
		};
		const onOpen = () => {
			cleanup();
			resolve();
		};
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};
		const onClose = () => {
			cleanup();
			reject(new Error("local websocket unavailable"));
		};
		socket.once("open", onOpen);
		socket.once("error", onError);
		socket.once("close", onClose);
	});
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
