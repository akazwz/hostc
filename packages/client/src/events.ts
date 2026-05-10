export type HostcClientState =
	| "idle"
	| "creatingTunnel"
	| "connecting"
	| "ready"
	| "reconnecting"
	| "closed";

export type HostcReadyEvent = {
	tunnelId: string;
	clientConnectionId: string;
	publicUrl: string;
};

export type HostcReconnectEvent = {
	attempt: number;
	delayMs: number;
	reason: string;
};

export type HostcClosedEvent = {
	reason: string;
};

export type HostcLogEvent = {
	level: "debug" | "info" | "warn" | "error";
	message: string;
	fields?: Record<string, unknown>;
};

export type HostcClientEvents = {
	state: [state: HostcClientState];
	ready: [event: HostcReadyEvent];
	reconnecting: [event: HostcReconnectEvent];
	closed: [event: HostcClosedEvent];
	error: [error: Error];
	log: [event: HostcLogEvent];
};
