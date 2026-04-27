import { DurableObject } from "cloudflare:workers";
import { Buffer } from "node:buffer";
import {
	type BinaryPayloadMessage,
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
const HTTP_BODY_BATCH_TARGET_BYTES = 32 * 1024;
const RESPONSE_BODY_CREDIT_BATCH_BYTES = HTTP_BODY_BATCH_TARGET_BYTES;
const RESPONSE_BODY_MAX_OUTSTANDING_CREDIT_BYTES =
	RESPONSE_BODY_CREDIT_BATCH_BYTES * 4;
const SOCKET_BACKPRESSURE_HIGH_WATERMARK = 256 * 1024;
const SOCKET_BACKPRESSURE_LOW_WATERMARK = 64 * 1024;
const SOCKET_BACKPRESSURE_POLL_MS = 4;
const TUNNEL_PROTOCOL_VERSION = 2;
const BINARY_PAYLOAD_CAPABILITY = "binary-payload";
const RESPONSE_BODY_CREDIT_CAPABILITY = "response-body-credit";
const SERVER_CAPABILITIES = [
	BINARY_PAYLOAD_CAPABILITY,
	RESPONSE_BODY_CREDIT_CAPABILITY,
];

type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (reason?: unknown) => void;
};

type PendingResponse = {
	responseStart: Deferred<ResponseStartMessage>;
	controller: ReadableStreamDefaultController<Uint8Array> | null;
	started: boolean;
	useBinaryPayload: boolean;
	useResponseBodyCredit: boolean;
	responseBodyCreditsOutstanding: number;
	responseBodyCreditGrant: Promise<void> | null;
};

type PendingWebSocketUpgrade = {
	accepted: Deferred<WebSocketAcceptMessage>;
	requestedProtocols: string[];
};

type ActiveProxySocket = {
	socket: WebSocket;
	remoteClosed: boolean;
	useBinaryPayload: boolean;
};

type TunnelConnection = {
	socket: WebSocket;
	capabilities: Set<string>;
};

type ControlSocketAttachment = {
	kind: "control";
	generation: string;
	ready: boolean;
	capabilities: string[];
};

type ProxySocketAttachment = {
	kind: "proxy";
	requestId: string;
	useBinaryPayload: boolean;
};

type HibernatableWebSocket = WebSocket & {
	serializeAttachment: (value: unknown) => void;
	deserializeAttachment: () => unknown;
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
	private readonly socketSendQueues = new WeakMap<WebSocket, Promise<void>>();
	private activeControlSocket: WebSocket | null = null;
	private activeControlGeneration: string | null = null;
	private pendingControlBinaryPayload: BinaryPayloadMessage | null = null;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.restoreActiveControlSocket();
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
			await this.handleProxySocketMessage(metadata.requestId, message);
			return;
		}

		if (metadata?.kind !== "control" || !this.isActiveControlSocket(ws)) {
			return;
		}

		if (typeof message !== "string") {
			const pendingBinaryPayload = this.pendingControlBinaryPayload;
			this.pendingControlBinaryPayload = null;

			if (!pendingBinaryPayload) {
				logError("tunnel.invalid_frame", {
					reason: "unexpected_binary_frame",
				});
				ws.close(1003, "Unexpected binary tunnel frame");
				this.failPendingResponses(
					new Error("Tunnel closed because of an unexpected binary frame"),
				);
				this.failPendingUpgrades(
					new Error("Tunnel closed because of an unexpected binary frame"),
				);
				this.closeActiveProxySockets(
					TUNNEL_ERROR_CLOSE_CODE,
					"Tunnel closed because of an unexpected binary frame",
				);
				return;
			}

			try {
				this.handleBinaryTunnelPayload(
					pendingBinaryPayload,
					new Uint8Array(message),
				);
			} catch (error) {
				const errorMessage = asErrorMessage(error);

				logError("tunnel.invalid_binary_payload", {
					requestId: pendingBinaryPayload.requestId,
					stream: pendingBinaryPayload.stream,
					error: errorMessage,
				});
				ws.close(1003, "Invalid binary tunnel payload");
				this.failPendingResponses(
					new Error("Tunnel closed because of an invalid binary payload"),
				);
				this.failPendingUpgrades(
					new Error("Tunnel closed because of an invalid binary payload"),
				);
				this.closeActiveProxySockets(
					TUNNEL_ERROR_CLOSE_CODE,
					"Tunnel closed because of an invalid binary payload",
				);
			}
			return;
		}

		if (this.pendingControlBinaryPayload) {
			logError("tunnel.invalid_message", {
				reason: "missing_binary_payload",
				requestId: this.pendingControlBinaryPayload.requestId,
				stream: this.pendingControlBinaryPayload.stream,
			});
			this.pendingControlBinaryPayload = null;
			ws.close(1003, "Expected a binary tunnel payload frame");
			this.failPendingResponses(
				new Error("Tunnel closed because a binary payload frame was missing"),
			);
			this.failPendingUpgrades(
				new Error("Tunnel closed because a binary payload frame was missing"),
			);
			this.closeActiveProxySockets(
				TUNNEL_ERROR_CLOSE_CODE,
				"Tunnel closed because a binary payload frame was missing",
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

		if (parsedMessage.type === "binary-payload") {
			this.pendingControlBinaryPayload = parsedMessage;
			return;
		}

		this.handleTunnelMessage(ws, parsedMessage);
	}

	async webSocketClose(
		ws: WebSocket,
		code: number,
		reason: string,
	): Promise<void> {
		const metadata = this.getSocketMetadata(ws);

		if (metadata?.kind === "proxy") {
			await this.handleProxySocketClose(metadata.requestId, code, reason);
			return;
		}

		if (metadata?.kind !== "control" || !this.isActiveControlSocket(ws)) {
			return;
		}

		this.clearActiveControlSocket(ws);
		this.pendingControlBinaryPayload = null;

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

		if (metadata?.kind !== "control" || !this.isActiveControlSocket(ws)) {
			return;
		}

		this.clearActiveControlSocket(ws);
		this.pendingControlBinaryPayload = null;

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
		const generation = crypto.randomUUID();
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
		this.activeControlSocket = serverSocket;
		this.activeControlGeneration = generation;
		this.saveControlSocketAttachment(serverSocket, {
			kind: "control",
			generation,
			ready: true,
			capabilities: [],
		});

		logInfo("tunnel.connected", {
			subdomain,
			publicBaseDomain: this.env.PUBLIC_BASE_DOMAIN,
		});

		this.queueMessage(serverSocket, {
			type: "tunnel-ready",
			subdomain,
			publicUrl: buildPublicUrl(this.env.PUBLIC_BASE_DOMAIN, subdomain),
			protocolVersion: TUNNEL_PROTOCOL_VERSION,
			capabilities: SERVER_CAPABILITIES,
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

		const tunnelConnection = this.getTunnelConnection();

		if (!tunnelConnection) {
			return this.createUnavailableTunnelResponse(request);
		}

		const tunnelSocket = tunnelConnection.socket;
		const useBinaryPayload = tunnelConnection.capabilities.has(
			BINARY_PAYLOAD_CAPABILITY,
		);
		const useResponseBodyCredit = tunnelConnection.capabilities.has(
			RESPONSE_BODY_CREDIT_CAPABILITY,
		);

		const requestUrl = new URL(request.url);
		const requestId = crypto.randomUUID();

		const pendingResponse: PendingResponse = {
			responseStart: createDeferred<ResponseStartMessage>(),
			controller: null,
			started: false,
			useBinaryPayload,
			useResponseBodyCredit,
			responseBodyCreditsOutstanding: 0,
			responseBodyCreditGrant: null,
		};

		const responseBody = new ReadableStream<Uint8Array>({
			start(controller) {
				pendingResponse.controller = controller;
			},
			pull: async (controller) => {
				if (
					!pendingResponse.useResponseBodyCredit ||
					!pendingResponse.started
				) {
					return;
				}

				try {
					await this.ensureResponseBodyCredit(requestId, pendingResponse);
				} catch (error) {
					controller.error(asError(error));
					this.pendingResponses.delete(requestId);
				}
			},
			cancel: async () => {
				this.pendingResponses.delete(requestId);
				await this.cancelLocalRequest(
					tunnelSocket,
					requestId,
					"Public response stream was cancelled",
				);
			},
		});

		this.pendingResponses.set(requestId, pendingResponse);

		try {
			await this.sendMessage(tunnelSocket, {
				type: "request-start",
				requestId,
				method: request.method,
				url: `${requestUrl.pathname}${requestUrl.search}`,
				headers: getForwardHttpHeaders(request),
				hasBody: request.body !== null,
				binaryPayload: pendingResponse.useBinaryPayload,
				responseBodyCredit: pendingResponse.useResponseBodyCredit,
			});

			if (request.body) {
				const reader = request.body.getReader();
				let pendingBodyChunks: Uint8Array[] = [];
				let pendingBodyBytes = 0;

				try {
					while (true) {
						const { done, value } = await reader.read();

						if (done) {
							break;
						}

						pendingBodyChunks.push(value);
						pendingBodyBytes += value.byteLength;

						if (pendingBodyBytes >= HTTP_BODY_BATCH_TARGET_BYTES) {
							const batch = concatUint8Arrays(
								pendingBodyChunks,
								pendingBodyBytes,
							);

							if (pendingResponse.useBinaryPayload) {
								await this.sendBinaryPayload(
									tunnelSocket,
									{
										type: "binary-payload",
										requestId,
										stream: "request-body",
									},
									batch,
								);
							} else {
								await this.sendMessage(tunnelSocket, {
									type: "request-body",
									requestId,
									chunk: encodeBase64(batch),
								});
							}

							pendingBodyChunks = [];
							pendingBodyBytes = 0;
						}
					}

					if (pendingBodyBytes > 0) {
						const batch = concatUint8Arrays(
							pendingBodyChunks,
							pendingBodyBytes,
						);

						if (pendingResponse.useBinaryPayload) {
							await this.sendBinaryPayload(
								tunnelSocket,
								{
									type: "binary-payload",
									requestId,
									stream: "request-body",
								},
								batch,
							);
						} else {
							await this.sendMessage(tunnelSocket, {
								type: "request-body",
								requestId,
								chunk: encodeBase64(batch),
							});
						}
					}
				} finally {
					reader.releaseLock();
				}
			}

			await this.sendMessage(tunnelSocket, {
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
			} else if (pendingResponse.useResponseBodyCredit) {
				await this.ensureResponseBodyCredit(requestId, pendingResponse);
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
			await this.cancelLocalRequest(
				tunnelSocket,
				requestId,
				requestError.message,
			);

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
		const tunnelConnection = this.getTunnelConnection();

		if (!tunnelConnection) {
			return jsonError("No active tunnel is connected for this subdomain", 404);
		}

		const tunnelSocket = tunnelConnection.socket;
		const useBinaryPayload = tunnelConnection.capabilities.has(
			BINARY_PAYLOAD_CAPABILITY,
		);

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
			await this.sendMessage(tunnelSocket, {
				type: "websocket-connect",
				requestId,
				url: `${requestUrl.pathname}${requestUrl.search}`,
				headers: getForwardWebSocketHeaders(request),
				protocols: requestedProtocols,
				binaryPayload: useBinaryPayload,
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
				useBinaryPayload,
			});
			this.saveProxySocketAttachment(serverSocket, {
				kind: "proxy",
				requestId,
				useBinaryPayload,
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
			await this.sendMessage(tunnelSocket, {
				type: "websocket-close",
				requestId,
				code: TUNNEL_ERROR_CLOSE_CODE,
				reason: requestError.message,
			}).catch((sendError) => {
				logError("proxy.websocket_cancel_send_failed", {
					requestId,
					error: asErrorMessage(sendError),
				});
			});

			return jsonError(requestError.message, 502);
		} finally {
			this.pendingUpgrades.delete(requestId);
		}
	}

	private createUnavailableTunnelResponse(
		request: Request,
		status: "not_found" | "local_server_down" = "not_found",
		message = "No active tunnel is connected for this subdomain",
	): Response {
		if (wantsHtmlResponse(request)) {
			if (status === "local_server_down") {
				return serveLocalServerDownPage(request);
			}
			return serveTunnelNotFoundPage(request);
		}

		return jsonError(message, status === "local_server_down" ? 502 : 404);
	}

	private handleTunnelMessage(
		ws: WebSocket,
		message: TunnelClientMessage,
	): void {
		switch (message.type) {
			case "client-ready": {
				if (message.protocolVersion !== TUNNEL_PROTOCOL_VERSION) {
					this.queueMessage(ws, {
						type: "error",
						message: "Unsupported tunnel protocol version",
					});
					ws.close(1002, "Unsupported tunnel protocol version");
					return;
				}

				const capabilities = normalizeClientCapabilities(message.capabilities);
				const attachment = this.getControlSocketAttachment(ws);

				if (!attachment) {
					return;
				}

				this.saveControlSocketAttachment(ws, {
					...attachment,
					ready: true,
					capabilities,
				});

				this.queueMessage(ws, {
					type: "tunnel-accepted",
					subdomain: this.getTunnelSubdomain(),
					publicUrl: buildPublicUrl(
						this.env.PUBLIC_BASE_DOMAIN,
						this.getTunnelSubdomain(),
					),
					protocolVersion: TUNNEL_PROTOCOL_VERSION,
					capabilities,
				});
				return;
			}

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

				const chunk = decodeBase64(message.chunk);
				this.consumeResponseBodyCredit(pendingResponse, chunk.byteLength);
				pendingResponse.controller.enqueue(chunk);
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

			case "client-capabilities": {
				const capabilities = normalizeClientCapabilities(message.capabilities);
				const attachment = this.getControlSocketAttachment(ws);

				if (attachment) {
					this.saveControlSocketAttachment(ws, {
						...attachment,
						ready: true,
						capabilities,
					});
				}

				return;
			}

			case "binary-payload":
				return;

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

	private async handleProxySocketMessage(
		requestId: string,
		message: string | ArrayBuffer,
	): Promise<void> {
		const activeProxySocket = this.getActiveProxySocket(requestId);
		const tunnelConnection = this.getTunnelConnection();

		if (
			!activeProxySocket ||
			!tunnelConnection ||
			tunnelConnection.socket.readyState !== WebSocket.OPEN
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

		const tunnelSocket = tunnelConnection.socket;

		try {
			if (typeof message === "string") {
				await this.sendMessage(tunnelSocket, {
					type: "websocket-frame",
					requestId,
					chunk: encodeTextBase64(message),
					isBinary: false,
				});
			} else if (activeProxySocket.useBinaryPayload) {
				await this.sendBinaryPayload(
					tunnelSocket,
					{
						type: "binary-payload",
						requestId,
						stream: "websocket-frame",
					},
					new Uint8Array(message),
				);
			} else {
				await this.sendMessage(tunnelSocket, {
					type: "websocket-frame",
					requestId,
					chunk: encodeBase64(new Uint8Array(message as ArrayBuffer)),
					isBinary: true,
				});
			}
		} catch (error) {
			logError("proxy.websocket_frame_send_failed", {
				requestId,
				error: asErrorMessage(error),
			});

			if (isSocketWritable(activeProxySocket.socket)) {
				activeProxySocket.remoteClosed = true;
				activeProxySocket.socket.close(
					TUNNEL_ERROR_CLOSE_CODE,
					"Tunnel connection is unavailable",
				);
			}

			this.activeProxySockets.delete(requestId);
		}
	}

	private async handleProxySocketClose(
		requestId: string,
		code: number,
		reason: string,
	): Promise<void> {
		const activeProxySocket = this.getActiveProxySocket(requestId);
		const tunnelConnection = this.getTunnelConnection();
		const remoteClosed = activeProxySocket?.remoteClosed ?? false;

		this.activeProxySockets.delete(requestId);

		if (
			remoteClosed ||
			!tunnelConnection ||
			tunnelConnection.socket.readyState !== WebSocket.OPEN
		) {
			return;
		}

		try {
			await this.sendMessage(tunnelConnection.socket, {
				type: "websocket-close",
				requestId,
				code,
				reason,
			});
		} catch (error) {
			logError("proxy.websocket_close_send_failed", {
				requestId,
				error: asErrorMessage(error),
			});
		}
	}

	private getTunnelConnection(): TunnelConnection | null {
		if (
			this.activeControlSocket &&
			this.activeControlSocket.readyState === WebSocket.OPEN
		) {
			const attachment = this.getControlSocketAttachment(
				this.activeControlSocket,
			);

			if (attachment?.ready) {
				return {
					socket: this.activeControlSocket,
					capabilities: new Set(attachment.capabilities),
				};
			}
		}

		this.restoreActiveControlSocket();

		if (
			!this.activeControlSocket ||
			this.activeControlSocket.readyState !== WebSocket.OPEN
		) {
			return null;
		}

		const attachment = this.getControlSocketAttachment(
			this.activeControlSocket,
		);

		if (!attachment?.ready) {
			return null;
		}

		return {
			socket: this.activeControlSocket,
			capabilities: new Set(attachment.capabilities),
		};
	}

	private restoreActiveControlSocket(): void {
		const sockets = this.ctx.getWebSockets(CONTROL_SOCKET_TAG);

		if (sockets.length === 0) {
			this.activeControlSocket = null;
			this.activeControlGeneration = null;
			return;
		}

		const activeSocket = sockets[sockets.length - 1];

		for (const socket of sockets.slice(0, -1)) {
			socket.close(
				TUNNEL_REPLACED_CLOSE_CODE,
				"Replaced by a newer tunnel connection",
			);
		}

		const attachment = this.getControlSocketAttachment(activeSocket);

		this.activeControlSocket = activeSocket;
		this.activeControlGeneration = attachment?.generation ?? null;
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

			const attachment = this.getProxySocketAttachment(socket);

			const restoredSocket: ActiveProxySocket = {
				socket,
				remoteClosed: false,
				useBinaryPayload: attachment?.useBinaryPayload ?? false,
			};

			this.activeProxySockets.set(metadata.requestId, restoredSocket);

			if (metadata.requestId === requestId) {
				return restoredSocket;
			}
		}

		return null;
	}

	private disconnectExistingClients(): void {
		const hadExistingClients =
			this.ctx.getWebSockets(CONTROL_SOCKET_TAG).length > 0;

		this.activeControlSocket = null;
		this.activeControlGeneration = null;
		this.pendingControlBinaryPayload = null;

		for (const socket of this.ctx.getWebSockets(CONTROL_SOCKET_TAG)) {
			socket.close(
				TUNNEL_REPLACED_CLOSE_CODE,
				"Replaced by a newer tunnel connection",
			);
		}

		if (hadExistingClients) {
			this.failPendingResponses(new Error("Tunnel connection replaced"));
			this.failPendingUpgrades(new Error("Tunnel connection replaced"));
			this.closeActiveProxySockets(
				TUNNEL_REPLACED_CLOSE_CODE,
				"Tunnel connection replaced",
			);
		}
	}

	private clearActiveControlSocket(socket: WebSocket): void {
		if (this.activeControlSocket === socket) {
			this.activeControlSocket = null;
			this.activeControlGeneration = null;
		}
	}

	private restoreActiveProxySockets(): void {
		for (const socket of this.ctx.getWebSockets(PROXY_SOCKET_TAG)) {
			const metadata = this.getSocketMetadata(socket);

			if (metadata?.kind !== "proxy") {
				continue;
			}

			const attachment = this.getProxySocketAttachment(socket);

			this.activeProxySockets.set(metadata.requestId, {
				socket,
				remoteClosed: false,
				useBinaryPayload: attachment?.useBinaryPayload ?? false,
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

	private queueMessage(socket: WebSocket, message: TunnelServerMessage): void {
		void this.sendMessage(socket, message).catch((error) => {
			logError("tunnel.send_failed", {
				error: asErrorMessage(error),
				type: message.type,
			});
		});
	}

	private sendMessage(
		socket: WebSocket,
		message: TunnelServerMessage,
	): Promise<void> {
		return this.sendSocketFrames(socket, [JSON.stringify(message)]);
	}

	private sendBinaryPayload(
		socket: WebSocket,
		message: BinaryPayloadMessage,
		payload: Uint8Array,
	): Promise<void> {
		return this.sendSocketFrames(socket, [JSON.stringify(message), payload]);
	}

	private sendSocketFrames(
		socket: WebSocket,
		frames: ReadonlyArray<string | Uint8Array>,
	): Promise<void> {
		const previousSend = this.socketSendQueues.get(socket) ?? Promise.resolve();
		const nextSend = previousSend
			.catch(() => undefined)
			.then(async () => {
				for (const frame of frames) {
					await waitForSocketCapacity(socket);

					if (socket.readyState !== WebSocket.OPEN) {
						throw new Error("Tunnel socket is not open");
					}

					socket.send(frame);
				}
			});

		this.socketSendQueues.set(socket, nextSend);
		return nextSend;
	}

	private ensureResponseBodyCredit(
		requestId: string,
		pendingResponse: PendingResponse,
	): Promise<void> {
		if (!pendingResponse.useResponseBodyCredit || !pendingResponse.started) {
			return Promise.resolve();
		}

		if (pendingResponse.responseBodyCreditGrant) {
			return pendingResponse.responseBodyCreditGrant;
		}

		const grantPromise = (async () => {
			const tunnelConnection = this.getTunnelConnection();

			if (
				!tunnelConnection ||
				tunnelConnection.socket.readyState !== WebSocket.OPEN
			) {
				throw new Error("Tunnel connection is unavailable");
			}

			while (
				this.pendingResponses.has(requestId) &&
				pendingResponse.responseBodyCreditsOutstanding <
					RESPONSE_BODY_MAX_OUTSTANDING_CREDIT_BYTES
			) {
				pendingResponse.responseBodyCreditsOutstanding +=
					RESPONSE_BODY_CREDIT_BATCH_BYTES;

				await this.sendMessage(tunnelConnection.socket, {
					type: "response-body-credit",
					requestId,
					credit: RESPONSE_BODY_CREDIT_BATCH_BYTES,
				});
			}
		})().finally(() => {
			if (pendingResponse.responseBodyCreditGrant === grantPromise) {
				pendingResponse.responseBodyCreditGrant = null;
			}
		});

		pendingResponse.responseBodyCreditGrant = grantPromise;
		return grantPromise;
	}

	private async cancelLocalRequest(
		socket: WebSocket,
		requestId: string,
		reason: string,
	): Promise<void> {
		if (socket.readyState !== WebSocket.OPEN) {
			return;
		}

		try {
			await this.sendMessage(socket, {
				type: "request-cancel",
				requestId,
				reason,
			});
		} catch (error) {
			logError("proxy.request_cancel_send_failed", {
				requestId,
				error: asErrorMessage(error),
			});
		}
	}

	private consumeResponseBodyCredit(
		pendingResponse: PendingResponse,
		byteLength: number,
	): void {
		if (!pendingResponse.useResponseBodyCredit) {
			return;
		}

		pendingResponse.responseBodyCreditsOutstanding = Math.max(
			0,
			pendingResponse.responseBodyCreditsOutstanding - byteLength,
		);
	}

	private handleBinaryTunnelPayload(
		message: BinaryPayloadMessage,
		payload: Uint8Array,
	): void {
		switch (message.stream) {
			case "response-body": {
				const pendingResponse = this.pendingResponses.get(message.requestId);

				if (!pendingResponse?.controller) {
					return;
				}

				this.consumeResponseBodyCredit(pendingResponse, payload.byteLength);
				pendingResponse.controller.enqueue(payload);
				return;
			}

			case "websocket-frame": {
				const activeProxySocket = this.getActiveProxySocket(message.requestId);

				if (!activeProxySocket || !isSocketWritable(activeProxySocket.socket)) {
					return;
				}

				try {
					activeProxySocket.socket.send(payload);
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

			case "request-body":
				throw new Error(
					"Unexpected binary request body payload from tunnel client",
				);
		}
	}

	private getTunnelSubdomain(): string {
		const subdomain = this.ctx.id.name;

		if (!subdomain) {
			throw new Error("Named Durable Object id is required for tunnel routing");
		}

		return subdomain;
	}

	private isActiveControlSocket(ws: WebSocket): boolean {
		if (this.activeControlSocket === ws) {
			return true;
		}

		if (!this.activeControlSocket) {
			this.restoreActiveControlSocket();
		}

		if (this.activeControlSocket === ws) {
			return true;
		}

		const attachment = this.getControlSocketAttachment(ws);
		return (
			attachment !== null &&
			this.activeControlGeneration !== null &&
			attachment.generation === this.activeControlGeneration
		);
	}

	private saveControlSocketAttachment(
		ws: WebSocket,
		attachment: ControlSocketAttachment,
	): void {
		getHibernatableWebSocket(ws).serializeAttachment(attachment);
	}

	private getControlSocketAttachment(
		ws: WebSocket,
	): ControlSocketAttachment | null {
		const attachment = getHibernatableWebSocket(ws).deserializeAttachment();
		return isControlSocketAttachment(attachment) ? attachment : null;
	}

	private saveProxySocketAttachment(
		ws: WebSocket,
		attachment: ProxySocketAttachment,
	): void {
		getHibernatableWebSocket(ws).serializeAttachment(attachment);
	}

	private getProxySocketAttachment(
		ws: WebSocket,
	): ProxySocketAttachment | null {
		const attachment = getHibernatableWebSocket(ws).deserializeAttachment();
		return isProxySocketAttachment(attachment) ? attachment : null;
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

function normalizeClientCapabilities(capabilities: string[]): string[] {
	return SERVER_CAPABILITIES.filter((capability) =>
		capabilities.includes(capability),
	);
}

function getHibernatableWebSocket(ws: WebSocket): HibernatableWebSocket {
	return ws as HibernatableWebSocket;
}

function isControlSocketAttachment(
	value: unknown,
): value is ControlSocketAttachment {
	return (
		isRecord(value) &&
		value.kind === "control" &&
		typeof value.generation === "string" &&
		typeof value.ready === "boolean" &&
		Array.isArray(value.capabilities) &&
		value.capabilities.every((capability) => typeof capability === "string")
	);
}

function isProxySocketAttachment(
	value: unknown,
): value is ProxySocketAttachment {
	return (
		isRecord(value) &&
		value.kind === "proxy" &&
		typeof value.requestId === "string" &&
		typeof value.useBinaryPayload === "boolean"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
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

function encodeTextBase64(value: string): string {
	return Buffer.from(value, "utf8").toString("base64");
}

function encodeBase64(value: Uint8Array): string {
	return Buffer.from(value).toString("base64");
}

function decodeBase64(value: string): Uint8Array {
	return Buffer.from(value, "base64");
}

function decodeTextBase64(value: string): string {
	return Buffer.from(value, "base64").toString("utf8");
}

function concatUint8Arrays(
	chunks: Uint8Array[],
	totalByteLength: number,
): Uint8Array {
	if (chunks.length === 1) {
		return chunks[0];
	}

	const merged = new Uint8Array(totalByteLength);
	let offset = 0;

	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}

	return merged;
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

async function waitForSocketCapacity(socket: WebSocket): Promise<void> {
	if (getSocketBufferedAmount(socket) <= SOCKET_BACKPRESSURE_HIGH_WATERMARK) {
		return;
	}

	while (
		socket.readyState === WebSocket.OPEN &&
		getSocketBufferedAmount(socket) > SOCKET_BACKPRESSURE_LOW_WATERMARK
	) {
		await waitForDelay(SOCKET_BACKPRESSURE_POLL_MS);
	}
}

function getSocketBufferedAmount(socket: WebSocket): number {
	const bufferedSocket = socket as WebSocket & {
		bufferedAmount?: number;
	};

	return typeof bufferedSocket.bufferedAmount === "number"
		? bufferedSocket.bufferedAmount
		: 0;
}

function waitForDelay(delayMs: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, delayMs);
	});
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
