#!/usr/bin/env node

import type { IncomingMessage } from "node:http";
import {
	type BinaryPayloadMessage,
	buildTunnelRefreshPath,
	type CreateTunnelResponse,
	type HeaderEntry,
	parseCreateTunnelResponse,
	parseRefreshTunnelSessionResponse,
	parseTunnelServerMessage,
	type RefreshTunnelSessionResponse,
	type RequestStartMessage,
	TUNNELS_API_PATH,
	type TunnelClientMessage,
	type WebSocketConnectMessage,
} from "@hostc/tunnel-protocol";
import chalk from "chalk";
import { Command, InvalidArgumentError } from "commander";
import { renderUnicode } from "uqr";
import { WebSocket as LocalWebSocket, type RawData } from "ws";

type HttpCommandOptions = {
	localHost: string;
	qr: boolean;
};

type HttpTunnelOptions = {
	port: number;
	localHost: string;
	qr: boolean;
};

type RequestInitWithDuplex = RequestInit & {
	duplex?: "half";
};

type LocalRequestContext = {
	abortController: AbortController;
	writer: WritableStreamDefaultWriter<Uint8Array> | null;
	writeChain: Promise<void>;
};

type LocalWebSocketContext = {
	socket: LocalWebSocket;
	opened: boolean;
	remoteClosed: boolean;
	handshakeSettled: boolean;
};

type Spinner = {
	start: () => void;
	update: (text: string) => void;
	succeed: (text: string) => void;
	fail: (text: string) => void;
	stop: (text?: string) => void;
};

type ConnectionOutcome =
	| {
			kind: "interrupted";
	  }
	| {
			kind: "disconnected";
			message: string;
	  };

type RefreshReason = "scheduled" | "reconnect";

class CliError extends Error {
	constructor(
		message: string,
		readonly alreadyReported = false,
	) {
		super(message);
		this.name = "CliError";
	}
}

const DEFAULT_SERVER = "https://hostc.dev";
const SERVER_OVERRIDE_ENV = "HOSTC_SERVER_URL";
const SPINNER_FRAMES = ["-", "\\", "|", "/"];
const SESSION_REFRESH_INTERVAL_MS = 5 * 60_000;
const SESSION_REFRESH_RETRY_MS = 30_000;
const DEFAULT_WEBSOCKET_CLOSE_CODE = 1011;
const TUNNEL_REPLACED_CLOSE_CODE = 1012;
const HTTP_BODY_BATCH_TARGET_BYTES = 32 * 1024;
const TUNNEL_SOCKET_BACKPRESSURE_HIGH_WATERMARK = 256 * 1024;
const TUNNEL_SOCKET_BACKPRESSURE_LOW_WATERMARK = 64 * 1024;
const TUNNEL_SOCKET_BACKPRESSURE_POLL_MS = 4;
const TERMINAL_QR_DARK_MODULE = "\u001B[40m  \u001B[0m";
const TERMINAL_QR_LIGHT_MODULE = "\u001B[47m  \u001B[0m";

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

const LOCAL_WEBSOCKET_HEADER_EXCLUSIONS = new Set([
	...HTTP_HOP_BY_HOP_HEADERS,
	"sec-websocket-extensions",
	"sec-websocket-key",
	"sec-websocket-protocol",
	"sec-websocket-version",
]);

async function main(): Promise<void> {
	const program = new Command()
		.name("hostc")
		.description(
			"Expose a local web service (HTTP + WebSocket) through a hostc tunnel",
		)
		.version("1.2.1")
		.showHelpAfterError();

	program

		.argument("<port>", "local port to expose", parsePort)
		.option(
			"--local-host <host>",
			"Host of the local service",
			parseLocalHost,
			"127.0.0.1",
		)
		.option(
			"--qr",
			"Show a scannable QR code for the public URL when stdout is a TTY",
			false,
		)
		.addHelpText("after", "\nExamples:\n  hostc 3000\n  hostc 3000 --qr\n")
		.action(async (port: number, options: HttpCommandOptions) => {
			await runHttpTunnel({
				port,
				localHost: options.localHost,
				qr: options.qr,
			});
		});

	if (process.argv.length <= 2) {
		program.outputHelp();
		return;
	}

	await program.parseAsync(process.argv);
}

async function runHttpTunnel(options: HttpTunnelOptions): Promise<void> {
	const tunnelServer = resolveTunnelServerUrl();
	const localOrigin = buildLocalOrigin(options.localHost, options.port);
	const spinner = createSpinner(`Creating tunnel -> ${localOrigin.href}`);
	let tunnel: CreateTunnelResponse;
	let interrupted = false;
	let readyOnce = false;
	let activeSocket: WebSocket | null = null;
	let stopSessionRefreshLoop: (() => void) | null = null;
	let refreshPromise: Promise<void> | null = null;

	spinner.start();

	try {
		tunnel = await createTunnel(tunnelServer);
		spinner.update(
			`Connecting tunnel ${tunnel.subdomain} -> ${localOrigin.href}`,
		);
	} catch (error) {
		const message = formatError(error);
		spinner.fail(message);
		throw new CliError(message, true);
	}

	const closeTunnel = (code = 1000, reason = "Interrupted"): void => {
		if (
			activeSocket &&
			(activeSocket.readyState === WebSocket.OPEN ||
				activeSocket.readyState === WebSocket.CONNECTING)
		) {
			activeSocket.close(code, reason);
		}
	};

	const refreshSession = async (_reason: RefreshReason): Promise<void> => {
		if (refreshPromise) {
			return refreshPromise;
		}

		refreshPromise = (async () => {
			const refreshedSession = await refreshTunnelSession(
				tunnelServer,
				tunnel.tunnelId,
				tunnel.sessionToken,
			);

			tunnel = {
				...tunnel,
				websocketUrl: refreshedSession.websocketUrl,
				sessionToken: refreshedSession.sessionToken,
			};
		})().finally(() => {
			refreshPromise = null;
		});

		return refreshPromise;
	};

	const interruptTunnel = (): void => {
		interrupted = true;
		closeTunnel();
	};

	process.once("SIGINT", interruptTunnel);
	process.once("SIGTERM", interruptTunnel);

	try {
		while (!interrupted) {
			if (readyOnce) {
				console.log(
					chalk.gray(
						`Reconnecting tunnel ${tunnel.subdomain} -> ${localOrigin.href}`,
					),
				);
			}

			let outcome: ConnectionOutcome;

			try {
				outcome = await openTunnelConnection({
					tunnel,
					localOrigin,
					spinner,
					initialConnection: !readyOnce,
					qr: options.qr,
					interrupted: () => interrupted,
					registerSocket(socket) {
						activeSocket = socket;
					},
					onReady() {
						if (readyOnce) {
							return;
						}

						readyOnce = true;
						stopSessionRefreshLoop = startSessionRefreshLoop({
							interrupted: () => interrupted,
							refreshSession,
							subdomain: tunnel.subdomain,
						});
					},
				});
			} catch (error) {
				const message = formatError(error);

				if (readyOnce) {
					console.error(chalk.red(message));
				} else {
					spinner.fail(message);
				}

				throw new CliError(message, true);
			}

			activeSocket = null;

			if (outcome.kind === "interrupted") {
				if (readyOnce) {
					console.log(chalk.gray("Tunnel closed"));
				} else {
					spinner.stop("Tunnel closed");
				}

				break;
			}

			if (readyOnce) {
				console.error(
					chalk.yellow(`${outcome.message}. Attempting to reconnect...`),
				);
			} else {
				spinner.update("Connection lost, refreshing session and retrying");
			}

			try {
				await refreshSession("reconnect");
			} catch (error) {
				const message = `Tunnel disconnected and failed to refresh session (${formatError(error)})`;

				if (readyOnce) {
					console.error(chalk.red(message));
				} else {
					spinner.fail(message);
				}

				throw new CliError(message, true);
			}
		}
	} finally {
		invokeOptionalCallback(stopSessionRefreshLoop);
		stopSessionRefreshLoop = null;

		spinner.stop();
		process.off("SIGINT", interruptTunnel);
		process.off("SIGTERM", interruptTunnel);
		closeTunnel();
	}
}

void main().catch((error) => {
	if (!(error instanceof CliError && error.alreadyReported)) {
		console.error(chalk.red(formatError(error)));
	}

	process.exit(1);
});

function parsePort(value: string): number {
	const port = Number.parseInt(value, 10);

	if (!Number.isInteger(port) || port <= 0 || port > 65535) {
		throw new InvalidArgumentError(
			`Expected a port between 1 and 65535, got: ${value}`,
		);
	}

	return port;
}

function normalizeServerUrl(value: string, source: string): string {
	const trimmed = value.trim();

	if (!trimmed) {
		throw new CliError(`${source} cannot be empty`);
	}

	let url: URL;

	try {
		url = new URL(trimmed);
	} catch {
		throw new CliError(
			`Expected ${source} to be an http or https URL, got: ${value}`,
		);
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new CliError(
			`Expected ${source} to be an http or https URL, got: ${value}`,
		);
	}

	return url.toString();
}

function resolveTunnelServerUrl(): string {
	const override = process.env[SERVER_OVERRIDE_ENV];

	if (override === undefined) {
		return DEFAULT_SERVER;
	}

	return normalizeServerUrl(
		override,
		`environment variable ${SERVER_OVERRIDE_ENV}`,
	);
}

function parseLocalHost(value: string): string {
	const trimmed = value.trim();

	if (!trimmed) {
		throw new InvalidArgumentError("Local host cannot be empty");
	}

	return trimmed;
}

function createSpinner(initialText: string): Spinner {
	const stream = process.stdout;
	let currentText = initialText;
	let frameIndex = 0;
	let timer: NodeJS.Timeout | null = null;

	const clearLine = (): void => {
		if (!stream.isTTY) {
			return;
		}

		stream.clearLine(0);
		stream.cursorTo(0);
	};

	const draw = (frame: string): void => {
		if (!stream.isTTY) {
			return;
		}

		clearLine();
		stream.write(`${chalk.cyan(frame)} ${currentText}`);
	};

	const stopTimer = (): void => {
		if (timer === null) {
			return;
		}

		clearInterval(timer);
		timer = null;
	};

	const writeFinal = (icon: string, text: string): void => {
		clearLine();
		stream.write(`${icon} ${text}\n`);
	};

	return {
		start(): void {
			if (!stream.isTTY || timer !== null) {
				return;
			}

			draw(SPINNER_FRAMES[frameIndex]);
			frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
			timer = setInterval(() => {
				draw(SPINNER_FRAMES[frameIndex]);
				frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
			}, 80);
			timer.unref?.();
		},

		update(text: string): void {
			currentText = text;

			if (timer !== null) {
				draw(SPINNER_FRAMES[frameIndex]);
			}
		},

		succeed(text: string): void {
			stopTimer();
			writeFinal(chalk.green("[ok]"), text);
		},

		fail(text: string): void {
			stopTimer();
			writeFinal(chalk.red("[x]"), text);
		},

		stop(text?: string): void {
			stopTimer();

			if (text) {
				writeFinal(chalk.gray("[i]"), text);
				return;
			}

			clearLine();
		},
	};
}

function buildLocalOrigin(localHost: string, port: number): URL {
	const url = new URL("http://127.0.0.1");

	url.hostname = localHost;
	url.port = String(port);

	return url;
}

function renderTerminalQr(text: string): string {
	return renderUnicode(text, {
		blackChar: TERMINAL_QR_DARK_MODULE,
		whiteChar: TERMINAL_QR_LIGHT_MODULE,
	});
}

function logPublicUrl(publicUrl: string, showQr: boolean): void {
	console.log(chalk.cyan(`Public URL: ${publicUrl}`));

	if (!showQr || !process.stdout.isTTY || process.env.TERM === "dumb") {
		return;
	}

	try {
		console.log(chalk.gray("Scan on your phone:"));
		console.log(renderTerminalQr(publicUrl));
	} catch (error) {
		console.error(
			chalk.yellow(`Failed to render QR code: ${formatError(error)}`),
		);
	}
}

function invokeOptionalCallback(callback: (() => void) | null): void {
	if (typeof callback === "function") {
		callback();
	}
}

function buildCreateTunnelUrl(server: string): string {
	const serverUrl = new URL(server);

	serverUrl.pathname = TUNNELS_API_PATH;
	serverUrl.search = "";

	return serverUrl.toString();
}

function buildRefreshTunnelUrl(server: string, tunnelId: string): string {
	const serverUrl = new URL(buildTunnelRefreshPath(tunnelId), server);

	serverUrl.search = "";

	return serverUrl.toString();
}

async function createTunnel(server: string): Promise<CreateTunnelResponse> {
	return requestTunnelJson({
		action: "create tunnel",
		invalidResponseMessage: "Received an invalid create tunnel response",
		parse: parseCreateTunnelResponse,
		url: buildCreateTunnelUrl(server),
		init: {
			method: "POST",
		},
	});
}

async function refreshTunnelSession(
	server: string,
	tunnelId: string,
	sessionToken: string,
): Promise<RefreshTunnelSessionResponse> {
	return requestTunnelJson({
		action: "refresh tunnel session",
		invalidResponseMessage: "Received an invalid refresh tunnel response",
		parse: parseRefreshTunnelSessionResponse,
		url: buildRefreshTunnelUrl(server, tunnelId),
		init: {
			method: "POST",
			headers: {
				authorization: `Bearer ${sessionToken}`,
			},
		},
	});
}

async function requestTunnelJson<T>(options: {
	action: string;
	invalidResponseMessage: string;
	parse: (raw: string) => T | null;
	url: string;
	init?: RequestInit;
}): Promise<T> {
	const response = await fetch(options.url, options.init);
	const rawBody = await response.text();

	if (!response.ok) {
		throw new Error(
			parseErrorMessage(rawBody) ??
				`Failed to ${options.action} (${response.status})`,
		);
	}

	const parsed = options.parse(rawBody);

	if (!parsed) {
		throw new Error(options.invalidResponseMessage);
	}

	return parsed;
}

function startSessionRefreshLoop(options: {
	interrupted: () => boolean;
	refreshSession: (reason: RefreshReason) => Promise<void>;
	subdomain: string;
}): () => void {
	let stopped = false;
	let timeoutHandle: NodeJS.Timeout | null = null;

	const schedule = (delayMs: number): void => {
		if (stopped) {
			return;
		}

		timeoutHandle = setTimeout(() => {
			void tick();
		}, delayMs);
		timeoutHandle.unref?.();
	};

	const tick = async (): Promise<void> => {
		if (stopped || options.interrupted()) {
			return;
		}

		try {
			await options.refreshSession("scheduled");
			schedule(SESSION_REFRESH_INTERVAL_MS);
		} catch (error) {
			if (!options.interrupted()) {
				console.error(
					chalk.yellow(
						`Failed to refresh tunnel session for ${options.subdomain}: ${formatError(error)}`,
					),
				);
			}

			schedule(SESSION_REFRESH_RETRY_MS);
		}
	};

	schedule(SESSION_REFRESH_INTERVAL_MS);

	return (): void => {
		stopped = true;

		if (timeoutHandle !== null) {
			clearTimeout(timeoutHandle);
			timeoutHandle = null;
		}
	};
}

async function openTunnelConnection(options: {
	tunnel: CreateTunnelResponse;
	localOrigin: URL;
	spinner: Spinner;
	initialConnection: boolean;
	qr: boolean;
	interrupted: () => boolean;
	registerSocket: (socket: WebSocket | null) => void;
	onReady: () => void;
}): Promise<ConnectionOutcome> {
	const tunnelSocket = new WebSocket(options.tunnel.websocketUrl);
	const localRequests = new Map<string, LocalRequestContext>();
	const localSockets = new Map<string, LocalWebSocketContext>();
	let sendQueue = Promise.resolve();
	let pendingBinaryPayload: BinaryPayloadMessage | null = null;
	let useBinaryPayload = false;
	let opened = false;
	let ready = false;

	options.registerSocket(tunnelSocket);

	return new Promise<ConnectionOutcome>((resolve, reject) => {
		tunnelSocket.addEventListener("open", () => {
			opened = true;

			if (options.initialConnection) {
				options.spinner.update(
					`WebSocket connected, waiting for tunnel ${options.tunnel.subdomain}`,
				);
			}
		});

		tunnelSocket.addEventListener("message", (event) => {
			void handleServerMessage(event).catch((error) => {
				reject(new Error(formatError(error)));

				if (
					tunnelSocket.readyState === WebSocket.OPEN ||
					tunnelSocket.readyState === WebSocket.CONNECTING
				) {
					tunnelSocket.close(1011, "Client error");
				}
			});
		});

		tunnelSocket.addEventListener("error", () => {
			if (options.initialConnection && !ready) {
				options.spinner.update("Connection errored, waiting for close");
			}
		});

		tunnelSocket.addEventListener("close", (event) => {
			abortLocalRequests(localRequests);
			closeLocalWebSockets(
				localSockets,
				TUNNEL_REPLACED_CLOSE_CODE,
				"Tunnel connection closed",
			);
			pendingBinaryPayload = null;
			options.registerSocket(null);

			if (options.interrupted()) {
				resolve({ kind: "interrupted" });
				return;
			}

			const detail = event.reason ? `: ${event.reason}` : "";
			const label = opened ? "Tunnel disconnected" : "Tunnel failed to connect";

			resolve({
				kind: "disconnected",
				message: `${label} (${event.code}${detail})`,
			});
		});

		async function handleServerMessage(event: MessageEvent): Promise<void> {
			const incomingMessage = await readTunnelSocketMessage(event.data);

			if (incomingMessage.kind === "binary") {
				const binaryPayload = pendingBinaryPayload;
				pendingBinaryPayload = null;

				if (!binaryPayload) {
					throw new Error("Received an unexpected binary tunnel payload");
				}

				handleBinaryPayload(binaryPayload, incomingMessage.payload);
				return;
			}

			if (pendingBinaryPayload) {
				const missingPayload = pendingBinaryPayload;
				pendingBinaryPayload = null;
				throw new Error(
					`Expected a binary payload frame for ${missingPayload.stream} ${missingPayload.requestId}`,
				);
			}

			const message = parseTunnelServerMessage(incomingMessage.text);

			if (!message) {
				throw new Error("Received an invalid tunnel message");
			}

			if (message.type === "binary-payload") {
				pendingBinaryPayload = message;
				return;
			}

			switch (message.type) {
				case "tunnel-ready":
					if (!ready) {
						ready = true;
						options.onReady();

						if (message.capabilities?.includes("binary-payload")) {
							useBinaryPayload = true;
							queueBackgroundMessage({
								type: "client-capabilities",
								capabilities: ["binary-payload"],
							});
						}

						if (options.initialConnection) {
							options.spinner.succeed(
								`Tunnel ready ${options.tunnel.subdomain} -> ${options.localOrigin.href}`,
							);
							logPublicUrl(message.publicUrl, options.qr);
						} else {
							console.log(
								chalk.green(
									`Tunnel reconnected ${options.tunnel.subdomain} -> ${options.localOrigin.href}`,
								),
							);
						}
					}

					return;

				case "error":
					reject(new Error(message.message));

					if (
						tunnelSocket.readyState === WebSocket.OPEN ||
						tunnelSocket.readyState === WebSocket.CONNECTING
					) {
						tunnelSocket.close(1011, "Server error");
					}

					return;

				case "request-start":
					void startLocalRequest(message).catch((error) => {
						sendMessage({
							type: "response-error",
							requestId: message.requestId,
							message: formatError(error),
						});
					});
					return;

				case "request-body": {
					const requestContext = localRequests.get(message.requestId);

					if (!requestContext?.writer) {
						return;
					}

					requestContext.writeChain = requestContext.writeChain.then(() =>
						requestContext.writer?.write(decodeBase64(message.chunk)),
					);
					return;
				}

				case "request-end": {
					const requestContext = localRequests.get(message.requestId);

					if (!requestContext?.writer) {
						return;
					}

					requestContext.writeChain = requestContext.writeChain.then(() =>
						requestContext.writer?.close(),
					);
					return;
				}

				case "websocket-connect":
					try {
						startLocalWebSocket(message);
					} catch (error) {
						sendMessage({
							type: "websocket-reject",
							requestId: message.requestId,
							message: formatError(error),
						});
					}
					return;

				case "websocket-frame":
					forwardFrameToLocalWebSocket(
						message.requestId,
						message.chunk,
						message.isBinary,
					);
					return;

				case "websocket-close":
					closeLocalWebSocket(message.requestId, message.code, message.reason);
					return;
			}
		}

		function handleBinaryPayload(
			message: BinaryPayloadMessage,
			payload: Uint8Array,
		): void {
			switch (message.stream) {
				case "request-body": {
					const requestContext = localRequests.get(message.requestId);

					if (!requestContext?.writer) {
						return;
					}

					requestContext.writeChain = requestContext.writeChain.then(() =>
						requestContext.writer?.write(payload),
					);
					return;
				}

				case "websocket-frame":
					forwardBinaryFrameToLocalWebSocket(message.requestId, payload);
					return;

				case "response-body":
					throw new Error("Received an unexpected binary response payload");
			}
		}

		async function startLocalRequest(
			message: RequestStartMessage,
		): Promise<void> {
			const proxyUrl = new URL(message.url, options.localOrigin);
			const proxyHeaders = new Headers(
				stripHttpHopByHopHeaders(message.headers),
			);
			const abortController = new AbortController();

			let bodyStream: ReadableStream<Uint8Array> | undefined;
			let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

			if (message.hasBody) {
				const streamPair = new TransformStream<Uint8Array, Uint8Array>();
				bodyStream = streamPair.readable;
				writer = streamPair.writable.getWriter();
			}

			const requestContext: LocalRequestContext = {
				abortController,
				writer,
				writeChain: Promise.resolve(),
			};

			localRequests.set(message.requestId, requestContext);

			try {
				const requestInit: RequestInitWithDuplex = {
					method: message.method,
					headers: proxyHeaders,
					body: bodyStream,
					duplex: bodyStream ? "half" : undefined,
					signal: abortController.signal,
				};

				const localResponse = await fetch(proxyUrl, requestInit);

				await sendMessage({
					type: "response-start",
					requestId: message.requestId,
					status: localResponse.status,
					statusText: localResponse.statusText,
					headers: headersToEntries(localResponse.headers),
					hasBody: localResponse.body !== null,
				});

				if (localResponse.body) {
					const reader = localResponse.body.getReader();
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

								if (useBinaryPayload) {
									await sendBinaryPayload(
										message.requestId,
										"response-body",
										batch,
									);
								} else {
									await sendMessage({
										type: "response-body",
										requestId: message.requestId,
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

							if (useBinaryPayload) {
								await sendBinaryPayload(
									message.requestId,
									"response-body",
									batch,
								);
							} else {
								await sendMessage({
									type: "response-body",
									requestId: message.requestId,
									chunk: encodeBase64(batch),
								});
							}
						}
					} finally {
						reader.releaseLock();
					}
				}

				await sendMessage({
					type: "response-end",
					requestId: message.requestId,
				});
			} catch (error) {
				await sendMessage({
					type: "response-error",
					requestId: message.requestId,
					message: formatError(error),
				});
			} finally {
				localRequests.delete(message.requestId);
			}
		}

		function startLocalWebSocket(message: WebSocketConnectMessage): void {
			const proxyUrl = buildLocalWebSocketUrl(options.localOrigin, message.url);
			const localSocket = new LocalWebSocket(proxyUrl, message.protocols, {
				headers: headersToNodeRecord(
					stripLocalWebSocketHeaders(message.headers),
				),
			});
			const socketContext: LocalWebSocketContext = {
				socket: localSocket,
				opened: false,
				remoteClosed: false,
				handshakeSettled: false,
			};

			localSockets.set(message.requestId, socketContext);

			const rejectHandshake = (reason: string): void => {
				if (socketContext.handshakeSettled) {
					return;
				}

				socketContext.handshakeSettled = true;
				localSockets.delete(message.requestId);
				queueBackgroundMessage({
					type: "websocket-reject",
					requestId: message.requestId,
					message: reason,
				});
			};

			localSocket.once("open", () => {
				socketContext.opened = true;
				socketContext.handshakeSettled = true;
				queueBackgroundMessage({
					type: "websocket-accept",
					requestId: message.requestId,
					protocol: localSocket.protocol || undefined,
				});
			});

			localSocket.on("message", (data: RawData, isBinary: boolean) => {
				if (isBinary) {
					if (useBinaryPayload) {
						queueBackgroundBinaryPayload(
							message.requestId,
							"websocket-frame",
							rawDataToBuffer(data),
						);
					} else {
						queueBackgroundMessage({
							type: "websocket-frame",
							requestId: message.requestId,
							chunk: encodeBase64(rawDataToBuffer(data)),
							isBinary: true,
						});
					}
					return;
				}

				queueBackgroundMessage({
					type: "websocket-frame",
					requestId: message.requestId,
					chunk: encodeBase64(rawDataToBuffer(data)),
					isBinary: false,
				});
			});

			localSocket.once(
				"unexpected-response",
				(_request, response: IncomingMessage) => {
					rejectHandshake(formatUnexpectedWebSocketResponse(response));
					response.resume();
					localSocket.terminate();
				},
			);

			localSocket.on("error", (error) => {
				if (!socketContext.handshakeSettled) {
					rejectHandshake(formatError(error));
				}
			});

			localSocket.on("close", (code, reasonBuffer) => {
				const reason = Buffer.from(reasonBuffer).toString("utf8");
				const wasOpened = socketContext.opened;
				const handshakeSettled = socketContext.handshakeSettled;
				const remoteClosed = socketContext.remoteClosed;

				localSockets.delete(message.requestId);

				if (!wasOpened && !handshakeSettled) {
					rejectHandshake(formatLocalWebSocketClose(code, reason));
					return;
				}

				if (!wasOpened || remoteClosed) {
					return;
				}

				queueBackgroundMessage({
					type: "websocket-close",
					requestId: message.requestId,
					code,
					reason,
				});
			});
		}

		function forwardFrameToLocalWebSocket(
			requestId: string,
			chunk: string,
			isBinary: boolean,
		): void {
			if (isBinary) {
				forwardBinaryFrameToLocalWebSocket(requestId, decodeBase64(chunk));
				return;
			}

			const socketContext = localSockets.get(requestId);

			if (
				!socketContext ||
				socketContext.socket.readyState !== LocalWebSocket.OPEN
			) {
				return;
			}

			socketContext.socket.send(
				decodeTextBase64(chunk),
				{ binary: false },
				(error) => {
					if (!error) {
						return;
					}

					console.error(
						chalk.yellow(
							`Failed to forward WebSocket frame for ${requestId}: ${formatError(error)}`,
						),
					);

					if (socketContext.socket.readyState === LocalWebSocket.OPEN) {
						socketContext.socket.close(
							DEFAULT_WEBSOCKET_CLOSE_CODE,
							"Failed to forward WebSocket frame",
						);
					}
				},
			);
		}

		function forwardBinaryFrameToLocalWebSocket(
			requestId: string,
			payload: Uint8Array,
		): void {
			const socketContext = localSockets.get(requestId);

			if (
				!socketContext ||
				socketContext.socket.readyState !== LocalWebSocket.OPEN
			) {
				return;
			}

			socketContext.socket.send(payload, { binary: true }, (error) => {
				if (!error) {
					return;
				}

				console.error(
					chalk.yellow(
						`Failed to forward WebSocket frame for ${requestId}: ${formatError(error)}`,
					),
				);

				if (socketContext.socket.readyState === LocalWebSocket.OPEN) {
					socketContext.socket.close(
						DEFAULT_WEBSOCKET_CLOSE_CODE,
						"Failed to forward WebSocket frame",
					);
				}
			});
		}

		function closeLocalWebSocket(
			requestId: string,
			code: number | undefined,
			reason: string,
		): void {
			const socketContext = localSockets.get(requestId);

			if (!socketContext) {
				return;
			}

			socketContext.remoteClosed = true;

			if (
				socketContext.socket.readyState === LocalWebSocket.CLOSING ||
				socketContext.socket.readyState === LocalWebSocket.CLOSED
			) {
				localSockets.delete(requestId);
				return;
			}

			socketContext.socket.close(
				normalizeWebSocketCloseCode(code),
				normalizeWebSocketCloseReason(reason),
			);
		}

		function queueBackgroundMessage(message: TunnelClientMessage): void {
			void sendMessage(message).catch(() => undefined);
		}

		function queueBackgroundBinaryPayload(
			requestId: string,
			stream: BinaryPayloadMessage["stream"],
			payload: Uint8Array,
		): void {
			void sendBinaryPayload(requestId, stream, payload).catch(() => undefined);
		}

		function sendMessage(message: TunnelClientMessage): Promise<void> {
			return sendSocketFrames([JSON.stringify(message)]);
		}

		function sendBinaryPayload(
			requestId: string,
			stream: BinaryPayloadMessage["stream"],
			payload: Uint8Array,
		): Promise<void> {
			return sendSocketFrames([
				JSON.stringify({
					type: "binary-payload",
					requestId,
					stream,
				} satisfies BinaryPayloadMessage),
				payload,
			]);
		}

		function sendSocketFrames(
			frames: ReadonlyArray<string | Uint8Array>,
		): Promise<void> {
			const nextSend = sendQueue
				.catch(() => undefined)
				.then(async () => {
					for (const frame of frames) {
						await waitForTunnelSocketCapacity(tunnelSocket);

						if (tunnelSocket.readyState !== WebSocket.OPEN) {
							throw new Error("Tunnel connection is unavailable");
						}

						tunnelSocket.send(
							typeof frame === "string"
								? frame
								: (frame as ArrayBufferView<ArrayBuffer>),
						);
					}
				});

			sendQueue = nextSend;
			return nextSend;
		}
	});
}

async function readTunnelSocketMessage(data: MessageEvent["data"]): Promise<
	| {
			kind: "text";
			text: string;
	  }
	| {
			kind: "binary";
			payload: Uint8Array;
	  }
> {
	if (typeof data === "string") {
		return {
			kind: "text",
			text: data,
		};
	}

	if (data instanceof ArrayBuffer) {
		return {
			kind: "binary",
			payload: new Uint8Array(data),
		};
	}

	if (ArrayBuffer.isView(data)) {
		return {
			kind: "binary",
			payload: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
		};
	}

	if (data instanceof Blob) {
		return {
			kind: "binary",
			payload: new Uint8Array(await data.arrayBuffer()),
		};
	}

	throw new Error("Unsupported WebSocket message payload");
}

function abortLocalRequests(
	localRequests: Map<string, LocalRequestContext>,
): void {
	for (const requestContext of localRequests.values()) {
		requestContext.abortController.abort();
	}
}

function closeLocalWebSockets(
	localSockets: Map<string, LocalWebSocketContext>,
	code: number,
	reason: string,
): void {
	for (const socketContext of localSockets.values()) {
		socketContext.remoteClosed = true;

		if (
			socketContext.socket.readyState === LocalWebSocket.CONNECTING ||
			socketContext.socket.readyState === LocalWebSocket.OPEN
		) {
			socketContext.socket.close(
				normalizeWebSocketCloseCode(code),
				normalizeWebSocketCloseReason(reason),
			);
		}
	}

	localSockets.clear();
}

function stripHttpHopByHopHeaders(headers: HeaderEntry[]): HeaderEntry[] {
	return headers.filter(
		([name]) => !HTTP_HOP_BY_HOP_HEADERS.has(name.toLowerCase()),
	);
}

function stripLocalWebSocketHeaders(headers: HeaderEntry[]): HeaderEntry[] {
	return headers.filter(
		([name]) => !LOCAL_WEBSOCKET_HEADER_EXCLUSIONS.has(name.toLowerCase()),
	);
}

function headersToEntries(headers: Headers): HeaderEntry[] {
	const responseHeaders: HeaderEntry[] = [];

	for (const [name, value] of headers) {
		if (!HTTP_HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
			responseHeaders.push([name, value]);
		}
	}

	return responseHeaders;
}

function headersToNodeRecord(headers: HeaderEntry[]): Record<string, string> {
	const result: Record<string, string> = {};

	for (const [name, value] of headers) {
		const existingValue = result[name];
		result[name] = existingValue ? `${existingValue}, ${value}` : value;
	}

	return result;
}

function buildLocalWebSocketUrl(localOrigin: URL, path: string): string {
	const proxyUrl = new URL(path, localOrigin);

	proxyUrl.protocol = proxyUrl.protocol === "https:" ? "wss:" : "ws:";

	return proxyUrl.toString();
}

async function waitForTunnelSocketCapacity(socket: WebSocket): Promise<void> {
	if (
		getTunnelSocketBufferedAmount(socket) <=
		TUNNEL_SOCKET_BACKPRESSURE_HIGH_WATERMARK
	) {
		return;
	}

	while (
		socket.readyState === WebSocket.OPEN &&
		getTunnelSocketBufferedAmount(socket) >
			TUNNEL_SOCKET_BACKPRESSURE_LOW_WATERMARK
	) {
		await waitForTunnelDelay(TUNNEL_SOCKET_BACKPRESSURE_POLL_MS);
	}
}

function getTunnelSocketBufferedAmount(socket: WebSocket): number {
	return typeof socket.bufferedAmount === "number" ? socket.bufferedAmount : 0;
}

function waitForTunnelDelay(delayMs: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, delayMs);
	});
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

function encodeBase64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64");
}

function decodeBase64(value: string): Uint8Array {
	return Buffer.from(value, "base64");
}

function decodeTextBase64(value: string): string {
	return Buffer.from(value, "base64").toString("utf8");
}

function rawDataToBuffer(value: RawData): Buffer {
	if (Array.isArray(value)) {
		return Buffer.concat(value.map((chunk) => Buffer.from(chunk)));
	}

	if (value instanceof ArrayBuffer) {
		return Buffer.from(new Uint8Array(value));
	}

	return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
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

	return DEFAULT_WEBSOCKET_CLOSE_CODE;
}

function normalizeWebSocketCloseReason(reason: string): string {
	if (!reason) {
		return "Tunnel closed";
	}

	return reason.slice(0, 123);
}

function formatUnexpectedWebSocketResponse(response: IncomingMessage): string {
	const statusCode = response.statusCode ?? 502;
	const statusMessage = response.statusMessage?.trim();

	if (statusMessage) {
		return `Local WebSocket service rejected the upgrade (${statusCode} ${statusMessage})`;
	}

	return `Local WebSocket service rejected the upgrade (${statusCode})`;
}

function formatLocalWebSocketClose(code: number, reason: string): string {
	if (reason) {
		return `Local WebSocket connection closed during handshake (${code}: ${reason})`;
	}

	return `Local WebSocket connection closed during handshake (${code})`;
}

function formatError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return typeof error === "string" ? error : "Unknown error";
}

function parseErrorMessage(rawBody: string): string | null {
	try {
		const parsed = JSON.parse(rawBody) as { error?: unknown };
		return typeof parsed.error === "string" ? parsed.error : null;
	} catch {
		return rawBody.trim() || null;
	}
}
