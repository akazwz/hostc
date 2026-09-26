import { parseArgs } from "node:util";

export type Command =
	| { kind: "run"; target: URL; server: string; qr: boolean }
	| { kind: "help" }
	| { kind: "version" }
	| { kind: "error"; message: string };

export const USAGE = `Usage: hostc <target> [options]

Expose a local HTTP/WebSocket server through a public URL.

Target:
  3000                     http://localhost:3000
  127.0.0.1:8080           http://127.0.0.1:8080
  https://localhost:5173   any http(s) origin

Options:
  --server <url>   tunnel server (env HOSTC_SERVER)
  --qr             print a QR code of the public URL
  -h, --help       show this help
  -v, --version    show the version`;

export function parseCommand(argv: string[], env: Record<string, string | undefined>, defaultServer: string): Command {
	let parsed: ReturnType<typeof parse>;
	try {
		parsed = parse(argv);
	} catch (error) {
		return { kind: "error", message: (error as Error).message };
	}
	const { values, positionals } = parsed;
	if (values.help) {
		return { kind: "help" };
	}
	if (values.version) {
		return { kind: "version" };
	}
	const [input, ...rest] = positionals;
	if (!input) {
		return { kind: "help" };
	}
	if (rest.length > 0) {
		return { kind: "error", message: `Unexpected argument: ${rest[0]}` };
	}
	const target = parseTarget(input);
	if (!target) {
		return { kind: "error", message: `Invalid target "${input}". Use a port like 3000, host:port, or an http(s) URL.` };
	}
	const server = values.server ?? env.HOSTC_SERVER ?? defaultServer;
	if (!URL.canParse(server) || !/^https?:$/.test(new URL(server).protocol)) {
		return { kind: "error", message: `Invalid server URL "${server}".` };
	}
	return { kind: "run", target, server, qr: values.qr ?? false };
}

function parse(argv: string[]) {
	return parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			server: { type: "string" },
			qr: { type: "boolean" },
			help: { type: "boolean", short: "h" },
			version: { type: "boolean", short: "v" },
		},
	});
}

/** Accepts `3000`, `host:port`, or an http(s) URL; returns the origin to forward to. */
export function parseTarget(input: string): URL | null {
	if (/^\d+$/.test(input)) {
		return isPort(Number(input)) ? new URL(`http://localhost:${input}`) : null;
	}
	const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input);
	// Without a scheme, require host:port so a typo is not mistaken for a hostname on port 80.
	if (!hasScheme && !/:\d+$/.test(input)) {
		return null;
	}
	const candidate = hasScheme ? input : `http://${input}`;
	if (!URL.canParse(candidate)) {
		return null;
	}
	const url = new URL(candidate);
	if (!/^https?:$/.test(url.protocol) || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
		return null;
	}
	return new URL(url.origin);
}

function isPort(value: number): boolean {
	return Number.isInteger(value) && value > 0 && value < 65_536;
}
