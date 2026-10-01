import http from "node:http";
import type { AddressInfo } from "node:net";

import { PROTOCOL_HEADER, PROTOCOL_VERSION } from "@hostc/protocol";
import { describe, expect, it } from "vitest";

import { createTunnel } from "../src/api.ts";

const tunnel = {
	id: "abcdefghijkm",
	url: "https://abcdefghijkm.tunnel.test",
	connectUrl: "wss://api.test/api/tunnels/abcdefghijkm/connect",
	token: "test-token",
};

async function withServer(handler: http.RequestListener, run: (url: string) => Promise<void>): Promise<void> {
	const server = http.createServer(handler);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
}

describe("createTunnel", () => {
	it("creates a tunnel using the current protocol", async () => {
		let request: { method?: string; path?: string; protocol?: string | string[] } = {};
		await withServer(
			(req, res) => {
				request = { method: req.method, path: req.url, protocol: req.headers[PROTOCOL_HEADER] };
				res.writeHead(201, { "content-type": "application/json" });
				res.end(JSON.stringify(tunnel));
			},
			async (url) => expect(await createTunnel(url)).toEqual(tunnel),
		);
		expect(request).toEqual({ method: "POST", path: "/api/tunnels", protocol: String(PROTOCOL_VERSION) });
	});

	it.each([
		[426, "upgrade_required"],
		[429, "rate_limited"],
		[401, "unauthorized"],
		[404, "tunnel_gone"],
	])("preserves the API error for status %s", async (status, code) => {
		await withServer(
			(_req, res) => {
				res.writeHead(status, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: "API error" }));
			},
			async (url) => expect(createTunnel(url)).rejects.toMatchObject({ code, message: "API error" }),
		);
	});

	it.each(["not JSON", JSON.stringify({ id: tunnel.id })])(
		"reports malformed tunnel responses as server errors",
		async (body) => {
			await withServer(
				(_req, res) => {
					res.writeHead(201, { "content-type": "application/json" });
					res.end(body);
				},
				async (url) =>
					expect(createTunnel(url)).rejects.toMatchObject({
						code: "server_error",
						message: "The server returned an invalid tunnel",
					}),
			);
		},
	);

	it.concurrent.each(["headers", "body"])(
		"times out when the API stalls while sending response %s",
		async (phase) => {
			await withServer(
				(_req, res) => {
					if (phase === "body") {
						res.writeHead(201, { "content-type": "application/json" });
						res.write("{");
					}
				},
				async (url) =>
					expect(createTunnel(url)).rejects.toMatchObject({
						code: "network_error",
						message: expect.stringContaining("timed out after 15 seconds"),
					}),
			);
		},
		20_000,
	);
});
