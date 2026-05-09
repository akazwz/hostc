import {
	type CreateTunnelResponse,
	parseCreateTunnelResponse,
	parseRefreshTunnelResponse,
	type RefreshTunnelResponse,
	TUNNELS_API_PATH,
} from "@hostc/protocol";
import { redactToken } from "./redact";

export type FetchLike = (
	input: string | URL,
	init?: RequestInit,
) => Promise<Response>;

export type ApiRequestOptions = {
	timeoutMs?: number;
	signal?: AbortSignal;
};

const DEFAULT_API_TIMEOUT_MS = 15_000;

export async function createTunnel(
	serverUrl: string,
	dataChannels: number,
	fetcher: FetchLike = fetch,
	options: ApiRequestOptions = {},
): Promise<CreateTunnelResponse> {
	const request = createApiRequestController(options);
	try {
		const response = await fetcher(new URL(TUNNELS_API_PATH, serverUrl), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ dataChannels }),
			signal: request.signal,
		});
		const raw = await response.text();
		if (!response.ok) {
			throw new Error(
				`create tunnel failed (${response.status}): ${redactToken(raw)}`,
			);
		}
		const parsed = parseCreateTunnelResponse(raw);
		if (!parsed) {
			throw new Error("create tunnel returned an invalid response");
		}
		return normalizeConnectionUrls(parsed, serverUrl);
	} catch (error) {
		if (request.timedOut()) {
			throw new Error("create tunnel timed out");
		}
		throw error;
	} finally {
		request.clear();
	}
}

export async function refreshTunnel(
	serverUrl: string,
	tunnelId: string,
	refreshToken: string,
	dataChannels: number,
	fetcher: FetchLike = fetch,
	options: ApiRequestOptions = {},
): Promise<RefreshTunnelResponse> {
	const request = createApiRequestController(options);
	try {
		const response = await fetcher(
			new URL(
				`${TUNNELS_API_PATH}/${encodeURIComponent(tunnelId)}/refresh`,
				serverUrl,
			),
			{
				method: "POST",
				headers: {
					authorization: `Bearer ${refreshToken}`,
					"x-hostc-data-channels": String(dataChannels),
				},
				signal: request.signal,
			},
		);
		const raw = await response.text();
		if (!response.ok) {
			throw new Error(
				`refresh tunnel failed (${response.status}): ${redactToken(raw)}`,
			);
		}
		const parsed = parseRefreshTunnelResponse(raw);
		if (!parsed) {
			throw new Error("refresh tunnel returned an invalid response");
		}
		return normalizeConnectionUrls(parsed, serverUrl);
	} catch (error) {
		if (request.timedOut()) {
			throw new Error("refresh tunnel timed out");
		}
		throw error;
	} finally {
		request.clear();
	}
}

function normalizeConnectionUrls<
	T extends { controlUrl: string; dataUrl: string },
>(response: T, serverUrl: string): T {
	const server = new URL(serverUrl);
	if (!isLocalServer(server.hostname)) {
		return response;
	}

	return {
		...response,
		controlUrl: rewriteWebSocketUrl(response.controlUrl, server),
		dataUrl: rewriteWebSocketUrl(response.dataUrl, server),
	};
}

function rewriteWebSocketUrl(raw: string, server: URL): string {
	const url = new URL(raw);
	url.hostname = server.hostname;
	url.port = server.port;
	url.protocol = server.protocol === "https:" ? "wss:" : "ws:";
	return url.toString();
}

function isLocalServer(hostname: string): boolean {
	return (
		hostname === "localhost" ||
		hostname === "127.0.0.1" ||
		hostname === "::1" ||
		hostname === "[::1]"
	);
}

function createApiRequestController(options: ApiRequestOptions): {
	clear: () => void;
	signal: AbortSignal;
	timedOut: () => boolean;
} {
	const controller = new AbortController();
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, options.timeoutMs ?? DEFAULT_API_TIMEOUT_MS);
	timeout.unref?.();

	const abortFromParent = (): void => controller.abort();
	if (options.signal?.aborted) {
		abortFromParent();
	} else {
		options.signal?.addEventListener("abort", abortFromParent, { once: true });
	}

	return {
		signal: controller.signal,
		timedOut: () => timedOut,
		clear: () => {
			clearTimeout(timeout);
			options.signal?.removeEventListener("abort", abortFromParent);
		},
	};
}
