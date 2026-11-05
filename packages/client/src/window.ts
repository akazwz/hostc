import { STREAM_WINDOW_BYTES } from "@hostc/protocol";

/**
 * A stream moves at most one window per round trip, so 256 KiB caps an upload at about 1.3 MB/s over
 * a 200 ms path. A request body's window doubles, up to this size, while that limits it. The server
 * accepts any WINDOW grant, so this needs no protocol change.
 */
export const MAX_STREAM_WINDOW_BYTES = 4 * 1024 * 1024;
/** Window beyond STREAM_WINDOW_BYTES, shared by all streams of a connection. Bounds what the CLI buffers. */
export const WINDOW_BUDGET_BYTES = 16 * 1024 * 1024;
/** Windows that take longer than this to reach the local server are slow streams; they never grow. */
const WINDOW_GROWTH_MS = 1000;
/** Allowance for clock steps and jitter when comparing how long windows took. */
const WINDOW_JITTER_MS = 5;

/** Extra window available to the streams of one connection. */
export class WindowBudget {
	available = WINDOW_BUDGET_BYTES;
}

/**
 * The window granted for one request body, widened while it holds the upload back. The same rule
 * as the server's response windows: while the window is the limit, a window takes one round trip
 * whatever its size, so a doubled window takes no longer than the fastest one. Once the link is the
 * limit, a doubled window takes twice as long and growing further would only queue data in the CLI.
 */
export class GrowingWindow {
	size = STREAM_WINDOW_BYTES;
	private readonly budget: WindowBudget;
	/** Start of the current window (0 until the first full window) and its bytes the local server took. */
	private startedAt = 0;
	private bytes = 0;
	/** Shortest time a full window has taken: about one round trip. 0 until measured. */
	private fastestMs = 0;

	constructor(budget: WindowBudget) {
		this.budget = budget;
	}

	/**
	 * Counts bytes the local server accepted. `idle` says nothing else is queued for it, so it keeps
	 * up. Returns the bytes to grant on top of the ones accepted.
	 */
	delivered(bytes: number, idle: boolean, now = Date.now()): number {
		this.bytes += bytes;
		if (this.bytes < this.size) {
			return 0;
		}
		const elapsed = now - this.startedAt;
		const timed = this.startedAt > 0;
		this.startedAt = now;
		this.bytes = 0;
		if (!timed) {
			// The first window arrived before any grant, so how fast it came says nothing about the round trip.
			return 0;
		}
		this.fastestMs = this.fastestMs === 0 ? elapsed : Math.min(this.fastestMs, elapsed);
		const limitedByWindow = elapsed < WINDOW_GROWTH_MS && elapsed <= this.fastestMs * 1.5 + WINDOW_JITTER_MS && idle;
		if (!limitedByWindow) {
			return 0;
		}
		const extra = Math.min(this.size, MAX_STREAM_WINDOW_BYTES - this.size, this.budget.available);
		this.size += extra;
		this.budget.available -= extra;
		return extra;
	}

	/** Gives the extra window back to the connection once the stream has ended. */
	release(): void {
		this.budget.available += this.size - STREAM_WINDOW_BYTES;
		this.size = STREAM_WINDOW_BYTES;
	}
}
