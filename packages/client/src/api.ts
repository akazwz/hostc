import {
	API_TUNNELS_PATH,
	type CreateTunnelResponse,
	isCreateTunnelResponse,
	PROTOCOL_HEADER,
	PROTOCOL_VERSION,
} from "@hostc/protocol";

export type TunnelErrorCode =
	| "upgrade_required"
	| "rate_limited"
	| "tunnel_gone"
	| "replaced"
	| "unauthorized"
	| "server_error"
	| "network_error";

export class TunnelError extends Error {
	override name = "TunnelError";
	readonly code: TunnelErrorCode;

	constructor(code: TunnelErrorCode, message: string, options?: ErrorOptions) {
		super(message, options);
		this.code = code;
	}
}

export const PROTOCOL_HEADERS = { [PROTOCOL_HEADER]: String(PROTOCOL_VERSION) };

export async function createTunnel(server: string): Promise<CreateTunnelResponse> {
	let response: Response;
	try {
		response = await fetch(new URL(API_TUNNELS_PATH, server), { method: "POST", headers: PROTOCOL_HEADERS });
	} catch (error) {
		throw new TunnelError("network_error", `Could not reach ${server}`, { cause: error });
	}
	if (response.status !== 201) {
		throw errorFromResponse(response.status, await response.text());
	}
	const body: unknown = await response.json();
	if (!isCreateTunnelResponse(body)) {
		throw new TunnelError("server_error", "The server returned an invalid tunnel");
	}
	return body;
}

export function errorFromResponse(status: number, text: string): TunnelError {
	let message = text;
	try {
		const body = JSON.parse(text) as { error?: unknown };
		if (typeof body.error === "string") {
			message = body.error;
		}
	} catch {
		// Not JSON.
	}
	switch (status) {
		case 426:
			return new TunnelError("upgrade_required", message);
		case 429:
			return new TunnelError("rate_limited", message);
		case 401:
			return new TunnelError("unauthorized", message);
		case 404:
			return new TunnelError("tunnel_gone", message);
		default:
			return new TunnelError("server_error", `Server responded ${status}: ${message}`);
	}
}
