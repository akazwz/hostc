const HTML_REQUEST_METHODS = new Set(["GET", "HEAD"]);

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

export function serveTunnelNotFoundPage(request: Request): Response {
	return renderErrorPage(request, {
		status: 404,
		statusLabel: "404",
		title: "Tunnel Not Found",
		description:
			"The requested tunnel either does not exist or the local service has disconnected.",
	});
}

export function serveLocalServerDownPage(request: Request): Response {
	return renderErrorPage(request, {
		status: 502,
		statusLabel: "502",
		title: "Local Server Unreachable",
		description:
			"The tunnel is connected, but the local service did not respond. Please check the local server and try again.",
	});
}

type ErrorPageOptions = {
	status: number;
	statusLabel: string;
	title: string;
	description: string;
};

function renderErrorPage(request: Request, options: ErrorPageOptions): Response {
	const body = request.method === "HEAD" ? null : buildErrorPageHtml(options);

	return new Response(body, {
		status: options.status,
		headers: {
			"cache-control": "no-store",
			"content-type": "text/html; charset=UTF-8",
		},
	});
}

function buildErrorPageHtml(options: ErrorPageOptions): string {
	const title = escapeHtml(options.title);
	const description = escapeHtml(options.description);
	const statusLabel = escapeHtml(options.statusLabel);

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title} | hostc</title>
<meta name="description" content="${description}" />
<meta name="robots" content="noindex" />
<link rel="icon" href="https://hostc.dev/favicon.ico" sizes="32x32" />
<style>
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0;height:100%}
body{
  font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
  color:#f4f4f5;background:#09090b;
  -webkit-font-smoothing:antialiased;
}
.wrap{
  position:relative;min-height:100%;overflow:hidden;
  background:
    radial-gradient(circle at top,rgba(255,255,255,.08),transparent 55%),
    linear-gradient(rgba(255,255,255,.03) 1px,transparent 1px) 0 0/48px 48px,
    linear-gradient(90deg,rgba(255,255,255,.03) 1px,transparent 1px) 0 0/48px 48px,
    #09090b;
}
main{
  position:relative;max-width:48rem;margin:0 auto;
  min-height:100vh;padding:4rem 1.5rem;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  text-align:center;
}
.badge{
  color:#f87171;font-size:.625rem;font-weight:600;
  letter-spacing:.15em;text-transform:uppercase;
}
h1{
  margin:1.5rem 0 0;font-size:2.25rem;line-height:1.1;
  font-weight:700;letter-spacing:-.01em;
}
@media(min-width:768px){h1{font-size:3.75rem}}
p{
  margin:1.25rem 0 0;max-width:36rem;
  font-size:1rem;line-height:1.75;color:#a1a1aa;
}
@media(min-width:768px){p{font-size:1.125rem}}
.actions{
  margin-top:2.5rem;display:flex;flex-wrap:wrap;
  gap:.75rem;justify-content:center;
}
.btn{
  display:inline-flex;align-items:center;justify-content:center;gap:.375rem;
  height:2.75rem;padding:0 2rem;
  font-size:.75rem;font-weight:600;letter-spacing:.15em;text-transform:uppercase;
  text-decoration:none;border:1px solid transparent;transition:background .15s,color .15s;
}
.btn-outline{color:#f4f4f5;border-color:#27272a;background:transparent}
.btn-outline:hover{background:rgba(255,255,255,.06)}
.btn-primary{color:#09090b;background:#f4f4f5}
.btn-primary:hover{background:rgba(244,244,245,.8)}
.btn svg{width:14px;height:14px}
</style>
</head>
<body>
<div class="wrap">
<main>
<span class="badge">${statusLabel}</span>
<h1>${title}</h1>
<p>${description}</p>
<div class="actions">
<a class="btn btn-outline" href="https://hostc.dev/">Open hostc.dev</a>
<a class="btn btn-primary" href="https://github.com/akazwz/hostc" target="_blank" rel="noreferrer">
<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.416-4.042-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
View on GitHub
</a>
</div>
</main>
</div>
</body>
</html>`;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
