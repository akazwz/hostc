import {
	buildPublicUrl,
	buildTunnelControlPath,
	buildTunnelDataPath,
	type CreateTunnelResponse,
	DEFAULT_DATA_CHANNELS,
	defaultTunnelLimits,
	MAX_DATA_CHANNELS,
	type RefreshTunnelResponse,
} from "@hostc/protocol";
import { HostcTunnel } from "./durable/tunnel";
import type { HostcEnv } from "./env";
import { createConnectionId, createTunnelId } from "./id";
import { log } from "./log";
import { classifyHost, isWebSocketUpgrade, parseApiRoute } from "./router";
import { createTokenPayload, signToken, verifyToken } from "./token";

const CONNECT_TOKEN_TTL_SECONDS = 60;
const REFRESH_TOKEN_TTL_SECONDS = 10 * 60;
const INTERNAL_ORIGIN = "https://hostc.internal";

type CreateTunnelOptions = {
	dataChannels: number;
};

export { HostcTunnel };

export default {
	async fetch(request, env): Promise<Response> {
		try {
			return await handleRequest(request, env);
		} catch (error) {
			log({
				event: "server.unhandled",
				error: error instanceof Error ? error.message : String(error),
			});
			return jsonError("Internal server error", 500);
		}
	},
} satisfies ExportedHandler<HostcEnv>;

export async function handleRequest(
	request: Request,
	env: HostcEnv,
): Promise<Response> {
	const url = new URL(request.url);
	const hostRoute = getEffectiveHostRoute(request, url, env);

	if (hostRoute.kind === "unknown") {
		return new Response("Not Found", { status: 404 });
	}

	if (hostRoute.kind === "tunnel") {
		const stub = env.HOSTC_TUNNEL.getByName(hostRoute.tunnelId);
		return stub.fetch(request);
	}

	const apiRoute = parseApiRoute(request.method, url);
	switch (apiRoute.kind) {
		case "health":
			return Response.json({ ok: true });
		case "create":
			return createTunnel(request, env, url);
		case "refresh":
			return refreshTunnel(request, env, url, apiRoute.tunnelId);
		case "control":
			return connectControl(request, env, apiRoute.tunnelId, apiRoute);
		case "data":
			return connectData(request, env, apiRoute.tunnelId, apiRoute);
		case "method-not-allowed":
			return new Response("Method Not Allowed", {
				status: 405,
				headers: { Allow: apiRoute.allow },
			});
		case "invalid":
			return jsonError(apiRoute.message, apiRoute.status);
		case "not-found":
			return new Response("Not Found", { status: 404 });
	}
}

async function createTunnel(
	request: Request,
	env: HostcEnv,
	requestUrl: URL,
): Promise<Response> {
	const options = await parseCreateTunnelOptions(request);
	const tunnelId = createTunnelId();
	const issued = await issueTunnelConnection(
		env,
		requestUrl,
		tunnelId,
		options.dataChannels,
	);
	const response: CreateTunnelResponse = {
		tunnelId,
		publicUrl: buildPublicUrl(env.PUBLIC_BASE_DOMAIN, tunnelId),
		...issued,
	};

	log({
		event: "tunnel.created",
		tunnelId,
		dataChannels: options.dataChannels,
	});
	return Response.json(response, { status: 201 });
}

async function refreshTunnel(
	request: Request,
	env: HostcEnv,
	requestUrl: URL,
	tunnelId: string,
): Promise<Response> {
	const refreshToken = getBearerToken(request);
	const payload = await verifyToken(env.TOKEN_SECRET, refreshToken, {
		audience: "refresh",
		tunnelId,
	});
	if (!payload) {
		return jsonError("Invalid token", 403);
	}

	const dataChannels =
		parseDataChannelsHeader(request) ?? DEFAULT_DATA_CHANNELS;
	const response = await issueTunnelConnection(
		env,
		requestUrl,
		tunnelId,
		dataChannels,
	);
	log({
		event: "tunnel.refreshed",
		tunnelId,
		connectionId: response.connectionId,
	});
	return Response.json(response);
}

async function connectControl(
	request: Request,
	env: HostcEnv,
	tunnelId: string,
	route: Extract<ReturnType<typeof parseApiRoute>, { kind: "control" }>,
): Promise<Response> {
	if (!isWebSocketUpgrade(request)) {
		return jsonError("Expected WebSocket upgrade", 426);
	}

	const connectToken = getBearerToken(request);
	const payload = await verifyToken(env.TOKEN_SECRET, connectToken, {
		audience: "connect",
		tunnelId,
		connectionId: route.connectionId ?? undefined,
	});
	if (!payload?.connectionId) {
		return jsonError("Invalid token", 403);
	}

	const dataChannels = route.dataChannels ?? DEFAULT_DATA_CHANNELS;
	const internalUrl = new URL("/_hostc/control", INTERNAL_ORIGIN);
	internalUrl.searchParams.set("connectionId", payload.connectionId);
	internalUrl.searchParams.set("dataChannels", String(dataChannels));
	return env.HOSTC_TUNNEL.getByName(tunnelId).fetch(
		new Request(internalUrl, request),
	);
}

async function connectData(
	request: Request,
	env: HostcEnv,
	tunnelId: string,
	route: Extract<ReturnType<typeof parseApiRoute>, { kind: "data" }>,
): Promise<Response> {
	if (!isWebSocketUpgrade(request)) {
		return jsonError("Expected WebSocket upgrade", 426);
	}
	if (!route.connectionId) {
		return jsonError("Missing connection id", 400);
	}

	const connectToken = getBearerToken(request);
	const payload = await verifyToken(env.TOKEN_SECRET, connectToken, {
		audience: "connect",
		tunnelId,
		connectionId: route.connectionId,
	});
	if (!payload?.connectionId) {
		return jsonError("Invalid token", 403);
	}

	const internalUrl = new URL("/_hostc/data", INTERNAL_ORIGIN);
	internalUrl.searchParams.set("connectionId", payload.connectionId);
	internalUrl.searchParams.set("channel", String(route.channelId));
	return env.HOSTC_TUNNEL.getByName(tunnelId).fetch(
		new Request(internalUrl, request),
	);
}

async function issueTunnelConnection(
	env: HostcEnv,
	requestUrl: URL,
	tunnelId: string,
	dataChannels: number,
): Promise<RefreshTunnelResponse> {
	const connectionId = createConnectionId();
	const [connectToken, refreshToken] = await Promise.all([
		signToken(
			env.TOKEN_SECRET,
			createTokenPayload(
				"connect",
				tunnelId,
				CONNECT_TOKEN_TTL_SECONDS,
				connectionId,
			),
		),
		signToken(
			env.TOKEN_SECRET,
			createTokenPayload("refresh", tunnelId, REFRESH_TOKEN_TTL_SECONDS),
		),
	]);
	const controlUrl = buildAbsoluteWebSocketUrl(
		requestUrl,
		buildTunnelControlPath(tunnelId),
		{
			connectionId,
			dataChannels: String(dataChannels),
		},
	);
	const dataUrl = buildAbsoluteWebSocketUrl(
		requestUrl,
		buildTunnelDataPath(tunnelId),
	);

	return {
		connectionId,
		controlUrl,
		dataUrl,
		connectToken,
		refreshToken,
		dataChannels,
		limits: defaultTunnelLimits(),
	};
}

async function parseCreateTunnelOptions(
	request: Request,
): Promise<CreateTunnelOptions> {
	let dataChannels = DEFAULT_DATA_CHANNELS;
	const contentType = request.headers.get("content-type") ?? "";
	if (contentType.includes("application/json")) {
		try {
			const body = (await request.json()) as Record<string, unknown>;
			if (
				Number.isInteger(body.dataChannels) &&
				(body.dataChannels as number) >= 1 &&
				(body.dataChannels as number) <= MAX_DATA_CHANNELS
			) {
				dataChannels = body.dataChannels as number;
			}
		} catch {
			return { dataChannels };
		}
	}
	return { dataChannels };
}

function parseDataChannelsHeader(request: Request): number | null {
	const raw = request.headers.get("x-hostc-data-channels");
	if (!raw) {
		return null;
	}
	const value = Number(raw);
	return Number.isInteger(value) && value >= 1 && value <= MAX_DATA_CHANNELS
		? value
		: null;
}

function buildAbsoluteWebSocketUrl(
	requestUrl: URL,
	pathname: string,
	searchParams: Record<string, string> = {},
): string {
	const url = new URL(pathname, requestUrl);
	url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
	for (const [key, value] of Object.entries(searchParams)) {
		url.searchParams.set(key, value);
	}
	return url.toString();
}

function getBearerToken(request: Request): string {
	const authorization = request.headers.get("authorization") ?? "";
	const [scheme, token, ...rest] = authorization.trim().split(/\s+/);
	if (scheme?.toLowerCase() !== "bearer" || !token || rest.length > 0) {
		return "";
	}
	return token;
}

function getEffectiveHostRoute(
	request: Request,
	url: URL,
	env: HostcEnv,
): ReturnType<typeof classifyHost> {
	if (env.ALLOW_LOCAL_TUNNEL_HEADER === "1" || isLocalHostname(url.hostname)) {
		const tunnelHost = request.headers.get("x-hostc-local-tunnel-host");
		if (tunnelHost) {
			const tunnelRoute = classifyHost(tunnelHost, env.PUBLIC_BASE_DOMAIN);
			if (tunnelRoute.kind === "tunnel") {
				return tunnelRoute;
			}
		}
	}
	return classifyHost(url.hostname, env.PUBLIC_BASE_DOMAIN);
}

function isLocalHostname(hostname: string): boolean {
	return (
		hostname === "localhost" ||
		hostname === "127.0.0.1" ||
		hostname === "::1" ||
		hostname === "[::1]"
	);
}

function jsonError(message: string, status: number): Response {
	return Response.json({ error: message }, { status });
}
