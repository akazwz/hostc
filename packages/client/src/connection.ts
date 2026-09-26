import {
	CLOSE_PROTOCOL_ERROR,
	type CreateTunnelResponse,
	decodeFrame,
	decodeOpen,
	encodeFrame,
	encodeText,
	type Frame,
	type FrameType,
	FrameType as Frames,
	HEARTBEAT_INTERVAL_MS,
	HEARTBEAT_TIMEOUT_MS,
	PING,
	PONG,
	ProtocolError,
} from "@hostc/protocol";
import { type RawData, WebSocket } from "ws";

import { errorFromResponse, PROTOCOL_HEADERS, TunnelError } from "./api.ts";
import { createStream, type RequestLog, type Stream } from "./streams.ts";

export type ConnectionOptions = {
	tunnel: CreateTunnelResponse;
	target: URL;
	onRequest: (entry: RequestLog) => void;
};

export type CloseInfo = { code: number; reason: string };

/** One WebSocket session with the tunnel server. */
export class Connection {
	readonly closed: Promise<CloseInfo>;
	private readonly socket: WebSocket;
	private readonly options: ConnectionOptions;
	private readonly streams = new Map<number, Stream>();
	private readonly heartbeat: NodeJS.Timeout;
	private pongTimeout: NodeJS.Timeout | undefined;

	static open(options: ConnectionOptions): Promise<Connection> {
		return new Promise((resolve, reject) => {
			const socket = new WebSocket(options.tunnel.connectUrl, {
				headers: { authorization: `Bearer ${options.tunnel.token}`, ...PROTOCOL_HEADERS },
				perMessageDeflate: false,
				handshakeTimeout: 15_000,
			});
			socket.once("unexpected-response", (_request, response) => {
				let text = "";
				response.setEncoding("utf8");
				response.on("data", (chunk: string) => {
					text += chunk;
				});
				const fail = () => {
					reject(errorFromResponse(response.statusCode ?? 0, text));
					socket.terminate();
				};
				response.on("end", fail);
				response.on("error", fail);
			});
			socket.once("error", (error) => {
				reject(new TunnelError("network_error", `Could not connect: ${error.message}`, { cause: error }));
			});
			socket.once("open", () => {
				socket.removeAllListeners("error");
				resolve(new Connection(socket, options));
			});
		});
	}

	private constructor(socket: WebSocket, options: ConnectionOptions) {
		this.socket = socket;
		this.options = options;
		let resolveClosed!: (info: CloseInfo) => void;
		this.closed = new Promise((resolve) => {
			resolveClosed = resolve;
		});

		socket.on("message", (data, isBinary) => {
			if (isBinary) {
				this.receive(data);
			} else if (data.toString() === PONG) {
				clearTimeout(this.pongTimeout);
			}
		});
		socket.on("error", () => {
			// A close event always follows.
		});
		socket.on("close", (code, reason) => {
			clearInterval(this.heartbeat);
			clearTimeout(this.pongTimeout);
			for (const stream of this.streams.values()) {
				stream.abort();
			}
			this.streams.clear();
			resolveClosed({ code, reason: reason.toString() || closeDescription(code) });
		});

		// A connection that silently died (sleep, network change) never emits close; the missing pong reveals it.
		this.heartbeat = setInterval(() => {
			socket.send(PING);
			clearTimeout(this.pongTimeout);
			this.pongTimeout = setTimeout(() => socket.terminate(), HEARTBEAT_TIMEOUT_MS);
		}, HEARTBEAT_INTERVAL_MS);
	}

	close(code: number, reason: string): void {
		if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
			this.socket.close(code, reason);
			setTimeout(() => this.socket.terminate(), 1000).unref();
		}
	}

	private receive(data: RawData): void {
		let frame: Frame;
		try {
			frame = decodeFrame(
				Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? new Uint8Array(data) : data,
			);
		} catch (error) {
			this.close(CLOSE_PROTOCOL_ERROR, (error as Error).message);
			return;
		}
		try {
			this.dispatch(frame);
		} catch (error) {
			if (error instanceof ProtocolError) {
				this.close(CLOSE_PROTOCOL_ERROR, error.message);
				return;
			}
			// Whatever went wrong with one stream (bad input from the public side, a local socket error)
			// must not take down the CLI or the other streams.
			this.streams.get(frame.stream)?.abort();
			this.streams.delete(frame.stream);
			this.send(Frames.Reset, frame.stream, encodeText(`hostc client error: ${(error as Error).message}`));
		}
	}

	private dispatch(frame: Frame): void {
		if (frame.type !== Frames.Open) {
			// Frames for streams that already ended are expected and ignored.
			this.streams.get(frame.stream)?.receive(frame);
			return;
		}
		if (this.streams.has(frame.stream)) {
			throw new ProtocolError(`stream ${frame.stream} is already open`);
		}
		const stream = createStream(
			{
				target: this.options.target,
				publicOrigin: new URL(this.options.tunnel.url).origin,
				send: (type, id, payload) => this.send(type, id, payload),
				log: this.options.onRequest,
				remove: (id) => this.streams.delete(id),
			},
			frame.stream,
			decodeOpen(frame.payload),
		);
		this.streams.set(frame.stream, stream);
		stream.start();
	}

	private send(type: FrameType, stream: number, payload?: Uint8Array): void {
		if (this.socket.readyState === WebSocket.OPEN) {
			this.socket.send(encodeFrame(type, stream, payload));
		}
	}
}

function closeDescription(code: number): string {
	return code === 1006 ? "connection lost" : `closed with code ${code}`;
}
