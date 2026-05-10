import type { TunnelLimits } from "@hostc/protocol";
import type { HostcClientState } from "./events.js";
import type { UpstreamAdapter } from "./upstream.js";

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
	limits: TunnelLimits | null;
};
