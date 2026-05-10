import type { DataKind } from "@hostc/protocol";
import type { HostcUpstreamWebSocket } from "./upstream.js";

const MAX_REMEMBERED_CLOSED_STREAMS = 4096;

export type PendingInboundFrame = {
	kind: "request.body" | "ws.client";
	seq: bigint;
	flags: number;
	payload: Uint8Array;
};

export type StreamState = {
	id: bigint;
	kind: "http" | "websocket";
	channelId: number;
	target: string;
	requestWriter: WritableStreamDefaultWriter<Uint8Array> | null;
	requestEndSeq: number | null;
	localAbortController: AbortController;
	upstreamWebSocket: HostcUpstreamWebSocket | null;
	pendingInboundFrames: PendingInboundFrame[];
	pendingInboundBytes: number;
	receiveNextSeq: Map<DataKind, bigint>;
	sendNextSeq: Map<DataKind, bigint>;
	sendChains: Map<DataKind, Promise<void>>;
	aborted: boolean;
};

export class StreamRegistry {
	private readonly streams = new Map<bigint, StreamState>();
	private readonly closedStreamIds = new Set<string>();

	resetForNewTunnel(): void {
		this.streams.clear();
		this.closedStreamIds.clear();
	}

	set(stream: StreamState): void {
		this.streams.set(stream.id, stream);
		this.closedStreamIds.delete(stream.id.toString());
	}

	get(streamId: bigint): StreamState | undefined {
		return this.streams.get(streamId);
	}

	has(streamId: bigint): boolean {
		return this.streams.has(streamId);
	}

	isClosed(streamId: bigint): boolean {
		return this.closedStreamIds.has(streamId.toString());
	}

	isCurrent(stream: StreamState): boolean {
		return this.streams.get(stream.id) === stream;
	}

	delete(streamId: bigint): StreamState | undefined {
		const stream = this.streams.get(streamId);
		if (!stream) {
			return undefined;
		}
		this.streams.delete(streamId);
		this.rememberClosedStream(streamId);
		return stream;
	}

	values(): StreamState[] {
		return [...this.streams.values()];
	}

	private rememberClosedStream(streamId: bigint): void {
		const key = streamId.toString();
		this.closedStreamIds.delete(key);
		this.closedStreamIds.add(key);
		if (this.closedStreamIds.size <= MAX_REMEMBERED_CLOSED_STREAMS) {
			return;
		}
		const oldest = this.closedStreamIds.values().next().value;
		if (oldest !== undefined) {
			this.closedStreamIds.delete(oldest);
		}
	}
}
