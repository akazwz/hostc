const HTML_REQUEST_METHODS = new Set(["GET", "HEAD"]);
const TUNNEL_NOT_FOUND_PAGE_PATH = "/errors/tunnel-not-found/";
const LOCAL_SERVER_DOWN_PAGE_PATH = "/errors/local-server-down/";

export function canServeStaticAsset(request: Request): boolean {
	return HTML_REQUEST_METHODS.has(request.method);
}

export function wantsHtmlResponse(request: Request): boolean {
	if (!canServeStaticAsset(request)) {
		return false;
	}

	const destination = request.headers.get("sec-fetch-dest");

	if (destination === "document") {
		return true;
	}

	const accept = request.headers.get("accept") ?? "";
	return accept.includes("text/html");
}

export function serveStaticAsset(
	request: Request,
	env: Env,
): Promise<Response> {
	return env.ASSETS.fetch(request);
}

export async function serveTunnelNotFoundPage(
	request: Request,
	env: Env,
): Promise<Response> {
	const status = 404;
	const assetUrl = new URL(request.url);
	assetUrl.pathname = TUNNEL_NOT_FOUND_PAGE_PATH;
	assetUrl.search = "";
	assetUrl.hash = "";

	const assetResponse = await env.ASSETS.fetch(
		new Request(assetUrl.toString(), {
			method: request.method,
			headers: request.headers,
		}),
	);

	if (!assetResponse.ok) {
		return new Response("Tunnel not found", {
			status,
			headers: {
				"cache-control": "no-store",
				"content-type": "text/plain; charset=UTF-8",
			},
		});
	}

	const headers = new Headers(assetResponse.headers);
	headers.set("cache-control", "no-store");

	return new Response(request.method === "HEAD" ? null : assetResponse.body, {
		status,
		headers,
	});
}

export async function serveLocalServerDownPage(
	request: Request,
	env: Env,
): Promise<Response> {
	const status = 502;
	const assetUrl = new URL(request.url);
	assetUrl.pathname = LOCAL_SERVER_DOWN_PAGE_PATH;
	assetUrl.search = "";
	assetUrl.hash = "";

	const assetResponse = await env.ASSETS.fetch(
		new Request(assetUrl.toString(), {
			method: request.method,
			headers: request.headers,
		}),
	);

	if (!assetResponse.ok) {
		return new Response("Local server down", {
			status,
			headers: {
				"cache-control": "no-store",
				"content-type": "text/plain; charset=UTF-8",
			},
		});
	}

	const headers = new Headers(assetResponse.headers);
	headers.set("cache-control", "no-store");

	return new Response(request.method === "HEAD" ? null : assetResponse.body, {
		status,
		headers,
	});
}
