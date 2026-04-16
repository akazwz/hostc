import { DurableObject } from "cloudflare:workers";
import { Buffer } from "node:buffer";
import {
	buildPublicUrl,
	type HeaderEntry,
	parseTunnelClientMessage,
	type ResponseStartMessage,
	type TunnelClientMessage,
	type TunnelServerMessage,
} from "@hostc/tunnel-protocol";

const HOP_BY_HOP_HEADERS = new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
	"host",
]);

const INTERNAL_CONNECT_PATH = "/_internal/connect";
const REQUEST_START_TIMEOUT_MS = 30_000;

type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (reason?: unknown) => void;
};

type PendingResponse = {
	responseStart: Deferred<ResponseStartMessage>;
	controller: ReadableStreamDefaultController<Uint8Array> | null;
	started: boolean;
};

export class HostcDurableObject extends DurableObject<Env> {
	private readonly pendingResponses = new Map<string, PendingResponse>();

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === INTERNAL_CONNECT_PATH) {
			if (!isWebSocketUpgrade(request)) {
				return jsonError("Expected a WebSocket upgrade request", 426);
			}

			return this.handleTunnelConnection();
		}

		return this.handleProxyRequest(request);
	}

	async webSocketMessage(
		ws: WebSocket,
		message: string | ArrayBuffer,
	): Promise<void> {
		if (typeof message !== "string") {
			logError("tunnel.invalid_frame", {
				reason: "non_text_frame",
			});
			ws.close(1003, "Tunnel messages must be text frames");
			this.failPendingResponses(
				new Error("Tunnel closed because of an invalid message frame"),
			);
			return;
		}

		const parsedMessage = parseTunnelClientMessage(message);

		if (!parsedMessage) {
			logError("tunnel.invalid_message", {
				reason: "payload_parse_failed",
			});
			ws.close(1003, "Invalid tunnel message");
			this.failPendingResponses(
				new Error("Tunnel closed because of an invalid message payload"),
			);
			return;
		}

		this.handleTunnelMessage(parsedMessage);
	}

	async webSocketClose(): Promise<void> {
		logInfo("tunnel.closed");
		this.failPendingResponses(new Error("Tunnel connection closed"));
	}

	async webSocketError(): Promise<void> {
		logError("tunnel.socket_error");
		this.failPendingResponses(new Error("Tunnel connection errored"));
	}

	private handleTunnelConnection(): Response {
		const subdomain = this.getTunnelSubdomain();

		const { 0: clientSocket, 1: serverSocket } = new WebSocketPair();
		const existingConnections = this.ctx.getWebSockets("client").length;

		if (existingConnections > 0) {
			logInfo("tunnel.replaced", {
				subdomain,
				previousConnectionCount: existingConnections,
			});
		}

		this.disconnectExistingClients();
		this.ctx.acceptWebSocket(serverSocket, ["client"]);

		logInfo("tunnel.connected", {
			subdomain,
			publicBaseDomain: this.env.PUBLIC_BASE_DOMAIN,
		});

		this.sendMessage(serverSocket, {
			type: "tunnel-ready",
			subdomain,
			publicUrl: buildPublicUrl(this.env.PUBLIC_BASE_DOMAIN, subdomain),
		});

		return new Response(null, {
			status: 101,
			webSocket: clientSocket,
		});
	}

	private async handleProxyRequest(request: Request): Promise<Response> {
		if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
			return jsonError(
				"Proxying WebSocket upgrades is not supported in this MVP",
				501,
			);
		}

		const tunnelSocket = this.getTunnelSocket();

		if (!tunnelSocket) {
			return jsonError("No active tunnel is connected for this subdomain", 502);
		}

		const requestUrl = new URL(request.url);
		const requestId = crypto.randomUUID();

		const pendingResponse: PendingResponse = {
			responseStart: createDeferred<ResponseStartMessage>(),
			controller: null,
			started: false,
		};

		const responseBody = new ReadableStream<Uint8Array>({
			start(controller) {
				pendingResponse.controller = controller;
			},
			cancel: () => {
				this.pendingResponses.delete(requestId);
			},
		});

		this.pendingResponses.set(requestId, pendingResponse);

		try {
			this.sendMessage(tunnelSocket, {
				type: "request-start",
				requestId,
				method: request.method,
				url: `${requestUrl.pathname}${requestUrl.search}`,
				headers: getForwardRequestHeaders(request),
				hasBody: request.body !== null,
			});

			if (request.body) {
				const reader = request.body.getReader();

				try {
					while (true) {
						const { done, value } = await reader.read();

						if (done) {
							break;
						}

						this.sendMessage(tunnelSocket, {
							type: "request-body",
							requestId,
							chunk: encodeBase64(value),
						});
					}
				} finally {
					reader.releaseLock();
				}
			}

			this.sendMessage(tunnelSocket, {
				type: "request-end",
				requestId,
			});

			const responseStart = await withTimeout(
				pendingResponse.responseStart.promise,
				REQUEST_START_TIMEOUT_MS,
				`Timed out waiting for the local service to respond for request ${requestId}`,
			);

			if (!responseStart.hasBody) {
				this.pendingResponses.delete(requestId);
			}

			return new Response(responseStart.hasBody ? responseBody : null, {
				status: responseStart.status,
				statusText: responseStart.statusText,
				headers: new Headers(responseStart.headers),
			});
		} catch (error) {
			const requestError = asError(error);

			logError("proxy.request_failed", {
				requestId,
				path: requestUrl.pathname,
				error: requestError.message,
			});
			this.pendingResponses.delete(requestId);
			pendingResponse.controller?.error(requestError);

			return jsonError(requestError.message, 502);
		}
	}

	private handleTunnelMessage(message: TunnelClientMessage): void {
		switch (message.type) {
			case "response-start": {
				const pendingResponse = this.pendingResponses.get(message.requestId);

				if (!pendingResponse) {
					return;
				}

				pendingResponse.started = true;
				pendingResponse.responseStart.resolve(message);

				if (!message.hasBody) {
					this.pendingResponses.delete(message.requestId);
				}

				return;
			}

			case "response-body": {
				const pendingResponse = this.pendingResponses.get(message.requestId);

				if (!pendingResponse?.controller) {
					return;
				}

				pendingResponse.controller.enqueue(decodeBase64(message.chunk));
				return;
			}

			case "response-end": {
				const pendingResponse = this.pendingResponses.get(message.requestId);

				if (pendingResponse?.controller) {
					pendingResponse.controller.close();
				}

				this.pendingResponses.delete(message.requestId);
				return;
			}

			case "response-error": {
				const pendingResponse = this.pendingResponses.get(message.requestId);

				if (!pendingResponse) {
					return;
				}

				const error = new Error(message.message);

				logError("proxy.response_error", {
					requestId: message.requestId,
					error: message.message,
				});

				if (pendingResponse.started && pendingResponse.controller) {
					pendingResponse.controller.error(error);
				} else {
					pendingResponse.responseStart.reject(error);
				}

				this.pendingResponses.delete(message.requestId);
				return;
			}

			case "error":
				logError("tunnel.client_error", {
					error: message.message,
				});
				this.failPendingResponses(new Error(message.message));
				return;
		}
	}

	private getTunnelSocket(): WebSocket | null {
		const sockets = this.ctx.getWebSockets("client");

		if (sockets.length === 0) {
			return null;
		}

		const activeSocket = sockets[sockets.length - 1];

		for (const socket of sockets.slice(0, -1)) {
			socket.close(1012, "Replaced by a newer tunnel connection");
		}

		return activeSocket;
	}

	private disconnectExistingClients(): void {
		for (const socket of this.ctx.getWebSockets("client")) {
			socket.close(1012, "Replaced by a newer tunnel connection");
		}
	}

	private failPendingResponses(error: Error): void {
		for (const [requestId, pendingResponse] of this.pendingResponses) {
			if (pendingResponse.started && pendingResponse.controller) {
				pendingResponse.controller.error(error);
			} else {
				pendingResponse.responseStart.reject(error);
			}

			this.pendingResponses.delete(requestId);
		}
	}

	private sendMessage(socket: WebSocket, message: TunnelServerMessage): void {
		socket.send(JSON.stringify(message));
	}

	private getTunnelSubdomain(): string {
		const subdomain = this.ctx.id.name;

		if (!subdomain) {
			throw new Error("Named Durable Object id is required for tunnel routing");
		}

		return subdomain;
	}
}

function createDeferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;

	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});

	return {
		promise,
		resolve,
		reject,
	};
}

function getForwardRequestHeaders(request: Request): HeaderEntry[] {
	const requestHeaders = new Headers();

	for (const [name, value] of request.headers) {
		if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
			requestHeaders.append(name, value);
		}
	}

	const requestUrl = new URL(request.url);
	requestHeaders.set("x-forwarded-host", requestUrl.host);
	requestHeaders.set("x-forwarded-proto", requestUrl.protocol.replace(":", ""));

	const connectingIp = request.headers.get("cf-connecting-ip");

	if (connectingIp) {
		const existingForwardedFor = requestHeaders.get("x-forwarded-for");
		requestHeaders.set(
			"x-forwarded-for",
			existingForwardedFor
				? `${existingForwardedFor}, ${connectingIp}`
				: connectingIp,
		);
	}

	return [...requestHeaders.entries()];
}

function encodeBase64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64");
}

function decodeBase64(value: string): Uint8Array {
	return Buffer.from(value, "base64");
}

function isWebSocketUpgrade(request: Request): boolean {
	return request.headers.get("upgrade")?.toLowerCase() === "websocket";
}

function jsonError(message: string, status: number): Response {
	return Response.json(
		{
			error: message,
		},
		{ status },
	);
}

async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	message: string,
): Promise<T> {
	let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

	const timeoutPromise = new Promise<T>((_, reject) => {
		timeoutHandle = setTimeout(() => {
			reject(new Error(message));
		}, timeoutMs);
	});

	try {
		return await Promise.race([promise, timeoutPromise]);
	} finally {
		if (timeoutHandle !== undefined) {
			clearTimeout(timeoutHandle);
		}
	}
}

function asError(error: unknown): Error {
	if (error instanceof Error) {
		return error;
	}

	return new Error(typeof error === "string" ? error : "Unknown tunnel error");
}

function logInfo(event: string, fields: Record<string, unknown> = {}): void {
	console.log(
		JSON.stringify({
			event,
			...fields,
		}),
	);
}

function logError(event: string, fields: Record<string, unknown> = {}): void {
	console.error(
		JSON.stringify({
			event,
			...fields,
		}),
	);
}
