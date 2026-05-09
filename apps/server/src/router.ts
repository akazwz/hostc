import {
	isValidChannelId,
	isValidTunnelId,
	MAX_DATA_CHANNELS,
} from "@hostc/protocol";

export type HostRoute =
	| { kind: "app" }
	| { kind: "tunnel"; tunnelId: string }
	| { kind: "unknown" };

export type ApiRoute =
	| { kind: "health" }
	| { kind: "create" }
	| { kind: "refresh"; tunnelId: string }
	| {
			kind: "control";
			tunnelId: string;
			connectionId: string | null;
			dataChannels: number | null;
	  }
	| {
			kind: "data";
			tunnelId: string;
			channelId: number;
			connectionId: string | null;
	  }
	| { kind: "not-found" }
	| { kind: "invalid"; status: number; message: string }
	| { kind: "method-not-allowed"; allow: string };

export function classifyHost(hostname: string, baseDomain: string): HostRoute {
	const rawHost = stripHostnamePort(hostname).replace(/\.$/, "");
	const host = rawHost.toLowerCase();
	const base = normalizeHostname(baseDomain);

	if (isLocalAppHost(host) || host === base) {
		return { kind: "app" };
	}

	const suffix = `.${base}`;
	if (host.endsWith(suffix)) {
		const label = host.slice(0, -suffix.length);
		const rawLabel = rawHost.slice(0, rawHost.length - suffix.length);
		if (!label || label.includes(".") || rawLabel !== rawLabel.toLowerCase()) {
			return { kind: "unknown" };
		}
		if (!isValidTunnelId(label)) {
			return { kind: "unknown" };
		}
		return { kind: "tunnel", tunnelId: label };
	}

	return { kind: "unknown" };
}

export function parseApiRoute(method: string, url: URL): ApiRoute {
	const pathname = stripTrailingSlash(url.pathname);
	if (pathname === "/health") {
		return method === "GET"
			? { kind: "health" }
			: { kind: "method-not-allowed", allow: "GET" };
	}
	if (pathname === "/api/tunnels") {
		return method === "POST"
			? { kind: "create" }
			: { kind: "method-not-allowed", allow: "POST" };
	}

	const parts = pathname.split("/").filter(Boolean);
	if (parts.length !== 4 || parts[0] !== "api" || parts[1] !== "tunnels") {
		return { kind: "not-found" };
	}

	const tunnelId = decodeURIComponent(parts[2] ?? "");
	if (!isValidTunnelId(tunnelId)) {
		return { kind: "invalid", status: 400, message: "Invalid tunnel id" };
	}

	switch (parts[3]) {
		case "refresh":
			return method === "POST"
				? { kind: "refresh", tunnelId }
				: { kind: "method-not-allowed", allow: "POST" };
		case "control":
			if (method !== "GET") {
				return { kind: "method-not-allowed", allow: "GET" };
			}
			return {
				kind: "control",
				tunnelId,
				connectionId: url.searchParams.get("connectionId"),
				dataChannels: parseDataChannels(url.searchParams.get("dataChannels")),
			};
		case "data": {
			if (method !== "GET") {
				return { kind: "method-not-allowed", allow: "GET" };
			}
			const channelRaw = url.searchParams.get("channel");
			const channelId = channelRaw === null ? NaN : Number(channelRaw);
			if (!isValidChannelId(channelId, MAX_DATA_CHANNELS)) {
				return { kind: "invalid", status: 400, message: "Invalid channel" };
			}
			return {
				kind: "data",
				tunnelId,
				channelId,
				connectionId: url.searchParams.get("connectionId"),
			};
		}
		default:
			return { kind: "not-found" };
	}
}

export function isWebSocketUpgrade(request: Request): boolean {
	const upgrade = request.headers.get("upgrade")?.toLowerCase();
	const connection = request.headers.get("connection") ?? "";
	return (
		upgrade === "websocket" &&
		connection
			.split(",")
			.some((token) => token.trim().toLowerCase() === "upgrade")
	);
}

export function normalizeHostname(hostname: string): string {
	return stripHostnamePort(hostname).replace(/\.$/, "").toLowerCase();
}

function stripHostnamePort(hostname: string): string {
	return hostname.startsWith("[")
		? hostname
		: (hostname.split(":")[0] ?? hostname);
}

function stripTrailingSlash(pathname: string): string {
	return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function isLocalAppHost(host: string): boolean {
	return (
		host === "localhost" ||
		host.endsWith(".localhost") ||
		host === "127.0.0.1" ||
		host === "::1" ||
		host === "[::1]"
	);
}

function parseDataChannels(raw: string | null): number | null {
	if (raw === null || raw === "") {
		return null;
	}
	const value = Number(raw);
	return Number.isInteger(value) && value >= 1 && value <= MAX_DATA_CHANNELS
		? value
		: null;
}
