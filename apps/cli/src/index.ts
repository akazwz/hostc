#!/usr/bin/env node

import {
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
} from "@hostc/tunnel-protocol";
import chalk from "chalk";
import { Command, InvalidArgumentError } from "commander";

type HttpCommandOptions = {
	localHost: string;
	server: string;
};

type HttpTunnelOptions = {
	port: number;
	localHost: string;
	server: string;
};

type RequestInitWithDuplex = RequestInit & {
	duplex?: "half";
};

type LocalRequestContext = {
	abortController: AbortController;
	writer: WritableStreamDefaultWriter<Uint8Array> | null;
	writeChain: Promise<void>;
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
const SPINNER_FRAMES = ["-", "\\", "|", "/"];
const SESSION_REFRESH_INTERVAL_MS = 5 * 60_000;
const SESSION_REFRESH_RETRY_MS = 30_000;

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

async function main(): Promise<void> {
	const program = new Command()
		.name("hostc")
		.description("Expose local HTTP services through a hostc tunnel")
		.version("0.0.0")
		.showHelpAfterError();

	program
		.command("http")
		.description("Expose a local HTTP server")
		.argument("<port>", "local port to expose", parsePort)
		.option(
			"--server <url>",
			"Override tunnel server URL",
			parseServerUrl,
			DEFAULT_SERVER,
		)
		.option("--local-host <host>", "Local host", parseLocalHost, "127.0.0.1")
		.addHelpText("after", "\nExamples:\n  hostc http 5173\n")
		.action(async (port: number, options: HttpCommandOptions) => {
			await runHttpTunnel({
				port,
				localHost: options.localHost,
				server: options.server,
			});
		});

	if (process.argv.length <= 2) {
		program.outputHelp();
		return;
	}

	await program.parseAsync(process.argv);
}

async function runHttpTunnel(options: HttpTunnelOptions): Promise<void> {
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
		tunnel = await createTunnel(options.server);
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
				options.server,
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

function parseServerUrl(value: string): string {
	let url: URL;

	try {
		url = new URL(value);
	} catch {
		throw new InvalidArgumentError(
			`Expected an http or https URL, got: ${value}`,
		);
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new InvalidArgumentError(
			`Expected an http or https URL, got: ${value}`,
		);
	}

	return url.toString();
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
	const response = await fetch(buildCreateTunnelUrl(server), {
		method: "POST",
	});

	const rawBody = await response.text();

	if (!response.ok) {
		throw new Error(
			parseErrorMessage(rawBody) ??
				`Failed to create tunnel (${response.status})`,
		);
	}

	const createdTunnel = parseCreateTunnelResponse(rawBody);

	if (!createdTunnel) {
		throw new Error("Received an invalid create tunnel response");
	}

	return createdTunnel;
}

async function refreshTunnelSession(
	server: string,
	tunnelId: string,
	sessionToken: string,
): Promise<RefreshTunnelSessionResponse> {
	const response = await fetch(buildRefreshTunnelUrl(server, tunnelId), {
		method: "POST",
		headers: {
			authorization: `Bearer ${sessionToken}`,
		},
	});

	const rawBody = await response.text();

	if (!response.ok) {
		throw new Error(
			parseErrorMessage(rawBody) ??
				`Failed to refresh tunnel session (${response.status})`,
		);
	}

	const refreshedSession = parseRefreshTunnelSessionResponse(rawBody);

	if (!refreshedSession) {
		throw new Error("Received an invalid refresh tunnel response");
	}

	return refreshedSession;
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
	interrupted: () => boolean;
	registerSocket: (socket: WebSocket | null) => void;
	onReady: () => void;
}): Promise<ConnectionOutcome> {
	const tunnelSocket = new WebSocket(options.tunnel.websocketUrl);
	const localRequests = new Map<string, LocalRequestContext>();
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
			const rawMessage = await readMessageText(event.data);
			const message = parseTunnelServerMessage(rawMessage);

			if (!message) {
				throw new Error("Received an invalid tunnel message");
			}

			switch (message.type) {
				case "tunnel-ready":
					if (!ready) {
						ready = true;
						options.onReady();

						if (options.initialConnection) {
							options.spinner.succeed(
								`Tunnel ready ${options.tunnel.subdomain} -> ${options.localOrigin.href}`,
							);
							console.log(chalk.cyan(`Public URL: ${message.publicUrl}`));
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
			}
		}

		async function startLocalRequest(
			message: RequestStartMessage,
		): Promise<void> {
			const proxyUrl = new URL(message.url, options.localOrigin);
			const proxyHeaders = new Headers(stripHopByHopHeaders(message.headers));
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

				sendMessage({
					type: "response-start",
					requestId: message.requestId,
					status: localResponse.status,
					statusText: localResponse.statusText,
					headers: headersToEntries(localResponse.headers),
					hasBody: localResponse.body !== null,
				});

				if (localResponse.body) {
					const reader = localResponse.body.getReader();

					try {
						while (true) {
							const { done, value } = await reader.read();

							if (done) {
								break;
							}

							sendMessage({
								type: "response-body",
								requestId: message.requestId,
								chunk: encodeBase64(value),
							});
						}
					} finally {
						reader.releaseLock();
					}
				}

				sendMessage({
					type: "response-end",
					requestId: message.requestId,
				});
			} catch (error) {
				sendMessage({
					type: "response-error",
					requestId: message.requestId,
					message: formatError(error),
				});
			} finally {
				localRequests.delete(message.requestId);
			}
		}

		function sendMessage(message: TunnelClientMessage): void {
			if (tunnelSocket.readyState !== WebSocket.OPEN) {
				return;
			}

			tunnelSocket.send(JSON.stringify(message));
		}
	});
}

async function readMessageText(data: MessageEvent["data"]): Promise<string> {
	if (typeof data === "string") {
		return data;
	}

	if (data instanceof ArrayBuffer) {
		return Buffer.from(data).toString("utf8");
	}

	if (ArrayBuffer.isView(data)) {
		return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(
			"utf8",
		);
	}

	if (data instanceof Blob) {
		return data.text();
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

function stripHopByHopHeaders(headers: HeaderEntry[]): HeaderEntry[] {
	return headers.filter(
		([name]) => !HOP_BY_HOP_HEADERS.has(name.toLowerCase()),
	);
}

function headersToEntries(headers: Headers): HeaderEntry[] {
	const responseHeaders: HeaderEntry[] = [];

	for (const [name, value] of headers) {
		if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
			responseHeaders.push([name, value]);
		}
	}

	return responseHeaders;
}

function encodeBase64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64");
}

function decodeBase64(value: string): Uint8Array {
	return Buffer.from(value, "base64");
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
