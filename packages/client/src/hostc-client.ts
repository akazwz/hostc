import { EventEmitter } from "node:events";
import {
	CLOSE_INTERNAL_ERROR,
	CLOSE_NORMAL,
	DEFAULT_DATA_CHANNELS,
} from "@hostc/protocol";
import { ClientConnection } from "./client-connection.js";
import type {
	HostcClientOptions,
	HostcClientSnapshot,
	HostcTunnelLimits,
} from "./client-types.js";
import type {
	HostcClientEvents,
	HostcClientState,
	HostcReadyEvent,
} from "./events.js";
import { createEphemeralTunnel, withJitter } from "./tunnel-api.js";

export type {
	HostcClientOptions,
	HostcClientSnapshot,
	HostcTunnelLimits,
} from "./client-types.js";
export {
	createEphemeralTunnel,
	type HostcEphemeralTunnel,
	HostcProtocolUpgradeError,
} from "./tunnel-api.js";

type Listener<T extends keyof HostcClientEvents> = (
	...args: HostcClientEvents[T]
) => void;

export class HostcClient {
	private readonly emitter = new EventEmitter();
	private readonly fetchImpl: typeof fetch;
	private state: HostcClientState = "idle";
	private snapshot: HostcClientSnapshot;
	private connection: ClientConnection | null = null;
	private closed = false;
	private forcedReconnectReason: string | null = null;

	constructor(private readonly options: HostcClientOptions) {
		this.fetchImpl = options.fetch ?? fetch;
		this.snapshot = {
			state: this.state,
			tunnelId: null,
			clientConnectionId: null,
			publicUrl: null,
			dataChannels: options.dataChannels ?? DEFAULT_DATA_CHANNELS,
			limits: null,
		};
	}

	on<T extends keyof HostcClientEvents>(event: T, listener: Listener<T>): this {
		this.emitter.on(event, listener);
		return this;
	}

	off<T extends keyof HostcClientEvents>(
		event: T,
		listener: Listener<T>,
	): this {
		this.emitter.off(event, listener);
		return this;
	}

	getSnapshot(): HostcClientSnapshot {
		return { ...this.snapshot };
	}

	async start(): Promise<void> {
		let reconnectAttempt = 0;
		let delayMs = 500;
		let hasReadyConnection = false;
		let reconnectReason = "data channel disconnected";
		while (!this.closed) {
			let connection: ClientConnection | null = null;
			try {
				const isReconnect = hasReadyConnection || reconnectAttempt > 0;
				this.setState(isReconnect ? "reconnecting" : "creatingTunnel");
				if (isReconnect) {
					this.emit("reconnecting", {
						attempt: reconnectAttempt,
						delayMs,
						reason: this.forcedReconnectReason ?? reconnectReason,
					});
					await sleep(withJitter(delayMs));
					delayMs = Math.min(delayMs * 2, 10_000);
				}

				const tunnel = await createEphemeralTunnel({
					serverUrl: this.options.serverUrl,
					dataChannels: this.options.dataChannels ?? DEFAULT_DATA_CHANNELS,
					fetcher: this.fetchImpl,
				});
				this.snapshot = {
					...this.snapshot,
					tunnelId: tunnel.tunnelId,
					clientConnectionId: tunnel.clientConnectionId,
					publicUrl: tunnel.publicUrl,
					dataChannels: tunnel.dataChannels,
					limits: tunnel.limits,
				};

				connection = new ClientConnection({
					tunnel,
					upstream: this.options.upstream,
					emitLog: (event) => this.emit("log", event),
				});
				this.connection = connection;
				this.setState("connecting");
				await connection.connect();
				if (this.closed || this.connection !== connection) {
					connection.close(CLOSE_INTERNAL_ERROR, "superseded");
					continue;
				}

				this.setReady(
					{
						tunnelId: tunnel.tunnelId,
						clientConnectionId: tunnel.clientConnectionId,
						publicUrl: tunnel.publicUrl,
					},
					tunnel.limits,
				);
				hasReadyConnection = true;
				reconnectAttempt = 0;
				delayMs = 500;
				this.forcedReconnectReason = null;
				reconnectReason = await connection.waitForDisconnect();
			} catch (error) {
				reconnectReason = toError(error).message;
				if (!this.closed) {
					this.emit("error", toError(error));
				}
				if (!hasReadyConnection && reconnectAttempt === 0) {
					throw error;
				}
			} finally {
				if (connection && this.connection === connection) {
					connection.close(CLOSE_INTERNAL_ERROR, "reconnect");
					this.connection = null;
				}
			}
			if (!this.closed) {
				reconnectAttempt += 1;
			}
		}
	}

	async stop(): Promise<void> {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.connection?.close(CLOSE_NORMAL, "closed");
		this.connection = null;
		this.setState("closed");
		this.emit("closed", { reason: "stopped" });
	}

	forceReconnect(reason = "forced reconnect"): void {
		if (this.closed) {
			return;
		}
		this.forcedReconnectReason = reason;
		this.connection?.close(CLOSE_INTERNAL_ERROR, reason);
	}

	protected setReady(event: HostcReadyEvent, limits: HostcTunnelLimits): void {
		this.snapshot = {
			...this.snapshot,
			state: "ready",
			tunnelId: event.tunnelId,
			clientConnectionId: event.clientConnectionId,
			publicUrl: event.publicUrl,
			limits,
		};
		this.state = "ready";
		this.emit("state", "ready");
		this.emit("ready", event);
	}

	private setState(state: HostcClientState): void {
		if (this.state === state) {
			return;
		}
		this.state = state;
		this.snapshot = { ...this.snapshot, state };
		this.emit("state", state);
	}

	private emit<T extends keyof HostcClientEvents>(
		event: T,
		...args: HostcClientEvents[T]
	): void {
		this.emitter.emit(event, ...args);
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
