import { EventEmitter } from "node:events";

import { CLOSE_REPLACED, CLOSE_SHUTDOWN, type CreateTunnelResponse } from "@hostc/protocol";

import { createTunnel, TunnelError } from "./api.ts";
import { Connection } from "./connection.ts";
import type { RequestLog } from "./streams.ts";

export type TunnelOptions = {
	/** Tunnel server origin, for example `https://hostc.dev`. */
	server: string;
	/** Local server origin, for example `http://localhost:3000`. */
	target: string | URL;
};

export type TunnelEvents = {
	/** Connected again after a disconnect. `urlChanged` is true when the old tunnel had expired. */
	reconnected: [{ url: string; urlChanged: boolean }];
	disconnected: [{ reason: string }];
	reconnecting: [{ attempt: number; delayMs: number; error?: TunnelError }];
	request: [RequestLog];
	/** Reconnecting is impossible, for example because the server needs a newer client. */
	failed: [TunnelError];
	closed: [];
};

/**
 * A public URL forwarding to a local server. Survives network drops and
 * server restarts: reconnects keep the same URL while the tunnel is alive.
 */
export class Tunnel extends EventEmitter<TunnelEvents> {
	private readonly server: string;
	private readonly target: URL;
	private info: CreateTunnelResponse;
	private connection: Connection | null = null;
	private closing = false;
	private wakeBackoff: (() => void) | null = null;
	/** Set when a new tunnel replaced an expired one and the user has not been told yet. */
	private urlChanged = false;

	static async open(options: TunnelOptions): Promise<Tunnel> {
		const info = await createTunnel(options.server);
		const tunnel = new Tunnel(options, info);
		tunnel.connection = await tunnel.connect();
		void tunnel.supervise();
		return tunnel;
	}

	private constructor(options: TunnelOptions, info: CreateTunnelResponse) {
		super();
		this.server = options.server;
		this.target = new URL(options.target);
		this.info = info;
	}

	get url(): string {
		return this.info.url;
	}

	async close(): Promise<void> {
		if (this.closing) {
			return;
		}
		this.closing = true;
		this.wakeBackoff?.();
		const connection = this.connection;
		if (connection) {
			connection.close(CLOSE_SHUTDOWN, "client shutdown");
			await Promise.race([connection.closed, sleep(2000)]);
		}
		this.emit("closed");
	}

	private connect(): Promise<Connection> {
		return Connection.open({
			tunnel: this.info,
			target: this.target,
			onRequest: (entry) => this.emit("request", entry),
		});
	}

	private async supervise(): Promise<void> {
		while (this.connection && !this.closing) {
			const { code, reason } = await this.connection.closed;
			this.connection = null;
			if (this.closing) {
				return;
			}
			if (code === CLOSE_REPLACED) {
				// Another connection took over this tunnel; reconnecting would take it back and start a tug of war.
				this.closing = true;
				this.emit("failed", new TunnelError("replaced", "Another hostc process took over this tunnel."));
				this.emit("closed");
				return;
			}
			this.emit("disconnected", { reason });
			await this.reconnect();
		}
	}

	private async reconnect(): Promise<void> {
		let error: TunnelError | undefined;
		for (let attempt = 1; !this.closing; attempt += 1) {
			const delayMs = backoff(attempt);
			this.emit("reconnecting", error ? { attempt, delayMs, error } : { attempt, delayMs });
			await new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, delayMs);
				this.wakeBackoff = () => {
					clearTimeout(timer);
					resolve();
				};
			});
			this.wakeBackoff = null;
			if (this.closing) {
				return;
			}
			try {
				try {
					this.connection = await this.connect();
				} catch (caught) {
					if (!(caught instanceof TunnelError && (caught.code === "tunnel_gone" || caught.code === "unauthorized"))) {
						throw caught;
					}
					// The tunnel expired while we were away: start a new one.
					this.info = await createTunnel(this.server);
					this.urlChanged = true;
					this.connection = await this.connect();
				}
				if (this.closing) {
					this.connection.close(CLOSE_SHUTDOWN, "client shutdown");
					return;
				}
				this.emit("reconnected", { url: this.url, urlChanged: this.urlChanged });
				this.urlChanged = false;
				return;
			} catch (caught) {
				error = caught instanceof TunnelError ? caught : new TunnelError("network_error", String(caught));
				if (error.code === "upgrade_required") {
					this.closing = true;
					this.emit("failed", error);
					this.emit("closed");
					return;
				}
			}
		}
	}
}

/** 250 ms, 500 ms, 1 s … capped at 10 s, with ±20% jitter so clients don't reconnect in lockstep. */
function backoff(attempt: number): number {
	const base = Math.min(250 * 2 ** (attempt - 1), 10_000);
	return Math.round(base * (0.8 + Math.random() * 0.4));
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms).unref());
}
