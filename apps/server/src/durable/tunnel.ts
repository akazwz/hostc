import { DurableObject } from "cloudflare:workers";
import {
	type ChannelCreditMetadata,
	CLOSE_CLIENT_CONNECTION_REPLACED,
	CLOSE_INTERNAL_ERROR,
	CLOSE_MESSAGE_TOO_BIG,
	CLOSE_PROTOCOL_ERROR,
	CLOSE_UNSUPPORTED_DATA,
	chooseNextDataChannel,
	type DataKind,
	type DecodedFrame,
	decodeFrameView,
	decodeMetadata,
	defaultTunnelLimits,
	encodeFrame,
	encodeMetadata,
	FRAME_FLAG_NONE,
	FRAME_FLAG_WS_BINARY,
	FRAME_FLAG_WS_TEXT,
	FRAME_TYPE_CHANNEL_CREDIT,
	FRAME_TYPE_REQUEST_ABORT,
	FRAME_TYPE_REQUEST_DATA,
	FRAME_TYPE_REQUEST_END,
	FRAME_TYPE_REQUEST_START,
	FRAME_TYPE_RESPONSE_ABORT,
	FRAME_TYPE_RESPONSE_DATA,
	FRAME_TYPE_RESPONSE_END,
	FRAME_TYPE_RESPONSE_START,
	FRAME_TYPE_STREAM_CREDIT,
	type FrameType,
	filterHttpRequestHeaders,
	filterResponseHeaders,
	filterWebSocketRequestHeaders,
	headersToEntries,
	isValidDataChannelCount,
	isValidFrameForDirection,
	normalizeWebSocketCloseCode,
	normalizeWebSocketCloseReason,
	type RequestAbortMetadata,
	type RequestEndMetadata,
	type RequestStartMetadata,
	type ResponseAbortMetadata,
	type ResponseEndMetadata,
	type ResponseStartMetadata,
	type StreamCreditMetadata,
	utf8Decode,
	utf8Encode,
} from "@hostc/protocol";
import { tunnelErrorResponse } from "../error-page";
import { type JsonLog, log } from "../log";
import { isWebSocketUpgrade } from "../router";
import { TunnelCreditController } from "./credit";

const STORAGE_CLIENT_CONNECTION_ID = "activeClientConnectionId";
const STORAGE_DATA_CHANNELS = "expectedDataChannels";
const STORAGE_NEXT_STREAM_ID = "nextStreamId";
const SOCKET_BACKPRESSURE_HIGH_WATERMARK = 512 * 1024;
const SOCKET_BACKPRESSURE_LOW_WATERMARK = 128 * 1024;
const SOCKET_BACKPRESSURE_POLL_MS = 4;
const STREAM_RESPONSE_START_TIMEOUT_MS = 30_000;
const EPHEMERAL_CONNECT_TIMEOUT_MS = 2 * 60 * 1000;
const INTERNAL_INIT_PATH = "/_hostc/init";
const INTERNAL_CHANNEL_PREFIX = "/_hostc/channels/";
const MAX_REMEMBERED_CLOSED_STREAMS = 4096;

type DataAttachment = {
	kind: "data";
	clientConnectionId: string;
	channelId: number;
	socketGeneration: number;
	createdAt: number;
};

type PublicAttachment = {
	kind: "public";
	streamId: string;
	createdAt: number;
};

type SocketAttachment = DataAttachment | PublicAttachment;

type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (reason?: unknown) => void;
};

type PendingFrame = {
	kind: "response.body" | "ws.server";
	seq: bigint;
	flags: number;
	payload: Uint8Array;
};

type StreamState = {
	id: bigint;
	kind: "http" | "websocket";
	channelId: number;
	createdAt: number;
	requestTarget: string;
	requestedProtocols: readonly string[];
	responseStart: Deferred<ResponseStartMetadata>;
	responseController: ReadableStreamDefaultController<Uint8Array> | null;
	publicSocket: WebSocket | null;
	pendingFrames: PendingFrame[];
	pendingBytes: number;
	pendingGeneration: number;
	receiveNextSeq: Map<DataKind, bigint>;
	receiveEndSeq: Map<DataKind, number>;
	sendNextSeq: Map<DataKind, bigint>;
	sendChains: Map<DataKind, Promise<void>>;
	aborted: boolean;
};

export class HostcTunnel extends DurableObject<Env> {
	private activeClientConnectionId: string | null = null;
	private expectedDataChannels = 0;
	private nextStreamId = 1n;
	private nextChannelIndex = 0;
	private socketGeneration = 0;
	private pendingDataBytes = 0;
	private readonly streams = new Map<bigint, StreamState>();
	private readonly closedStreamIds = new Set<string>();
	private readonly credit = new TunnelCreditController(
		defaultTunnelLimits,
		(channelId, frameType, streamId, metadata) =>
			this.sendMetadataFrameToChannel(channelId, frameType, streamId, metadata),
		(promise) => this.ctx.waitUntil(promise),
		(error) =>
			this.log({ event: "credit.grant.failed", error: errorMessage(error) }),
	);

	async fetch(request: Request): Promise<Response> {
		await this.loadConnectionState();
		const url = new URL(request.url);

		if (url.pathname === INTERNAL_INIT_PATH) {
			return this.handleInit(request);
		}
		if (url.pathname.startsWith(INTERNAL_CHANNEL_PREFIX)) {
			return this.handleChannelConnect(request, url);
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

		if (attachment.kind === "data") {
			await this.handleDataChannelMessage(ws, attachment, message);
			return;
		}
		await this.handlePublicSocketMessage(BigInt(attachment.streamId), message);
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
		if (attachment.kind === "data" && this.isCurrentSocket(ws)) {
			await this.failClientConnection("data.close", code, reason);
			return;
		}
		if (attachment.kind === "public") {
			await this.handlePublicSocketClose(
				BigInt(attachment.streamId),
				code,
				reason,
			);
		}
	}

	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		await this.loadConnectionState();
		const attachment = getAttachment(ws);
		this.log({
			event: "socket.error",
			clientConnectionId:
				attachment?.kind === "data" ? attachment.clientConnectionId : undefined,
			channelId: attachment?.kind === "data" ? attachment.channelId : undefined,
			streamId: attachment?.kind === "public" ? attachment.streamId : undefined,
			error: errorMessage(error),
		});
		if (attachment?.kind === "data" && this.isCurrentSocket(ws)) {
			await this.failClientConnection(
				"socket.error",
				CLOSE_INTERNAL_ERROR,
				"socket error",
			);
		}
	}

	async alarm(): Promise<void> {
		await this.loadConnectionState();
		if (!this.activeClientConnectionId) {
			await this.ctx.storage.deleteAlarm();
			return;
		}
		if (this.isReady()) {
			await this.ctx.storage.deleteAlarm();
			return;
		}
		await this.failClientConnection(
			"connect.timeout",
			CLOSE_INTERNAL_ERROR,
			"Tunnel connection timeout",
		);
	}

	private async handleInit(request: Request): Promise<Response> {
		if (request.method !== "POST") {
			return jsonError("Method not allowed", 405);
		}
		const body = (await request.json().catch(() => null)) as {
			clientConnectionId?: unknown;
			dataChannels?: unknown;
		} | null;
		if (
			!body ||
			typeof body.clientConnectionId !== "string" ||
			!isValidDataChannelCount(body.dataChannels)
		) {
			return jsonError("Invalid client connection", 400);
		}
		await this.replaceClientConnection(
			body.clientConnectionId,
			body.dataChannels,
		);
		return Response.json({ ok: true });
	}

	private async handleChannelConnect(
		request: Request,
		url: URL,
	): Promise<Response> {
		if (!isWebSocketUpgrade(request)) {
			return jsonError("Expected WebSocket upgrade", 426);
		}
		const channelId = Number(
			url.pathname.slice(INTERNAL_CHANNEL_PREFIX.length),
		);
		const clientConnectionId = url.searchParams.get("clientConnectionId") ?? "";
		if (
			!this.activeClientConnectionId ||
			clientConnectionId !== this.activeClientConnectionId ||
			!Number.isInteger(channelId) ||
			channelId < 0 ||
			channelId >= this.expectedDataChannels
		) {
			return jsonError("Invalid data channel", 400);
		}

		for (const socket of this.ctx.getWebSockets(`ch:${channelId}`)) {
			const attachment = getAttachment(socket);
			if (
				attachment?.kind === "data" &&
				attachment.clientConnectionId === clientConnectionId
			) {
				socket.close(CLOSE_CLIENT_CONNECTION_REPLACED, "Data channel replaced");
			}
		}

		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];
		this.ctx.acceptWebSocket(server, [
			"data",
			`conn:${clientConnectionId}`,
			`ch:${channelId}`,
		]);
		server.serializeAttachment({
			kind: "data",
			clientConnectionId,
			channelId,
			socketGeneration: this.nextSocketGeneration(),
			createdAt: Date.now(),
		} satisfies DataAttachment);

		this.log({
			event: "channel.connected",
			clientConnectionId,
			channelId,
			ready: this.isReady(),
		});
		if (this.isReady()) {
			await this.ctx.storage.deleteAlarm();
		}
		return new Response(null, { status: 101, webSocket: client });
	}

	private async handlePublicHttp(request: Request): Promise<Response> {
		if (!this.isReady()) {
			return tunnelNotReadyResponse(request);
		}

		const stream = await this.createStream("http", request);
		try {
			await this.sendMetadataFrame(stream, FRAME_TYPE_REQUEST_START, {
				kind: "http",
				method: request.method,
				target: buildRequestTarget(request),
				headers: filterHttpRequestHeaders(headersToEntries(request.headers)),
				hasBody: request.body !== null,
			} satisfies RequestStartMetadata);
		} catch (error) {
			this.abortStream(stream, errorMessage(error));
			return tunnelNotReadyResponse(request);
		}

		this.ctx.waitUntil(this.pumpPublicRequestBody(stream, request));

		let responseStart: ResponseStartMetadata;
		try {
			responseStart = await withTimeout(
				stream.responseStart.promise,
				STREAM_RESPONSE_START_TIMEOUT_MS,
				"Timed out waiting for local response",
			);
		} catch (error) {
			this.abortStream(stream, errorMessage(error));
			return tunnelErrorResponse(request, {
				status: 502,
				eyebrow: "502",
				title: "Local server unavailable",
				message:
					"The tunnel is connected, but hostc could not get a response from the local service.",
				hint: "Make sure your local server is running and try refreshing this page.",
			});
		}

		if (
			responseStart.status < 200 ||
			responseStart.status === 101 ||
			(responseStart.hasBody && !allowsHttpResponseBody(responseStart.status))
		) {
			this.abortStream(stream, "Invalid HTTP response start");
			return tunnelErrorResponse(request, {
				status: 502,
				eyebrow: "502",
				title: "Invalid tunnel response",
				message:
					"The local service returned a response that cannot be proxied by this tunnel.",
				hint: "Check the local server response and try again.",
			});
		}

		const headers = new Headers();
		for (const [name, value] of filterResponseHeaders(responseStart.headers)) {
			headers.append(name, value);
		}
		if (!responseStart.hasBody) {
			this.cleanupStream(stream.id);
			return new Response(null, { status: responseStart.status, headers });
		}

		const body = new ReadableStream<Uint8Array>({
			start: (controller) => {
				stream.responseController = controller;
				this.ctx.waitUntil(this.flushPendingFrames(stream));
			},
			pull: () => {
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

		const stream = await this.createStream("websocket", request);
		const requestedProtocols = parseWebSocketProtocols(request);
		stream.requestedProtocols = requestedProtocols;
		try {
			await this.sendMetadataFrame(stream, FRAME_TYPE_REQUEST_START, {
				kind: "websocket",
				method: request.method,
				target: buildRequestTarget(request),
				headers: filterWebSocketRequestHeaders(
					headersToEntries(request.headers),
				),
				hasBody: false,
				protocols: requestedProtocols,
			} satisfies RequestStartMetadata);
		} catch (error) {
			this.abortStream(stream, errorMessage(error));
			return jsonError("Tunnel not ready", 502);
		}

		let responseStart: ResponseStartMetadata;
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
			responseStart.status !== 101 ||
			!isSelectedProtocolValid(responseStart.protocol, requestedProtocols)
		) {
			this.abortStream(stream, "Invalid WebSocket accept");
			return jsonError("Invalid WebSocket accept", 502);
		}

		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];
		this.ctx.acceptWebSocket(server, [
			"public",
			`stream:${stream.id.toString()}`,
		]);
		server.serializeAttachment({
			kind: "public",
			streamId: stream.id.toString(),
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

	private async handleDataChannelMessage(
		ws: WebSocket,
		attachment: DataAttachment,
		message: string | ArrayBuffer,
	): Promise<void> {
		if (
			attachment.clientConnectionId !== this.activeClientConnectionId ||
			!this.isCurrentSocket(ws)
		) {
			ws.close(CLOSE_CLIENT_CONNECTION_REPLACED, "Old client connection");
			return;
		}
		if (typeof message === "string") {
			await this.failClientConnection(
				"protocol.error",
				CLOSE_UNSUPPORTED_DATA,
				"Text data channel message",
			);
			return;
		}

		let frame: DecodedFrame;
		try {
			frame = decodeFrameView(new Uint8Array(message), {
				maxFrameBytes: defaultTunnelLimits().maxFrameBytes,
			});
		} catch {
			await this.failClientConnection(
				"protocol.error",
				CLOSE_PROTOCOL_ERROR,
				"Invalid data frame",
			);
			return;
		}
		if (!isValidFrameForDirection(frame.frameType, "client-to-server")) {
			await this.failClientConnection(
				"protocol.error",
				CLOSE_PROTOCOL_ERROR,
				"Wrong frame direction",
			);
			return;
		}

		if (frame.frameType === FRAME_TYPE_CHANNEL_CREDIT) {
			const metadata = await this.decodeMetadataOrFail<ChannelCreditMetadata>(
				FRAME_TYPE_CHANNEL_CREDIT,
				frame.payload,
			);
			if (!metadata) {
				return;
			}
			this.credit.applyChannelCredit(attachment.channelId, metadata);
			return;
		}
		if (frame.frameType === FRAME_TYPE_STREAM_CREDIT) {
			const metadata = await this.decodeMetadataOrFail<StreamCreditMetadata>(
				FRAME_TYPE_STREAM_CREDIT,
				frame.payload,
			);
			if (!metadata) {
				return;
			}
			this.credit.applyStreamCredit(frame.streamId, metadata);
			return;
		}

		const stream = this.streams.get(frame.streamId);
		if (!stream) {
			if (
				this.closedStreamIds.has(frame.streamId.toString()) ||
				frame.streamId < this.nextStreamId
			) {
				this.log({
					event: "stream.stale_frame",
					streamId: frame.streamId.toString(),
					frameType: frame.frameType,
					channelId: attachment.channelId,
				});
				return;
			}
			await this.failClientConnection(
				"protocol.error",
				CLOSE_PROTOCOL_ERROR,
				"Unknown stream",
			);
			return;
		}
		if (stream.channelId !== attachment.channelId) {
			await this.failClientConnection(
				"protocol.error",
				CLOSE_PROTOCOL_ERROR,
				"Stream frame on wrong channel",
			);
			return;
		}

		await this.dispatchStreamFrame(stream, attachment.channelId, frame);
	}

	private async dispatchStreamFrame(
		stream: StreamState,
		channelId: number,
		frame: DecodedFrame,
	): Promise<void> {
		switch (frame.frameType) {
			case FRAME_TYPE_RESPONSE_START: {
				const metadata = await this.decodeMetadataOrFail<ResponseStartMetadata>(
					FRAME_TYPE_RESPONSE_START,
					frame.payload,
				);
				if (!metadata) {
					return;
				}
				stream.responseStart.resolve(metadata);
				await this.flushPendingFrames(stream);
				return;
			}
			case FRAME_TYPE_RESPONSE_DATA: {
				const kind = stream.kind === "http" ? "response.body" : "ws.server";
				if (stream.kind === "http" && frame.flags !== FRAME_FLAG_NONE) {
					await this.failClientConnection(
						"protocol.error",
						CLOSE_PROTOCOL_ERROR,
						"HTTP response data must not have WebSocket flags",
					);
					return;
				}
				if (
					stream.kind === "websocket" &&
					frame.flags !== FRAME_FLAG_WS_TEXT &&
					frame.flags !== FRAME_FLAG_WS_BINARY
				) {
					await this.failClientConnection(
						"protocol.error",
						CLOSE_PROTOCOL_ERROR,
						"WebSocket response data missing type flag",
					);
					return;
				}
				if (!this.checkReceiveEndBoundary(stream, kind, frame.seq)) {
					await this.failClientConnection(
						"protocol.error",
						CLOSE_PROTOCOL_ERROR,
						"Data after declared end",
					);
					return;
				}
				if (
					!this.credit.consumeInbound(
						stream.id,
						channelId,
						kind,
						frame.payload.byteLength,
					)
				) {
					await this.failClientConnection(
						"credit.violation",
						CLOSE_PROTOCOL_ERROR,
						"Credit violation",
					);
					return;
				}
				if (!this.checkReceiveSeq(stream, kind, frame.seq)) {
					await this.failClientConnection(
						"protocol.error",
						CLOSE_PROTOCOL_ERROR,
						"Seq discontinuity",
					);
					return;
				}
				const pendingFrame: PendingFrame = {
					kind,
					seq: frame.seq,
					flags: frame.flags,
					payload: frame.payload,
				};
				if (!(await this.deliverFrameOrAbort(stream, pendingFrame))) {
					this.enqueuePendingFrame(stream, pendingFrame);
				}
				return;
			}
			case FRAME_TYPE_RESPONSE_END: {
				const metadata = await this.decodeMetadataOrFail<ResponseEndMetadata>(
					FRAME_TYPE_RESPONSE_END,
					frame.payload,
				);
				if (!metadata) {
					return;
				}
				const expectedKind =
					stream.kind === "http" ? "response.body" : "ws.server";
				if (metadata.kind !== expectedKind) {
					await this.failClientConnection(
						"protocol.error",
						CLOSE_PROTOCOL_ERROR,
						"response end kind mismatch",
					);
					return;
				}
				if (!this.checkReceiveEndSeq(stream, metadata.kind, metadata.lastSeq)) {
					await this.failClientConnection(
						"protocol.error",
						CLOSE_PROTOCOL_ERROR,
						"lastSeq mismatch",
					);
					return;
				}
				stream.receiveEndSeq.set(metadata.kind, metadata.lastSeq);
				this.finishStreamDirection(
					stream,
					metadata.kind,
					metadata.code,
					metadata.reason,
				);
				this.armReceiveEndTimeout(stream, metadata.kind, metadata.lastSeq);
				return;
			}
			case FRAME_TYPE_RESPONSE_ABORT: {
				const metadata = await this.decodeMetadataOrFail<ResponseAbortMetadata>(
					FRAME_TYPE_RESPONSE_ABORT,
					frame.payload,
				);
				if (!metadata) {
					return;
				}
				this.abortStream(stream, metadata.reason);
				return;
			}
			default:
				await this.failClientConnection(
					"protocol.error",
					CLOSE_PROTOCOL_ERROR,
					"Unexpected stream frame",
				);
		}
	}

	private async handlePublicSocketMessage(
		streamId: bigint,
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
			await this.sendMetadataFrame(stream, FRAME_TYPE_REQUEST_END, {
				kind: "ws.client",
				lastSeq: this.lastSentSeq(stream, "ws.client"),
				code: CLOSE_MESSAGE_TOO_BIG,
				reason: "WebSocket message too big",
			} satisfies RequestEndMetadata);
			this.cleanupStream(stream.id);
			return;
		}
		try {
			await this.enqueueStreamSend(stream, "ws.client", () =>
				this.sendDataPayload(
					stream,
					"ws.client",
					payload,
					isText ? FRAME_FLAG_WS_TEXT : FRAME_FLAG_WS_BINARY,
				),
			);
		} catch (error) {
			if (this.canSendForStream(stream)) {
				await this.failClientConnection(
					"public.websocket.send.failed",
					CLOSE_INTERNAL_ERROR,
					errorMessage(error),
				);
			}
		}
	}

	private async handlePublicSocketClose(
		streamId: bigint,
		code: number,
		reason: string,
	): Promise<void> {
		const stream = this.streams.get(streamId);
		if (!stream || stream.kind !== "websocket" || stream.aborted) {
			return;
		}
		const closeCode = normalizeWebSocketCloseCode(code);
		const closeReason = normalizeWebSocketCloseReason(reason);
		await this.sendMetadataFrame(stream, FRAME_TYPE_REQUEST_END, {
			kind: "ws.client",
			lastSeq: this.lastSentSeq(stream, "ws.client"),
			code: closeCode,
			reason: closeReason,
		} satisfies RequestEndMetadata);
		stream.publicSocket?.close(closeCode, closeReason);
		this.cleanupStream(stream.id);
	}

	private async createStream(
		kind: "http" | "websocket",
		request: Request,
	): Promise<StreamState> {
		const selected = chooseNextDataChannel(
			this.nextChannelIndex,
			this.expectedDataChannels,
		);
		this.nextChannelIndex = selected.nextChannelIndex;
		const streamId = this.nextStreamId;
		this.nextStreamId += 1n;
		this.ctx.waitUntil(
			this.ctx.storage.put(
				STORAGE_NEXT_STREAM_ID,
				this.nextStreamId.toString(),
			),
		);
		const stream: StreamState = {
			id: streamId,
			kind,
			channelId: selected.channelId,
			createdAt: Date.now(),
			requestTarget: buildRequestTarget(request),
			requestedProtocols: [],
			responseStart: deferred<ResponseStartMetadata>(),
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
		this.closedStreamIds.delete(streamId.toString());
		this.credit.seedStream(streamId);
		this.log({
			event: "stream.request.start",
			streamId: streamId.toString(),
			channelId: stream.channelId,
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
				await this.sendMetadataFrame(stream, FRAME_TYPE_REQUEST_END, {
					kind: "request.body",
					lastSeq: -1,
				} satisfies RequestEndMetadata);
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
			await this.sendMetadataFrame(stream, FRAME_TYPE_REQUEST_END, {
				kind: "request.body",
				lastSeq: this.lastSentSeq(stream, "request.body"),
			} satisfies RequestEndMetadata);
		} catch (error) {
			const reason = errorMessage(error);
			const shouldNotifyLocal = this.canSendForStream(stream);
			this.abortStream(stream, reason);
			if (shouldNotifyLocal) {
				await this.sendMetadataFrameByChannel(
					stream.channelId,
					FRAME_TYPE_REQUEST_ABORT,
					stream.id,
					{ reason } satisfies RequestAbortMetadata,
				).catch(() => undefined);
			}
		}
	}

	private async abortPublicStream(
		stream: StreamState,
		reason: string,
	): Promise<void> {
		const shouldNotifyLocal = this.canSendForStream(stream);
		this.abortStream(stream, reason);
		if (shouldNotifyLocal) {
			await this.sendMetadataFrameByChannel(
				stream.channelId,
				FRAME_TYPE_REQUEST_ABORT,
				stream.id,
				{ reason } satisfies RequestAbortMetadata,
			).catch(() => undefined);
		}
	}

	private async sendDataPayload(
		stream: StreamState,
		kind: "request.body" | "ws.client",
		payload: Uint8Array,
		flags = FRAME_FLAG_NONE,
	): Promise<void> {
		const limits = defaultTunnelLimits();
		if (
			kind === "ws.client" &&
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
			await this.credit.waitForOutbound(
				stream.id,
				stream.channelId,
				kind,
				chunk.byteLength,
				() => this.canSendForStream(stream),
			);
			const socket = this.getDataSocket(stream.channelId);
			if (!socket || socket.readyState !== WebSocket.OPEN) {
				throw new Error("Data channel unavailable");
			}
			await waitForSocketCapacity(socket);
			const seq = stream.sendNextSeq.get(kind) ?? 0n;
			socket.send(
				toArrayBuffer(
					encodeFrame(
						{
							frameType: FRAME_TYPE_REQUEST_DATA,
							streamId: stream.id,
							seq,
							flags,
							payload: chunk,
						},
						{ maxFrameBytes: limits.maxFrameBytes },
					),
				),
			);
			stream.sendNextSeq.set(kind, seq + 1n);
			this.credit.decrementOutbound(
				stream.id,
				stream.channelId,
				kind,
				chunk.byteLength,
			);
			if (payload.byteLength === 0) {
				break;
			}
			offset += chunk.byteLength;
		}
	}

	private async sendMetadataFrame(
		stream: StreamState,
		frameType:
			| typeof FRAME_TYPE_REQUEST_START
			| typeof FRAME_TYPE_REQUEST_END
			| typeof FRAME_TYPE_REQUEST_ABORT,
		metadata: RequestStartMetadata | RequestEndMetadata | RequestAbortMetadata,
	): Promise<void> {
		return this.sendMetadataFrameByChannel(
			stream.channelId,
			frameType,
			stream.id,
			metadata,
		);
	}

	private async sendMetadataFrameToChannel(
		channelId: number,
		frameType:
			| typeof FRAME_TYPE_STREAM_CREDIT
			| typeof FRAME_TYPE_CHANNEL_CREDIT,
		streamId: bigint,
		metadata: StreamCreditMetadata | ChannelCreditMetadata,
	): Promise<void> {
		return this.sendMetadataFrameByChannel(
			channelId,
			frameType,
			streamId,
			metadata,
		);
	}

	private async sendMetadataFrameByChannel(
		channelId: number,
		frameType: FrameType,
		streamId: bigint,
		metadata:
			| RequestStartMetadata
			| RequestEndMetadata
			| RequestAbortMetadata
			| StreamCreditMetadata
			| ChannelCreditMetadata,
	): Promise<void> {
		const socket = this.getDataSocket(channelId);
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			throw new Error("Data channel unavailable");
		}
		const limits = defaultTunnelLimits();
		const payload = encodeMetadata(frameType, metadata, {
			maxMetadataBytes: limits.maxMetadataBytes,
		});
		await waitForSocketCapacity(socket);
		socket.send(
			toArrayBuffer(
				encodeFrame(
					{
						frameType,
						streamId,
						seq: 0n,
						payload,
					},
					{ maxFrameBytes: limits.maxFrameBytes },
				),
			),
		);
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

	private async deliverFrame(
		stream: StreamState,
		frame: PendingFrame,
	): Promise<boolean> {
		if (frame.kind === "response.body") {
			if (!stream.responseController) {
				return false;
			}
			if (
				stream.responseController.desiredSize !== null &&
				stream.responseController.desiredSize <= 0
			) {
				return false;
			}
			stream.responseController.enqueue(frame.payload);
			this.credit.grantInbound(
				stream.id,
				stream.channelId,
				frame.kind,
				frame.payload.byteLength,
			);
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
			if (frame.flags === FRAME_FLAG_WS_TEXT) {
				stream.publicSocket.send(utf8Decode(frame.payload));
			} else {
				stream.publicSocket.send(toArrayBuffer(frame.payload));
			}
			await waitForSocketCapacity(stream.publicSocket);
			this.credit.grantInbound(
				stream.id,
				stream.channelId,
				frame.kind,
				frame.payload.byteLength,
			);
			this.finishStreamDirection(stream, frame.kind);
			return true;
		}
		return true;
	}

	private async deliverFrameOrAbort(
		stream: StreamState,
		frame: PendingFrame,
	): Promise<boolean> {
		try {
			return await this.deliverFrame(stream, frame);
		} catch (error) {
			if (this.streams.get(stream.id) === stream && !stream.aborted) {
				await this.abortPublicStream(
					stream,
					`public response delivery failed: ${errorMessage(error)}`,
				);
			}
			return true;
		}
	}

	private async flushPendingFrames(stream: StreamState): Promise<void> {
		for (;;) {
			const frame = stream.pendingFrames[0];
			if (!frame) {
				break;
			}
			if (!(await this.deliverFrameOrAbort(stream, frame))) {
				break;
			}
			if (this.streams.get(stream.id) !== stream) {
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
		kind: "response.body" | "ws.server",
		code?: number,
		reason?: string,
	): void {
		const endSeq = stream.receiveEndSeq.get(kind);
		if (endSeq === undefined) {
			return;
		}
		const nextSeq = stream.receiveNextSeq.get(kind) ?? 0n;
		if (endSeq !== -1 && nextSeq <= BigInt(endSeq)) {
			return;
		}
		if (kind === "response.body") {
			stream.responseController?.close();
			this.cleanupStream(stream.id);
			return;
		}
		stream.publicSocket?.close(
			normalizeWebSocketCloseCode(code),
			normalizeWebSocketCloseReason(reason),
		);
		this.cleanupStream(stream.id);
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
		this.log({ event: "stream.abort", streamId: stream.id.toString(), reason });
	}

	private cleanupStream(streamId: bigint): void {
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
		this.rememberClosedStream(streamId);
		this.log({ event: "stream.end", streamId: streamId.toString() });
	}

	private async replaceClientConnection(
		clientConnectionId: string,
		dataChannels: number,
	): Promise<void> {
		if (this.activeClientConnectionId) {
			this.closeClientConnectionSockets(
				this.activeClientConnectionId,
				CLOSE_CLIENT_CONNECTION_REPLACED,
				"Client connection replaced",
			);
		}
		this.abortAllStreams("Client connection replaced");
		this.activeClientConnectionId = clientConnectionId;
		this.expectedDataChannels = dataChannels;
		this.nextStreamId = 1n;
		this.nextChannelIndex = 0;
		this.closedStreamIds.clear();
		await Promise.all([
			this.ctx.storage.put(STORAGE_CLIENT_CONNECTION_ID, clientConnectionId),
			this.ctx.storage.put(STORAGE_DATA_CHANNELS, dataChannels),
			this.ctx.storage.put(
				STORAGE_NEXT_STREAM_ID,
				this.nextStreamId.toString(),
			),
			this.ctx.storage.setAlarm(Date.now() + EPHEMERAL_CONNECT_TIMEOUT_MS),
		]);
		this.credit.reset(dataChannels);
		this.log({
			event: "clientConnection.created",
			clientConnectionId,
			dataChannels,
		});
	}

	private async failClientConnection(
		event: string,
		code: number,
		reason: string,
	): Promise<void> {
		if (!this.activeClientConnectionId) {
			return;
		}
		const clientConnectionId = this.activeClientConnectionId;
		this.closeClientConnectionSockets(clientConnectionId, code, reason);
		this.abortAllStreams(reason);
		this.activeClientConnectionId = null;
		this.expectedDataChannels = 0;
		await Promise.all([
			this.ctx.storage.delete(STORAGE_CLIENT_CONNECTION_ID),
			this.ctx.storage.delete(STORAGE_DATA_CHANNELS),
			this.ctx.storage.delete(STORAGE_NEXT_STREAM_ID),
			this.ctx.storage.deleteAlarm(),
		]);
		this.credit.reset(0);
		this.log({
			event: "clientConnection.closed",
			clientConnectionId,
			reason: event,
			code,
		});
	}

	private closeClientConnectionSockets(
		clientConnectionId: string,
		code: number,
		reason: string,
	): void {
		for (const socket of this.ctx.getWebSockets(`conn:${clientConnectionId}`)) {
			socket.close(code, reason);
		}
	}

	private abortAllStreams(reason: string): void {
		for (const stream of [...this.streams.values()]) {
			this.abortStream(stream, reason);
		}
	}

	private isReady(): boolean {
		if (!this.activeClientConnectionId || this.expectedDataChannels < 1) {
			return false;
		}
		const seen = new Set<number>();
		for (const socket of this.ctx.getWebSockets(
			`conn:${this.activeClientConnectionId}`,
		)) {
			const attachment = getAttachment(socket);
			if (
				attachment?.kind === "data" &&
				attachment.clientConnectionId === this.activeClientConnectionId &&
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

	private getDataSocket(channelId: number): WebSocket | null {
		if (!this.activeClientConnectionId) {
			return null;
		}
		for (const socket of this.ctx.getWebSockets(`ch:${channelId}`)) {
			const attachment = getAttachment(socket);
			if (
				attachment?.kind === "data" &&
				attachment.clientConnectionId === this.activeClientConnectionId &&
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
		return Boolean(
			attachment?.kind === "data" &&
				this.activeClientConnectionId &&
				attachment.clientConnectionId === this.activeClientConnectionId &&
				this.isLatestSocket(ws, `ch:${attachment.channelId}`),
		);
	}

	private isLatestSocket(ws: WebSocket, tag: string): boolean {
		const attachment = getAttachment(ws);
		if (!attachment || attachment.kind !== "data") {
			return false;
		}
		let latest: { socket: WebSocket; generation: number } | null = null;
		for (const candidate of this.ctx.getWebSockets(tag)) {
			const candidateAttachment = getAttachment(candidate);
			if (
				candidateAttachment?.kind !== "data" ||
				candidateAttachment.clientConnectionId !==
					attachment.clientConnectionId ||
				candidateAttachment.channelId !== attachment.channelId
			) {
				continue;
			}
			if (
				!latest ||
				candidateAttachment.socketGeneration >= latest.generation
			) {
				latest = {
					socket: candidate,
					generation: candidateAttachment.socketGeneration,
				};
			}
		}
		return latest?.socket === ws;
	}

	private nextSocketGeneration(): number {
		const generation = Date.now() * 1000 + (this.socketGeneration % 1000);
		this.socketGeneration += 1;
		return generation;
	}

	private canSendForStream(stream: StreamState): boolean {
		return (
			!stream.aborted &&
			this.streams.get(stream.id) === stream &&
			this.getDataSocket(stream.channelId) !== null
		);
	}

	private async decodeMetadataOrFail<T>(
		frameType: FrameType,
		payload: Uint8Array,
	): Promise<T | null> {
		try {
			return decodeMetadata(frameType, payload) as T;
		} catch {
			await this.failClientConnection(
				"protocol.error",
				CLOSE_PROTOCOL_ERROR,
				"Invalid frame metadata",
			);
			return null;
		}
	}

	private async loadConnectionState(): Promise<void> {
		if (
			this.activeClientConnectionId !== null ||
			this.expectedDataChannels > 0
		) {
			return;
		}
		const [clientConnectionId, dataChannels, nextStreamId] = await Promise.all([
			this.ctx.storage.get<string>(STORAGE_CLIENT_CONNECTION_ID),
			this.ctx.storage.get<number>(STORAGE_DATA_CHANNELS),
			this.ctx.storage.get<string>(STORAGE_NEXT_STREAM_ID),
		]);
		this.activeClientConnectionId = clientConnectionId ?? null;
		this.expectedDataChannels =
			typeof dataChannels === "number" ? dataChannels : 0;
		this.nextStreamId = nextStreamId ? BigInt(nextStreamId) : 1n;
		this.credit.reset(this.expectedDataChannels);
		this.closeUnrecoverablePublicSockets();
	}

	private closeUnrecoverablePublicSockets(): void {
		if (this.streams.size > 0) {
			return;
		}
		for (const socket of this.ctx.getWebSockets("public")) {
			socket.close(CLOSE_INTERNAL_ERROR, "Public stream state expired");
		}
	}

	private checkReceiveSeq(
		stream: StreamState,
		kind: DataKind,
		seq: bigint,
	): boolean {
		const expected = stream.receiveNextSeq.get(kind) ?? 0n;
		if (seq !== expected) {
			return false;
		}
		stream.receiveNextSeq.set(kind, expected + 1n);
		return true;
	}

	private checkReceiveEndSeq(
		stream: StreamState,
		kind: "response.body" | "ws.server",
		lastSeq: number,
	): boolean {
		const nextSeq = stream.receiveNextSeq.get(kind) ?? 0n;
		return BigInt(lastSeq) === nextSeq - 1n;
	}

	private checkReceiveEndBoundary(
		stream: StreamState,
		kind: DataKind,
		seq: bigint,
	): boolean {
		if (kind !== "response.body" && kind !== "ws.server") {
			return true;
		}
		const endSeq = stream.receiveEndSeq.get(kind);
		return endSeq === undefined || seq <= BigInt(endSeq);
	}

	private armReceiveEndTimeout(
		stream: StreamState,
		kind: "response.body" | "ws.server",
		lastSeq: number,
	): void {
		if (
			lastSeq === -1 ||
			(stream.receiveNextSeq.get(kind) ?? 0n) > BigInt(lastSeq)
		) {
			return;
		}
		const limits = defaultTunnelLimits();
		this.ctx.waitUntil(
			sleep(limits.pendingDataTimeoutMs).then(() => {
				const current = this.streams.get(stream.id);
				if (
					current === stream &&
					stream.receiveEndSeq.get(kind) === lastSeq &&
					(stream.receiveNextSeq.get(kind) ?? 0n) <= BigInt(lastSeq)
				) {
					void this.failClientConnection(
						"protocol.error",
						CLOSE_PROTOCOL_ERROR,
						"Missing data before declared end",
					);
				}
			}),
		);
	}

	private lastSentSeq(stream: StreamState, kind: DataKind): number {
		return Number((stream.sendNextSeq.get(kind) ?? 0n) - 1n);
	}

	private rememberClosedStream(streamId: bigint): void {
		const key = streamId.toString();
		this.closedStreamIds.delete(key);
		this.closedStreamIds.add(key);
		if (this.closedStreamIds.size <= MAX_REMEMBERED_CLOSED_STREAMS) {
			return;
		}
		const oldest = this.closedStreamIds.values().next().value;
		if (oldest !== undefined) {
			this.closedStreamIds.delete(oldest);
		}
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
	if (record.kind === "data") {
		return (
			typeof record.clientConnectionId === "string" &&
			typeof record.channelId === "number" &&
			typeof record.socketGeneration === "number" &&
			typeof record.createdAt === "number"
		);
	}
	if (record.kind === "public") {
		return (
			typeof record.streamId === "string" &&
			typeof record.createdAt === "number"
		);
	}
	return false;
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
	return tunnelErrorResponse(request, {
		status: 502,
		eyebrow: "502",
		title: "Tunnel not ready",
		message:
			"This public URL is valid, but the hostc client is not connected right now.",
		hint: "Start or reconnect hostc on the machine that owns this tunnel.",
	});
}

function jsonError(message: string, status: number): Response {
	return Response.json({ error: message }, { status });
}

function allowsHttpResponseBody(status: number): boolean {
	return status !== 204 && status !== 205 && status !== 304;
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
