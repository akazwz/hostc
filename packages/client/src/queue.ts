export class DataChannelQueue {
	private readonly chains = new Map<number, Promise<void>>();

	enqueue(channelId: number, task: () => Promise<void>): Promise<void> {
		const previous = this.chains.get(channelId) ?? Promise.resolve();
		const next = previous.catch(() => undefined).then(task);
		this.chains.set(
			channelId,
			next.catch(() => undefined),
		);
		return next;
	}

	clear(): void {
		this.chains.clear();
	}
}
