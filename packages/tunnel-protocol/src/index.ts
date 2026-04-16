export const TUNNELS_API_PATH = "/api/tunnels";

export type HeaderEntry = [name: string, value: string];

export type CreateTunnelResponse = {
	tunnelId: string;
	subdomain: string;
	publicUrl: string;
	websocketUrl: string;
	sessionToken: string;
};

export type RefreshTunnelSessionResponse = {
	websocketUrl: string;
	sessionToken: string;
};

export type TunnelReadyMessage = {
	type: "tunnel-ready";
	subdomain: string;
	publicUrl: string;
};

export type ErrorMessage = {
	type: "error";
	message: string;
};

export type RequestStartMessage = {
	type: "request-start";
	requestId: string;
	method: string;
	url: string;
	headers: HeaderEntry[];
	hasBody: boolean;
};

export type RequestBodyMessage = {
	type: "request-body";
	requestId: string;
	chunk: string;
};

export type RequestEndMessage = {
	type: "request-end";
	requestId: string;
};

export type WebSocketConnectMessage = {
	type: "websocket-connect";
	requestId: string;
	url: string;
	headers: HeaderEntry[];
	protocols: string[];
};

export type WebSocketAcceptMessage = {
	type: "websocket-accept";
	requestId: string;
	protocol?: string;
};

export type WebSocketRejectMessage = {
	type: "websocket-reject";
	requestId: string;
	message: string;
};

export type WebSocketFrameMessage = {
	type: "websocket-frame";
	requestId: string;
	chunk: string;
	isBinary: boolean;
};

export type WebSocketCloseMessage = {
	type: "websocket-close";
	requestId: string;
	code?: number;
	reason: string;
};

export type ResponseStartMessage = {
	type: "response-start";
	requestId: string;
	status: number;
	statusText: string;
	headers: HeaderEntry[];
	hasBody: boolean;
};

export type ResponseBodyMessage = {
	type: "response-body";
	requestId: string;
	chunk: string;
};

export type ResponseEndMessage = {
	type: "response-end";
	requestId: string;
};

export type ResponseErrorMessage = {
	type: "response-error";
	requestId: string;
	message: string;
};

export type TunnelServerMessage =
	| TunnelReadyMessage
	| ErrorMessage
	| RequestStartMessage
	| RequestBodyMessage
	| RequestEndMessage
	| WebSocketConnectMessage
	| WebSocketFrameMessage
	| WebSocketCloseMessage;

export type TunnelClientMessage =
	| ErrorMessage
	| ResponseStartMessage
	| ResponseBodyMessage
	| ResponseEndMessage
	| ResponseErrorMessage
	| WebSocketAcceptMessage
	| WebSocketRejectMessage
	| WebSocketFrameMessage
	| WebSocketCloseMessage;

type JsonRecord = Record<string, unknown>;

const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeSubdomain(value: string): string | null {
	const normalized = value.trim().toLowerCase();

	if (!SUBDOMAIN_PATTERN.test(normalized)) {
		return null;
	}

	return normalized;
}

export function buildPublicUrl(baseDomain: string, subdomain: string): string {
	return `https://${subdomain}.${baseDomain}`;
}

export function buildTunnelConnectPath(tunnelId: string): string {
	return `${TUNNELS_API_PATH}/${encodeURIComponent(tunnelId)}/connect`;
}

export function buildTunnelRefreshPath(tunnelId: string): string {
	return `${TUNNELS_API_PATH}/${encodeURIComponent(tunnelId)}/refresh`;
}

export function parseCreateTunnelResponse(
	raw: string,
): CreateTunnelResponse | null {
	const parsed = parseJsonRecord(raw);

	if (!parsed) {
		return null;
	}

	return isCreateTunnelResponse(parsed) ? parsed : null;
}

export function parseRefreshTunnelSessionResponse(
	raw: string,
): RefreshTunnelSessionResponse | null {
	const parsed = parseJsonRecord(raw);

	if (!parsed) {
		return null;
	}

	return isRefreshTunnelSessionResponse(parsed) ? parsed : null;
}

export function parseTunnelClientMessage(
	raw: string,
): TunnelClientMessage | null {
	const parsed = parseJsonRecord(raw);

	if (!parsed) {
		return null;
	}

	return isTunnelClientMessage(parsed) ? parsed : null;
}

export function parseTunnelServerMessage(
	raw: string,
): TunnelServerMessage | null {
	const parsed = parseJsonRecord(raw);

	if (!parsed) {
		return null;
	}

	return isTunnelServerMessage(parsed) ? parsed : null;
}

function parseJsonRecord(raw: string): JsonRecord | null {
	try {
		const parsed: unknown = JSON.parse(raw);
		return isJsonRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function isTunnelServerMessage(
	value: JsonRecord,
): value is TunnelServerMessage {
	switch (value.type) {
		case "tunnel-ready":
			return isString(value.subdomain) && isString(value.publicUrl);
		case "error":
			return isString(value.message);
		case "request-start":
			return (
				isString(value.requestId) &&
				isString(value.method) &&
				isString(value.url) &&
				isHeaderEntries(value.headers) &&
				typeof value.hasBody === "boolean"
			);
		case "request-body":
			return isString(value.requestId) && isString(value.chunk);
		case "request-end":
			return isString(value.requestId);
		case "websocket-connect":
			return (
				isString(value.requestId) &&
				isString(value.url) &&
				isHeaderEntries(value.headers) &&
				isStringArray(value.protocols)
			);
		case "websocket-frame":
			return (
				isString(value.requestId) &&
				isString(value.chunk) &&
				typeof value.isBinary === "boolean"
			);
		case "websocket-close":
			return (
				isString(value.requestId) &&
				isOptionalNumber(value.code) &&
				isString(value.reason)
			);
		default:
			return false;
	}
}

function isTunnelClientMessage(
	value: JsonRecord,
): value is TunnelClientMessage {
	switch (value.type) {
		case "error":
			return isString(value.message);
		case "response-start":
			return (
				isString(value.requestId) &&
				typeof value.status === "number" &&
				isString(value.statusText) &&
				isHeaderEntries(value.headers) &&
				typeof value.hasBody === "boolean"
			);
		case "response-body":
			return isString(value.requestId) && isString(value.chunk);
		case "response-end":
			return isString(value.requestId);
		case "response-error":
			return isString(value.requestId) && isString(value.message);
		case "websocket-accept":
			return isString(value.requestId) && isOptionalString(value.protocol);
		case "websocket-reject":
			return isString(value.requestId) && isString(value.message);
		case "websocket-frame":
			return (
				isString(value.requestId) &&
				isString(value.chunk) &&
				typeof value.isBinary === "boolean"
			);
		case "websocket-close":
			return (
				isString(value.requestId) &&
				isOptionalNumber(value.code) &&
				isString(value.reason)
			);
		default:
			return false;
	}
}

function isCreateTunnelResponse(
	value: JsonRecord,
): value is CreateTunnelResponse {
	return (
		isString(value.tunnelId) &&
		isString(value.subdomain) &&
		isString(value.publicUrl) &&
		isString(value.websocketUrl) &&
		isString(value.sessionToken)
	);
}

function isRefreshTunnelSessionResponse(
	value: JsonRecord,
): value is RefreshTunnelSessionResponse {
	return isString(value.websocketUrl) && isString(value.sessionToken);
}

function isHeaderEntries(value: unknown): value is HeaderEntry[] {
	return Array.isArray(value) && value.every(isHeaderEntry);
}

function isHeaderEntry(value: unknown): value is HeaderEntry {
	return (
		Array.isArray(value) &&
		value.length === 2 &&
		isString(value[0]) &&
		isString(value[1])
	);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(isString);
}

function isJsonRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}

function isOptionalNumber(value: unknown): value is number | undefined {
	return value === undefined || typeof value === "number";
}

function isOptionalString(value: unknown): value is string | undefined {
	return value === undefined || isString(value);
}
