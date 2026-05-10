export type TokenAudience = "connect";

export type TokenPayload = {
	v: 1;
	aud: TokenAudience;
	tunnelId: string;
	clientConnectionId?: string;
	exp: number;
	nonce: string;
};

export type VerifyTokenOptions = {
	audience: TokenAudience;
	tunnelId: string;
	clientConnectionId?: string;
	now?: number;
};

const keyCache = new Map<string, Promise<CryptoKey>>();
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function signToken(
	secret: string,
	payload: TokenPayload,
): Promise<string> {
	assertUsableSecret(secret);
	const encodedPayload = base64UrlEncodeBytes(
		encoder.encode(JSON.stringify(payload)),
	);
	const signature = await hmac(secret, encodedPayload);
	return `${encodedPayload}.${base64UrlEncodeBytes(signature)}`;
}

export async function verifyToken(
	secret: string,
	token: string,
	options: VerifyTokenOptions,
): Promise<TokenPayload | null> {
	assertUsableSecret(secret);
	const [encodedPayload, encodedSignature, ...extra] = token.split(".");
	if (!encodedPayload || !encodedSignature || extra.length > 0) {
		return null;
	}

	const signature = base64UrlDecodeBytes(encodedSignature);
	if (!signature) {
		return null;
	}

	const key = await importKey(secret);
	const verified = await crypto.subtle.verify(
		"HMAC",
		key,
		toArrayBuffer(signature),
		toArrayBuffer(encoder.encode(encodedPayload)),
	);
	if (!verified) {
		return null;
	}

	const payloadBytes = base64UrlDecodeBytes(encodedPayload);
	if (!payloadBytes) {
		return null;
	}

	let payload: unknown;
	try {
		payload = JSON.parse(decoder.decode(payloadBytes));
	} catch {
		return null;
	}

	if (!isTokenPayload(payload)) {
		return null;
	}

	const now = options.now ?? Math.floor(Date.now() / 1000);
	if (
		payload.aud !== options.audience ||
		payload.tunnelId !== options.tunnelId ||
		payload.exp < now
	) {
		return null;
	}
	if (
		options.clientConnectionId !== undefined &&
		payload.clientConnectionId !== options.clientConnectionId
	) {
		return null;
	}

	return payload;
}

export function createTokenPayload(
	audience: TokenAudience,
	tunnelId: string,
	ttlSeconds: number,
	clientConnectionId?: string,
	now = Math.floor(Date.now() / 1000),
): TokenPayload {
	return {
		v: 1,
		aud: audience,
		tunnelId,
		clientConnectionId,
		exp: now + ttlSeconds,
		nonce: crypto.randomUUID(),
	};
}

export function redactToken(value: string): string {
	return value.replace(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-token]");
}

function assertUsableSecret(secret: string): void {
	if (typeof secret !== "string" || encoder.encode(secret).byteLength < 32) {
		throw new Error("TOKEN_SECRET must be at least 32 bytes");
	}
}

async function hmac(secret: string, payload: string): Promise<Uint8Array> {
	const key = await importKey(secret);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		toArrayBuffer(encoder.encode(payload)),
	);
	return new Uint8Array(signature);
}

function importKey(secret: string): Promise<CryptoKey> {
	let cached = keyCache.get(secret);
	if (!cached) {
		cached = crypto.subtle.importKey(
			"raw",
			toArrayBuffer(encoder.encode(secret)),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign", "verify"],
		);
		keyCache.set(secret, cached);
	}
	return cached;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;
}

function isTokenPayload(value: unknown): value is TokenPayload {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		record.v === 1 &&
		record.aud === "connect" &&
		typeof record.tunnelId === "string" &&
		(record.clientConnectionId === undefined ||
			typeof record.clientConnectionId === "string") &&
		Number.isInteger(record.exp) &&
		typeof record.nonce === "string"
	);
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
}

function base64UrlDecodeBytes(value: string): Uint8Array | null {
	try {
		const padded = value.replaceAll("-", "+").replaceAll("_", "/");
		const base64 = padded.padEnd(
			padded.length + ((4 - (padded.length % 4)) % 4),
			"=",
		);
		const binary = atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) {
			bytes[index] = binary.charCodeAt(index);
		}
		return bytes;
	} catch {
		return null;
	}
}
