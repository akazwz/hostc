import {
	DEFAULT_DATA_CHANNELS,
	EPHEMERAL_TUNNELS_API_PATH,
	PROTOCOL_VERSION,
	parseCreateEphemeralTunnelResponse,
} from "@hostc/protocol";
import type { HostcTunnelLimits } from "./client-types.js";

export type HostcEphemeralTunnel = {
	readonly kind: "ephemeral";
	readonly protocolVersion: 4;
	readonly tunnelId: string;
	readonly publicUrl: string;
	readonly clientConnectionId: string;
	readonly dataUrl: string;
	readonly connectToken: string;
	readonly dataChannels: number;
	readonly limits: HostcTunnelLimits;
};

export class HostcProtocolUpgradeError extends Error {
	constructor(detail?: string) {
		super(createProtocolUpgradeMessage(detail));
		this.name = "HostcProtocolUpgradeError";
	}
}

export async function createEphemeralTunnel(options: {
	serverUrl: string;
	dataChannels?: number;
	fetcher?: typeof fetch;
	signal?: AbortSignal;
	timeoutMs?: number;
}): Promise<HostcEphemeralTunnel> {
	const fetcher = options.fetcher ?? fetch;
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(),
		options.timeoutMs ?? 15_000,
	);
	timeout.unref?.();
	const abortFromParent = (): void => controller.abort();
	options.signal?.addEventListener("abort", abortFromParent, { once: true });
	try {
		const response = await fetcher(
			new URL(EPHEMERAL_TUNNELS_API_PATH, options.serverUrl),
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					dataChannels: options.dataChannels ?? DEFAULT_DATA_CHANNELS,
				}),
				signal: controller.signal,
			},
		);
		const text = await response.text();
		if (response.status === 426) {
			throw new HostcProtocolUpgradeError(text || "server requires upgrade");
		}
		if (!response.ok) {
			throw new Error(`create tunnel failed (${response.status}): ${text}`);
		}
		let json: unknown;
		try {
			json = JSON.parse(text);
		} catch {
			throw new Error("create tunnel returned invalid JSON");
		}
		let parsed: HostcEphemeralTunnel;
		try {
			parsed = parseCreateEphemeralTunnelResponse(json);
		} catch {
			throw new HostcProtocolUpgradeError(describeProtocolMismatch(json));
		}
		return rewriteLocalDataUrl(parsed, options.serverUrl);
	} finally {
		clearTimeout(timeout);
		options.signal?.removeEventListener("abort", abortFromParent);
	}
}

export function withJitter(delayMs: number, jitterRatio = 0.2): number {
	const spread = delayMs * jitterRatio;
	return Math.max(0, Math.round(delayMs - spread + Math.random() * spread * 2));
}

function rewriteLocalDataUrl(
	response: HostcEphemeralTunnel,
	serverUrl: string,
): HostcEphemeralTunnel {
	const server = new URL(serverUrl);
	if (!isLocalServer(server.hostname)) {
		return response;
	}
	const dataUrl = new URL(response.dataUrl);
	dataUrl.hostname = server.hostname;
	dataUrl.port = server.port;
	dataUrl.protocol = server.protocol === "https:" ? "wss:" : "ws:";
	return { ...response, dataUrl: dataUrl.toString() };
}

function describeProtocolMismatch(value: unknown): string {
	if (!isRecord(value)) {
		return `server did not return a v${PROTOCOL_VERSION} create tunnel response`;
	}
	if ("protocolVersion" in value) {
		return `server protocolVersion is ${String(value.protocolVersion)}, CLI expects ${PROTOCOL_VERSION}`;
	}
	return `server did not return a v${PROTOCOL_VERSION} create tunnel response`;
}

function createProtocolUpgradeMessage(detail?: string): string {
	const lines = [
		"This hostc CLI is incompatible with the tunnel server protocol.",
	];
	if (detail) {
		lines.push(`Reason: ${detail}`);
	}
	lines.push("Please upgrade hostc CLI:", "npm i -g hostc@latest");
	return lines.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLocalServer(hostname: string): boolean {
	return (
		hostname === "localhost" ||
		hostname === "127.0.0.1" ||
		hostname === "::1" ||
		hostname === "[::1]"
	);
}
