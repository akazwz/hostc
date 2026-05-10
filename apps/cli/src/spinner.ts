import chalk from "chalk";

const FRAMES = ["-", "\\", "|", "/"];

export class TerminalSpinner {
	private frameIndex = 0;
	private interval: ReturnType<typeof setInterval> | null = null;
	private active = false;

	constructor(
		private text: string,
		private readonly stream: NodeJS.WriteStream = process.stderr,
	) {}

	start(): void {
		if (this.active || !this.stream.isTTY) {
			return;
		}
		this.active = true;
		this.render();
		this.interval = setInterval(() => this.render(), 80);
		this.interval.unref?.();
	}

	update(text: string): void {
		this.text = text;
		if (this.active) {
			this.render();
		}
	}

	stop(): void {
		if (!this.active) {
			return;
		}
		this.active = false;
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
		}
		this.stream.write("\r\x1b[2K");
	}

	private render(): void {
		const frame = FRAMES[this.frameIndex % FRAMES.length];
		this.frameIndex += 1;
		this.stream.write(`\r\x1b[2K${chalk.cyan(frame)} ${chalk.dim(this.text)}`);
	}
}
