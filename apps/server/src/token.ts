/**
 * A connect token is HMAC-SHA256(TOKEN_SECRET, "connect:<tunnelId>").
 *
 * It carries no expiry: it is only accepted while the tunnel exists, and
 * tunnel ids are random and never reused.
 */

const encoder = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();

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
