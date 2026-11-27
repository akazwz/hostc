import { CLOSE_SHUTDOWN, decodeText, FrameType, TUNNEL_ID_ALPHABET } from "@hostc/protocol";
import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { locationHintFromCf } from "../src/location.ts";
import { createTunnelId, verifyTunnelId } from "../src/token.ts";
import { TUNNEL_MISSING_HEADER } from "../src/tunnel.ts";
import { connect, createTunnel, PROTOCOL, publicUrl } from "./helpers.ts";

describe("locationHintFromCf", () => {
	it("places mainland China and northeast Asia in apac-ne", () => {
		expect(locationHintFromCf({ country: "CN", continent: "AS", longitude: "116.4" })).toBe("apac-ne");
		expect(locationHintFromCf({ country: "HK", continent: "AS" })).toBe("apac-ne");
		expect(locationHintFromCf({ country: "TW", continent: "AS" })).toBe("apac-ne");
		expect(locationHintFromCf({ country: "JP", continent: "AS" })).toBe("apac-ne");
		expect(locationHintFromCf({ country: "KR", continent: "AS" })).toBe("apac-ne");
	});

	it("places southeast Asia in apac-se, Middle East in me, and rest of Asia in apac", () => {
		expect(locationHintFromCf({ country: "SG", continent: "AS" })).toBe("apac-se");
		expect(locationHintFromCf({ country: "VN", continent: "AS" })).toBe("apac-se");
		expect(locationHintFromCf({ country: "AE", continent: "AS" })).toBe("me");
		expect(locationHintFromCf({ country: "TR", continent: "EU" })).toBe("me");
		expect(locationHintFromCf({ country: "IN", continent: "AS" })).toBe("apac");
	});

	it("splits Europe and North America by longitude and maps remaining continents", () => {
		expect(locationHintFromCf({ country: "DE", continent: "EU", longitude: "8.68" })).toBe("weur");
		expect(locationHintFromCf({ country: "PL", continent: "EU", longitude: "21.01" })).toBe("eeur");
		expect(locationHintFromCf({ country: "FR", continent: "EU" })).toBe("weur");
		expect(locationHintFromCf({ country: "US", continent: "NA", longitude: "-122.4" })).toBe("wnam");
		expect(locationHintFromCf({ country: "US", continent: "NA", longitude: "-74.0" })).toBe("enam");
		expect(locationHintFromCf({ country: "US", continent: "NA" })).toBeUndefined();
		expect(locationHintFromCf({ country: "AU", continent: "OC" })).toBe("oc");
		expect(locationHintFromCf({ country: "BR", continent: "SA" })).toBe("sam");
		expect(locationHintFromCf({ country: "ZA", continent: "AF" })).toBe("afr");
	});

	it("falls back to default placement when metadata is absent or unknown", () => {
		expect(locationHintFromCf(undefined)).toBeUndefined();
		expect(locationHintFromCf({})).toBeUndefined();
		expect(locationHintFromCf({ country: "T1" })).toBeUndefined();
		expect(locationHintFromCf({ country: "XX", longitude: "" })).toBeUndefined();
	});
});

function flipAlphabetChar(char: string): string {
	return TUNNEL_ID_ALPHABET[(TUNNEL_ID_ALPHABET.indexOf(char) + 1) % TUNNEL_ID_ALPHABET.length] as string;
}

describe("authenticated tunnel ids and expired 404 cache", () => {
	it("creates verifiable 16-character ids and rejects tampered ids or wrong secrets", async () => {
		const id = await createTunnelId(env.TOKEN_SECRET);
		expect(id).toMatch(/^[a-z2-9]{16}$/);
		expect(await verifyTunnelId(env.TOKEN_SECRET, id)).toBe(true);
		expect(await verifyTunnelId("another-secret-that-is-also-at-least-32-bytes", id)).toBe(false);

		// Flipping a character in the random prefix or in the MAC tag fails verification.
		expect(await verifyTunnelId(env.TOKEN_SECRET, flipAlphabetChar(id[0] as string) + id.slice(1))).toBe(false);
		expect(await verifyTunnelId(env.TOKEN_SECRET, id.slice(0, -1) + flipAlphabetChar(id.at(-1) as string))).toBe(false);
	});

	it("does not leak the internal missing header and never caches a local server's 404", async () => {
		const tunnel = await createTunnel();
		const client = await connect(tunnel);

		// A local server returning 404 — even attempting to spoof the internal missing header — must not trigger negative caching.
		const pendingNotFound = SELF.fetch(publicUrl(tunnel, "/missing"));
		const firstOpen = await client.next((frame) => frame.type === FrameType.Open);
		client.head(firstOpen.stream, {
			status: 404,
			body: false,
			headers: [
				["content-type", "text/plain"],
				[TUNNEL_MISSING_HEADER, "1"],
			],
		});
		const local404 = await pendingNotFound;
		expect(local404.status).toBe(404);
		expect(local404.headers.get(TUNNEL_MISSING_HEADER)).toBeNull();

		// The tunnel still reaches the local server immediately afterwards.
		const pendingOk = SELF.fetch(publicUrl(tunnel, "/ok"));
		const secondOpen = await client.next((frame) => frame.type === FrameType.Open);
		client.head(secondOpen.stream, { status: 200, body: false });
		expect((await pendingOk).status).toBe(200);

		client.ws.close(CLOSE_SHUTDOWN);
	});

	it("negatively caches expired tunnels at the Worker edge without waking the Durable Object again", async () => {
		const tunnel = await createTunnel();
		const client = await connect(tunnel);
		client.ws.close(CLOSE_SHUTDOWN, "done");
		await client.waitUntil(() => client.closed !== null);

		// First miss hits the DO, populates the expired cache, and strips the internal marker header.
		await expect
			.poll(async () => {
				const res = await SELF.fetch(publicUrl(tunnel, "/first"));
				expect(res.headers.get(TUNNEL_MISSING_HEADER)).toBeNull();
				return res.status;
			})
			.toBe(404);

		// Re-initializing the DO behind the cache proves subsequent requests are served from Worker cache, not the DO.
		await env.TUNNEL.getByName(tunnel.id).init();

		const cachedHtml = await SELF.fetch(publicUrl(tunnel, "/second"), { headers: { accept: "text/html" } });
		expect(cachedHtml.status).toBe(404);
		expect(await cachedHtml.text()).toContain("Tunnel not found");

		const cachedJson = await SELF.fetch(publicUrl(tunnel, "/third"));
		expect(cachedJson.status).toBe(404);
		expect(await cachedJson.json()).toMatchObject({ error: "Tunnel not found" });

		const cachedConnect = await SELF.fetch(tunnel.connectUrl.replace(/^ws/, "http"), {
			headers: { upgrade: "websocket", authorization: `Bearer ${tunnel.token}`, ...PROTOCOL },
		});
		expect(cachedConnect.status).toBe(404);
	});
});

describe("WebSocket upgrade cancellation", () => {
	it("resets the pending local upgrade and frees the slot when the visitor aborts before 101", async () => {
		const tunnel = await createTunnel();
		const client = await connect(tunnel);
		const visitor = new AbortController();

		const pending = SELF.fetch(publicUrl(tunnel, "/ws"), {
			headers: { upgrade: "websocket" },
			signal: visitor.signal,
		});
		const open = await client.next((frame) => frame.type === FrameType.Open);
		visitor.abort();
		await expect(pending).rejects.toThrow();

		const reset = await client.next((frame) => frame.type === FrameType.Reset && frame.stream === open.stream);
		expect(decodeText(reset.payload)).toBe("public client went away");

		const pendingSize = await runInDurableObject(
			env.TUNNEL.getByName(tunnel.id),
			(instance) => (Reflect.get(instance, "pendingWebSockets") as Map<number, unknown>).size,
		);
		expect(pendingSize).toBe(0);
	});
});
