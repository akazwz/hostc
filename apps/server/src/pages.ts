/** Error pages shown to visitors of a tunnel URL. */

export type PageOptions = {
	status: number;
	title: string;
	message: string;
};

/** HTML for browsers, JSON for everything else. */
export function errorResponse(request: Request, { status, title, message }: PageOptions): Response {
	const headers = { "cache-control": "no-store" };
	if (!wantsHtml(request)) {
		return Response.json({ error: title, message }, { status, headers });
	}
	return html(
		status,
		title,
		`<p class="code">${status}</p><h1>${escape(title)}</h1><p>${escape(message)}</p>`,
		headers,
	);
}

export const pages = {
	notFound: {
		status: 404,
		title: "Tunnel not found",
		message:
			"This link is not connected to anything right now: its tunnel was stopped or has expired. If it is yours, run hostc again for a new URL.",
	},
	offline: {
		status: 502,
		title: "Tunnel offline",
		message:
			"The computer behind this link is not connected right now. It is probably reconnecting; try again in a moment.",
	},
	upstreamFailed: {
		status: 502,
		title: "Local server unavailable",
		message:
			"The tunnel is up, but the local server behind it did not answer. If it is yours, make sure it is running on the port you gave hostc.",
	},
	timeout: {
		status: 504,
		title: "Local server timed out",
		message: "The local server behind this link took too long to start responding.",
	},
	busy: {
		status: 503,
		title: "Tunnel busy",
		message: "This tunnel is handling too many requests at once. Try again in a moment.",
	},
} satisfies Record<string, PageOptions>;

function wantsHtml(request: Request): boolean {
	return (request.headers.get("accept") ?? "").includes("text/html");
}

function html(status: number, title: string, body: string, headers: Record<string, string>): Response {
	return new Response(
		`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escape(title)} · hostc</title>
<style>
:root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: Canvas; color: CanvasText; }
main { max-width: 34rem; padding: 2rem; line-height: 1.6; }
h1 { font-size: 1.5rem; margin: 0 0 1rem; }
.code { font-family: ui-monospace, monospace; opacity: 0.6; margin: 0; }
footer { margin-top: 2rem; font-size: 0.875rem; opacity: 0.6; }
footer a { color: inherit; }
</style>
</head>
<body><main>${body}<footer>Served by <a href="https://github.com/akazwz/hostc">hostc</a>, public URLs for local servers</footer></main></body>
</html>`,
		{ status, headers: { "content-type": "text/html; charset=utf-8", ...headers } },
	);
}

function escape(value: string): string {
	return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
