import { DurableObject } from "cloudflare:workers";
import {
	CLOSE_INTERNAL_ERROR,
	CLOSE_MESSAGE_TOO_BIG,
	CLOSE_PROTOCOL_ERROR,
	CLOSE_TUNNEL_REPLACED,
	CLOSE_UNSUPPORTED_DATA,
	type ControlMessage,
	DATA_FLAG_WS_BINARY,
	DATA_FLAG_WS_TEXT,
	type DataKind,
	decodeControlMessage,
	decodeDataFrameView,
	defaultTunnelLimits,
	encodeControlMessage,
	encodeDataFrame,
	filterHttpRequestHeaders,
	filterResponseHeaders,
	filterWebSocketRequestHeaders,
	headersToEntries,
	isValidChannelId,
	normalizeWebSocketCloseCode,
	normalizeWebSocketCloseReason,
	selectDataChannel,
	utf8Decode,
	utf8Encode,
} from "@hostc/protocol";
import { type JsonLog, log } from "../log";
import { isWebSocketUpgrade } from "../router";
import { TunnelCreditController } from "./credit";

const STORAGE_CONNECTION_ID = "currentConnectionId";
const STORAGE_DATA_CHANNELS = "expectedDataChannels";
const SOCKET_BACKPRESSURE_HIGH_WATERMARK = 512 * 1024;
const SOCKET_BACKPRESSURE_LOW_WATERMARK = 128 * 1024;
const SOCKET_BACKPRESSURE_POLL_MS = 4;
const STREAM_RESPONSE_START_TIMEOUT_MS = 30_000;
const CONTROL_CREDIT_FLUSH_DELAY_MS = 50;
const INTERNAL_CONTROL_PATH = "/_hostc/control";
const INTERNAL_DATA_PATH = "/_hostc/data";

type ControlAttachment = {
	kind: "control";
	connectionId: string;
	dataChannels: number;
	createdAt: number;
};

type DataAttachment = {
	kind: "data";
	connectionId: string;
	channelId: number;
	createdAt: number;
};

type PublicAttachment = {
	kind: "public";
	streamId: number;
	createdAt: number;
};

type SocketAttachment = ControlAttachment | DataAttachment | PublicAttachment;

type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (reason?: unknown) => void;
};

type PendingFrame = {
	kind: DataKind;
	seq: number;
	flags: number;
	payload: Uint8Array;
};

type StreamState = {
	id: number;
	kind: "http" | "websocket";
	channelId: number;
	createdAt: number;
	requestUrl: string;
	responseStart: Deferred<ControlMessage>;
	responseController: ReadableStreamDefaultController<Uint8Array> | null;
	publicSocket: WebSocket | null;
	pendingFrames: PendingFrame[];
	pendingBytes: number;
	pendingGeneration: number;
	receiveNextSeq: Map<DataKind, number>;
	receiveEndSeq: Map<DataKind, number>;
	sendNextSeq: Map<DataKind, number>;
	sendChains: Map<DataKind, Promise<void>>;
	aborted: boolean;
};

export class HostcTunnel extends DurableObject<Env> {
	private currentConnectionId: string | null = null;
	private expectedDataChannels = 0;
	private nextStreamId = 1;
	private readonly streams = new Map<number, StreamState>();
	private pendingDataBytes = 0;
	private readonly credit = new TunnelCreditController(
		defaultTunnelLimits,
		CONTROL_CREDIT_FLUSH_DELAY_MS,
		(message) => this.sendControl(message),
		(promise) => this.ctx.waitUntil(promise),
		(error) =>
			this.log({ event: "credit.grant.failed", error: errorMessage(error) }),
	);

	async fetch(request: Request): Promise<Response> {
		await this.loadConnectionState();
		const url = new URL(request.url);

		if (url.pathname === INTERNAL_CONTROL_PATH) {
			return this.handleControlConnect(request, url);
		}
		if (url.pathname === INTERNAL_DATA_PATH) {
			return this.handleDataConnect(request, url);
		}

		return isWebSocketUpgrade(request)
			? this.handlePublicWebSocket(request)
			: this.handlePublicHttp(request);
	}

	async webSocketMessage(
		ws: WebSocket,
		message: string | ArrayBuffer,
	): Promise<void> {
		await this.loadConnectionState();
		const attachment = getAttachment(ws);
		if (!attachment) {
			ws.close(CLOSE_PROTOCOL_ERROR, "Missing socket attachment");
			return;
		}

		if (attachment.kind === "control") {
			await this.handleControlMessage(ws, attachment, message);
			return;
		}
		if (attachment.kind === "data") {
			await this.handleDataMessage(ws, attachment, message);
			return;
		}
		await this.handlePublicSocketMessage(attachment.streamId, message);
	}

	async webSocketClose(
		ws: WebSocket,
		code: number,
		reason: string,
	): Promise<void> {
		await this.loadConnectionState();
		const attachment = getAttachment(ws);
		if (!attachment) {
			return;
		}

		if (
			attachment.kind === "control" &&
			attachment.connectionId === this.currentConnectionId
		) {
			await this.failConnection("control.close", code, reason);
			return;
		}
		if (
			attachment.kind === "data" &&
			attachment.connectionId === this.currentConnectionId
		) {
			await this.failConnection("data.close", code, reason);
			return;
		}
		if (attachment.kind === "public") {
			await this.handlePublicSocketClose(attachment.streamId, code, reason);
		}
	}

	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		await this.loadConnectionState();
		const attachment = getAttachment(ws);
		this.log({
			event: "socket.error",
			connectionId:
				attachment?.kind === "control" || attachment?.kind === "data"
					? attachment.connectionId
					: undefined,
			streamId: attachment?.kind === "public" ? attachment.streamId : undefined,
			error: error instanceof Error ? error.message : String(error),
		});
		if (attachment?.kind === "control" || attachment?.kind === "data") {
			await this.failConnection(
				"socket.error",
				CLOSE_INTERNAL_ERROR,
				"socket error",
			);
		}
	}

	private async handleControlConnect(
		request: Request,
		url: URL,
	): Promise<Response> {
		if (!isWebSocketUpgrade(request)) {
			return jsonError("Expected WebSocket upgrade", 426);
		}

		const connectionId = url.searchParams.get("connectionId") ?? "";
		const dataChannels = Number(url.searchParams.get("dataChannels") ?? "0");
		if (!connectionId || !isValidDataChannelCount(dataChannels)) {
			return jsonError("Invalid connection parameters", 400);
		}

		await this.replaceConnection(connectionId, dataChannels);

		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];
		this.ctx.acceptWebSocket(server, ["control", `conn:${connectionId}`]);
		server.serializeAttachment({
			kind: "control",
			connectionId,
			dataChannels,
			createdAt: Date.now(),
		} satisfies ControlAttachment);

		this.log({ event: "connection.control.connected", connectionId });
		return new Response(null, { status: 101, webSocket: client });
	}

	private async handleDataConnect(
		request: Request,
		url: URL,
	): Promise<Response> {
		if (!isWebSocketUpgrade(request)) {
			return jsonError("Expected WebSocket upgrade", 426);
		}

		const connectionId = url.searchParams.get("connectionId") ?? "";
		const channelId = Number(url.searchParams.get("channel") ?? "-1");
		if (
			!this.currentConnectionId ||
			connectionId !== this.currentConnectionId ||
			!isValidChannelId(channelId, this.expectedDataChannels)
		) {
			return jsonError("Invalid data channel", 400);
		}

		for (const socket of this.ctx.getWebSockets(`ch:${channelId}`)) {
			const attachment = getAttachment(socket);
			if (
				attachment?.kind === "data" &&
				attachment.connectionId === connectionId
			) {
				socket.close(CLOSE_TUNNEL_REPLACED, "Data channel replaced");
			}
		}

		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];
		this.ctx.acceptWebSocket(server, [
			"data",
			`conn:${connectionId}`,
			`ch:${channelId}`,
		]);
		server.serializeAttachment({
			kind: "data",
			connectionId,
			channelId,
			createdAt: Date.now(),
		} satisfies DataAttachment);

		this.log({
			event: "connection.data.connected",
			connectionId,
			channelId,
			ready: this.isReady(),
		});
		return new Response(null, { status: 101, webSocket: client });
	}

	private async handlePublicHttp(request: Request): Promise<Response> {
		if (!this.isReady()) {
			return tunnelNotReadyResponse(request);
		}

		const stream = this.createStream("http", request);
		await this.sendControl({
			type: "request.start",
			id: stream.id,
			kind: "http",
			method: request.method,
			url: buildRequestTarget(request),
			headers: filterHttpRequestHeaders(headersToEntries(request.headers)),
			body: request.body !== null,
		});
		this.ctx.waitUntil(this.pumpPublicRequestBody(stream, request));

		let responseStart: ControlMessage;
		try {
			responseStart = await withTimeout(
				stream.responseStart.promise,
				STREAM_RESPONSE_START_TIMEOUT_MS,
				"Timed out waiting for local response",
			);
		} catch (error) {
			this.abortStream(stream, errorMessage(error));
			return jsonError("Local server unavailable", 502);
		}

		if (
			responseStart.type !== "response.start" ||
			responseStart.status < 200 ||
			responseStart.status === 101 ||
			(responseStart.body && !allowsHttpResponseBody(responseStart.status))
		) {
			this.abortStream(stream, "Invalid HTTP response start");
			return jsonError("Invalid tunnel response", 502);
		}

		const headers = new Headers();
		for (const [name, value] of filterResponseHeaders(responseStart.headers)) {
			headers.append(name, value);
		}
		if (!responseStart.body) {
			this.cleanupStream(stream.id);
			return new Response(null, { status: responseStart.status, headers });
		}

		const body = new ReadableStream<Uint8Array>({
			start: (controller) => {
				stream.responseController = controller;
				this.ctx.waitUntil(this.flushPendingFrames(stream));
			},
			cancel: () => this.abortPublicStream(stream, "public response cancelled"),
		});

		return new Response(body, { status: responseStart.status, headers });
	}

	private async handlePublicWebSocket(request: Request): Promise<Response> {
		if (!this.isReady()) {
			return jsonError("Tunnel not ready", 502);
		}

		const stream = this.createStream("websocket", request);
		const requestedProtocols = parseWebSocketProtocols(request);
		await this.sendControl({
			type: "request.start",
			id: stream.id,
			kind: "websocket",
			method: request.method,
			url: buildRequestTarget(request),
			headers: filterWebSocketRequestHeaders(headersToEntries(request.headers)),
			body: false,
			protocols: requestedProtocols,
		});

		let responseStart: ControlMessage;
		try {
			responseStart = await withTimeout(
				stream.responseStart.promise,
				STREAM_RESPONSE_START_TIMEOUT_MS,
				"Timed out waiting for local WebSocket accept",
			);
		} catch (error) {
			this.abortStream(stream, errorMessage(error));
			return jsonError("Local WebSocket unavailable", 502);
		}

		if (
			responseStart.type !== "response.start" ||
			responseStart.status !== 101 ||
			!isSelectedProtocolValid(responseStart.protocol, requestedProtocols)
		) {
			this.abortStream(stream, "Invalid WebSocket accept");
			return jsonError("Invalid WebSocket accept", 502);
		}

		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];
		this.ctx.acceptWebSocket(server, ["public", `stream:${stream.id}`]);
		server.serializeAttachment({
			kind: "public",
			streamId: stream.id,
			createdAt: Date.now(),
		} satisfies PublicAttachment);
		stream.publicSocket = server;
		await this.flushPendingFrames(stream);

		const headers = new Headers();
		if (responseStart.protocol) {
			headers.set("Sec-WebSocket-Protocol", responseStart.protocol);
		}
		return new Response(null, { status: 101, headers, webSocket: client });
	}

	private async handleControlMessage(
		ws: WebSocket,
		attachment: ControlAttachment,
		message: string | ArrayBuffer,
	): Promise<void> {
		if (
			attachment.connectionId !== this.currentConnectionId ||
			!this.isCurrentSocket(ws)
		) {
			ws.close(CLOSE_TUNNEL_REPLACED, "Old connection");
			return;
		}
		if (typeof message !== "string") {
			await this.failConnection(
				"protocol.error",
				CLOSE_PROTOCOL_ERROR,
				"Binary control message",
			);
			return;
		}

		const decoded = decodeControlMessage(message);
		if (!decoded) {
			await this.failConnection(
				"protocol.error",
				CLOSE_PROTOCOL_ERROR,
				"Invalid control message",
			);
			return;
		}

		await this.dispatchControlMessage(decoded);
	}

	private async dispatchControlMessage(message: ControlMessage): Promise<void> {
		switch (message.type) {
			case "response.start": {
				const stream = this.streams.get(message.id);
				if (!stream || stream.aborted) {
					return;
				}
				stream.responseStart.resolve(message);
				await this.flushPendingFrames(stream);
				return;
			}
			case "response.end": {
				const stream = this.streams.get(message.id);
				if (!stream || stream.aborted) {
					return;
				}
				stream.receiveEndSeq.set(message.kind, message.lastSeq);
				this.finishStreamDirection(
					stream,
					message.kind,
					message.code,
					message.reason,
				);
				return;
			}
			case "response.abort": {
				const stream = this.streams.get(message.id);
				if (stream) {
					this.abortStream(stream, message.reason);
				}
				return;
			}
			case "credit":
				this.credit.apply(message);
				return;
			default:
				await this.failConnection(
					"protocol.error",
					CLOSE_PROTOCOL_ERROR,
					"Unexpected control message",
				);
		}
	}

	private async handleDataMessage(
		ws: WebSocket,
		attachment: DataAttachment,
		message: string | ArrayBuffer,
	): Promise<void> {
		if (
			attachment.connectionId !== this.currentConnectionId ||
			!this.isCurrentSocket(ws)
		) {
			ws.close(CLOSE_TUNNEL_REPLACED, "Old connection");
			return;
		}
		if (typeof message === "string") {
			await this.failConnection(
				"protocol.error",
				CLOSE_UNSUPPORTED_DATA,
				"Text data channel message",
			);
			return;
		}

		const frame = decodeDataFrameView(new Uint8Array(message));
		if (!frame) {
			await this.failConnection(
				"protocol.error",
				CLOSE_PROTOCOL_ERROR,
				"Invalid data frame",
			);
			return;
		}
		if (
			selectDataChannel(frame.id, this.expectedDataChannels) !==
			attachment.channelId
		) {
			await this.failConnection(
				"protocol.error",
				CLOSE_PROTOCOL_ERROR,
				"Data frame on wrong channel",
			);
			return;
		}
		if (frame.kind !== "response.body" && frame.kind !== "ws.server") {
			await this.failConnection(
				"protocol.error",
				CLOSE_PROTOCOL_ERROR,
				"Unexpected data kind",
			);
			return;
		}

		const stream = this.streams.get(frame.id);
		if (!stream || stream.aborted) {
			return;
		}
		if (
			!this.credit.consumeInbound(stream.id, frame.kind, frame.payloadLength)
		) {
			await this.failConnection(
				"credit.violation",
				CLOSE_PROTOCOL_ERROR,
				"Credit violation",
			);
			return;
		}
		if (!this.checkReceiveSeq(stream, frame.kind, frame.seq)) {
			await this.failConnection(
				"protocol.error",
				CLOSE_PROTOCOL_ERROR,
				"Seq discontinuity",
			);
			return;
		}

		const pendingFrame: PendingFrame = {
			kind: frame.kind,
			seq: frame.seq,
			flags: frame.flags,
			payload: frame.payload,
		};
		if (!(await this.deliverFrame(stream, pendingFrame))) {
			this.enqueuePendingFrame(stream, pendingFrame);
		}
	}

	private async handlePublicSocketMessage(
		streamId: number,
		message: string | ArrayBuffer,
	): Promise<void> {
		const stream = this.streams.get(streamId);
		if (!stream || stream.kind !== "websocket" || stream.aborted) {
			return;
		}

		const isText = typeof message === "string";
		const payload = isText ? utf8Encode(message) : new Uint8Array(message);
		const limits = defaultTunnelLimits();
		if (payload.byteLength > limits.maxWebSocketMessageBytes) {
			stream.publicSocket?.close(
				CLOSE_MESSAGE_TOO_BIG,
				"WebSocket message too big",
			);
			const lastSeq = this.lastSentSeq(stream, "ws.client");
			await this.sendControl({
				type: "request.end",
				id: stream.id,
				kind: "ws.client",
				lastSeq,
				code: CLOSE_MESSAGE_TOO_BIG,
				reason: "WebSocket message too big",
			});
			this.cleanupStream(stream.id);
			return;
		}
		try {
			await this.enqueueStreamSend(stream, "ws.client", () =>
				this.sendDataPayload(
					stream,
					"ws.client",
					payload,
					isText ? DATA_FLAG_WS_TEXT : DATA_FLAG_WS_BINARY,
				),
			);
		} catch (error) {
			if (this.canSendForStream(stream)) {
				await this.failConnection(
					"public.websocket.send.failed",
					CLOSE_INTERNAL_ERROR,
					errorMessage(error),
				);
			}
		}
	}

	private async handlePublicSocketClose(
		streamId: number,
		code: number,
		reason: string,
	): Promise<void> {
		const stream = this.streams.get(streamId);
		if (!stream || stream.kind !== "websocket" || stream.aborted) {
			return;
		}
		const closeCode = normalizeWebSocketCloseCode(code);
		const closeReason = normalizeWebSocketCloseReason(reason);
		const lastSeq = this.lastSentSeq(stream, "ws.client");
		await this.sendControl({
			type: "request.end",
			id: stream.id,
			kind: "ws.client",
			lastSeq,
			code: closeCode,
			reason: closeReason,
		});
		stream.publicSocket?.close(closeCode, closeReason);
		this.cleanupStream(stream.id);
	}

	private createStream(
		kind: "http" | "websocket",
		request: Request,
	): StreamState {
		const streamId = this.nextStreamId;
		this.nextStreamId =
			this.nextStreamId === 0xffffffff ? 1 : this.nextStreamId + 1;
		const channelId = selectDataChannel(streamId, this.expectedDataChannels);
		const stream: StreamState = {
			id: streamId,
			kind,
			channelId,
			createdAt: Date.now(),
			requestUrl: buildRequestTarget(request),
			responseStart: deferred<ControlMessage>(),
			responseController: null,
			publicSocket: null,
			pendingFrames: [],
			pendingBytes: 0,
			pendingGeneration: 0,
			receiveNextSeq: new Map(),
			receiveEndSeq: new Map(),
			sendNextSeq: new Map(),
			sendChains: new Map(),
			aborted: false,
		};
		this.streams.set(streamId, stream);
		this.credit.seedStream(streamId);
		this.log({
			event: "stream.request.start",
			streamId,
			channelId,
			kind,
		});
		return stream;
	}

	private async pumpPublicRequestBody(
		stream: StreamState,
		request: Request,
	): Promise<void> {
		try {
			if (!request.body) {
				await this.sendControl({
					type: "request.end",
					id: stream.id,
					kind: "request.body",
					lastSeq: -1,
				});
				return;
			}

			const reader = request.body.getReader();
			for (;;) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				await this.sendDataPayload(stream, "request.body", value);
			}
			await this.sendControl({
				type: "request.end",
				id: stream.id,
				kind: "request.body",
				lastSeq: this.lastSentSeq(stream, "request.body"),
			});
		} catch (error) {
			const reason = errorMessage(error);
			if (this.canSendForStream(stream)) {
				await this.sendControl({
					type: "request.abort",
					id: stream.id,
					reason,
				}).catch(() => undefined);
			}
			this.abortStream(stream, reason);
		}
	}

	private async abortPublicStream(
		stream: StreamState,
		reason: string,
	): Promise<void> {
		if (this.canSendForStream(stream)) {
			await this.sendControl({
				type: "request.abort",
				id: stream.id,
				reason,
			}).catch(() => undefined);
		}
		this.abortStream(stream, reason);
	}

	private async sendDataPayload(
		stream: StreamState,
		kind: DataKind,
		payload: Uint8Array,
		flags = 0,
	): Promise<void> {
		const limits = defaultTunnelLimits();
		if (
			isWebSocketKind(kind) &&
			payload.byteLength > limits.maxWebSocketMessageBytes
		) {
			throw new Error("WebSocket message exceeds max message size");
		}
		for (let offset = 0; offset < payload.byteLength || offset === 0; ) {
			if (!this.canSendForStream(stream)) {
				throw new Error("Stream unavailable");
			}
			const chunk =
				payload.byteLength === 0
					? payload
					: payload.subarray(offset, offset + limits.maxFrameBytes);
			await this.credit.waitForOutbound(stream.id, kind, chunk.byteLength, () =>
				Boolean(this.streams.has(stream.id) && this.getControlSocket()),
			);
			if (!this.canSendForStream(stream)) {
				throw new Error("Stream unavailable");
			}
			const socket = this.getDataSocket(stream.channelId);
			if (!socket || socket.readyState !== WebSocket.OPEN) {
				throw new Error("Data channel unavailable");
			}
			await waitForSocketCapacity(socket);
			if (socket.readyState !== WebSocket.OPEN) {
				throw new Error("Data channel unavailable");
			}

			const seq = stream.sendNextSeq.get(kind) ?? 0;
			socket.send(
				toArrayBuffer(
					encodeDataFrame({
						kind,
						id: stream.id,
						seq,
						flags,
						payload: chunk,
					}),
				),
			);
			stream.sendNextSeq.set(kind, seq + 1);
			this.credit.decrementOutbound(stream.id, kind, chunk.byteLength);

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

	private async sendControl(message: ControlMessage): Promise<void> {
		const control = this.getControlSocket();
		if (!control || control.readyState !== WebSocket.OPEN) {
			throw new Error("Control socket unavailable");
		}
		control.send(encodeControlMessage(message));
	}

	private async deliverFrame(
		stream: StreamState,
		frame: PendingFrame,
	): Promise<boolean> {
		if (frame.kind === "response.body") {
			if (!stream.responseController) {
				return false;
			}
			stream.responseController.enqueue(frame.payload);
			this.credit.grantInbound(stream.id, frame.kind, frame.payload.byteLength);
			this.finishStreamDirection(stream, frame.kind);
			return true;
		}

		if (frame.kind === "ws.server") {
			if (
				!stream.publicSocket ||
				stream.publicSocket.readyState !== WebSocket.OPEN
			) {
				return false;
			}
			if (frame.flags === DATA_FLAG_WS_TEXT) {
				stream.publicSocket.send(utf8Decode(frame.payload));
			} else {
				stream.publicSocket.send(toArrayBuffer(frame.payload));
			}
			await waitForSocketCapacity(stream.publicSocket);
			if (stream.publicSocket.readyState !== WebSocket.OPEN) {
				return false;
			}
			this.credit.grantInbound(stream.id, frame.kind, frame.payload.byteLength);
			this.finishStreamDirection(stream, frame.kind);
			return true;
		}

		return true;
	}

	private async flushPendingFrames(stream: StreamState): Promise<void> {
		for (;;) {
			const frame = stream.pendingFrames[0];
			if (!frame) {
				break;
			}
			if (!(await this.deliverFrame(stream, frame))) {
				break;
			}
			stream.pendingFrames.shift();
			stream.pendingBytes -= frame.payload.byteLength;
			this.pendingDataBytes = Math.max(
				0,
				this.pendingDataBytes - frame.payload.byteLength,
			);
		}
	}

	private enqueuePendingFrame(stream: StreamState, frame: PendingFrame): void {
		const limits = defaultTunnelLimits();
		if (
			stream.pendingBytes + frame.payload.byteLength >
				limits.pendingDataBytes ||
			this.pendingDataBytes + frame.payload.byteLength > limits.pendingDataBytes
		) {
			this.abortStream(stream, "Pending data limit exceeded");
			return;
		}
		stream.pendingFrames.push(frame);
		stream.pendingBytes += frame.payload.byteLength;
		this.pendingDataBytes += frame.payload.byteLength;
		this.armPendingFrameTimeout(stream);
	}

	private armPendingFrameTimeout(stream: StreamState): void {
		const limits = defaultTunnelLimits();
		stream.pendingGeneration += 1;
		const generation = stream.pendingGeneration;
		this.ctx.waitUntil(
			sleep(limits.pendingDataTimeoutMs).then(() => {
				const current = this.streams.get(stream.id);
				if (
					current === stream &&
					stream.pendingGeneration === generation &&
					stream.pendingFrames.length > 0
				) {
					this.abortStream(stream, "Pending data timeout exceeded");
				}
			}),
		);
	}

	private finishStreamDirection(
		stream: StreamState,
		kind: DataKind,
		code?: number,
		reason?: string,
	): void {
		const endSeq = stream.receiveEndSeq.get(kind);
		if (endSeq === undefined) {
			return;
		}
		const nextSeq = stream.receiveNextSeq.get(kind) ?? 0;
		if (endSeq !== -1 && nextSeq <= endSeq) {
			return;
		}
		if (kind === "response.body") {
			stream.responseController?.close();
			this.cleanupStream(stream.id);
		}
		if (kind === "ws.server") {
			stream.publicSocket?.close(
				normalizeWebSocketCloseCode(code),
				normalizeWebSocketCloseReason(reason),
			);
			this.cleanupStream(stream.id);
		}
	}

	private abortStream(stream: StreamState, reason: string): void {
		if (stream.aborted || this.streams.get(stream.id) !== stream) {
			return;
		}
		stream.aborted = true;
		stream.responseStart.reject(new Error(reason));
		try {
			stream.responseController?.error(new Error(reason));
		} catch {
			// Controller may already be closed.
		}
		stream.publicSocket?.close(CLOSE_INTERNAL_ERROR, "Stream aborted");
		this.cleanupStream(stream.id);
		this.log({ event: "stream.abort", streamId: stream.id, reason });
	}

	private cleanupStream(streamId: number): void {
		const stream = this.streams.get(streamId);
		if (!stream) {
			return;
		}
		this.streams.delete(streamId);
		this.pendingDataBytes = Math.max(
			0,
			this.pendingDataBytes - stream.pendingBytes,
		);
		stream.pendingFrames = [];
		stream.pendingBytes = 0;
		this.credit.deleteStream(streamId);
		this.log({ event: "stream.end", streamId });
	}

	private async replaceConnection(
		connectionId: string,
		dataChannels: number,
	): Promise<void> {
		if (this.currentConnectionId) {
			this.closeConnectionSockets(
				this.currentConnectionId,
				CLOSE_TUNNEL_REPLACED,
				"Tunnel connection replaced",
			);
		}
		this.abortAllStreams("Tunnel connection replaced");
		this.currentConnectionId = connectionId;
		this.expectedDataChannels = dataChannels;
		await Promise.all([
			this.ctx.storage.put(STORAGE_CONNECTION_ID, connectionId),
			this.ctx.storage.put(STORAGE_DATA_CHANNELS, dataChannels),
		]);
		this.resetConnectionCredits();
	}

	private async failConnection(
		event: string,
		code: number,
		reason: string,
	): Promise<void> {
		if (!this.currentConnectionId) {
			return;
		}
		const connectionId = this.currentConnectionId;
		this.closeConnectionSockets(connectionId, code, reason);
		this.abortAllStreams(reason);
		this.currentConnectionId = null;
		this.expectedDataChannels = 0;
		await Promise.all([
			this.ctx.storage.delete(STORAGE_CONNECTION_ID),
			this.ctx.storage.delete(STORAGE_DATA_CHANNELS),
		]);
		this.resetConnectionCredits();
		this.log({ event: "connection.closed", connectionId, reason: event, code });
	}

	private closeConnectionSockets(
		connectionId: string,
		code: number,
		reason: string,
	): void {
		for (const socket of this.ctx.getWebSockets(`conn:${connectionId}`)) {
			socket.close(code, reason);
		}
	}

	private abortAllStreams(reason: string): void {
		for (const stream of [...this.streams.values()]) {
			this.abortStream(stream, reason);
		}
	}

	private isReady(): boolean {
		if (!this.currentConnectionId || this.expectedDataChannels < 1) {
			return false;
		}
		if (!this.getControlSocket()) {
			return false;
		}
		const seen = new Set<number>();
		for (const socket of this.ctx.getWebSockets(
			`conn:${this.currentConnectionId}`,
		)) {
			const attachment = getAttachment(socket);
			if (
				attachment?.kind === "data" &&
				attachment.connectionId === this.currentConnectionId &&
				socket.readyState === WebSocket.OPEN
			) {
				seen.add(attachment.channelId);
			}
		}
		if (seen.size !== this.expectedDataChannels) {
			return false;
		}
		for (
			let channelId = 0;
			channelId < this.expectedDataChannels;
			channelId += 1
		) {
			if (!seen.has(channelId)) {
				return false;
			}
		}
		return true;
	}

	private getControlSocket(): WebSocket | null {
		if (!this.currentConnectionId) {
			return null;
		}
		for (const socket of this.ctx.getWebSockets("control")) {
			const attachment = getAttachment(socket);
			if (
				attachment?.kind === "control" &&
				attachment.connectionId === this.currentConnectionId &&
				socket.readyState === WebSocket.OPEN
			) {
				return socket;
			}
		}
		return null;
	}

	private getDataSocket(channelId: number): WebSocket | null {
		if (!this.currentConnectionId) {
			return null;
		}
		for (const socket of this.ctx.getWebSockets(`ch:${channelId}`)) {
			const attachment = getAttachment(socket);
			if (
				attachment?.kind === "data" &&
				attachment.connectionId === this.currentConnectionId &&
				attachment.channelId === channelId &&
				socket.readyState === WebSocket.OPEN
			) {
				return socket;
			}
		}
		return null;
	}

	private isCurrentSocket(ws: WebSocket): boolean {
		const attachment = getAttachment(ws);
		if (!attachment || !this.currentConnectionId) {
			return false;
		}
		return (
			(attachment.kind === "control" || attachment.kind === "data") &&
			attachment.connectionId === this.currentConnectionId
		);
	}

	private canSendForStream(stream: StreamState): boolean {
		return (
			!stream.aborted &&
			this.streams.get(stream.id) === stream &&
			this.getControlSocket() !== null
		);
	}

	private async loadConnectionState(): Promise<void> {
		if (this.currentConnectionId !== null || this.expectedDataChannels > 0) {
			return;
		}
		const [connectionId, dataChannels] = await Promise.all([
			this.ctx.storage.get<string>(STORAGE_CONNECTION_ID),
			this.ctx.storage.get<number>(STORAGE_DATA_CHANNELS),
		]);
		this.currentConnectionId = connectionId ?? null;
		this.expectedDataChannels =
			typeof dataChannels === "number" ? dataChannels : 0;
		this.resetConnectionCredits();
	}

	private resetConnectionCredits(): void {
		this.credit.reset();
	}

	private checkReceiveSeq(
		stream: StreamState,
		kind: DataKind,
		seq: number,
	): boolean {
		const expected = stream.receiveNextSeq.get(kind) ?? 0;
		if (seq !== expected) {
			return false;
		}
		stream.receiveNextSeq.set(kind, expected + 1);
		return true;
	}

	private lastSentSeq(stream: StreamState, kind: DataKind): number {
		return (stream.sendNextSeq.get(kind) ?? 0) - 1;
	}

	private log(fields: JsonLog): void {
		log(fields);
	}
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((innerResolve, innerReject) => {
		resolve = innerResolve;
		reject = innerReject;
	});
	return { promise, resolve, reject };
}

function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	message: string,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
		promise.then(
			(value) => {
				clearTimeout(timeout);
				resolve(value);
			},
			(error) => {
				clearTimeout(timeout);
				reject(error);
			},
		);
	});
}

function getAttachment(ws: WebSocket): SocketAttachment | null {
	try {
		const attachment = ws.deserializeAttachment();
		return isAttachment(attachment) ? attachment : null;
	} catch {
		return null;
	}
}

function isAttachment(value: unknown): value is SocketAttachment {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	if (record.kind === "control") {
		return (
			typeof record.connectionId === "string" &&
			typeof record.dataChannels === "number" &&
			typeof record.createdAt === "number"
		);
	}
	if (record.kind === "data") {
		return (
			typeof record.connectionId === "string" &&
			typeof record.channelId === "number" &&
			typeof record.createdAt === "number"
		);
	}
	if (record.kind === "public") {
		return (
			typeof record.streamId === "number" &&
			typeof record.createdAt === "number"
		);
	}
	return false;
}

function isValidDataChannelCount(value: number): boolean {
	return Number.isInteger(value) && value >= 1 && value <= 8;
}

function buildRequestTarget(request: Request): string {
	const url = new URL(request.url);
	return `${url.pathname}${url.search}`;
}

function parseWebSocketProtocols(request: Request): string[] {
	return (request.headers.get("sec-websocket-protocol") ?? "")
		.split(",")
		.map((protocol) => protocol.trim())
		.filter(Boolean);
}

function isSelectedProtocolValid(
	protocol: string | undefined,
	requestedProtocols: readonly string[],
): boolean {
	return protocol === undefined || requestedProtocols.includes(protocol);
}

function tunnelNotReadyResponse(request: Request): Response {
	const accept = request.headers.get("accept") ?? "";
	if (accept.includes("text/html")) {
		return new Response(
			"<!doctype html><title>Tunnel not ready</title><h1>Tunnel not ready</h1>",
			{
				status: 502,
				headers: { "content-type": "text/html; charset=utf-8" },
			},
		);
	}
	return jsonError("Tunnel not ready", 502);
}

function jsonError(message: string, status: number): Response {
	return Response.json({ error: message }, { status });
}

function allowsHttpResponseBody(status: number): boolean {
	return status !== 204 && status !== 205 && status !== 304;
}

function isWebSocketKind(kind: DataKind): boolean {
	return kind === "ws.client" || kind === "ws.server";
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSocketCapacity(socket: WebSocket): Promise<void> {
	if (socket.bufferedAmount <= SOCKET_BACKPRESSURE_HIGH_WATERMARK) {
		return;
	}
	while (
		socket.readyState === WebSocket.OPEN &&
		socket.bufferedAmount > SOCKET_BACKPRESSURE_LOW_WATERMARK
	) {
		await sleep(SOCKET_BACKPRESSURE_POLL_MS);
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;
}
