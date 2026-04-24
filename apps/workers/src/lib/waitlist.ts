const WAITLIST_REQUEST_MAX_BYTES = 1024;
const MAX_EMAIL_LENGTH = 320;
const WAITLIST_ROUTE = "/api/waitlist";

type WaitlistRequestBody = {
	email?: unknown;
};

export async function createWaitlistSignup(
	request: Request,
	database: D1Database | undefined,
	rateLimiter: RateLimit | undefined,
): Promise<Response> {
	if (!database) {
		return jsonError("Database is not configured", 503);
	}

	if (!rateLimiter) {
		return jsonError("Rate limiter is not configured", 503);
	}

	const rateLimitResult = await rateLimiter.limit({
		key: buildWaitlistRateLimitKey(request),
	});

	if (!rateLimitResult.success) {
		console.warn(
			JSON.stringify({
				event: "waitlist.rate_limited",
				path: WAITLIST_ROUTE,
			}),
		);

		return jsonError("Too many requests. Please try again in a minute.", 429);
	}

	const contentLength = Number(request.headers.get("content-length") ?? "");

	if (Number.isFinite(contentLength) && contentLength > WAITLIST_REQUEST_MAX_BYTES) {
		return jsonError("Request body is too large", 413);
	}

	let body: WaitlistRequestBody;

	try {
		body = await request.json<WaitlistRequestBody>();
	} catch {
		return jsonError("Invalid JSON body", 400);
	}

	const email = normalizeEmail(body.email);

	if (!email) {
		return jsonError("Invalid email address", 400);
	}

	await database
		.prepare(
			`INSERT OR IGNORE INTO waitlist_signups (email, source, created_at)
			 VALUES (?, ?, ?)` ,
		)
		.bind(email, "web", new Date().toISOString())
		.run();

	return Response.json({ ok: true }, { status: 201 });
}

function normalizeEmail(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const email = value.trim().toLowerCase();

	if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) {
		return null;
	}

	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return null;
	}

	return email;
}

function buildWaitlistRateLimitKey(request: Request): string {
	const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";

	return `${WAITLIST_ROUTE}:${clientIp}`;
}

function jsonError(message: string, status: number): Response {
	return Response.json(
		{
			error: message,
		},
		{ status },
	);
}