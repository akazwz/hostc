import {
	addCredit,
	type ChannelCreditMetadata,
	consumeCredit,
	type DataKind,
	type StreamCreditMetadata,
	type TunnelLimits,
} from "@hostc/protocol";

export class ClientCreditController {
	private readonly outboundStreamCredit = new Map<string, number>();
	private readonly inboundStreamCredit = new Map<string, number>();
	private readonly outboundChannelCredit = new Map<number, number>();
	private readonly inboundChannelCredit = new Map<number, number>();
	private readonly waiters = new Set<() => void>();

	constructor(private readonly limits: () => TunnelLimits) {}

	reset(dataChannels: number): void {
		this.outboundStreamCredit.clear();
		this.inboundStreamCredit.clear();
		this.outboundChannelCredit.clear();
		this.inboundChannelCredit.clear();
		for (let channelId = 0; channelId < dataChannels; channelId += 1) {
			this.outboundChannelCredit.set(
				channelId,
				this.limits().channelCreditBytes,
			);
			this.inboundChannelCredit.set(
				channelId,
				this.limits().channelCreditBytes,
			);
		}
		this.wakeWaiters();
	}

	seedStream(streamId: bigint): void {
		for (const kind of dataKinds()) {
			this.outboundStreamCredit.set(
				creditKey(streamId, kind),
				this.limits().streamCreditBytes,
			);
			this.inboundStreamCredit.set(
				creditKey(streamId, kind),
				this.limits().streamCreditBytes,
			);
		}
	}

	deleteStream(streamId: bigint): void {
		for (const kind of dataKinds()) {
			this.outboundStreamCredit.delete(creditKey(streamId, kind));
			this.inboundStreamCredit.delete(creditKey(streamId, kind));
		}
		this.wakeWaiters();
	}

	applyStreamCredit(streamId: bigint, metadata: StreamCreditMetadata): void {
		const key = creditKey(streamId, metadata.kind);
		this.outboundStreamCredit.set(
			key,
			addCredit(this.outboundStreamCredit.get(key) ?? 0, metadata.bytes),
		);
		this.wakeWaiters();
	}

	applyChannelCredit(channelId: number, metadata: ChannelCreditMetadata): void {
		this.outboundChannelCredit.set(
			channelId,
			addCredit(this.outboundChannelCredit.get(channelId) ?? 0, metadata.bytes),
		);
		this.wakeWaiters();
	}

	async waitForOutbound(
		streamId: bigint,
		channelId: number,
		kind: DataKind,
		bytes: number,
		canWait: () => boolean,
	): Promise<void> {
		if (!canWait()) {
			throw new Error("stream unavailable");
		}
		while (!this.hasOutbound(streamId, channelId, kind, bytes)) {
			await new Promise<void>((resolve) => this.waiters.add(resolve));
			if (!canWait()) {
				throw new Error("stream unavailable");
			}
		}
	}

	decrementOutbound(
		streamId: bigint,
		channelId: number,
		kind: DataKind,
		bytes: number,
	): void {
		const key = creditKey(streamId, kind);
		this.outboundStreamCredit.set(
			key,
			consumeCredit(this.outboundStreamCredit.get(key) ?? 0, bytes),
		);
		this.outboundChannelCredit.set(
			channelId,
			consumeCredit(this.outboundChannelCredit.get(channelId) ?? 0, bytes),
		);
	}

	consumeInbound(
		streamId: bigint,
		channelId: number,
		kind: DataKind,
		bytes: number,
	): boolean {
		const key = creditKey(streamId, kind);
		const streamCredit = this.inboundStreamCredit.get(key) ?? 0;
		const channelCredit = this.inboundChannelCredit.get(channelId) ?? 0;
		if (streamCredit < bytes || channelCredit < bytes) {
			return false;
		}
		this.inboundStreamCredit.set(key, streamCredit - bytes);
		this.inboundChannelCredit.set(channelId, channelCredit - bytes);
		return true;
	}

	grantInbound(
		streamId: bigint,
		channelId: number,
		kind: DataKind,
		bytes: number,
	): void {
		if (bytes <= 0) {
			return;
		}
		const key = creditKey(streamId, kind);
		this.inboundStreamCredit.set(
			key,
			addCredit(this.inboundStreamCredit.get(key) ?? 0, bytes),
		);
		this.inboundChannelCredit.set(
			channelId,
			addCredit(this.inboundChannelCredit.get(channelId) ?? 0, bytes),
		);
	}

	wakeWaiters(): void {
		for (const waiter of this.waiters) {
			waiter();
		}
		this.waiters.clear();
	}

	private hasOutbound(
		streamId: bigint,
		channelId: number,
		kind: DataKind,
		bytes: number,
	): boolean {
		return (
			(this.outboundStreamCredit.get(creditKey(streamId, kind)) ?? 0) >=
				bytes && (this.outboundChannelCredit.get(channelId) ?? 0) >= bytes
		);
	}
}

function dataKinds(): DataKind[] {
	return ["request.body", "response.body", "ws.client", "ws.server"];
}

function creditKey(streamId: bigint, kind: DataKind): string {
	return `${streamId.toString()}:${kind}`;
}
