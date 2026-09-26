import { describe, expect, it } from "vitest";

import { parseCommand, parseTarget } from "../src/args.ts";

const DEFAULT = "https://hostc.dev";

describe("parseTarget", () => {
	it("accepts ports, host:port and URLs", () => {
		expect(parseTarget("3000")?.origin).toBe("http://localhost:3000");
		expect(parseTarget("127.0.0.1:8080")?.origin).toBe("http://127.0.0.1:8080");
		expect(parseTarget("https://localhost:5173")?.origin).toBe("https://localhost:5173");
		expect(parseTarget("http://[::1]:4000/")?.origin).toBe("http://[::1]:4000");
	});

	it("rejects anything else", () => {
		expect(parseTarget("0")).toBeNull();
		expect(parseTarget("70000")).toBeNull();
		expect(parseTarget("ftp://localhost:21")).toBeNull();
		expect(parseTarget("http://localhost:3000/app")).toBeNull();
	});
});

describe("parseCommand", () => {
	it("resolves the server from flag, env, then default", () => {
		expect(parseCommand(["3000"], {}, DEFAULT)).toMatchObject({ kind: "run", server: DEFAULT, qr: false });
		expect(parseCommand(["3000"], { HOSTC_SERVER: "http://localhost:8787" }, DEFAULT)).toMatchObject({
			server: "http://localhost:8787",
		});
		expect(
			parseCommand(["3000", "--server", "https://a.test", "--qr"], { HOSTC_SERVER: "http://b.test" }, DEFAULT),
		).toMatchObject({ server: "https://a.test", qr: true });
	});

	it("handles help, version and errors", () => {
		expect(parseCommand([], {}, DEFAULT).kind).toBe("help");
		expect(parseCommand(["-h"], {}, DEFAULT).kind).toBe("help");
		expect(parseCommand(["--version"], {}, DEFAULT).kind).toBe("version");
		expect(parseCommand(["abc"], {}, DEFAULT).kind).toBe("error");
		expect(parseCommand(["3000", "4000"], {}, DEFAULT).kind).toBe("error");
		expect(parseCommand(["3000", "--nope"], {}, DEFAULT).kind).toBe("error");
		expect(parseCommand(["3000", "--server", "nope"], {}, DEFAULT).kind).toBe("error");
	});
});
