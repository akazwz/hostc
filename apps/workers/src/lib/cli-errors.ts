import { CLI_ERROR_REPORTS_API_PATH } from "@hostc/tunnel-protocol";

const CLI_ERROR_REPORT_MAX_BYTES = 8 * 1024;
const MAX_VERSION_LENGTH = 32;
const MAX_RUNTIME_LENGTH = 64;
const MAX_COMMAND_LENGTH = 64;
const MAX_ERROR_NAME_LENGTH = 80;
const MAX_ERROR_MESSAGE_LENGTH = 500;
const MAX_STACK_LENGTH = 4 * 1024;

type CliErrorReportBody = {
	cliVersion?: unknown;
	nodeVersion?: unknown;
	platform?: unknown;
	arch?: unknown;
	command?: unknown;
	errorName?: unknown;
	errorMessage?: unknown;
	stack?: unknown;
};

type CliErrorReport = {
	cliVersion: string;
	nodeVersion: string;
	platform: string;
	arch: string;
	command: string;
	errorName: string;
	errorMessage: string;
	stack: string | null;
};

export async function createCliErrorReport(
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
		key: buildCliErrorRateLimitKey(request),
	});

	if (!rateLimitResult.success) {
		console.warn(
			JSON.stringify({
				event: "cli_error.rate_limited",
				path: CLI_ERROR_REPORTS_API_PATH,
			}),
		);

		return jsonError("Too many requests. Please try again later.", 429);
	}

	const contentLength = Number(request.headers.get("content-length") ?? "");

	if (
		Number.isFinite(contentLength) &&
		contentLength > CLI_ERROR_REPORT_MAX_BYTES
	) {
		return jsonError("Request body is too large", 413);
	}

	let body: CliErrorReportBody;

	try {
		body = await request.json<CliErrorReportBody>();
	} catch {
		return jsonError("Invalid JSON body", 400);
	}

	const report = normalizeCliErrorReport(body);

	if (!report) {
		return jsonError("Invalid error report", 400);
	}

	await database
		.prepare(
			`INSERT INTO cli_error_reports (
				id,
				cli_version,
				node_version,
				platform,
				arch,
				command,
				error_name,
				error_message,
				stack,
				created_at
			 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			crypto.randomUUID(),
			report.cliVersion,
			report.nodeVersion,
			report.platform,
			report.arch,
			report.command,
			report.errorName,
			report.errorMessage,
			report.stack,
			new Date().toISOString(),
		)
		.run();

	return Response.json({ ok: true }, { status: 202 });
}

function normalizeCliErrorReport(
	body: CliErrorReportBody,
): CliErrorReport | null {
	const cliVersion = normalizeRequiredString(
		body.cliVersion,
		MAX_VERSION_LENGTH,
	);
	const nodeVersion = normalizeRequiredString(
		body.nodeVersion,
		MAX_RUNTIME_LENGTH,
	);
	const platform = normalizeRequiredString(body.platform, MAX_RUNTIME_LENGTH);
	const arch = normalizeRequiredString(body.arch, MAX_RUNTIME_LENGTH);
	const command = normalizeRequiredString(body.command, MAX_COMMAND_LENGTH);
	const errorName = normalizeRequiredString(
		body.errorName,
		MAX_ERROR_NAME_LENGTH,
	);
	const errorMessage = normalizeRequiredString(
		body.errorMessage,
		MAX_ERROR_MESSAGE_LENGTH,
	);
	const stack = normalizeOptionalString(body.stack, MAX_STACK_LENGTH);

	if (
		!cliVersion ||
		!nodeVersion ||
		!platform ||
		!arch ||
		!command ||
		!errorName ||
		!errorMessage ||
		stack === undefined
	) {
		return null;
	}

	return {
		cliVersion,
		nodeVersion,
		platform,
		arch,
		command,
		errorName,
		errorMessage,
		stack,
	};
}

function normalizeRequiredString(
	value: unknown,
	maxLength: number,
): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const normalized = value.trim();

	if (!normalized || normalized.length > maxLength) {
		return null;
	}

	return normalized;
}

function normalizeOptionalString(
	value: unknown,
	maxLength: number,
): string | null | undefined {
	if (value === undefined || value === null) {
		return null;
	}

	if (typeof value !== "string") {
		return undefined;
	}

	return value.trim().slice(0, maxLength) || null;
}

function buildCliErrorRateLimitKey(request: Request): string {
	const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";

	return `${CLI_ERROR_REPORTS_API_PATH}:${clientIp}`;
}

function jsonError(message: string, status: number): Response {
	return Response.json(
		{
			error: message,
		},
		{ status },
	);
}
