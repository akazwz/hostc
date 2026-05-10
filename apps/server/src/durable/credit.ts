import {
	addCredit,
	type ChannelCreditMetadata,
	consumeCredit,
	type DataKind,
	FRAME_TYPE_CHANNEL_CREDIT,
	FRAME_TYPE_STREAM_CREDIT,
	MAX_CREDIT_BYTES,
	type StreamCreditMetadata,
	type TunnelLimits,
} from "@hostc/protocol";

type CreditKey = `${string}:${DataKind}`;

type SendCredit = (
	channelId: number,
	frameType: typeof FRAME_TYPE_STREAM_CREDIT | typeof FRAME_TYPE_CHANNEL_CREDIT,
	streamId: bigint,
	metadata: StreamCreditMetadata | ChannelCreditMetadata,
) => Promise<void>;

const CREDIT_KINDS = [
	"request.body",
	"response.body",
	"ws.client",
	"ws.server",
] satisfies DataKind[];

export class TunnelCreditController {
	private readonly outboundStreamCredit = new Map<CreditKey, number>();
	private readonly inboundStreamCredit = new Map<CreditKey, number>();
	private readonly outboundChannelCredit = new Map<number, number>();
	private readonly inboundChannelCredit = new Map<number, number>();
	private readonly waiters = new Set<() => void>();

	constructor(
		private readonly limits: () => TunnelLimits,
		private readonly sendCredit: SendCredit,
		private readonly waitUntil: (promise: Promise<unknown>) => void,
		private readonly onCreditError: (error: unknown) => void,
	) {}

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
		for (const kind of CREDIT_KINDS) {
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
		for (const kind of CREDIT_KINDS) {
			this.outboundStreamCredit.delete(creditKey(streamId, kind));
			this.inboundStreamCredit.delete(creditKey(streamId, kind));
		}
		this.wakeWaiters();
	}

	applyStreamCredit(streamId: bigint, metadata: StreamCreditMetadata): void {
		const key = creditKey(streamId, metadata.kind);
		this.outboundStreamCredit.set(
			key,
			Math.min(
				MAX_CREDIT_BYTES,
				(this.outboundStreamCredit.get(key) ?? 0) + metadata.bytes,
			),
		);
		this.wakeWaiters();
	}

	applyChannelCredit(channelId: number, metadata: ChannelCreditMetadata): void {
		this.outboundChannelCredit.set(
			channelId,
			Math.min(
				MAX_CREDIT_BYTES,
				(this.outboundChannelCredit.get(channelId) ?? 0) + metadata.bytes,
			),
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
			throw new Error("Stream unavailable");
		}
		while (!this.hasOutbound(streamId, channelId, kind, bytes)) {
			await new Promise<void>((resolve) => this.waiters.add(resolve));
			if (!canWait()) {
				throw new Error("Stream unavailable");
			}
		}
	}

	decrementOutbound(
		streamId: bigint,
		channelId: number,
		kind: DataKind,
		bytes: number,
	): void {
		const streamKey = creditKey(streamId, kind);
		this.outboundStreamCredit.set(
			streamKey,
			consumeCredit(this.outboundStreamCredit.get(streamKey) ?? 0, bytes),
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
		const streamKey = creditKey(streamId, kind);
		const streamCredit = this.inboundStreamCredit.get(streamKey) ?? 0;
		const channelCredit = this.inboundChannelCredit.get(channelId) ?? 0;
		if (streamCredit < bytes || channelCredit < bytes) {
			return false;
		}
		this.inboundStreamCredit.set(streamKey, streamCredit - bytes);
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
		const streamKey = creditKey(streamId, kind);
		this.inboundStreamCredit.set(
			streamKey,
			addCredit(this.inboundStreamCredit.get(streamKey) ?? 0, bytes),
		);
		this.inboundChannelCredit.set(
			channelId,
			addCredit(this.inboundChannelCredit.get(channelId) ?? 0, bytes),
		);
		this.waitUntil(
			this.sendCredit(channelId, FRAME_TYPE_STREAM_CREDIT, streamId, {
				kind,
				bytes,
			})
				.then(() =>
					this.sendCredit(channelId, FRAME_TYPE_CHANNEL_CREDIT, 0n, { bytes }),
				)
				.catch((error) => this.onCreditError(error)),
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

function creditKey(streamId: bigint, kind: DataKind): CreditKey {
	return `${streamId.toString()}:${kind}`;
}
