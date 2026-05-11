export type TunnelErrorPageOptions = {
	status: number;
	title: string;
	eyebrow: string;
	message: string;
	hint?: string;
};

export function tunnelErrorResponse(
	request: Request,
	options: TunnelErrorPageOptions,
): Response {
	if (!prefersHtml(request)) {
		return Response.json({ error: options.title }, { status: options.status });
	}
	return new Response(renderTunnelErrorPage(options), {
		status: options.status,
		headers: {
			"cache-control": "no-store",
			"content-type": "text/html; charset=utf-8",
		},
	});
}

function prefersHtml(request: Request): boolean {
	const accept = request.headers.get("accept") ?? "";
	return accept.includes("text/html");
}

function renderTunnelErrorPage(options: TunnelErrorPageOptions): string {
	const title = escapeHtml(options.title);
	const eyebrow = escapeHtml(options.eyebrow);
	const message = escapeHtml(options.message);
	const hint = options.hint ? escapeHtml(options.hint) : null;
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} · hostc</title>
<style>
:root {
	color-scheme: dark;
	--background: oklch(0.147 0.004 49.3);
	--card: oklch(0.214 0.009 43.1);
	--border: oklch(1 0 0 / 10%);
	--foreground: oklch(0.986 0.002 67.8);
	--muted: oklch(0.714 0.014 41.2);
	--accent: oklch(0.922 0.005 34.3);
}
* { box-sizing: border-box; }
body {
	margin: 0;
	min-height: 100vh;
	display: grid;
	place-items: center;
	padding: 32px;
	font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	color: var(--foreground);
	background:
		radial-gradient(circle at top, rgba(255, 255, 255, 0.08), transparent 55%),
		linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
		linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px),
		var(--background);
	background-size: auto, 48px 48px, 48px 48px, auto;
}
main {
	width: min(100%, 560px);
	border: 1px solid var(--border);
	padding: 36px;
	background: color-mix(in srgb, var(--card) 92%, transparent);
	box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28);
}
.brand {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
	margin-bottom: 42px;
	font-size: 14px;
	color: var(--muted);
}
.logo {
	font-weight: 800;
	letter-spacing: -0.03em;
	color: var(--foreground);
}
.status {
	color: var(--accent);
	font-size: 12px;
	text-transform: uppercase;
	letter-spacing: 0.18em;
}
h1 {
	margin: 0;
	font-family: Georgia, "Times New Roman", serif;
	font-size: clamp(38px, 7vw, 64px);
	line-height: 0.92;
	letter-spacing: -0.06em;
}
p {
	margin: 18px 0 0;
	color: var(--muted);
	font-size: 16px;
	line-height: 1.7;
}
.hint {
	margin-top: 24px;
	padding: 14px 16px;
	border: 1px solid var(--border);
	background: rgba(255, 255, 255, 0.04);
	font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	font-size: 13px;
	color: var(--muted);
}
a {
	display: inline-flex;
	margin-top: 28px;
	color: var(--foreground);
	text-decoration: none;
	border-bottom: 1px solid var(--accent);
}
</style>
</head>
<body>
<main>
<div class="brand"><span class="logo">hostc</span><span class="status">${eyebrow}</span></div>
<h1>${title}</h1>
<p>${message}</p>
${hint ? `<div class="hint">${hint}</div>` : ""}
<a href="https://hostc.dev">Learn more about hostc</a>
</main>
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
