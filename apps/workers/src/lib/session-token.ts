import { Buffer } from "node:buffer";

const SESSION_TOKEN_TTL_MS = 10 * 60_000;
const SESSION_TOKEN_VERSION = 1;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type SessionTokenPayload = {
	v: number;
	subdomain: string;
	exp: number;
	nonce: string;
};

export async function createSessionToken(
	secret: string,
	subdomain: string,
): Promise<string> {
	const payload: SessionTokenPayload = {
		v: SESSION_TOKEN_VERSION,
		subdomain,
		exp: Date.now() + SESSION_TOKEN_TTL_MS,
		nonce: crypto.randomUUID(),
	};
	const encodedPayload = encodeBase64Url(JSON.stringify(payload));
	const signature = await signPayload(secret, encodedPayload);

	return `${encodedPayload}.${signature}`;
}

export async function verifySessionToken(
	secret: string,
	subdomain: string,
	token: string,
): Promise<boolean> {
	const [encodedPayload, encodedSignature, ...rest] = token.split(".");

	if (!encodedPayload || !encodedSignature || rest.length > 0) {
		return false;
	}

	const payload = parsePayload(encodedPayload);

	if (!payload) {
		return false;
	}

	if (
		payload.v !== SESSION_TOKEN_VERSION ||
		payload.subdomain !== subdomain ||
		payload.exp < Date.now()
	) {
		return false;
	}

	const key = await importSessionTokenKey(secret);

	return crypto.subtle.verify(
		"HMAC",
		key,
		decodeBase64Url(encodedSignature),
		encoder.encode(encodedPayload),
	);
}

function parsePayload(encodedPayload: string): SessionTokenPayload | null {
	try {
		const parsed = JSON.parse(
			decoder.decode(decodeBase64Url(encodedPayload)),
		) as unknown;

		if (!isSessionTokenPayload(parsed)) {
			return null;
		}

		return parsed;
	} catch {
		return null;
	}
}

function isSessionTokenPayload(value: unknown): value is SessionTokenPayload {
	if (!isJsonRecord(value)) {
		return false;
	}

	return (
		typeof value.v === "number" &&
		typeof value.subdomain === "string" &&
		typeof value.exp === "number" &&
		typeof value.nonce === "string"
	);
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

async function signPayload(
	secret: string,
	encodedPayload: string,
): Promise<string> {
	const key = await importSessionTokenKey(secret);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		encoder.encode(encodedPayload),
	);

	return encodeBase64Url(new Uint8Array(signature));
}

function importSessionTokenKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
}

function encodeBase64Url(value: Uint8Array | string): string {
	return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value: string): Uint8Array {
	return Buffer.from(value, "base64url");
}
