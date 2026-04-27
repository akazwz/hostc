import {
	buildPublicUrl,
	CLI_ERROR_REPORTS_API_PATH,
	type CreateTunnelResponse,
	normalizeSubdomain,
	type RefreshTunnelSessionResponse,
	TUNNELS_API_PATH,
} from "@hostc/tunnel-protocol";
import { Hono } from "hono";
import { HostcDurableObject } from "./durable/tunnel";
import { createCliErrorReport } from "./lib/cli-errors";
import { createConnectToken, verifyConnectToken } from "./lib/connect-token";
import { createSessionToken, verifySessionToken } from "./lib/session-token";
import { canServeStaticAsset, serveStaticAsset } from "./lib/static-site";
import {
	buildTunnelWebSocketUrl,
	createRandomSubdomain,
	extractTunnelSubdomain,
	isApplicationHostname,
} from "./lib/tunnels";
import { createWaitlistSignup } from "./lib/waitlist";

const INTERNAL_CONNECT_PATH = "/_internal/connect";
const WAITLIST_API_PATH = "/api/waitlist";

const app = new Hono<{ Bindings: Env }>();

app.post(WAITLIST_API_PATH, (context) =>
	createWaitlistSignup(
		context.req.raw,
		context.env.DB,
		context.env.WAITLIST_RATE_LIMITER,
	),
);

app.post(CLI_ERROR_REPORTS_API_PATH, (context) =>
	createCliErrorReport(
		context.req.raw,
		context.env.DB,
		context.env.WAITLIST_RATE_LIMITER,
	),
);

app.post(TUNNELS_API_PATH, (context) =>
	createTunnel(context.env, new URL(context.req.url)),
);

app.post(`${TUNNELS_API_PATH}/:tunnelId/refresh`, (context) =>
	refreshTunnelSession(
		context.req.raw,
		context.env,
		context.req.param("tunnelId"),
		new URL(context.req.url),
	),
);

app.get(`${TUNNELS_API_PATH}/:tunnelId/connect`, (context) =>
	connectTunnel(
		context.req.raw,
		context.env,
		context.req.param("tunnelId"),
		new URL(context.req.url).search,
	),
);

app.all("/api/*", () => new Response("Not Found", { status: 404 }));

app.all("*", (context) => {
	if (canServeStaticAsset(context.req.raw)) {
		return serveStaticAsset(context.req.raw, context.env);
	}

	return new Response("Not Found", { status: 404 });
});

app.onError((error, context) => {
	console.error(
		JSON.stringify({
			event: "worker.unhandled_error",
			error: asErrorMessage(error),
			path: new URL(context.req.url).pathname,
		}),
	);

	return jsonError("Internal server error", 500);
});

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

	const tunnelSubdomain = extractTunnelSubdomain(
		url.hostname,
		env.PUBLIC_BASE_DOMAIN,
	);

	if (tunnelSubdomain) {
		return proxyTunnelRequest(request, env, tunnelSubdomain);
	}

	if (!isApplicationHostname(url.hostname, env.PUBLIC_BASE_DOMAIN)) {
		return new Response("Not Found", {
			status: 404,
		});
	}

	return app.fetch(request, env);
}

async function createTunnel(env: Env, requestUrl: URL): Promise<Response> {
	const subdomain = createRandomSubdomain();
	const tunnelSession = await issueTunnelSession(env, requestUrl, subdomain);
	const response: CreateTunnelResponse = {
		tunnelId: subdomain,
		subdomain,
		publicUrl: buildPublicUrl(env.PUBLIC_BASE_DOMAIN, subdomain),
		websocketUrl: tunnelSession.websocketUrl,
		sessionToken: tunnelSession.sessionToken,
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

	return Response.json(await issueTunnelSession(env, requestUrl, subdomain));
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

async function issueTunnelSession(
	env: Env,
	requestUrl: URL,
	subdomain: string,
): Promise<RefreshTunnelSessionResponse> {
	const [connectToken, sessionToken] = await Promise.all([
		createConnectToken(env.TOKEN_SECRET, subdomain),
		createSessionToken(env.TOKEN_SECRET, subdomain),
	]);

	return {
		websocketUrl: buildTunnelWebSocketUrl(requestUrl, subdomain, connectToken),
		sessionToken,
	};
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
