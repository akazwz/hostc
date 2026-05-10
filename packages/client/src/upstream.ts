import type { HeaderEntry } from "@hostc/protocol";

export type { HeaderEntry };

export type HostcHttpRequest = {
	method: string;
	target: string;
	headers: HeaderEntry[];
	body: ReadableStream<Uint8Array> | null;
	publicUrl?: string;
	signal?: AbortSignal;
};

export type HostcHttpResponse = {
	status: number;
	headers?: HeaderEntry[];
	body?: ReadableStream<Uint8Array> | Uint8Array | string | null;
};

export type HostcWebSocketMessage = {
	data: Uint8Array | string;
	binary: boolean;
};

export type HostcUpstreamWebSocket = {
	readonly protocol?: string;
	accept(options?: { protocol?: string }): void;
	send(message: Uint8Array | string): void;
	close(code?: number, reason?: string): void;
	onMessage(listener: (message: HostcWebSocketMessage) => void): void;
	onClose(listener: (event: { code: number; reason: string }) => void): void;
};

export type HostcWebSocketRequest = {
	method: string;
	target: string;
	headers: HeaderEntry[];
	protocols: string[];
	publicUrl?: string;
	signal?: AbortSignal;
};

export type UpstreamAdapter = {
	handleHttp(request: HostcHttpRequest): Promise<HostcHttpResponse>;
	handleWebSocket?(
		request: HostcWebSocketRequest,
	): Promise<HostcUpstreamWebSocket>;
};
