export const PROTOCOL_VERSION = 3;
export const DEFAULT_DATA_CHANNELS = 2;
export const MAX_DATA_CHANNELS = 8;
export const DEFAULT_MAX_WEBSOCKET_MESSAGE_BYTES = 1024 * 1024;
export const DEFAULT_MAX_FRAME_BYTES = DEFAULT_MAX_WEBSOCKET_MESSAGE_BYTES;
export const DEFAULT_MAX_CONTROL_BYTES = 64 * 1024;
export const DEFAULT_STREAM_CREDIT_BYTES = DEFAULT_MAX_WEBSOCKET_MESSAGE_BYTES;
export const DEFAULT_CONNECTION_CREDIT_BYTES = 4 * 1024 * 1024;
export const DEFAULT_PENDING_DATA_BYTES = DEFAULT_CONNECTION_CREDIT_BYTES;
export const DEFAULT_PENDING_DATA_TIMEOUT_MS = 120_000;

export const DATA_FRAME_HEADER_BYTES = 17;
export const DATA_FRAME_MAGIC_0 = 0x48;
export const DATA_FRAME_MAGIC_1 = 0x43;

export const DATA_KIND_REQUEST_BODY = 1;
export const DATA_KIND_RESPONSE_BODY = 2;
export const DATA_KIND_WS_CLIENT = 3;
export const DATA_KIND_WS_SERVER = 4;

export const DATA_FLAG_NONE = 0x00;
export const DATA_FLAG_WS_TEXT = 0x01;
export const DATA_FLAG_WS_BINARY = 0x02;

export const CLOSE_NORMAL = 1000;
export const CLOSE_PROTOCOL_ERROR = 1002;
export const CLOSE_UNSUPPORTED_DATA = 1003;
export const CLOSE_MESSAGE_TOO_BIG = 1009;
export const CLOSE_TUNNEL_REPLACED = 1012;
export const CLOSE_INTERNAL_ERROR = 1011;

export const TUNNELS_API_PATH = "/api/tunnels";

export const MAX_HEADER_ENTRIES = 128;
export const MAX_HEADER_NAME_BYTES = 128;
export const MAX_HEADER_VALUE_BYTES = 8 * 1024;
export const MAX_URL_BYTES = 8 * 1024;
export const MAX_REASON_BYTES = 512;
export const MAX_CLOSE_REASON_BYTES = 123;

export type HeaderEntry = readonly [name: string, value: string];

export type TunnelLimits = {
	maxFrameBytes: number;
	maxWebSocketMessageBytes: number;
	maxControlBytes: number;
	streamCreditBytes: number;
	connectionCreditBytes: number;
	pendingDataBytes: number;
	pendingDataTimeoutMs: number;
};

export type CreateTunnelResponse = {
	tunnelId: string;
	publicUrl: string;
	connectionId: string;
	controlUrl: string;
	dataUrl: string;
	connectToken: string;
	refreshToken: string;
	dataChannels: number;
	limits: TunnelLimits;
};

export type RefreshTunnelResponse = {
	connectionId: string;
	controlUrl: string;
	dataUrl: string;
	connectToken: string;
	refreshToken: string;
	dataChannels: number;
	limits: TunnelLimits;
};

export type DataKind =
	| "request.body"
	| "response.body"
	| "ws.client"
	| "ws.server";

export type RequestStartMessage = {
	type: "request.start";
	id: number;
	kind: "http" | "websocket";
	method: string;
	url: string;
	headers: HeaderEntry[];
	body: boolean;
	protocols?: string[];
};

export type RequestEndMessage = {
	type: "request.end";
	id: number;
	kind: "request.body" | "ws.client";
	lastSeq: number;
	code?: number;
	reason?: string;
};

export type RequestAbortMessage = {
	type: "request.abort";
	id: number;
	reason: string;
};

export type ResponseStartMessage = {
	type: "response.start";
	id: number;
	status: number;
	headers: HeaderEntry[];
	body: boolean;
	protocol?: string;
};

export type ResponseEndMessage = {
	type: "response.end";
	id: number;
	kind: "response.body" | "ws.server";
	lastSeq: number;
	code?: number;
	reason?: string;
};

export type ResponseAbortMessage = {
	type: "response.abort";
	id: number;
	reason: string;
};

export type CreditMessage = {
	type: "credit";
	scope: "stream" | "connection";
	id?: number;
	kind?: DataKind;
	bytes: number;
};

export type ControlMessage =
	| RequestStartMessage
	| RequestEndMessage
	| RequestAbortMessage
	| ResponseStartMessage
	| ResponseEndMessage
	| ResponseAbortMessage
	| CreditMessage;

export type DataFrameMeta = {
	kind: DataKind;
	id: number;
	seq: number;
	flags?: number;
	payloadLength: number;
};

export type DataFrame = Omit<DataFrameMeta, "payloadLength"> & {
	payload: Uint8Array;
};

export type DecodedDataFrame = Required<DataFrameMeta> & {
	payload: Uint8Array;
};

export type CreditWindow = {
	readonly available: number;
};

export type CreditConsumeResult =
	| { ok: true; window: CreditWindow }
	| { ok: false; window: CreditWindow };

type JsonRecord = Record<string, unknown>;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const DATA_KIND_TO_CODE: Record<DataKind, number> = {
	"request.body": DATA_KIND_REQUEST_BODY,
	"response.body": DATA_KIND_RESPONSE_BODY,
	"ws.client": DATA_KIND_WS_CLIENT,
	"ws.server": DATA_KIND_WS_SERVER,
};

const DATA_CODE_TO_KIND = new Map<number, DataKind>([
	[DATA_KIND_REQUEST_BODY, "request.body"],
	[DATA_KIND_RESPONSE_BODY, "response.body"],
	[DATA_KIND_WS_CLIENT, "ws.client"],
	[DATA_KIND_WS_SERVER, "ws.server"],
]);

const HTTP_HOP_BY_HOP_HEADERS = new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
]);

const REQUEST_HEADER_EXCLUSIONS = new Set([
	...HTTP_HOP_BY_HOP_HEADERS,
	"content-length",
	"host",
]);

const WEBSOCKET_REQUEST_HEADER_EXCLUSIONS = new Set([
	...REQUEST_HEADER_EXCLUSIONS,
	"sec-websocket-accept",
	"sec-websocket-extensions",
	"sec-websocket-key",
	"sec-websocket-protocol",
	"sec-websocket-version",
]);

const RESPONSE_HEADER_EXCLUSIONS = new Set([
	...HTTP_HOP_BY_HOP_HEADERS,
	"content-encoding",
	"content-length",
]);

const CONTROL_KEYS: Record<ControlMessage["type"], readonly string[]> = {
	"request.start": [
		"type",
		"id",
		"kind",
		"method",
		"url",
		"headers",
		"body",
		"protocols",
	],
	"request.end": ["type", "id", "kind", "lastSeq", "code", "reason"],
	"request.abort": ["type", "id", "reason"],
	"response.start": ["type", "id", "status", "headers", "body", "protocol"],
	"response.end": ["type", "id", "kind", "lastSeq", "code", "reason"],
	"response.abort": ["type", "id", "reason"],
	credit: ["type", "scope", "id", "kind", "bytes"],
};

export function defaultTunnelLimits(): TunnelLimits {
	return {
		maxFrameBytes: DEFAULT_MAX_FRAME_BYTES,
		maxWebSocketMessageBytes: DEFAULT_MAX_WEBSOCKET_MESSAGE_BYTES,
		maxControlBytes: DEFAULT_MAX_CONTROL_BYTES,
		streamCreditBytes: DEFAULT_STREAM_CREDIT_BYTES,
		connectionCreditBytes: DEFAULT_CONNECTION_CREDIT_BYTES,
		pendingDataBytes: DEFAULT_PENDING_DATA_BYTES,
		pendingDataTimeoutMs: DEFAULT_PENDING_DATA_TIMEOUT_MS,
	};
}

export function encodeControlMessage(message: ControlMessage): string {
	if (!isControlMessage(message)) {
		throw new TypeError("Invalid control message");
	}

	return JSON.stringify(message);
}

export function decodeControlMessage(
	raw: string,
	options: { maxControlBytes?: number } = {},
): ControlMessage | null {
	if (
		byteLength(raw) > (options.maxControlBytes ?? DEFAULT_MAX_CONTROL_BYTES)
	) {
		return null;
	}

	const parsed = parseJsonRecord(raw);
	return parsed && isControlMessage(parsed) ? parsed : null;
}

export function isControlMessage(value: unknown): value is ControlMessage {
	if (!isRecord(value) || typeof value.type !== "string") {
		return false;
	}

	if (
		!hasOnlyKnownKeys(value, CONTROL_KEYS[value.type as ControlMessage["type"]])
	) {
		return false;
	}

	switch (value.type) {
		case "request.start":
			return (
				isValidStreamId(value.id) &&
				(value.kind === "http" || value.kind === "websocket") &&
				isNonEmptyToken(value.method, 32) &&
				isValidUrlPath(value.url) &&
				isHeaderEntries(value.headers) &&
				typeof value.body === "boolean" &&
				(value.protocols === undefined ||
					isStringArray(value.protocols, 128, 128))
			);
		case "request.end":
			return (
				isValidStreamId(value.id) &&
				(value.kind === "request.body" || value.kind === "ws.client") &&
				isValidLastSeq(value.lastSeq) &&
				isOptionalCloseCode(value.code) &&
				isOptionalReason(value.reason)
			);
		case "request.abort":
			return isValidStreamId(value.id) && isReason(value.reason);
		case "response.start":
			return (
				isValidStreamId(value.id) &&
				isHttpStatus(value.status) &&
				isHeaderEntries(value.headers) &&
				typeof value.body === "boolean" &&
				(value.protocol === undefined || isNonEmptyToken(value.protocol, 128))
			);
		case "response.end":
			return (
				isValidStreamId(value.id) &&
				(value.kind === "response.body" || value.kind === "ws.server") &&
				isValidLastSeq(value.lastSeq) &&
				isOptionalCloseCode(value.code) &&
				isOptionalReason(value.reason)
			);
		case "response.abort":
			return isValidStreamId(value.id) && isReason(value.reason);
		case "credit":
			if (!isPositiveSafeInteger(value.bytes)) {
				return false;
			}
			if (value.scope === "stream") {
				return isValidStreamId(value.id) && isDataKind(value.kind);
			}
			if (value.scope === "connection") {
				return value.id === undefined && value.kind === undefined;
			}
			return false;
		default:
			return false;
	}
}

export function encodeDataFrame(
	frame: DataFrame,
	options: { maxFrameBytes?: number } = {},
): Uint8Array {
	const payload = frame.payload;
	const header = encodeDataFrameHeader(
		{
			kind: frame.kind,
			id: frame.id,
			seq: frame.seq,
			flags: frame.flags ?? DATA_FLAG_NONE,
			payloadLength: payload.byteLength,
		},
		options,
	);
	const encoded = new Uint8Array(DATA_FRAME_HEADER_BYTES + payload.byteLength);
	encoded.set(header);
	encoded.set(payload, DATA_FRAME_HEADER_BYTES);
	return encoded;
}

export function encodeDataFrameHeader(
	meta: DataFrameMeta,
	options: { maxFrameBytes?: number } = {},
): Uint8Array {
	const flags = meta.flags ?? DATA_FLAG_NONE;
	const maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
	if (!isDataKind(meta.kind)) {
		throw new TypeError("Invalid data kind");
	}
	if (!isValidFlagsForKind(meta.kind, flags)) {
		throw new TypeError("Invalid data frame flags");
	}
	if (!isValidStreamId(meta.id)) {
		throw new TypeError("Invalid stream id");
	}
	if (!isValidSeq(meta.seq)) {
		throw new TypeError("Invalid seq");
	}
	if (!isUint32(meta.payloadLength) || meta.payloadLength > maxFrameBytes) {
		throw new TypeError("Invalid payload length");
	}

	const header = new Uint8Array(DATA_FRAME_HEADER_BYTES);
	const view = new DataView(header.buffer);
	header[0] = DATA_FRAME_MAGIC_0;
	header[1] = DATA_FRAME_MAGIC_1;
	header[2] = PROTOCOL_VERSION;
	header[3] = DATA_KIND_TO_CODE[meta.kind];
	header[4] = flags;
	view.setUint32(5, meta.id, false);
	view.setUint32(9, meta.seq, false);
	view.setUint32(13, meta.payloadLength, false);
	return header;
}

export function decodeDataFrame(
	bytes: Uint8Array,
	options: { maxFrameBytes?: number } = {},
): DecodedDataFrame | null {
	return decodeDataFrameView(bytes, options);
}

export function decodeDataFrameView(
	bytes: Uint8Array,
	options: { maxFrameBytes?: number } = {},
): DecodedDataFrame | null {
	if (bytes.byteLength < DATA_FRAME_HEADER_BYTES) {
		return null;
	}
	if (bytes[0] !== DATA_FRAME_MAGIC_0 || bytes[1] !== DATA_FRAME_MAGIC_1) {
		return null;
	}
	if (bytes[2] !== PROTOCOL_VERSION) {
		return null;
	}

	const kind = DATA_CODE_TO_KIND.get(bytes[3]);
	if (!kind) {
		return null;
	}

	const flags = bytes[4];
	if (!isValidFlagsForKind(kind, flags)) {
		return null;
	}

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const id = view.getUint32(5, false);
	const seq = view.getUint32(9, false);
	const payloadLength = view.getUint32(13, false);
	const maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;

	if (
		!isValidStreamId(id) ||
		!isValidSeq(seq) ||
		payloadLength > maxFrameBytes ||
		bytes.byteLength !== DATA_FRAME_HEADER_BYTES + payloadLength
	) {
		return null;
	}

	return {
		kind,
		id,
		seq,
		flags,
		payloadLength,
		payload: bytes.subarray(DATA_FRAME_HEADER_BYTES),
	};
}

export function getDataKindCode(kind: DataKind): number {
	return DATA_KIND_TO_CODE[kind];
}

export function getDataKindFromCode(code: number): DataKind | null {
	return DATA_CODE_TO_KIND.get(code) ?? null;
}

export function isDataKind(value: unknown): value is DataKind {
	return (
		value === "request.body" ||
		value === "response.body" ||
		value === "ws.client" ||
		value === "ws.server"
	);
}

export function selectDataChannel(
	streamId: number,
	dataChannels: number,
): number {
	if (
		!isValidStreamId(streamId) ||
		!Number.isInteger(dataChannels) ||
		dataChannels < 1 ||
		dataChannels > MAX_DATA_CHANNELS
	) {
		throw new RangeError("Invalid stream id or data channel count");
	}

	return streamId % dataChannels;
}

export function isValidStreamId(id: unknown): id is number {
	return isUint32(id) && id >= 1;
}

export function isValidChannelId(
	id: unknown,
	dataChannels: number,
): id is number {
	return (
		Number.isInteger(dataChannels) &&
		dataChannels >= 1 &&
		dataChannels <= MAX_DATA_CHANNELS &&
		Number.isInteger(id) &&
		(id as number) >= 0 &&
		(id as number) < dataChannels
	);
}

export function isValidSeq(seq: unknown): seq is number {
	return isUint32(seq);
}

export function isValidLastSeq(seq: unknown): seq is number {
	return seq === -1 || isValidSeq(seq);
}

export function createCreditWindow(bytes: number): CreditWindow {
	if (!isNonNegativeSafeInteger(bytes)) {
		throw new RangeError("Invalid credit");
	}
	return { available: bytes };
}

export function grantCredit(window: CreditWindow, bytes: number): CreditWindow {
	if (!isPositiveSafeInteger(bytes)) {
		throw new RangeError("Invalid credit grant");
	}
	return { available: window.available + bytes };
}

export function canConsumeCredit(window: CreditWindow, bytes: number): boolean {
	return isNonNegativeSafeInteger(bytes) && window.available >= bytes;
}

export function consumeCredit(
	window: CreditWindow,
	bytes: number,
): CreditConsumeResult {
	if (!isNonNegativeSafeInteger(bytes)) {
		return { ok: false, window };
	}
	if (window.available < bytes) {
		return { ok: false, window };
	}
	return { ok: true, window: { available: window.available - bytes } };
}

export function normalizeWebSocketCloseCode(code: unknown): number {
	if (!Number.isInteger(code)) {
		return CLOSE_NORMAL;
	}

	const value = code as number;
	if (value < 1000 || value > 4999) {
		return CLOSE_NORMAL;
	}
	if (value === 1004 || value === 1005 || value === 1006 || value === 1015) {
		return CLOSE_NORMAL;
	}
	return value;
}

export function normalizeWebSocketCloseReason(reason: unknown): string {
	if (typeof reason !== "string") {
		return "";
	}

	let result = "";
	for (const char of reason) {
		if (byteLength(result + char) > MAX_CLOSE_REASON_BYTES) {
			break;
		}
		result += char;
	}
	return result;
}

export function filterHttpRequestHeaders(
	headers: readonly HeaderEntry[],
): HeaderEntry[] {
	return filterHeaders(headers, REQUEST_HEADER_EXCLUSIONS);
}

export function filterWebSocketRequestHeaders(
	headers: readonly HeaderEntry[],
): HeaderEntry[] {
	return filterHeaders(headers, WEBSOCKET_REQUEST_HEADER_EXCLUSIONS);
}

export function filterResponseHeaders(
	headers: readonly HeaderEntry[],
): HeaderEntry[] {
	return filterHeaders(headers, RESPONSE_HEADER_EXCLUSIONS);
}

export function headersToEntries(headers: {
	forEach(callback: (value: string, key: string) => void): void;
	getSetCookie?(): string[];
}): HeaderEntry[] {
	const entries: HeaderEntry[] = [];
	const setCookies = headers.getSetCookie?.() ?? [];
	headers.forEach((value, key) => {
		const lowerKey = key.toLowerCase();
		if (lowerKey === "set-cookie" && setCookies.length > 0) {
			return;
		}
		entries.push([lowerKey, value]);
	});
	for (const value of setCookies) {
		entries.push(["set-cookie", value]);
	}
	return entries;
}

export function buildPublicUrl(baseDomain: string, tunnelId: string): string {
	return `https://${tunnelId}.${baseDomain}`;
}

export function buildTunnelControlPath(tunnelId: string): string {
	return `${TUNNELS_API_PATH}/${encodeURIComponent(tunnelId)}/control`;
}

export function buildTunnelDataPath(tunnelId: string): string {
	return `${TUNNELS_API_PATH}/${encodeURIComponent(tunnelId)}/data`;
}

export function buildTunnelRefreshPath(tunnelId: string): string {
	return `${TUNNELS_API_PATH}/${encodeURIComponent(tunnelId)}/refresh`;
}

export function isValidTunnelId(value: unknown): value is string {
	if (typeof value !== "string") {
		return false;
	}
	if (value.length < 1 || value.length > 63 || value !== value.toLowerCase()) {
		return false;
	}
	if (value === "api" || value === "www") {
		return false;
	}
	return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value);
}

export function parseCreateTunnelResponse(
	raw: string | unknown,
): CreateTunnelResponse | null {
	const value = typeof raw === "string" ? parseJsonRecord(raw) : raw;
	if (!isCreateTunnelResponse(value)) {
		return null;
	}
	return { ...value, limits: normalizeTunnelLimits(value.limits) };
}

export function parseRefreshTunnelResponse(
	raw: string | unknown,
): RefreshTunnelResponse | null {
	const value = typeof raw === "string" ? parseJsonRecord(raw) : raw;
	if (!isRefreshTunnelResponse(value)) {
		return null;
	}
	return { ...value, limits: normalizeTunnelLimits(value.limits) };
}

export function isCreateTunnelResponse(
	value: unknown,
): value is CreateTunnelResponse {
	if (!isRecord(value)) {
		return false;
	}

	const dataChannels = value.dataChannels;
	return (
		isValidTunnelId(value.tunnelId) &&
		isNonEmptyString(value.publicUrl, 2048) &&
		isNonEmptyString(value.connectionId, 256) &&
		isNonEmptyString(value.controlUrl, 2048) &&
		isNonEmptyString(value.dataUrl, 2048) &&
		isNonEmptyString(value.connectToken, 16_384) &&
		isNonEmptyString(value.refreshToken, 16_384) &&
		typeof dataChannels === "number" &&
		Number.isInteger(dataChannels) &&
		dataChannels >= 1 &&
		dataChannels <= MAX_DATA_CHANNELS &&
		isTunnelLimits(value.limits)
	);
}

export function isRefreshTunnelResponse(
	value: unknown,
): value is RefreshTunnelResponse {
	if (!isRecord(value)) {
		return false;
	}

	const dataChannels = value.dataChannels;
	return (
		isNonEmptyString(value.connectionId, 256) &&
		isNonEmptyString(value.controlUrl, 2048) &&
		isNonEmptyString(value.dataUrl, 2048) &&
		isNonEmptyString(value.connectToken, 16_384) &&
		isNonEmptyString(value.refreshToken, 16_384) &&
		typeof dataChannels === "number" &&
		Number.isInteger(dataChannels) &&
		dataChannels >= 1 &&
		dataChannels <= MAX_DATA_CHANNELS &&
		isTunnelLimits(value.limits)
	);
}

export function isTunnelLimits(value: unknown): value is TunnelLimits {
	return (
		isRecord(value) &&
		isPositiveSafeInteger(value.maxFrameBytes) &&
		(value.maxWebSocketMessageBytes === undefined ||
			isPositiveSafeInteger(value.maxWebSocketMessageBytes)) &&
		isPositiveSafeInteger(value.maxControlBytes) &&
		isPositiveSafeInteger(value.streamCreditBytes) &&
		isPositiveSafeInteger(value.connectionCreditBytes) &&
		isPositiveSafeInteger(value.pendingDataBytes) &&
		isPositiveSafeInteger(value.pendingDataTimeoutMs)
	);
}

function normalizeTunnelLimits(limits: TunnelLimits): TunnelLimits {
	return {
		...limits,
		maxWebSocketMessageBytes:
			limits.maxWebSocketMessageBytes ?? limits.maxFrameBytes,
	};
}

export function utf8Encode(value: string): Uint8Array {
	return textEncoder.encode(value);
}

export function utf8Decode(value: Uint8Array): string {
	return textDecoder.decode(value);
}

export function byteLength(value: string): number {
	return textEncoder.encode(value).byteLength;
}

function filterHeaders(
	headers: readonly HeaderEntry[],
	staticExclusions: ReadonlySet<string>,
): HeaderEntry[] {
	const dynamicExclusions = new Set<string>();
	for (const [name, value] of headers) {
		if (name.toLowerCase() === "connection") {
			for (const token of value.split(",")) {
				const normalized = token.trim().toLowerCase();
				if (normalized) {
					dynamicExclusions.add(normalized);
				}
			}
		}
	}

	const filtered: HeaderEntry[] = [];
	for (const [name, value] of headers) {
		const lowerName = name.toLowerCase();
		if (
			!isHeaderName(lowerName) ||
			staticExclusions.has(lowerName) ||
			dynamicExclusions.has(lowerName)
		) {
			continue;
		}
		filtered.push([lowerName, value]);
	}
	return filtered;
}

function isValidFlagsForKind(kind: DataKind, flags: number): boolean {
	if (!Number.isInteger(flags)) {
		return false;
	}
	if (kind === "ws.client" || kind === "ws.server") {
		return flags === DATA_FLAG_WS_TEXT || flags === DATA_FLAG_WS_BINARY;
	}
	return flags === DATA_FLAG_NONE;
}

function hasOnlyKnownKeys(
	value: JsonRecord,
	allowedKeys: readonly string[] | undefined,
): boolean {
	if (!allowedKeys) {
		return false;
	}

	const allowed = new Set(allowedKeys);
	return Object.keys(value).every((key) => allowed.has(key));
}

function isHeaderEntries(value: unknown): value is HeaderEntry[] {
	if (!Array.isArray(value) || value.length > MAX_HEADER_ENTRIES) {
		return false;
	}
	return value.every(
		(entry) =>
			Array.isArray(entry) &&
			entry.length === 2 &&
			typeof entry[0] === "string" &&
			typeof entry[1] === "string" &&
			isHeaderName(entry[0]) &&
			byteLength(entry[0]) <= MAX_HEADER_NAME_BYTES &&
			byteLength(entry[1]) <= MAX_HEADER_VALUE_BYTES,
	);
}

function isHeaderName(value: string): boolean {
	return /^[!#$%&'*+\-.^_`|~0-9a-zA-Z]+$/.test(value);
}

function isValidUrlPath(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.startsWith("/") &&
		byteLength(value) <= MAX_URL_BYTES
	);
}

function isReason(value: unknown): value is string {
	return typeof value === "string" && byteLength(value) <= MAX_REASON_BYTES;
}

function isOptionalReason(value: unknown): value is string | undefined {
	return value === undefined || isReason(value);
}

function isOptionalCloseCode(value: unknown): value is number | undefined {
	return value === undefined || normalizeWebSocketCloseCode(value) === value;
}

function isHttpStatus(value: unknown): value is number {
	return (
		Number.isInteger(value) &&
		(value as number) >= 100 &&
		(value as number) <= 599
	);
}

function isStringArray(
	value: unknown,
	maxEntries: number,
	maxEntryBytes: number,
): value is string[] {
	return (
		Array.isArray(value) &&
		value.length <= maxEntries &&
		value.every(
			(entry) =>
				typeof entry === "string" &&
				entry.length > 0 &&
				byteLength(entry) <= maxEntryBytes,
		)
	);
}

function isNonEmptyToken(value: unknown, maxBytes: number): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		!/\s/.test(value) &&
		byteLength(value) <= maxBytes
	);
}

function isNonEmptyString(value: unknown, maxBytes: number): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		byteLength(value) <= maxBytes
	);
}

function isPositiveSafeInteger(value: unknown): value is number {
	return (
		Number.isSafeInteger(value) &&
		(value as number) > 0 &&
		(value as number) <= 0xffffffff
	);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return (
		Number.isSafeInteger(value) &&
		(value as number) >= 0 &&
		(value as number) <= Number.MAX_SAFE_INTEGER
	);
}

function isUint32(value: unknown): value is number {
	return (
		Number.isInteger(value) &&
		(value as number) >= 0 &&
		(value as number) <= 0xffffffff
	);
}

function parseJsonRecord(raw: string): JsonRecord | null {
	try {
		const parsed = JSON.parse(raw);
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
