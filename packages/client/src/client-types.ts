import type { HostcClientState } from "./events.js";
import type { UpstreamAdapter } from "./upstream.js";

export type HostcTunnelLimits = {
	readonly maxFrameBytes: number;
	readonly maxMetadataBytes: number;
	readonly maxWebSocketMessageBytes: number;
	readonly streamCreditBytes: number;
	readonly channelCreditBytes: number;
	readonly pendingDataBytes: number;
	readonly pendingDataTimeoutMs: number;
};

export type HostcClientOptions = {
	serverUrl: string;
	upstream: UpstreamAdapter;
	dataChannels?: number;
	debug?: boolean;
	fetch?: typeof fetch;
};

export type HostcClientSnapshot = {
	state: HostcClientState;
	tunnelId: string | null;
	clientConnectionId: string | null;
	publicUrl: string | null;
	dataChannels: number;
	limits: HostcTunnelLimits | null;
};
