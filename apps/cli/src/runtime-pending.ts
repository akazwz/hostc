import type { ControlMessage, DataKind } from "@hostc/protocol";

export type PendingFrame = {
	kind: DataKind;
	seq: number;
	flags: number;
	payload: Uint8Array;
};

export class PendingDataBuffer {
	private readonly frames = new Map<number, PendingFrame[]>();
	private readonly ends = new Map<number, ControlMessage[]>();
	private readonly timers = new Map<number, NodeJS.Timeout>();
	private totalFrameBytes = 0;

	constructor(
		private readonly maxBytes: number,
		private readonly timeoutMs: number,
		private readonly isStreamKnown: (streamId: number) => boolean,
		private readonly onTimeout: (streamId: number) => void,
	) {}

	get byteLength(): number {
		return this.totalFrameBytes;
	}

	addFrame(streamId: number, frame: PendingFrame): void {
		const frames = this.frames.get(streamId) ?? [];
		const streamBytes = frames.reduce(
			(total, item) => total + item.payload.byteLength,
			0,
		);
		if (
			streamBytes + frame.payload.byteLength > this.maxBytes ||
			this.totalFrameBytes + frame.payload.byteLength > this.maxBytes
		) {
			throw new Error("pending data limit exceeded");
		}
		frames.push(frame);
		this.frames.set(streamId, frames);
		this.totalFrameBytes += frame.payload.byteLength;
		this.refreshTimeout(streamId);
	}

	addEnd(streamId: number, message: ControlMessage): void {
		const messages = this.ends.get(streamId) ?? [];
		messages.push(message);
		this.ends.set(streamId, messages);
		this.refreshTimeout(streamId);
	}

	takeFrames(streamId: number): PendingFrame[] {
		const frames = this.frames.get(streamId) ?? [];
		this.frames.delete(streamId);
		this.totalFrameBytes = Math.max(
			0,
			this.totalFrameBytes -
				frames.reduce((total, frame) => total + frame.payload.byteLength, 0),
		);
		return frames;
	}

	takeEnds(streamId: number): ControlMessage[] {
		const messages = this.ends.get(streamId) ?? [];
		this.ends.delete(streamId);
		return messages;
	}

	clearTimer(streamId: number): void {
		const timer = this.timers.get(streamId);
		if (!timer) {
			return;
		}
		clearTimeout(timer);
		this.timers.delete(streamId);
	}

	clearAll(): void {
		this.frames.clear();
		this.ends.clear();
		this.totalFrameBytes = 0;
		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}
		this.timers.clear();
	}

	private refreshTimeout(streamId: number): void {
		this.clearTimer(streamId);
		const timer = setTimeout(() => {
			this.timers.delete(streamId);
			if (this.isStreamKnown(streamId)) {
				return;
			}
			if (!this.frames.has(streamId) && !this.ends.has(streamId)) {
				return;
			}
			this.takeFrames(streamId);
			this.takeEnds(streamId);
			this.onTimeout(streamId);
		}, this.timeoutMs);
		timer.unref?.();
		this.timers.set(streamId, timer);
	}
}
