import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";

export type RpcError = { code: number; message: string; data?: unknown };

/** A JSON-RPC message from Codex that is not the answer to one of our requests. */
export type CodexMessage = { method: string; id?: number | string; params?: unknown };

type Events = {
	/** A notification, or a request when it has an `id`. */
	message: [CodexMessage];
	exit: [{ code: number | null; error?: Error }];
};

type Pending = { resolve: (result: unknown) => void; reject: (error: RpcError) => void };

/**
 * `codex app-server` as a child process, speaking JSON-RPC over stdio. Stdio opens no port and needs
 * no credential, and the process ends with ours.
 */
export class CodexProcess extends EventEmitter<Events> {
	private readonly child: ChildProcessWithoutNullStreams;
	private readonly pending = new Map<number, Pending>();
	private nextId = 1;
	private errorOutput = "";

	constructor(command: string, args: string[], cwd: string) {
		super();
		this.child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
		this.child.stderr.on("data", (chunk: Buffer) => {
			this.errorOutput = (this.errorOutput + chunk.toString()).slice(-2000);
		});
		this.child.stdin.on("error", () => {
			// The exit event reports a process that went away.
		});
		this.child.on("error", (error) => this.gone(null, error));
		this.child.on("exit", (code) => this.gone(code));
		createInterface({ input: this.child.stdout, crlfDelay: Number.POSITIVE_INFINITY }).on("line", (line) =>
			this.receive(line),
		);
	}

	request(method: string, params?: unknown): Promise<unknown> {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.write({ method, id, params });
		});
	}

	/** The last thing it said on stderr, which is usually why it stopped. */
	get lastError(): string {
		return this.errorOutput.trim().split("\n").at(-1) ?? "";
	}

	notify(method: string): void {
		this.write({ method });
	}

	/** Answers a request Codex made. */
	respond(id: number | string, answer: { result: unknown } | { error: RpcError }): void {
		this.write({ id, ...answer });
	}

	kill(): void {
		this.child.kill();
	}

	private write(message: object): void {
		if (this.child.stdin.writable) {
			this.child.stdin.write(`${JSON.stringify(message)}\n`);
		}
	}

	private receive(line: string): void {
		let message: { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: RpcError };
		try {
			message = JSON.parse(line);
		} catch {
			return;
		}
		if (message.method !== undefined) {
			this.emit("message", { method: message.method, id: message.id, params: message.params });
			return;
		}
		const pending = typeof message.id === "number" ? this.pending.get(message.id) : undefined;
		if (pending) {
			this.pending.delete(message.id as number);
			if (message.error) {
				pending.reject(message.error);
			} else {
				pending.resolve(message.result);
			}
		}
	}

	private gone(code: number | null, error?: Error): void {
		for (const { reject } of this.pending.values()) {
			reject({ code: -32000, message: "Codex exited" });
		}
		this.pending.clear();
		this.emit("exit", { code, ...(error ? { error } : {}) });
	}
}
