import { isTunnelId, TUNNEL_ID_ALPHABET, TUNNEL_ID_LENGTH } from "@hostc/protocol";

/**
 * A connect token is HMAC-SHA256(TOKEN_SECRET, "connect:<tunnelId>").
 *
 * It carries no expiry: it is only accepted while the tunnel exists, and
 * tunnel ids are random and never reused.
 *
 * Tunnel ids embed a 4-character (20-bit) HMAC tag over the leading 12 random characters (60 bits),
 * so the Worker can reject random subdomain probes in memory without waking a Durable Object.
 */

const TUNNEL_ID_TAG_LENGTH = 4;
const TUNNEL_ID_BODY_LENGTH = TUNNEL_ID_LENGTH - TUNNEL_ID_TAG_LENGTH;

const encoder = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();

export async function createTunnelId(secret: string): Promise<string> {
	// The alphabet has 32 characters, so masking a random byte has no bias.
	const bytes = crypto.getRandomValues(new Uint8Array(TUNNEL_ID_BODY_LENGTH));
	const body = Array.from(bytes, (byte) => TUNNEL_ID_ALPHABET[byte & 31]).join("");
	return body + (await signIdTag(secret, body));
}

export async function verifyTunnelId(secret: string, tunnelId: string): Promise<boolean> {
	if (!isTunnelId(tunnelId)) {
		return false;
	}
	const expected = await signIdTag(secret, tunnelId.slice(0, TUNNEL_ID_BODY_LENGTH));
	const actual = tunnelId.slice(TUNNEL_ID_BODY_LENGTH);
	let diff = 0;
	for (let index = 0; index < TUNNEL_ID_TAG_LENGTH; index += 1) {
		diff |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
	}
	return diff === 0;
}

async function signIdTag(secret: string, body: string): Promise<string> {
	const signature = new Uint8Array(
		await crypto.subtle.sign("HMAC", await importKey(secret), encoder.encode(`id:${body}`) as Uint8Array<ArrayBuffer>),
	);
	let tag = "";
	for (let index = 0; index < TUNNEL_ID_TAG_LENGTH; index += 1) {
		tag += TUNNEL_ID_ALPHABET[(signature[index] as number) & 31];
	}
	return tag;
}

export async function signConnectToken(secret: string, tunnelId: string): Promise<string> {
	const signature = await crypto.subtle.sign("HMAC", await importKey(secret), message(tunnelId));
	return toBase64Url(new Uint8Array(signature));
}

export async function verifyConnectToken(secret: string, tunnelId: string, token: string): Promise<boolean> {
	const signature = fromBase64Url(token);
	if (!signature) {
		return false;
	}
	return crypto.subtle.verify("HMAC", await importKey(secret), signature, message(tunnelId));
}

function message(tunnelId: string): Uint8Array<ArrayBuffer> {
	return encoder.encode(`connect:${tunnelId}`) as Uint8Array<ArrayBuffer>;
}

function importKey(secret: string): Promise<CryptoKey> {
	if (encoder.encode(secret).byteLength < 32) {
		throw new Error("TOKEN_SECRET must be at least 32 bytes");
	}
	let key = keys.get(secret);
	if (!key) {
		key = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
			"sign",
			"verify",
		]);
		keys.set(secret, key);
	}
	return key;
}

function toBase64Url(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
	if (!/^[A-Za-z0-9_-]+$/.test(value)) {
		return null;
	}
	try {
		const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
		return Uint8Array.from(binary, (char) => char.charCodeAt(0));
	} catch {
		return null;
	}
}
