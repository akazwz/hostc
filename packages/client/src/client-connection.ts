import {
	buildDataChannelUrl,
	type ChannelCreditMetadata,
	CLOSE_INTERNAL_ERROR,
	CLOSE_MESSAGE_TOO_BIG,
	CLOSE_NORMAL,
	CLOSE_PROTOCOL_ERROR,
	type CreateEphemeralTunnelResponse,
	type DataKind,
	type DecodedFrame,
	decodeFrameView,
	decodeMetadata,
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
import WebSocket, { type RawData } from "ws";
import { ClientCreditController } from "./credit.js";
import type { HostcLogEvent } from "./events.js";
import { DataChannelQueue } from "./queue.js";
import {
	openWebSocket,
	rawDataToUint8Array,
	safeCloseWebSocket,
	waitForSocketCapacity,
} from "./socket.js";
import {
	type PendingInboundFrame,
	StreamRegistry,
	type StreamState,
} from "./stream-registry.js";
import type { HostcHttpResponse, UpstreamAdapter } from "./upstream.js";

export type ClientConnectionOptions = {
	tunnel: CreateEphemeralTunnelResponse;
	upstream: UpstreamAdapter;
	emitLog: (event: HostcLogEvent) => void;
};

export class ClientConnection {
	private readonly sockets = new Map<number, WebSocket>();
	private readonly queue = new DataChannelQueue();
	private readonly streams = new StreamRegistry();
	private readonly credit = new ClientCreditController(
		() => this.tunnel.limits,
	);
	private readonly disconnected: Promise<string>;
	private resolveDisconnected!: (reason: string) => void;
	private closed = false;

	readonly tunnel: CreateEphemeralTunnelResponse;
	private readonly upstream: UpstreamAdapter;
	private readonly emitLog: (event: HostcLogEvent) => void;

	constructor(options: ClientConnectionOptions) {
		this.tunnel = options.tunnel;
		this.upstream = options.upstream;
		this.emitLog = options.emitLog;
		this.disconnected = new Promise((resolve) => {
			this.resolveDisconnected = resolve;
		});
	}

	async connect(): Promise<void> {
		this.streams.resetForNewTunnel();
		this.credit.reset(this.tunnel.dataChannels);
		await Promise.all(
			Array.from({ length: this.tunnel.dataChannels }, async (_, channelId) => {
				const url = new URL(
					buildDataChannelUrl(this.tunnel.dataUrl, channelId),
				);
				url.searchParams.set(
					"clientConnectionId",
					this.tunnel.clientConnectionId,
				);
				const socket = await openWebSocket(
					url.toString(),
					this.tunnel.connectToken,
				);
				if (this.closed) {
					safeCloseWebSocket(socket, CLOSE_NORMAL, "closed");
					throw new Error("client connection closed while connecting");
				}
				socket.on("message", (data, isBinary) => {
					this.enqueueDataMessage(channelId, () =>
						this.handleDataMessage(channelId, data, isBinary),
					);
				});
				socket.on("close", (code, reason) => {
					if (this.closed || this.sockets.get(channelId) !== socket) {
						return;
					}
					this.failConnection(
						`data channel ${channelId} closed ${code} ${reason.toString()}`,
					);
				});
				socket.on("error", (error) => {
					if (this.closed || this.sockets.get(channelId) !== socket) {
						return;
					}
					this.failConnection(
						`data channel ${channelId} error ${error.message}`,
					);
				});
				this.sockets.set(channelId, socket);
			}),
		);
	}

	waitForDisconnect(): Promise<string> {
		return this.disconnected;
	}

	close(code: number, reason: string): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.closeSockets(code, reason);
		this.abortAllStreams(reason);
		this.queue.clear();
		this.credit.wakeWaiters();
		this.resolveDisconnected(reason);
	}

	private async handleDataMessage(
		channelId: number,
		data: RawData,
		isBinary: boolean,
	): Promise<void> {
		if (!isBinary) {
			throw new Error("text data channel message");
		}
		let frame: DecodedFrame;
		try {
			frame = decodeFrameView(rawDataToUint8Array(data), {
				maxFrameBytes: this.tunnel.limits.maxFrameBytes,
			});
		} catch (error) {
			throw new Error(`invalid data frame: ${errorMessage(error)}`);
		}
		if (!isValidFrameForDirection(frame.frameType, "server-to-client")) {
			throw new Error("wrong frame direction");
		}

		if (frame.frameType === FRAME_TYPE_CHANNEL_CREDIT) {
			const metadata = decodeMetadata(
				FRAME_TYPE_CHANNEL_CREDIT,
				frame.payload,
			) as ChannelCreditMetadata;
			this.credit.applyChannelCredit(channelId, metadata);
			return;
		}
		if (frame.frameType === FRAME_TYPE_STREAM_CREDIT) {
			const metadata = decodeMetadata(
				FRAME_TYPE_STREAM_CREDIT,
				frame.payload,
			) as StreamCreditMetadata;
			this.credit.applyStreamCredit(frame.streamId, metadata);
			return;
		}

		if (this.streams.isClosed(frame.streamId)) {
			return;
		}

		if (frame.frameType === FRAME_TYPE_REQUEST_START) {
			await this.handleRequestStart(channelId, frame);
			return;
		}

		const stream = this.streams.get(frame.streamId);
		if (!stream) {
			throw new Error("unknown stream");
		}
		if (stream.channelId !== channelId) {
			throw new Error("stream frame on wrong channel");
		}
		await this.dispatchStreamFrame(stream, frame);
	}

	private async handleRequestStart(
		channelId: number,
		frame: DecodedFrame,
	): Promise<void> {
		const metadata = decodeMetadata(
			FRAME_TYPE_REQUEST_START,
			frame.payload,
		) as RequestStartMetadata;
		if (this.streams.has(frame.streamId)) {
			throw new Error("duplicate stream start");
		}
		const stream: StreamState = {
			id: frame.streamId,
			kind: metadata.kind,
			channelId,
			target: metadata.target,
			requestWriter: null,
			requestEndSeq: null,
			localAbortController: new AbortController(),
			upstreamWebSocket: null,
			pendingInboundFrames: [],
			pendingInboundBytes: 0,
			receiveNextSeq: new Map(),
			sendNextSeq: new Map(),
			sendChains: new Map(),
			aborted: false,
		};
		this.streams.set(stream);
		this.credit.seedStream(stream.id);
		this.emitLog({
			level: "debug",
			message: "stream.request.start",
			fields: { streamId: stream.id.toString(), channelId, kind: stream.kind },
		});

		if (metadata.kind === "http") {
			void this.startHttpProxy(stream, metadata).catch((error) => {
				void this.abortResponseStream(stream, errorMessage(error));
			});
			return;
		}
		void this.startWebSocketProxy(stream, metadata).catch((error) => {
			void this.abortResponseStream(stream, errorMessage(error));
		});
	}

	private async startHttpProxy(
		stream: StreamState,
		metadata: RequestStartMetadata,
	): Promise<void> {
		let body: ReadableStream<Uint8Array> | null = null;
		if (metadata.hasBody) {
			const bodyStream = new TransformStream<Uint8Array, Uint8Array>();
			stream.requestWriter = bodyStream.writable.getWriter();
			body = bodyStream.readable;
		}
		const response = await this.upstream.handleHttp({
			method: metadata.method,
			target: metadata.target,
			headers: [...metadata.headers],
			body,
			publicUrl: this.tunnel.publicUrl,
			signal: stream.localAbortController.signal,
		});
		if (!this.canSendForStream(stream)) {
			return;
		}
		await this.sendMetadataFrame(stream, FRAME_TYPE_RESPONSE_START, {
			status: response.status,
			headers: response.headers ?? [],
			hasBody: response.body !== null && response.body !== undefined,
		} satisfies ResponseStartMetadata);
		await this.sendHttpResponseBody(stream, response);
		if (!this.canSendForStream(stream)) {
			return;
		}
		await this.sendMetadataFrame(stream, FRAME_TYPE_RESPONSE_END, {
			kind: "response.body",
			lastSeq: this.lastSentSeq(stream, "response.body"),
		} satisfies ResponseEndMetadata);
		this.cleanupStream(stream.id);
	}

	private async sendHttpResponseBody(
		stream: StreamState,
		response: HostcHttpResponse,
	): Promise<void> {
		const body = response.body;
		if (!body) {
			return;
		}
		if (typeof body === "string") {
			await this.sendDataPayload(stream, "response.body", utf8Encode(body));
			return;
		}
		if (body instanceof Uint8Array) {
			await this.sendDataPayload(stream, "response.body", body);
			return;
		}
		const reader = body.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			await this.sendDataPayload(stream, "response.body", value);
		}
	}

	private async startWebSocketProxy(
		stream: StreamState,
		metadata: RequestStartMetadata,
	): Promise<void> {
		if (!this.upstream.handleWebSocket) {
			throw new Error("local websocket unavailable");
		}
		const upstreamWebSocket = await this.upstream.handleWebSocket({
			method: metadata.method,
			target: metadata.target,
			headers: [...metadata.headers],
			protocols: [...(metadata.protocols ?? [])],
			publicUrl: this.tunnel.publicUrl,
			signal: stream.localAbortController.signal,
		});
		stream.upstreamWebSocket = upstreamWebSocket;
		await this.sendMetadataFrame(stream, FRAME_TYPE_RESPONSE_START, {
			status: 101,
			headers: [],
			hasBody: false,
			protocol: upstreamWebSocket.protocol,
		} satisfies ResponseStartMetadata);
		upstreamWebSocket.onMessage((message) => {
			const payload =
				typeof message.data === "string"
					? utf8Encode(message.data)
					: message.data;
			if (payload.byteLength > this.tunnel.limits.maxWebSocketMessageBytes) {
				upstreamWebSocket.close(
					CLOSE_MESSAGE_TOO_BIG,
					"WebSocket message too big",
				);
				return;
			}
			void this.enqueueStreamSend(stream, "ws.server", () =>
				this.sendDataPayload(
					stream,
					"ws.server",
					payload,
					message.binary ? FRAME_FLAG_WS_BINARY : FRAME_FLAG_WS_TEXT,
				),
			).catch(
				(error) => void this.abortResponseStream(stream, errorMessage(error)),
			);
		});
		upstreamWebSocket.onClose((event) => {
			if (!this.canSendForStream(stream)) {
				return;
			}
			void this.sendMetadataFrame(stream, FRAME_TYPE_RESPONSE_END, {
				kind: "ws.server",
				lastSeq: this.lastSentSeq(stream, "ws.server"),
				code: normalizeWebSocketCloseCode(event.code),
				reason: normalizeWebSocketCloseReason(event.reason),
			} satisfies ResponseEndMetadata).finally(() =>
				this.cleanupStream(stream.id),
			);
		});
		await this.flushPendingInboundFrames(stream);
	}

	private async dispatchStreamFrame(
		stream: StreamState,
		frame: DecodedFrame,
	): Promise<void> {
		switch (frame.frameType) {
			case FRAME_TYPE_REQUEST_DATA: {
				const kind = stream.kind === "http" ? "request.body" : "ws.client";
				if (stream.kind === "http" && frame.flags !== FRAME_FLAG_NONE) {
					throw new Error("HTTP request data must not have WebSocket flags");
				}
				if (
					stream.kind === "websocket" &&
					frame.flags !== FRAME_FLAG_WS_TEXT &&
					frame.flags !== FRAME_FLAG_WS_BINARY
				) {
					throw new Error("WebSocket request data missing type flag");
				}
				if (
					!this.credit.consumeInbound(
						stream.id,
						stream.channelId,
						kind,
						frame.payload.byteLength,
					)
				) {
					throw new Error("credit violation");
				}
				if (!this.checkReceiveSeq(stream, kind, frame.seq)) {
					throw new Error("seq discontinuity");
				}
				try {
					await this.deliverInboundFrame(stream, {
						kind,
						seq: frame.seq,
						flags: frame.flags,
						payload: frame.payload,
					});
				} catch (error) {
					await this.abortResponseStream(stream, errorMessage(error));
				}
				return;
			}
			case FRAME_TYPE_REQUEST_END: {
				const metadata = decodeMetadata(
					FRAME_TYPE_REQUEST_END,
					frame.payload,
				) as RequestEndMetadata;
				const kind = stream.kind === "http" ? "request.body" : "ws.client";
				if (metadata.kind !== kind) {
					throw new Error("request end kind mismatch");
				}
				if (!this.checkReceiveEndSeq(stream, kind, metadata.lastSeq)) {
					throw new Error("request end lastSeq mismatch");
				}
				stream.requestEndSeq = metadata.lastSeq;
				try {
					await this.finishIncomingDirection(stream, metadata);
				} catch (error) {
					await this.abortResponseStream(stream, errorMessage(error));
				}
				return;
			}
			case FRAME_TYPE_REQUEST_ABORT: {
				const metadata = decodeMetadata(
					FRAME_TYPE_REQUEST_ABORT,
					frame.payload,
				) as RequestAbortMetadata;
				this.abortLocalStream(stream, metadata.reason);
				return;
			}
			default:
				throw new Error("unexpected stream frame");
		}
	}

	private async deliverInboundFrame(
		stream: StreamState,
		frame: PendingInboundFrame,
	): Promise<void> {
		if (frame.kind === "request.body") {
			if (!stream.requestWriter) {
				throw new Error("request body writer unavailable");
			}
			await stream.requestWriter.write(frame.payload);
			await this.grantInboundCredit(
				stream,
				frame.kind,
				frame.payload.byteLength,
			);
			return;
		}
		if (!stream.upstreamWebSocket) {
			this.enqueuePendingInboundFrame(stream, frame);
			return;
		}
		stream.upstreamWebSocket.send(
			frame.flags === FRAME_FLAG_WS_TEXT
				? utf8Decode(frame.payload)
				: frame.payload,
		);
		await this.grantInboundCredit(stream, frame.kind, frame.payload.byteLength);
	}

	private enqueuePendingInboundFrame(
		stream: StreamState,
		frame: PendingInboundFrame,
	): void {
		if (
			stream.pendingInboundBytes + frame.payload.byteLength >
			this.tunnel.limits.pendingDataBytes
		) {
			void this.abortResponseStream(stream, "pending data limit exceeded");
			return;
		}
		stream.pendingInboundFrames.push(frame);
		stream.pendingInboundBytes += frame.payload.byteLength;
	}

	private async flushPendingInboundFrames(stream: StreamState): Promise<void> {
		for (;;) {
			const frame = stream.pendingInboundFrames.shift();
			if (!frame) {
				return;
			}
			stream.pendingInboundBytes -= frame.payload.byteLength;
			await this.deliverInboundFrame(stream, frame);
		}
	}

	private async finishIncomingDirection(
		stream: StreamState,
		metadata: RequestEndMetadata,
	): Promise<void> {
		if (metadata.kind === "request.body") {
			await stream.requestWriter?.close();
			return;
		}
		stream.upstreamWebSocket?.close(
			metadata.code ?? CLOSE_NORMAL,
			metadata.reason ?? "",
		);
	}

	private async sendDataPayload(
		stream: StreamState,
		kind: "response.body" | "ws.server",
		payload: Uint8Array,
		flags = FRAME_FLAG_NONE,
	): Promise<void> {
		const limits = this.tunnel.limits;
		if (
			kind === "ws.server" &&
			payload.byteLength > limits.maxWebSocketMessageBytes
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
					: payload.subarray(offset, offset + limits.maxFrameBytes);
			await this.credit.waitForOutbound(
				stream.id,
				stream.channelId,
				kind,
				chunk.byteLength,
				() => this.canSendForStream(stream),
			);
			const socket = this.sockets.get(stream.channelId);
			if (!socket || socket.readyState !== WebSocket.OPEN) {
				throw new Error("data channel unavailable");
			}
			await waitForSocketCapacity(socket);
			const seq = stream.sendNextSeq.get(kind) ?? 0n;
			socket.send(
				encodeFrame(
					{
						frameType: FRAME_TYPE_RESPONSE_DATA,
						streamId: stream.id,
						seq,
						flags,
						payload: chunk,
					},
					{ maxFrameBytes: limits.maxFrameBytes },
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
			| typeof FRAME_TYPE_RESPONSE_START
			| typeof FRAME_TYPE_RESPONSE_END
			| typeof FRAME_TYPE_RESPONSE_ABORT,
		metadata:
			| ResponseStartMetadata
			| ResponseEndMetadata
			| ResponseAbortMetadata,
	): Promise<void> {
		return this.sendMetadataFrameByChannel(
			stream.channelId,
			frameType,
			stream.id,
			metadata,
		);
	}

	private async sendMetadataFrameByChannel(
		channelId: number,
		frameType: FrameType,
		streamId: bigint,
		metadata:
			| ResponseStartMetadata
			| ResponseEndMetadata
			| ResponseAbortMetadata
			| StreamCreditMetadata
			| ChannelCreditMetadata,
	): Promise<void> {
		const socket = this.sockets.get(channelId);
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			throw new Error("data channel unavailable");
		}
		const payload = encodeMetadata(frameType, metadata, {
			maxMetadataBytes: this.tunnel.limits.maxMetadataBytes,
		});
		await waitForSocketCapacity(socket);
		socket.send(
			encodeFrame(
				{ frameType, streamId, seq: 0n, payload },
				{ maxFrameBytes: this.tunnel.limits.maxFrameBytes },
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

	private async grantInboundCredit(
		stream: StreamState,
		kind: DataKind,
		bytes: number,
	): Promise<void> {
		this.credit.grantInbound(stream.id, stream.channelId, kind, bytes);
		await this.sendMetadataFrameByChannel(
			stream.channelId,
			FRAME_TYPE_STREAM_CREDIT,
			stream.id,
			{ kind, bytes } satisfies StreamCreditMetadata,
		);
		await this.sendMetadataFrameByChannel(
			stream.channelId,
			FRAME_TYPE_CHANNEL_CREDIT,
			0n,
			{ bytes } satisfies ChannelCreditMetadata,
		);
	}

	private canSendForStream(stream: StreamState): boolean {
		return (
			!stream.aborted &&
			this.streams.isCurrent(stream) &&
			this.sockets.get(stream.channelId)?.readyState === WebSocket.OPEN
		);
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
		kind: DataKind,
		lastSeq: number,
	): boolean {
		const nextSeq = stream.receiveNextSeq.get(kind) ?? 0n;
		return BigInt(lastSeq) === nextSeq - 1n;
	}

	private lastSentSeq(stream: StreamState, kind: DataKind): number {
		return Number((stream.sendNextSeq.get(kind) ?? 0n) - 1n);
	}

	private async abortResponseStream(
		stream: StreamState,
		reason: string,
	): Promise<void> {
		const shouldNotifyServer = this.canSendForStream(stream);
		this.abortLocalStream(stream, reason);
		if (shouldNotifyServer) {
			await this.sendMetadataFrameByChannel(
				stream.channelId,
				FRAME_TYPE_RESPONSE_ABORT,
				stream.id,
				{ reason } satisfies ResponseAbortMetadata,
			).catch(() => undefined);
		}
	}

	private abortLocalStream(stream: StreamState, reason: string): void {
		stream.aborted = true;
		stream.localAbortController.abort(new Error(reason));
		stream.upstreamWebSocket?.close(CLOSE_INTERNAL_ERROR, reason);
		void stream.requestWriter?.abort(new Error(reason));
		this.cleanupStream(stream.id);
	}

	private cleanupStream(streamId: bigint): void {
		const stream = this.streams.delete(streamId);
		if (!stream) {
			return;
		}
		this.credit.deleteStream(streamId);
		this.emitLog({
			level: "debug",
			message: "stream.end",
			fields: { streamId: streamId.toString() },
		});
	}

	private abortAllStreams(reason: string): void {
		for (const stream of this.streams.values()) {
			this.abortLocalStream(stream, reason);
		}
	}

	private failConnection(reason: string): void {
		this.emitLog({ level: "debug", message: reason });
		this.close(CLOSE_PROTOCOL_ERROR, reason);
	}

	private closeSockets(code: number, reason: string): void {
		for (const socket of this.sockets.values()) {
			safeCloseWebSocket(socket, code, reason);
		}
		this.sockets.clear();
	}

	private enqueueDataMessage(
		channelId: number,
		task: () => Promise<void>,
	): Promise<void> {
		const next = this.queue.enqueue(channelId, task);
		void next.catch((error) => this.failConnection(errorMessage(error)));
		return next;
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
