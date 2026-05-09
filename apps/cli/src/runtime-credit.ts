import type { ControlMessage, DataKind } from "@hostc/protocol";

type CreditKey = `${number}:${DataKind}`;

const CREDIT_KINDS = [
	"request.body",
	"response.body",
	"ws.client",
	"ws.server",
] satisfies DataKind[];

export class RuntimeCreditController {
	private outboundConnectionCredit = 0;
	private readonly outboundStreamCredit = new Map<CreditKey, number>();
	private readonly waiters = new Set<() => void>();
	private pendingConnectionCredit = 0;
	private readonly pendingStreamCredit = new Map<CreditKey, number>();
	private flushTimer: NodeJS.Timeout | null = null;

	constructor(
		private readonly flushDelayMs: number,
		private readonly sendControl: (message: ControlMessage) => Promise<void>,
		private readonly debug: (message: string) => void,
	) {}

	reset(connectionCreditBytes: number): void {
		this.outboundConnectionCredit = connectionCreditBytes;
		this.outboundStreamCredit.clear();
		this.wakeWaiters();
	}

	seedStream(streamId: number, streamCreditBytes: number): void {
		for (const kind of CREDIT_KINDS) {
			this.outboundStreamCredit.set(
				creditKey(streamId, kind),
				streamCreditBytes,
			);
		}
	}

	deleteStream(streamId: number): void {
		for (const kind of CREDIT_KINDS) {
			this.outboundStreamCredit.delete(creditKey(streamId, kind));
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

	waitFor(
		streamId: number,
		kind: DataKind,
		bytes: number,
		canWait: () => boolean,
	): Promise<void> {
		if (!canWait()) {
			return Promise.reject(new Error("stream unavailable"));
		}
		if (this.has(streamId, kind, bytes)) {
			return Promise.resolve();
		}
		return new Promise<void>((resolve) => {
			this.waiters.add(resolve);
		}).then(() => this.waitFor(streamId, kind, bytes, canWait));
	}

	consume(streamId: number, kind: DataKind, bytes: number): void {
		this.outboundConnectionCredit -= bytes;
		const key = creditKey(streamId, kind);
		this.outboundStreamCredit.set(
			key,
			(this.outboundStreamCredit.get(key) ?? 0) - bytes,
		);
	}

	grant(streamId: number, kind: DataKind, bytes: number): void {
		if (bytes <= 0) {
			return;
		}
		this.pendingConnectionCredit += bytes;
		this.addStreamCredit(this.pendingStreamCredit, streamId, kind, bytes);
		this.scheduleFlush();
	}

	close(): void {
		if (this.flushTimer !== null) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
		this.pendingConnectionCredit = 0;
		this.pendingStreamCredit.clear();
	}

	wakeWaiters(): void {
		for (const waiter of this.waiters) {
			waiter();
		}
		this.waiters.clear();
	}

	private has(streamId: number, kind: DataKind, bytes: number): boolean {
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
		if (this.flushTimer !== null) {
			return;
		}
		this.flushTimer = setTimeout(() => {
			this.flushTimer = null;
			void this.flush().catch((error) => {
				this.debug(`credit flush failed: ${formatError(error)}`);
			});
		}, this.flushDelayMs);
		this.flushTimer.unref?.();
	}

	private async flush(): Promise<void> {
		const connectionBytes = this.pendingConnectionCredit;
		const streamCredits = [...this.pendingStreamCredit.entries()];
		this.pendingConnectionCredit = 0;
		this.pendingStreamCredit.clear();

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

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
