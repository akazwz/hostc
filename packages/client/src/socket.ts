import {
	CLOSE_INTERNAL_ERROR,
	normalizeWebSocketCloseCode,
	normalizeWebSocketCloseReason,
	utf8Encode,
} from "@hostc/protocol";
import WebSocket, { type RawData } from "ws";

const DATA_SOCKET_BACKPRESSURE_HIGH_WATERMARK = 512 * 1024;
const DATA_SOCKET_BACKPRESSURE_LOW_WATERMARK = 128 * 1024;
const DATA_SOCKET_BACKPRESSURE_POLL_MS = 4;
const WEBSOCKET_CONNECT_TIMEOUT_MS = 15_000;

export function openWebSocket(url: string, token: string): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(url, {
			headers: { authorization: `Bearer ${token}` },
		});
		const timeout = setTimeout(() => {
			cleanup();
			safeCloseWebSocket(socket, CLOSE_INTERNAL_ERROR, "connect timeout");
			reject(new Error("WebSocket connect timed out"));
		}, WEBSOCKET_CONNECT_TIMEOUT_MS);
		timeout.unref?.();
		const cleanup = (): void => {
			clearTimeout(timeout);
			socket.off("open", onOpen);
			socket.off("error", onError);
			socket.off("close", onClose);
		};
		const onOpen = (): void => {
			cleanup();
			resolve(socket);
		};
		const onError = (error: Error): void => {
			cleanup();
			reject(error);
		};
		const onClose = (code: number, reason: Buffer): void => {
			cleanup();
			reject(
				new Error(`WebSocket closed before open: ${code} ${reason.toString()}`),
			);
		};
		socket.once("open", onOpen);
		socket.once("error", onError);
		socket.once("close", onClose);
	});
}

export function rawDataToUint8Array(data: RawData): Uint8Array {
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

export async function waitForSocketCapacity(socket: WebSocket): Promise<void> {
	if (socket.bufferedAmount <= DATA_SOCKET_BACKPRESSURE_HIGH_WATERMARK) {
		return;
	}
	while (
		socket.readyState === WebSocket.OPEN &&
		socket.bufferedAmount > DATA_SOCKET_BACKPRESSURE_LOW_WATERMARK
	) {
		await sleep(DATA_SOCKET_BACKPRESSURE_POLL_MS);
	}
}

export function safeCloseWebSocket(
	socket: WebSocket | null | undefined,
	code: number,
	reason: string,
): void {
	if (!socket) {
		return;
	}
	try {
		socket.close(
			normalizeWebSocketCloseCode(code),
			normalizeWebSocketCloseReason(reason),
		);
	} catch {
		socket.terminate();
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
