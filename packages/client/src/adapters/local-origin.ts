import {
	filterHttpRequestHeaders,
	filterResponseHeaders,
	filterWebSocketRequestHeaders,
	headersToEntries,
	normalizeWebSocketCloseCode,
	normalizeWebSocketCloseReason,
	utf8Encode,
} from "@hostc/protocol";
import WebSocket, { type RawData } from "ws";
import type {
	HeaderEntry,
	HostcHttpRequest,
	HostcHttpResponse,
	HostcUpstreamWebSocket,
	HostcWebSocketMessage,
	HostcWebSocketRequest,
	UpstreamAdapter,
} from "../upstream.js";

export type LocalOriginAdapterOptions = {
	origin: string | URL;
	publicUrl?: string | URL;
	fetch?: typeof fetch;
};

type RequestInitWithDuplex = RequestInit & { duplex?: "half" };

export function localOriginAdapter(
	options: LocalOriginAdapterOptions,
): UpstreamAdapter {
	const origin = new URL(options.origin);
	const fetchImpl = options.fetch ?? fetch;
	return {
		async handleHttp(request: HostcHttpRequest): Promise<HostcHttpResponse> {
			const publicOrigin = request.publicUrl
				? new URL(request.publicUrl).origin
				: options.publicUrl
					? new URL(options.publicUrl).origin
					: null;
			const response = await fetchImpl(new URL(request.target, origin), {
				method: request.method,
				headers: entriesToHeaders(
					filterHttpRequestHeaders(
						rewriteLocalRequestHeaders(request.headers, publicOrigin, origin),
					),
				),
				body: request.body,
				duplex: request.body ? "half" : undefined,
				redirect: "manual",
				signal: request.signal,
			} as RequestInitWithDuplex);
			return {
				status: response.status,
				headers: filterResponseHeaders(headersToEntries(response.headers)),
				body: response.body,
			};
		},
		async handleWebSocket(
			request: HostcWebSocketRequest,
		): Promise<HostcUpstreamWebSocket> {
			const publicOrigin = request.publicUrl
				? new URL(request.publicUrl).origin
				: options.publicUrl
					? new URL(options.publicUrl).origin
					: null;
			const url = new URL(request.target, origin);
			url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
			const socket = new WebSocket(url, request.protocols, {
				headers: Object.fromEntries(
					filterWebSocketRequestHeaders(
						rewriteLocalRequestHeaders(request.headers, publicOrigin, origin),
					),
				),
			});
			request.signal?.addEventListener(
				"abort",
				() => safeCloseWebSocket(socket, 1011, "aborted"),
				{ once: true },
			);
			await waitForOpen(socket);
			return new LocalUpstreamWebSocket(socket);
		},
	};
}

class LocalUpstreamWebSocket implements HostcUpstreamWebSocket {
	private readonly messageListeners = new Set<
		(message: HostcWebSocketMessage) => void
	>();
	private readonly closeListeners = new Set<
		(event: { code: number; reason: string }) => void
	>();

	constructor(private readonly socket: WebSocket) {
		this.socket.on("message", (data, isBinary) => {
			const payload = rawDataToUint8Array(data);
			const message: HostcWebSocketMessage = {
				data: isBinary ? payload : Buffer.from(payload).toString("utf8"),
				binary: isBinary,
			};
			for (const listener of this.messageListeners) {
				listener(message);
			}
		});
		this.socket.on("close", (code, reason) => {
			const event = { code, reason: reason.toString() };
			for (const listener of this.closeListeners) {
				listener(event);
			}
		});
	}

	get protocol(): string | undefined {
		return this.socket.protocol || undefined;
	}

	accept(): void {
		// Local origin WebSocket is accepted when the upstream socket opens.
	}

	send(message: Uint8Array | string): void {
		this.socket.send(
			typeof message === "string" ? message : Buffer.from(message),
		);
	}

	close(code?: number, reason?: string): void {
		safeCloseWebSocket(this.socket, code, reason);
	}

	onMessage(listener: (message: HostcWebSocketMessage) => void): void {
		this.messageListeners.add(listener);
	}

	onClose(listener: (event: { code: number; reason: string }) => void): void {
		this.closeListeners.add(listener);
	}
}

function entriesToHeaders(entries: HeaderEntry[]): Headers {
	const headers = new Headers();
	for (const [name, value] of entries) {
		headers.append(name, value);
	}
	return headers;
}

function rewriteLocalRequestHeaders(
	headers: readonly HeaderEntry[],
	publicOrigin: string | null,
	localOrigin: URL,
): HeaderEntry[] {
	let sawAcceptEncoding = false;
	const rewritten: HeaderEntry[] = [];
	for (const [name, value] of headers) {
		const lowerName = name.toLowerCase();
		if (lowerName === "accept-encoding") {
			sawAcceptEncoding = true;
			rewritten.push([name, "identity"]);
			continue;
		}
		if (publicOrigin && lowerName === "origin" && value === publicOrigin) {
			rewritten.push([name, localOrigin.origin]);
			continue;
		}
		if (publicOrigin && lowerName === "referer") {
			rewritten.push([
				name,
				rewriteSameOriginUrl(value, publicOrigin, localOrigin),
			]);
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
		return new URL(`${url.pathname}${url.search}${url.hash}`, localOrigin).href;
	} catch {
		return value;
	}
}

function waitForOpen(socket: WebSocket, timeoutMs = 15_000): Promise<void> {
	if (socket.readyState === WebSocket.OPEN) {
		return Promise.resolve();
	}
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error("local websocket unavailable"));
		}, timeoutMs);
		const cleanup = (): void => {
			clearTimeout(timeout);
			socket.off("open", onOpen);
			socket.off("error", onError);
			socket.off("close", onClose);
		};
		const onOpen = (): void => {
			cleanup();
			resolve();
		};
		const onError = (error: Error): void => {
			cleanup();
			reject(error);
		};
		const onClose = (): void => {
			cleanup();
			reject(new Error("local websocket unavailable"));
		};
		socket.once("open", onOpen);
		socket.once("error", onError);
		socket.once("close", onClose);
	});
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

function safeCloseWebSocket(
	socket: WebSocket,
	code?: number,
	reason?: string,
): void {
	try {
		socket.close(
			normalizeWebSocketCloseCode(code),
			normalizeWebSocketCloseReason(reason),
		);
	} catch {
		socket.terminate();
	}
}
