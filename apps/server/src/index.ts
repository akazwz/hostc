import {
	API_TUNNELS_PATH,
	type CreateTunnelResponse,
	isTunnelPrefix,
	PROTOCOL_HEADER,
	PROTOCOL_VERSION,
	tunnelIdFromLabel,
} from "@hostc/protocol";

import { resolveTunnelLimits } from "./limits.ts";
import { locationHintFromCf } from "./location.ts";
import { errorResponse, pages } from "./pages.ts";
import { createTunnelId, signConnectToken, verifyConnectToken, verifyTunnelId } from "./token.ts";
import { CONNECT_URL, TUNNEL_MISSING_HEADER } from "./tunnel.ts";

export { Tunnel } from "./tunnel.ts";

/** Expired tunnel ids are never reused; caching their 404 keeps repeat visits off the Durable Object. */
const EXPIRED_CACHE_TTL_SECONDS = 3600;

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		const tunnelId = tunnelIdFromHost(url.host, env.TUNNEL_DOMAIN);
		if (tunnelId !== undefined) {
			return handleTunnelRequest(request, env, ctx, tunnelId);
		}

		if (url.pathname === "/api/health") {
			return Response.json({ ok: true });
		}
		if (url.pathname.startsWith(API_TUNNELS_PATH)) {
			// Checked before routing, so clients on any older protocol (including their old paths)
			// get the 426 they know how to show as "please upgrade".
			const mismatch = checkProtocol(request);
			if (mismatch) {
				return mismatch;
			}
		}
		if (url.pathname === API_TUNNELS_PATH) {
			return request.method === "POST" ? createTunnel(request, env, ctx, url) : jsonError(405, "Method not allowed");
		}
		const connect = url.pathname.match(/^\/api\/tunnels\/([^/]+)\/connect$/);
		if (connect?.[1]) {
			return connectTunnel(request, env, ctx, connect[1]);
		}
		return jsonError(404, "Not found");
	},
} satisfies ExportedHandler<Env>;

/**
 * `undefined` when the host is not under the tunnel domain,
 * `null` when it is but the label does not name a tunnel.
 */
export function tunnelIdFromHost(host: string, tunnelDomain: string): string | null | undefined {
	const suffix = `.${tunnelDomain.toLowerCase()}`;
	const normalized = host.toLowerCase();
	if (!normalized.endsWith(suffix)) {
		return undefined;
	}
	return tunnelIdFromLabel(normalized.slice(0, -suffix.length));
}

async function handleTunnelRequest(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
	tunnelId: string | null,
): Promise<Response> {
	if (tunnelId === null || !(await verifyTunnelId(env.TOKEN_SECRET, tunnelId))) {
		return errorResponse(request, pages.notFound);
	}
	const cache = caches.default;
	const cacheKey = expiredCacheKey(tunnelId);
	if (await cache.match(cacheKey)) {
		return errorResponse(request, pages.notFound);
	}
	try {
		const response = await env.TUNNEL.getByName(tunnelId).fetch(request);
		return cacheIfMissing(response, cache, cacheKey, ctx);
	} catch (error) {
		recordUnavailable(env, "proxy", error);
		return errorResponse(request, pages.unavailable);
	}
}

async function createTunnel(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
	const client = request.headers.get("cf-connecting-ip") ?? "local";
	const { success } = await env.CREATE_LIMIT.limit({ key: client });
	if (!success) {
		return jsonError(429, "Too many tunnels created. Try again in a minute.");
	}

	// An unknown prefix gets a plain address: a newer client still works against this server.
	const asked = ((await request.json().catch(() => null)) as { prefix?: unknown } | null)?.prefix;
	const id = await createTunnelId(env.TOKEN_SECRET);
	const locationHint = locationHintFromCf(request.cf);
	try {
		await env.TUNNEL.getByName(id, locationHint ? { locationHint } : undefined).init({
			tier: "free",
			limits: resolveTunnelLimits("free", env.TUNNEL_LIMITS),
		});
	} catch (error) {
		recordUnavailable(env, "create", error);
		return jsonError(503, "Tunnel service is temporarily unavailable. Try again later.");
	}
	ctx.waitUntil(caches.default.delete(expiredCacheKey(id)));

	const connectUrl = new URL(`${API_TUNNELS_PATH}/${id}/connect`, url);
	connectUrl.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	const body: CreateTunnelResponse = {
		id,
		url: `${url.protocol}//${isTunnelPrefix(asked) ? `${asked}-` : ""}${id}.${env.TUNNEL_DOMAIN}`,
		connectUrl: connectUrl.toString(),
		token: await signConnectToken(env.TOKEN_SECRET, id),
	};
	return Response.json(body, { status: 201 });
}

async function connectTunnel(request: Request, env: Env, ctx: ExecutionContext, id: string): Promise<Response> {
	if (!(await verifyTunnelId(env.TOKEN_SECRET, id))) {
		return jsonError(404, "Tunnel not found");
	}
	if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
		return jsonError(426, "Expected a WebSocket upgrade");
	}
	const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
	if (!token || !(await verifyConnectToken(env.TOKEN_SECRET, id, token))) {
		return jsonError(401, "Invalid tunnel token");
	}
	const cache = caches.default;
	const cacheKey = expiredCacheKey(id);
	if (await cache.match(cacheKey)) {
		return jsonError(404, "Tunnel not found");
	}
	try {
		const response = await env.TUNNEL.getByName(id).fetch(new Request(CONNECT_URL, request));
		return cacheIfMissing(response, cache, cacheKey, ctx);
	} catch (error) {
		recordUnavailable(env, "connect", error);
		return jsonError(503, "Tunnel service is temporarily unavailable. Try again later.");
	}
}

function recordUnavailable(env: Env, op: "create" | "connect" | "proxy", error: unknown): void {
	console.error(
		JSON.stringify({
			event: "do_error",
			op,
			error: error instanceof Error ? error.message : String(error),
		}),
	);
	try {
		env.ERRORS.writeDataPoint({ blobs: [pages.unavailable.title], indexes: [pages.unavailable.title] });
	} catch {
		// Analytics Engine write limits must not mask the 503 fallback.
	}
}

function cacheIfMissing(response: Response, cache: Cache, cacheKey: Request, ctx: ExecutionContext): Response {
	if (!response.headers.has(TUNNEL_MISSING_HEADER)) {
		return response;
	}
	ctx.waitUntil(
		cache.put(
			cacheKey,
			new Response("gone", {
				status: 200,
				headers: { "cache-control": `public, max-age=${EXPIRED_CACHE_TTL_SECONDS}` },
			}),
		),
	);
	const headers = new Headers(response.headers);
	headers.delete(TUNNEL_MISSING_HEADER);
	return new Response(response.body, { status: response.status, headers });
}

function expiredCacheKey(tunnelId: string): Request {
	return new Request(`https://expired.hostc.internal/${tunnelId}`);
}

function checkProtocol(request: Request): Response | null {
	if (request.headers.get(PROTOCOL_HEADER) === String(PROTOCOL_VERSION)) {
		return null;
	}
	return jsonError(426, "This hostc version is not supported by the server. Run `npx hostc@latest` to upgrade.");
}

function jsonError(status: number, error: string): Response {
	return Response.json({ error }, { status });
}
