const SENSITIVE_KEY_PATTERN = /authorization|token|secret/i;
const SIGNED_TOKEN_PATTERN = /[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

export type JsonLog = Record<string, unknown>;

export function log(fields: JsonLog): void {
	console.log(JSON.stringify(redactLogFields(fields)));
}

export function redactLogFields(fields: JsonLog): JsonLog {
	const redacted: JsonLog = {};
	for (const [key, value] of Object.entries(fields)) {
		redacted[key] = redactLogValue(key, value);
	}
	return redacted;
}

function redactLogValue(key: string, value: unknown): unknown {
	if (SENSITIVE_KEY_PATTERN.test(key)) {
		return "[redacted]";
	}
	if (typeof value === "string") {
		return value
			.replace(SIGNED_TOKEN_PATTERN, "[redacted-token]")
			.replace(/Bearer\s+\S+/gi, "Bearer [redacted-token]");
	}
	if (Array.isArray(value)) {
		return value.map((item) => redactLogValue(key, item));
	}
	if (typeof value === "object" && value !== null) {
		return redactLogFields(value as JsonLog);
	}
	return value;
}
