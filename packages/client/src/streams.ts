import http from "node:http";
import https from "node:https";

import {
	decodeClose,
	decodeWindow,
	encodeClose,
	encodeHead,
	encodeText,
	encodeWindow,
	type Frame,
	FrameType,
	MAX_CHUNK_BYTES,
	MAX_WEBSOCKET_MESSAGE_BYTES,
	type OpenMessage,
	ProtocolError,
	responseHasBody,
	sendableCloseCode,
	sendableCloseReason,
	STREAM_WINDOW_BYTES,
	stripHopByHop,
} from "@hostc/protocol";
import { type RawData, WebSocket } from "ws";

import { fromRawHeaders, toLocalRequestHeaders, toPublicResponseHeaders, toRawHeaders } from "./rewrite.ts";

export type RequestLog = {
	method: string;
	path: string;
	status: number;
	durationMs: number;
	websocket: boolean;
};

/** What a stream needs from its connection. */
export type StreamContext = {
	target: URL;
	publicOrigin: string;
	send: (type: FrameType, stream: number, payload?: Uint8Array) => void;
	/** Reports a request once its response status is known. */
	log: (entry: RequestLog) => void;
	/** Forgets a stream that has ended. */
	remove: (stream: number) => void;
};

export interface Stream {
	start(): void;
	receive(frame: Frame): void;
	/** Tears down local resources without notifying the server. */
	abort(): void;
}

export function createStream(context: StreamContext, id: number, open: OpenMessage): Stream {
	return open.websocket ? new WebSocketStream(context, id, open) : new HttpStream(context, id, open);
}

/** One public HTTP request forwarded to the local server. */
class HttpStream implements Stream {
	private readonly context: StreamContext;
	private readonly id: number;
	private readonly open: OpenMessage;
	private readonly startedAt = Date.now();
	private request: http.ClientRequest | null = null;
	private response: http.IncomingMessage | null = null;
	private sendCredit = STREAM_WINDOW_BYTES;
	private wakeSender: (() => void) | null = null;
	private requestEnded = false;
	private finished = false;

	constructor(context: StreamContext, id: number, open: OpenMessage) {
		this.context = context;
		this.id = id;
		this.open = open;
	}

	start(): void {
		const { target, publicOrigin } = this.context;
		const secure = target.protocol === "https:";
		const request = (secure ? https : http).request({
			protocol: target.protocol,
			hostname: target.hostname.replace(/^\[|\]$/g, ""),
			port: target.port || (secure ? 443 : 80),
			method: this.open.method,
			path: this.open.path,
			headers: toRawHeaders(toLocalRequestHeaders(this.open.headers, publicOrigin, target)),
			// Local dev servers commonly use self-signed certificates.
			...(secure ? { rejectUnauthorized: false } : {}),
		});
		this.request = request;
		request.on("response", (response) => void this.respond(response));
		request.on("error", (error) => {
			if (!this.finished) {
				this.context.send(FrameType.Reset, this.id, encodeText(`local server: ${error.message}`));
				this.finish(502);
			}
		});
		if (!this.open.body) {
			this.requestEnded = true;
			request.end();
		}
	}

	receive(frame: Frame): void {
		switch (frame.type) {
			case FrameType.Data: {
				const bytes = frame.payload.byteLength;
				// Return the window once the bytes are handed to the local socket.
				this.request?.write(frame.payload, () => {
					if (!this.finished) {
						this.context.send(FrameType.Window, this.id, encodeWindow(bytes));
					}
				});
				return;
			}
			case FrameType.End:
				this.requestEnded = true;
				this.request?.end();
				return;
			case FrameType.Reset:
				this.abort();
				this.finish(499);
				return;
			case FrameType.Window:
				this.sendCredit += decodeWindow(frame.payload);
				this.wakeSender?.();
				return;
			default:
				throw new ProtocolError(`unexpected frame type ${frame.type} for an HTTP stream`);
		}
	}

	abort(): void {
		this.finished = true;
		this.request?.destroy();
		this.response?.destroy();
		this.wakeSender?.();
	}

	private async respond(response: http.IncomingMessage): Promise<void> {
		this.response = response;
		const status = response.statusCode ?? 0;
		if (status < 100 || status > 599) {
			this.context.send(FrameType.Reset, this.id, encodeText(`local server sent invalid status ${status}`));
			this.abort();
			this.finish(502);
			return;
		}
		const body = responseHasBody(this.open.method, status);
		const headers = toPublicResponseHeaders(
			stripHopByHop(fromRawHeaders(response.rawHeaders)),
			this.context.publicOrigin,
			this.context.target,
		);
		this.context.send(FrameType.Head, this.id, encodeHead({ status, headers, body }));
		if (!body) {
			response.resume();
			this.finish(status);
			return;
		}
		try {
			// Async iteration pauses the local response while we wait for window.
			for await (const chunk of response as AsyncIterable<Buffer>) {
				for (let offset = 0; offset < chunk.byteLength; offset += MAX_CHUNK_BYTES) {
					const part = chunk.subarray(offset, offset + MAX_CHUNK_BYTES);
					while (!this.finished && this.sendCredit < part.byteLength) {
						await new Promise<void>((resolve) => {
							this.wakeSender = resolve;
						});
					}
					if (this.finished) {
						return;
					}
					this.sendCredit -= part.byteLength;
					this.context.send(FrameType.Data, this.id, part);
				}
			}
			if (!this.finished) {
				this.context.send(FrameType.End, this.id);
				this.finish(status);
			}
		} catch (error) {
			if (!this.finished) {
				this.context.send(FrameType.Reset, this.id, encodeText(`local response failed: ${String(error)}`));
				this.finish(status);
			}
		}
	}

	private finish(status: number): void {
		this.finished = true;
		this.wakeSender?.();
		if (!this.requestEnded) {
			// The local server answered before reading the whole body; the rest will never be sent.
			this.request?.destroy();
		}
		this.context.remove(this.id);
		this.context.log({
			method: this.open.method,
			path: this.open.path,
			status,
			durationMs: Date.now() - this.startedAt,
			websocket: false,
		});
	}
}

/** One public WebSocket bridged to a WebSocket on the local server. */
class WebSocketStream implements Stream {
	private readonly context: StreamContext;
	private readonly id: number;
	private readonly open: OpenMessage;
	private readonly startedAt = Date.now();
	private socket: WebSocket | null = null;
	private settled = false;
	private ended = false;

	constructor(context: StreamContext, id: number, open: OpenMessage) {
		this.context = context;
		this.id = id;
		this.open = open;
	}

	start(): void {
		const { target, publicOrigin, send } = this.context;
		// Concatenate instead of resolving: a path like `//other-host/` must never leave the target.
		const url = new URL(`${target.protocol === "https:" ? "wss:" : "ws:"}//${target.host}${this.open.path}`);
		if (url.host !== target.host) {
			throw new Error("request path escapes the target");
		}
		const requestHeaders: Record<string, string> = {};
		for (const [name, value] of toLocalRequestHeaders(this.open.headers, publicOrigin, target)) {
			const lower = name.toLowerCase();
			if (lower !== "host") {
				const previous = requestHeaders[lower];
				requestHeaders[lower] = previous === undefined ? value : `${previous}, ${value}`;
			}
		}
		const socket = new WebSocket(url, this.open.websocket ?? [], {
			headers: requestHeaders,
			rejectUnauthorized: false,
			maxPayload: MAX_WEBSOCKET_MESSAGE_BYTES,
		});
		this.socket = socket;

		socket.on("open", () => {
			const protocol = socket.protocol || undefined;
			send(FrameType.Head, this.id, encodeHead({ status: 101, headers: [], body: false, protocol }));
			this.settle(101);
		});
		socket.on("unexpected-response", (_request, response) => {
			const status = response.statusCode ?? 502;
			const headers = stripHopByHop(fromRawHeaders(response.rawHeaders), ["content-length"]);
			send(FrameType.Head, this.id, encodeHead({ status, headers, body: false }));
			response.resume();
			this.settle(status);
			this.end();
			socket.terminate();
		});
		socket.on("message", (data, isBinary) => {
			send(isBinary ? FrameType.Data : FrameType.Text, this.id, toBytes(data));
		});
		socket.on("close", (code, reason) => {
			if (!this.ended) {
				send(FrameType.End, this.id, encodeClose({ code, reason: reason.toString() }));
				this.end();
			}
		});
		socket.on("error", (error) => {
			if (this.ended) {
				return;
			}
			if (this.settled) {
				send(FrameType.End, this.id, encodeClose({ code: 1011, reason: error.message }));
			} else {
				send(FrameType.Reset, this.id, encodeText(`local server: ${error.message}`));
				this.settle(502);
			}
			this.end();
			socket.terminate();
		});
	}

	receive(frame: Frame): void {
		switch (frame.type) {
			case FrameType.Data:
			case FrameType.Text:
				if (this.socket?.readyState === WebSocket.OPEN) {
					this.socket.send(frame.payload, { binary: frame.type === FrameType.Data });
				}
				return;
			case FrameType.End: {
				const { code, reason } = decodeClose(frame.payload);
				this.end();
				this.socket?.close(sendableCloseCode(code), sendableCloseReason(reason));
				return;
			}
			case FrameType.Reset:
				this.settle(499);
				this.end();
				this.socket?.terminate();
				return;
			default:
				throw new ProtocolError(`unexpected frame type ${frame.type} for a WebSocket stream`);
		}
	}

	abort(): void {
		this.ended = true;
		this.socket?.terminate();
	}

	private settle(status: number): void {
		if (this.settled) {
			return;
		}
		this.settled = true;
		this.context.log({
			method: "GET",
			path: this.open.path,
			status,
			durationMs: Date.now() - this.startedAt,
			websocket: true,
		});
	}

	private end(): void {
		if (!this.ended) {
			this.ended = true;
			this.context.remove(this.id);
		}
	}
}

function toBytes(data: RawData): Uint8Array {
	if (Array.isArray(data)) {
		return Buffer.concat(data);
	}
	return data instanceof ArrayBuffer ? new Uint8Array(data) : data;
}
