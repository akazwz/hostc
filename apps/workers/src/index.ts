import {
	buildPublicUrl,
	type CreateTunnelResponse,
	normalizeSubdomain,
	type RefreshTunnelSessionResponse,
	TUNNELS_API_PATH,
} from "@hostc/tunnel-protocol";
import { HostcDurableObject } from "./durable/tunnel";
import { createConnectToken, verifyConnectToken } from "./lib/connect-token";
import { createSessionToken, verifySessionToken } from "./lib/session-token";
import {
	buildTunnelWebSocketUrl,
	createRandomSubdomain,
	extractTunnelSubdomain,
} from "./lib/tunnels";

const INTERNAL_CONNECT_PATH = "/_internal/connect";
const CONNECT_ROUTE_SUFFIX = "/connect";
const REFRESH_ROUTE_SUFFIX = "/refresh";

const worker: ExportedHandler<Env> = {
	async fetch(request, env): Promise<Response> {
		try {
			return await handleRequest(request, env);
		} catch (error) {
			console.error(
				JSON.stringify({
					event: "worker.unhandled_error",
					error: asErrorMessage(error),
					path: new URL(request.url).pathname,
				}),
			);

			return jsonError("Internal server error", 500);
		}
	},
};

export { HostcDurableObject };
export default worker;

async function handleRequest(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);

	if (request.method === "POST" && url.pathname === TUNNELS_API_PATH) {
		return createTunnel(env, url);
	}

	const refreshTunnelId = matchTunnelRouteId(
		url.pathname,
		REFRESH_ROUTE_SUFFIX,
	);

	if (request.method === "POST" && refreshTunnelId) {
		return refreshTunnelSession(request, env, refreshTunnelId, url);
	}

	const tunnelId = matchTunnelRouteId(url.pathname, CONNECT_ROUTE_SUFFIX);

	if (request.method === "GET" && tunnelId) {
		return connectTunnel(request, env, tunnelId, url.search);
	}

	const tunnelSubdomain = extractTunnelSubdomain(
		url.hostname,
		env.PUBLIC_BASE_DOMAIN,
	);

	if (tunnelSubdomain) {
		return proxyTunnelRequest(request, env, tunnelSubdomain);
	}

	if (request.method === "GET" && url.pathname === "/") {
		return createInfoResponse(env.PUBLIC_BASE_DOMAIN);
	}

	return new Response("Not Found", {
		status: 404,
	});
}

async function createTunnel(env: Env, requestUrl: URL): Promise<Response> {
	const subdomain = createRandomSubdomain();
	const [connectToken, sessionToken] = await Promise.all([
		createConnectToken(env.TOKEN_SECRET, subdomain),
		createSessionToken(env.TOKEN_SECRET, subdomain),
	]);
	const response: CreateTunnelResponse = {
		tunnelId: subdomain,
		subdomain,
		publicUrl: buildPublicUrl(env.PUBLIC_BASE_DOMAIN, subdomain),
		websocketUrl: buildTunnelWebSocketUrl(requestUrl, subdomain, connectToken),
		sessionToken,
	};

	return Response.json(response, { status: 201 });
}

async function refreshTunnelSession(
	request: Request,
	env: Env,
	tunnelId: string,
	requestUrl: URL,
): Promise<Response> {
	const subdomain = normalizeSubdomain(tunnelId);

	if (!subdomain) {
		return jsonError("Invalid tunnel id", 400);
	}

	const sessionToken = getBearerToken(request);

	if (!(await verifySessionToken(env.TOKEN_SECRET, subdomain, sessionToken))) {
		return jsonError("Invalid session token", 403);
	}

	const [connectToken, refreshedSessionToken] = await Promise.all([
		createConnectToken(env.TOKEN_SECRET, subdomain),
		createSessionToken(env.TOKEN_SECRET, subdomain),
	]);
	const response: RefreshTunnelSessionResponse = {
		websocketUrl: buildTunnelWebSocketUrl(requestUrl, subdomain, connectToken),
		sessionToken: refreshedSessionToken,
	};

	return Response.json(response);
}

async function connectTunnel(
	request: Request,
	env: Env,
	tunnelId: string,
	search: string,
): Promise<Response> {
	const subdomain = normalizeSubdomain(tunnelId);

	if (!subdomain) {
		return jsonError("Invalid tunnel id", 400);
	}

	const connectToken =
		new URL(`https://hostc.internal${search}`).searchParams.get("token") ?? "";

	if (!(await verifyConnectToken(env.TOKEN_SECRET, subdomain, connectToken))) {
		return jsonError("Invalid connect token", 403);
	}

	const tunnelStub = env.HOSTC_DURABLE_OBJECT.getByName(subdomain);
	return tunnelStub.fetch(
		new Request(`https://hostc.internal${INTERNAL_CONNECT_PATH}`, request),
	);
}

function matchTunnelRouteId(pathname: string, suffix: string): string | null {
	const prefix = `${TUNNELS_API_PATH}/`;

	if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) {
		return null;
	}

	const tunnelId = pathname.slice(prefix.length, -suffix.length);

	if (!tunnelId || tunnelId.includes("/")) {
		return null;
	}

	try {
		return decodeURIComponent(tunnelId);
	} catch {
		return null;
	}
}

function getBearerToken(request: Request): string {
	const authorization = request.headers.get("authorization") ?? "";
	const [scheme, token, ...rest] = authorization.trim().split(/\s+/);

	if (scheme?.toLowerCase() !== "bearer" || !token || rest.length > 0) {
		return "";
	}

	return token;
}

function proxyTunnelRequest(
	request: Request,
	env: Env,
	tunnelSubdomain: string,
): Promise<Response> {
	const tunnelStub = env.HOSTC_DURABLE_OBJECT.getByName(tunnelSubdomain);
	return tunnelStub.fetch(request);
}

function createInfoResponse(publicBaseDomain: string): Response {
	return Response.json({
		name: "hostc",
		createTunnelPath: TUNNELS_API_PATH,
		publicBaseDomain,
		message: `Create a tunnel and route public traffic through subdomain.${publicBaseDomain}`,
	});
}

function jsonError(message: string, status: number): Response {
	return Response.json(
		{
			error: message,
		},
		{ status },
	);
}

function asErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return typeof error === "string" ? error : "Unknown error";
}
