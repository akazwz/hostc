import {
	buildPublicUrl,
	type CreateEphemeralTunnelResponse,
	DEFAULT_DATA_CHANNELS,
	defaultTunnelLimits,
	isValidDataChannelCount,
	MAX_DATA_CHANNELS,
	PROTOCOL_VERSION,
	TUNNEL_KIND_EPHEMERAL,
	TUNNELS_API_PATH,
} from "@hostc/protocol";
import { HostcTunnel } from "./durable/tunnel";
import type { HostcEnv } from "./env";
import { tunnelErrorResponse } from "./error-page";
import { createClientConnectionId, createTunnelId } from "./id";
import { log } from "./log";
import { classifyHost, isWebSocketUpgrade, parseApiRoute } from "./router";
import { createTokenPayload, signToken, verifyToken } from "./token";

const CONNECT_TOKEN_TTL_SECONDS = 60;
const INTERNAL_ORIGIN = "https://hostc.internal";

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
		return tunnelErrorResponse(request, {
			status: 404,
			eyebrow: "404",
			title: "Tunnel not found",
			message:
				"This hostc tunnel does not exist, or the public URL is no longer valid.",
			hint: "Check the URL or restart hostc to create a fresh tunnel.",
		});
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
		case "channel":
			return connectChannel(request, env, apiRoute.tunnelId, apiRoute);
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
	const dataChannels = await parseCreateTunnelDataChannels(request);
	const tunnelId = createTunnelId();
	const clientConnectionId = createClientConnectionId();
	const connectToken = await signToken(
		env.TOKEN_SECRET,
		createTokenPayload(
			"connect",
			tunnelId,
			CONNECT_TOKEN_TTL_SECONDS,
			clientConnectionId,
		),
	);

	await initializeTunnelClientConnection(env, tunnelId, {
		clientConnectionId,
		dataChannels,
	});

	const response: CreateEphemeralTunnelResponse = {
		kind: TUNNEL_KIND_EPHEMERAL,
		protocolVersion: PROTOCOL_VERSION,
		tunnelId,
		publicUrl: buildPublicUrl(env.PUBLIC_BASE_DOMAIN, tunnelId),
		clientConnectionId,
		dataUrl: buildAbsoluteWebSocketUrl(
			requestUrl,
			`${TUNNELS_API_PATH}/${encodeURIComponent(tunnelId)}/channels`,
		),
		connectToken,
		dataChannels,
		limits: defaultTunnelLimits(),
	};

	log({
		event: "tunnel.created",
		tunnelId,
		clientConnectionId,
		dataChannels,
	});
	return Response.json(response, { status: 201 });
}

async function connectChannel(
	request: Request,
	env: HostcEnv,
	tunnelId: string,
	route: Extract<ReturnType<typeof parseApiRoute>, { kind: "channel" }>,
): Promise<Response> {
	if (!isWebSocketUpgrade(request)) {
		return jsonError("Expected WebSocket upgrade", 426);
	}
	if (!route.clientConnectionId) {
		return jsonError("Missing client connection id", 400);
	}

	const connectToken = getBearerToken(request);
	const payload = await verifyToken(env.TOKEN_SECRET, connectToken, {
		audience: "connect",
		tunnelId,
		clientConnectionId: route.clientConnectionId,
	});
	if (!payload?.clientConnectionId) {
		return jsonError("Invalid token", 403);
	}

	const internalUrl = new URL(
		`/_hostc/channels/${route.channelId}`,
		INTERNAL_ORIGIN,
	);
	internalUrl.searchParams.set(
		"clientConnectionId",
		payload.clientConnectionId,
	);
	return env.HOSTC_TUNNEL.getByName(tunnelId).fetch(
		new Request(internalUrl, request),
	);
}

async function initializeTunnelClientConnection(
	env: HostcEnv,
	tunnelId: string,
	body: { clientConnectionId: string; dataChannels: number },
): Promise<void> {
	const response = await env.HOSTC_TUNNEL.getByName(tunnelId).fetch(
		new Request(new URL("/_hostc/init", INTERNAL_ORIGIN), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
	if (!response.ok) {
		throw new Error(`failed to initialize tunnel: ${response.status}`);
	}
}

async function parseCreateTunnelDataChannels(
	request: Request,
): Promise<number> {
	let dataChannels = DEFAULT_DATA_CHANNELS;
	const contentType = request.headers.get("content-type") ?? "";
	if (contentType.includes("application/json")) {
		try {
			const body = (await request.json()) as Record<string, unknown>;
			if (isValidDataChannelCount(body.dataChannels)) {
				dataChannels = body.dataChannels;
			}
		} catch {
			return dataChannels;
		}
	}
	return Math.min(dataChannels, MAX_DATA_CHANNELS);
}

function buildAbsoluteWebSocketUrl(requestUrl: URL, pathname: string): string {
	const url = new URL(pathname, requestUrl);
	url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
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
