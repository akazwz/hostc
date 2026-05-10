import { isValidClientConnectionId, isValidTunnelId } from "@hostc/protocol";

const TUNNEL_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function createTunnelId(): string {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const bytes = new Uint8Array(10);
		crypto.getRandomValues(bytes);
		let suffix = "";
		for (const byte of bytes) {
			suffix += TUNNEL_ALPHABET[byte % TUNNEL_ALPHABET.length];
		}
		const tunnelId = `t-${suffix}`;
		if (isValidTunnelId(tunnelId)) {
			return tunnelId;
		}
	}
	throw new Error("Failed to generate tunnel id");
}

export function createClientConnectionId(): string {
	const clientConnectionId = `c-${crypto.randomUUID()}`;
	if (!isValidClientConnectionId(clientConnectionId)) {
		throw new Error("Failed to generate client connection id");
	}
	return clientConnectionId;
}
