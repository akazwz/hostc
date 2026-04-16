import { DurableObject } from "cloudflare:workers";
import { Buffer } from "node:buffer";
import {
	buildPublicUrl,
	type HeaderEntry,
	parseTunnelClientMessage,
	type ResponseStartMessage,
	type TunnelClientMessage,
	type TunnelServerMessage,
	type WebSocketAcceptMessage,
} from "@hostc/tunnel-protocol";
import {
	serveLocalServerDownPage,
	serveTunnelNotFoundPage,
	wantsHtmlResponse,
} from "../lib/static-site";

const HTTP_HOP_BY_HOP_HEADERS = new Set([
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

const WEBSOCKET_FORWARD_HEADER_EXCLUSIONS = new Set([
	...HTTP_HOP_BY_HOP_HEADERS,
	"sec-websocket-extensions",
	"sec-websocket-key",
	"sec-websocket-protocol",
	"sec-websocket-version",
]);

const CONTROL_SOCKET_TAG = "client";
const PROXY_SOCKET_TAG = "proxy";
const PROXY_REQUEST_TAG_PREFIX = "request:";
const INTERNAL_CONNECT_PATH = "/_internal/connect";
const REQUEST_START_TIMEOUT_MS = 30_000;
const WEBSOCKET_CONNECT_TIMEOUT_MS = 30_000;
const TUNNEL_REPLACED_CLOSE_CODE = 1012;
const TUNNEL_ERROR_CLOSE_CODE = 1011;

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

type PendingWebSocketUpgrade = {
	accepted: Deferred<WebSocketAcceptMessage>;
	requestedProtocols: string[];
};

type ActiveProxySocket = {
	socket: WebSocket;
	remoteClosed: boolean;
};

type SocketMetadata =
	| {
			kind: "control";
	  }
	| {
			kind: "proxy";
			requestId: string;
	  };

export class HostcDurableObject extends DurableObject<Env> {
	private readonly pendingResponses = new Map<string, PendingResponse>();
	private readonly pendingUpgrades = new Map<string, PendingWebSocketUpgrade>();
	private readonly activeProxySockets = new Map<string, ActiveProxySocket>();

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.restoreActiveProxySockets();
	}

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
		const metadata = this.getSocketMetadata(ws);

		if (metadata?.kind === "proxy") {
			this.handleProxySocketMessage(metadata.requestId, message);
			return;
		}

		if (typeof message !== "string") {
			logError("tunnel.invalid_frame", {
				reason: "non_text_frame",
			});
			ws.close(1003, "Tunnel messages must be text frames");
			this.failPendingResponses(
				new Error("Tunnel closed because of an invalid message frame"),
			);
			this.failPendingUpgrades(
				new Error("Tunnel closed because of an invalid message frame"),
			);
			this.closeActiveProxySockets(
				TUNNEL_ERROR_CLOSE_CODE,
				"Tunnel closed because of an invalid message frame",
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
			this.failPendingUpgrades(
				new Error("Tunnel closed because of an invalid message payload"),
			);
			this.closeActiveProxySockets(
				TUNNEL_ERROR_CLOSE_CODE,
				"Tunnel closed because of an invalid message payload",
			);
			return;
		}

		this.handleTunnelMessage(parsedMessage);
	}

	async webSocketClose(
		ws: WebSocket,
		code: number,
		reason: string,
	): Promise<void> {
		const metadata = this.getSocketMetadata(ws);

		if (metadata?.kind === "proxy") {
			this.handleProxySocketClose(metadata.requestId, code, reason);
			return;
		}

		logInfo("tunnel.closed", {
			code,
			reason,
		});
		this.failPendingResponses(new Error("Tunnel connection closed"));
		this.failPendingUpgrades(new Error("Tunnel connection closed"));
		this.closeActiveProxySockets(
			TUNNEL_REPLACED_CLOSE_CODE,
			"Tunnel connection closed",
		);
	}

	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		const metadata = this.getSocketMetadata(ws);
		const message = asErrorMessage(error);

		if (metadata?.kind === "proxy") {
			logError("proxy.websocket_error", {
				requestId: metadata.requestId,
				error: message,
			});
			return;
		}

		logError("tunnel.socket_error", {
			error: message,
		});
		this.failPendingResponses(new Error("Tunnel connection errored"));
		this.failPendingUpgrades(new Error("Tunnel connection errored"));
		this.closeActiveProxySockets(
			TUNNEL_ERROR_CLOSE_CODE,
			"Tunnel connection errored",
		);
	}

	private handleTunnelConnection(): Response {
		const subdomain = this.getTunnelSubdomain();
		const { 0: clientSocket, 1: serverSocket } = new WebSocketPair();
		const existingConnections =
			this.ctx.getWebSockets(CONTROL_SOCKET_TAG).length;

		if (existingConnections > 0) {
			logInfo("tunnel.replaced", {
				subdomain,
				previousConnectionCount: existingConnections,
			});
		}

		this.disconnectExistingClients();
		this.ctx.acceptWebSocket(serverSocket, [CONTROL_SOCKET_TAG]);

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
		if (isWebSocketUpgrade(request)) {
			return this.handleWebSocketProxyRequest(request);
		}

		const tunnelSocket = this.getTunnelSocket();

		if (!tunnelSocket) {
			return this.createUnavailableTunnelResponse(request);
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
				headers: getForwardHttpHeaders(request),
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

			return this.createUnavailableTunnelResponse(
				request,
				"local_server_down",
				requestError.message,
			);
		}
	}

	private async handleWebSocketProxyRequest(
		request: Request,
	): Promise<Response> {
		const tunnelSocket = this.getTunnelSocket();

		if (!tunnelSocket) {
			return jsonError("No active tunnel is connected for this subdomain", 404);
		}

		const requestUrl = new URL(request.url);
		const requestId = crypto.randomUUID();
		const requestedProtocols = getRequestedWebSocketProtocols(request);
		const pendingUpgrade: PendingWebSocketUpgrade = {
			accepted: createDeferred<WebSocketAcceptMessage>(),
			requestedProtocols,
		};
		const { 0: clientSocket, 1: serverSocket } = new WebSocketPair();

		this.pendingUpgrades.set(requestId, pendingUpgrade);

		try {
			this.sendMessage(tunnelSocket, {
				type: "websocket-connect",
				requestId,
				url: `${requestUrl.pathname}${requestUrl.search}`,
				headers: getForwardWebSocketHeaders(request),
				protocols: requestedProtocols,
			});

			const accepted = await withTimeout(
				pendingUpgrade.accepted.promise,
				WEBSOCKET_CONNECT_TIMEOUT_MS,
				`Timed out waiting for the local WebSocket service to accept request ${requestId}`,
			);
			validateAcceptedWebSocketProtocol(
				accepted.protocol,
				pendingUpgrade.requestedProtocols,
			);
			this.ctx.acceptWebSocket(serverSocket, [
				PROXY_SOCKET_TAG,
				buildProxyRequestTag(requestId),
			]);
			this.activeProxySockets.set(requestId, {
				socket: serverSocket,
				remoteClosed: false,
			});

			const responseHeaders = new Headers();

			if (accepted.protocol) {
				responseHeaders.set("sec-websocket-protocol", accepted.protocol);
			}

			return new Response(null, {
				status: 101,
				headers: responseHeaders,
				webSocket: clientSocket,
			});
		} catch (error) {
			const requestError = asError(error);

			logError("proxy.websocket_upgrade_failed", {
				requestId,
				path: requestUrl.pathname,
				error: requestError.message,
			});
			serverSocket.close(
				TUNNEL_ERROR_CLOSE_CODE,
				normalizeWebSocketCloseReason(requestError.message),
			);

			return jsonError(requestError.message, 502);
		} finally {
			this.pendingUpgrades.delete(requestId);
		}
	}

	private createUnavailableTunnelResponse(
		request: Request,
		status: "not_found" | "local_server_down" = "not_found",
		message = "No active tunnel is connected for this subdomain",
	): Promise<Response> | Response {
		if (wantsHtmlResponse(request)) {
			if (status === "local_server_down") {
				return serveLocalServerDownPage(request, this.env);
			}
			return serveTunnelNotFoundPage(request, this.env);
		}

		return jsonError(message, status === "local_server_down" ? 502 : 404);
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

			case "websocket-accept": {
				const pendingUpgrade = this.pendingUpgrades.get(message.requestId);

				if (!pendingUpgrade) {
					return;
				}

				pendingUpgrade.accepted.resolve(message);
				return;
			}

			case "websocket-reject": {
				const pendingUpgrade = this.pendingUpgrades.get(message.requestId);

				if (!pendingUpgrade) {
					return;
				}

				pendingUpgrade.accepted.reject(new Error(message.message));
				return;
			}

			case "websocket-frame": {
				const activeProxySocket = this.getActiveProxySocket(message.requestId);

				if (!activeProxySocket || !isSocketWritable(activeProxySocket.socket)) {
					return;
				}

				try {
					activeProxySocket.socket.send(
						message.isBinary
							? decodeBase64(message.chunk)
							: decodeTextBase64(message.chunk),
					);
				} catch (error) {
					logError("proxy.websocket_frame_forward_failed", {
						requestId: message.requestId,
						error: asErrorMessage(error),
					});
					activeProxySocket.remoteClosed = true;
					activeProxySocket.socket.close(
						TUNNEL_ERROR_CLOSE_CODE,
						"Failed to forward WebSocket frame",
					);
					this.activeProxySockets.delete(message.requestId);
				}
				return;
			}

			case "websocket-close": {
				const activeProxySocket = this.getActiveProxySocket(message.requestId);

				if (!activeProxySocket) {
					return;
				}

				activeProxySocket.remoteClosed = true;

				if (!isSocketWritable(activeProxySocket.socket)) {
					this.activeProxySockets.delete(message.requestId);
					return;
				}

				activeProxySocket.socket.close(
					normalizeWebSocketCloseCode(message.code),
					normalizeWebSocketCloseReason(message.reason),
				);
				return;
			}

			case "error":
				logError("tunnel.client_error", {
					error: message.message,
				});
				this.failPendingResponses(new Error(message.message));
				this.failPendingUpgrades(new Error(message.message));
				this.closeActiveProxySockets(
					TUNNEL_ERROR_CLOSE_CODE,
					"Tunnel client error",
				);
				return;
		}
	}

	private handleProxySocketMessage(
		requestId: string,
		message: string | ArrayBuffer,
	): void {
		const activeProxySocket = this.getActiveProxySocket(requestId);
		const tunnelSocket = this.getTunnelSocket();

		if (
			!activeProxySocket ||
			!tunnelSocket ||
			tunnelSocket.readyState !== WebSocket.OPEN
		) {
			if (activeProxySocket && isSocketWritable(activeProxySocket.socket)) {
				activeProxySocket.remoteClosed = true;
				activeProxySocket.socket.close(
					TUNNEL_ERROR_CLOSE_CODE,
					"Tunnel connection is unavailable",
				);
			}

			this.activeProxySockets.delete(requestId);
			return;
		}

		this.sendMessage(tunnelSocket, {
			type: "websocket-frame",
			requestId,
			chunk:
				typeof message === "string"
					? encodeTextBase64(message)
					: encodeBase64(new Uint8Array(message)),
			isBinary: typeof message !== "string",
		});
	}

	private handleProxySocketClose(
		requestId: string,
		code: number,
		reason: string,
	): void {
		const activeProxySocket = this.getActiveProxySocket(requestId);
		const tunnelSocket = this.getTunnelSocket();
		const remoteClosed = activeProxySocket?.remoteClosed ?? false;

		this.activeProxySockets.delete(requestId);

		if (
			remoteClosed ||
			!tunnelSocket ||
			tunnelSocket.readyState !== WebSocket.OPEN
		) {
			return;
		}

		this.sendMessage(tunnelSocket, {
			type: "websocket-close",
			requestId,
			code,
			reason,
		});
	}

	private getTunnelSocket(): WebSocket | null {
		const sockets = this.ctx.getWebSockets(CONTROL_SOCKET_TAG);

		if (sockets.length === 0) {
			return null;
		}

		const activeSocket = sockets[sockets.length - 1];

		for (const socket of sockets.slice(0, -1)) {
			socket.close(
				TUNNEL_REPLACED_CLOSE_CODE,
				"Replaced by a newer tunnel connection",
			);
		}

		return activeSocket;
	}

	private getActiveProxySocket(requestId: string): ActiveProxySocket | null {
		const activeProxySocket = this.activeProxySockets.get(requestId);

		if (activeProxySocket) {
			return activeProxySocket;
		}

		for (const socket of this.ctx.getWebSockets(PROXY_SOCKET_TAG)) {
			const metadata = this.getSocketMetadata(socket);

			if (metadata?.kind !== "proxy") {
				continue;
			}

			const restoredSocket: ActiveProxySocket = {
				socket,
				remoteClosed: false,
			};

			this.activeProxySockets.set(metadata.requestId, restoredSocket);

			if (metadata.requestId === requestId) {
				return restoredSocket;
			}
		}

		return null;
	}

	private disconnectExistingClients(): void {
		for (const socket of this.ctx.getWebSockets(CONTROL_SOCKET_TAG)) {
			socket.close(
				TUNNEL_REPLACED_CLOSE_CODE,
				"Replaced by a newer tunnel connection",
			);
		}
	}

	private restoreActiveProxySockets(): void {
		for (const socket of this.ctx.getWebSockets(PROXY_SOCKET_TAG)) {
			const metadata = this.getSocketMetadata(socket);

			if (metadata?.kind !== "proxy") {
				continue;
			}

			this.activeProxySockets.set(metadata.requestId, {
				socket,
				remoteClosed: false,
			});
		}
	}

	private closeActiveProxySockets(code: number, reason: string): void {
		for (const socket of this.ctx.getWebSockets(PROXY_SOCKET_TAG)) {
			const metadata = this.getSocketMetadata(socket);

			if (metadata?.kind === "proxy") {
				const activeProxySocket = this.getActiveProxySocket(metadata.requestId);

				if (activeProxySocket) {
					activeProxySocket.remoteClosed = true;
				}
			}

			if (!isSocketWritable(socket)) {
				continue;
			}

			socket.close(code, normalizeWebSocketCloseReason(reason));
		}

		this.activeProxySockets.clear();
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

	private failPendingUpgrades(error: Error): void {
		for (const [requestId, pendingUpgrade] of this.pendingUpgrades) {
			pendingUpgrade.accepted.reject(error);
			this.pendingUpgrades.delete(requestId);
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

	private getSocketMetadata(ws: WebSocket): SocketMetadata | null {
		const tags = this.ctx.getTags(ws);

		if (tags.includes(CONTROL_SOCKET_TAG)) {
			return {
				kind: "control",
			};
		}

		if (!tags.includes(PROXY_SOCKET_TAG)) {
			return null;
		}

		const requestTag = tags.find((tag) =>
			tag.startsWith(PROXY_REQUEST_TAG_PREFIX),
		);

		if (!requestTag) {
			return null;
		}

		return {
			kind: "proxy",
			requestId: requestTag.slice(PROXY_REQUEST_TAG_PREFIX.length),
		};
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

function getForwardHttpHeaders(request: Request): HeaderEntry[] {
	return [...buildForwardHeaders(request, HTTP_HOP_BY_HOP_HEADERS).entries()];
}

function getForwardWebSocketHeaders(request: Request): HeaderEntry[] {
	return [
		...buildForwardHeaders(
			request,
			WEBSOCKET_FORWARD_HEADER_EXCLUSIONS,
		).entries(),
	];
}

function buildForwardHeaders(
	request: Request,
	excludedHeaders: Set<string>,
): Headers {
	const requestHeaders = new Headers();

	for (const [name, value] of request.headers) {
		if (!excludedHeaders.has(name.toLowerCase())) {
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

	return requestHeaders;
}

function getRequestedWebSocketProtocols(request: Request): string[] {
	const headerValue = request.headers.get("sec-websocket-protocol");

	if (!headerValue) {
		return [];
	}

	return headerValue
		.split(",")
		.map((protocol) => protocol.trim())
		.filter(Boolean);
}

function validateAcceptedWebSocketProtocol(
	protocol: string | undefined,
	requestedProtocols: string[],
): void {
	if (!protocol) {
		return;
	}

	if (
		requestedProtocols.length === 0 ||
		!requestedProtocols.includes(protocol)
	) {
		throw new Error(
			`Local WebSocket service selected an unsupported protocol: ${protocol}`,
		);
	}
}

function buildProxyRequestTag(requestId: string): string {
	return `${PROXY_REQUEST_TAG_PREFIX}${requestId}`;
}

function encodeBase64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64");
}

function encodeTextBase64(value: string): string {
	return Buffer.from(value, "utf8").toString("base64");
}

function decodeBase64(value: string): Uint8Array {
	return Buffer.from(value, "base64");
}

function decodeTextBase64(value: string): string {
	return Buffer.from(value, "base64").toString("utf8");
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

function asErrorMessage(error: unknown): string {
	return asError(error).message;
}

function isSocketWritable(socket: WebSocket): boolean {
	return (
		socket.readyState === WebSocket.OPEN ||
		socket.readyState === WebSocket.CLOSING
	);
}

function normalizeWebSocketCloseCode(code?: number): number {
	if (
		typeof code === "number" &&
		((code >= 1000 &&
			code <= 1014 &&
			code !== 1004 &&
			code !== 1005 &&
			code !== 1006) ||
			(code >= 3000 && code <= 4999))
	) {
		return code;
	}

	return TUNNEL_ERROR_CLOSE_CODE;
}

function normalizeWebSocketCloseReason(reason: string): string {
	if (!reason) {
		return "Tunnel closed";
	}

	return reason.slice(0, 123);
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
