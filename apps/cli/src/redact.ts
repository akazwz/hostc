export function redactToken(value: string): string {
	return value
		.replace(
			/Bearer\s+[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gi,
			"Bearer [redacted-token]",
		)
		.replace(
			/"(connectToken|refreshToken)"\s*:\s*"[^"]+"/g,
			'"$1":"[redacted-token]"',
		);
}

export function formatError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return redactToken(message);
}
