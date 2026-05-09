import type { ControlMessage, DataKind, TunnelLimits } from "@hostc/protocol";

type CreditKey = `${number}:${DataKind}`;

const CREDIT_KINDS = [
	"request.body",
	"response.body",
	"ws.client",
	"ws.server",
] satisfies DataKind[];

export class TunnelCreditController {
	private outboundConnectionCredit = 0;
	private inboundConnectionCredit = 0;
	private readonly outboundStreamCredit = new Map<CreditKey, number>();
	private readonly inboundStreamCredit = new Map<CreditKey, number>();
	private readonly waiters = new Set<() => void>();
	private pendingConnectionCredit = 0;
	private readonly pendingStreamCredit = new Map<CreditKey, number>();
	private flushScheduled = false;

	constructor(
		private readonly limits: () => TunnelLimits,
		private readonly flushDelayMs: number,
		private readonly sendControl: (message: ControlMessage) => Promise<void>,
		private readonly waitUntil: (promise: Promise<unknown>) => void,
		private readonly onFlushError: (error: unknown) => void,
	) {}

	reset(): void {
		const limits = this.limits();
		this.outboundConnectionCredit = limits.connectionCreditBytes;
		this.inboundConnectionCredit = limits.connectionCreditBytes;
		this.outboundStreamCredit.clear();
		this.inboundStreamCredit.clear();
		this.pendingConnectionCredit = 0;
		this.pendingStreamCredit.clear();
		this.flushScheduled = false;
		this.wakeWaiters();
	}

	seedStream(streamId: number): void {
		const limits = this.limits();
		for (const kind of CREDIT_KINDS) {
			this.outboundStreamCredit.set(
				creditKey(streamId, kind),
				limits.streamCreditBytes,
			);
			this.inboundStreamCredit.set(
				creditKey(streamId, kind),
				limits.streamCreditBytes,
			);
		}
	}

	deleteStream(streamId: number): void {
		for (const kind of CREDIT_KINDS) {
			this.outboundStreamCredit.delete(creditKey(streamId, kind));
			this.inboundStreamCredit.delete(creditKey(streamId, kind));
		}
	}

	apply(message: Extract<ControlMessage, { type: "credit" }>): void {
		if (message.scope === "connection") {
			this.outboundConnectionCredit += message.bytes;
		} else if (message.id && message.kind) {
			this.addStreamCredit(
				this.outboundStreamCredit,
				message.id,
				message.kind,
				message.bytes,
			);
		}
		this.wakeWaiters();
	}

	async waitForOutbound(
		streamId: number,
		kind: DataKind,
		bytes: number,
		canWait: () => boolean,
	): Promise<void> {
		if (!canWait()) {
			throw new Error("Stream unavailable");
		}
		while (!this.hasOutbound(streamId, kind, bytes)) {
			await new Promise<void>((resolve) => {
				this.waiters.add(resolve);
			});
			if (!canWait()) {
				throw new Error("Stream unavailable");
			}
		}
	}

	decrementOutbound(streamId: number, kind: DataKind, bytes: number): void {
		this.outboundConnectionCredit -= bytes;
		const key = creditKey(streamId, kind);
		this.outboundStreamCredit.set(
			key,
			(this.outboundStreamCredit.get(key) ?? 0) - bytes,
		);
	}

	consumeInbound(streamId: number, kind: DataKind, bytes: number): boolean {
		const key = creditKey(streamId, kind);
		const streamCredit = this.inboundStreamCredit.get(key) ?? 0;
		if (this.inboundConnectionCredit < bytes || streamCredit < bytes) {
			return false;
		}
		this.inboundConnectionCredit -= bytes;
		this.inboundStreamCredit.set(key, streamCredit - bytes);
		return true;
	}

	grantInbound(streamId: number, kind: DataKind, bytes: number): void {
		if (bytes <= 0) {
			return;
		}
		this.inboundConnectionCredit += bytes;
		this.addStreamCredit(this.inboundStreamCredit, streamId, kind, bytes);
		this.pendingConnectionCredit += bytes;
		this.addStreamCredit(this.pendingStreamCredit, streamId, kind, bytes);
		this.scheduleFlush();
	}

	wakeWaiters(): void {
		for (const waiter of this.waiters) {
			waiter();
		}
		this.waiters.clear();
	}

	private hasOutbound(
		streamId: number,
		kind: DataKind,
		bytes: number,
	): boolean {
		return (
			this.outboundConnectionCredit >= bytes &&
			(this.outboundStreamCredit.get(creditKey(streamId, kind)) ?? 0) >= bytes
		);
	}

	private addStreamCredit(
		store: Map<CreditKey, number>,
		streamId: number,
		kind: DataKind,
		bytes: number,
	): void {
		const key = creditKey(streamId, kind);
		store.set(key, (store.get(key) ?? 0) + bytes);
	}

	private scheduleFlush(): void {
		if (this.flushScheduled) {
			return;
		}
		this.flushScheduled = true;
		this.waitUntil(sleep(this.flushDelayMs).then(() => this.flush()));
	}

	private async flush(): Promise<void> {
		const connectionBytes = this.pendingConnectionCredit;
		const streamCredits = [...this.pendingStreamCredit.entries()];
		this.pendingConnectionCredit = 0;
		this.pendingStreamCredit.clear();
		this.flushScheduled = false;

		try {
			for (const [key, bytes] of streamCredits) {
				const { streamId, kind } = parseCreditKey(key);
				await this.sendControl({
					type: "credit",
					scope: "stream",
					id: streamId,
					kind,
					bytes,
				});
			}
			if (connectionBytes > 0) {
				await this.sendControl({
					type: "credit",
					scope: "connection",
					bytes: connectionBytes,
				});
			}
		} catch (error) {
			this.onFlushError(error);
		}
	}
}

function creditKey(streamId: number, kind: DataKind): CreditKey {
	return `${streamId}:${kind}`;
}

function parseCreditKey(key: CreditKey): { streamId: number; kind: DataKind } {
	const separator = key.indexOf(":");
	return {
		streamId: Number(key.slice(0, separator)),
		kind: key.slice(separator + 1) as DataKind,
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
