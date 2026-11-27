import { CLOSE_LIMIT_REACHED, encodeText, FrameType } from "@hostc/protocol";
import { env, evictDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { FREE_LIMITS, PRO_LIMITS, resolveTunnelLimits, type TunnelLimits } from "../src/limits.ts";
import { connect, createTunnel, type FakeClient, publicUrl, readAll } from "./helpers.ts";

async function openWithLimits(overrides: Partial<TunnelLimits>) {
	const tunnel = await createTunnel();
	await env.TUNNEL.getByName(tunnel.id).init({ tier: "free", limits: overrides });
	const client = await connect(tunnel);
	return { tunnel, client };
}

async function openPublicWs(tunnel: Awaited<ReturnType<typeof createTunnel>>, client: FakeClient, path = "/ws") {
	const upgrade = SELF.fetch(publicUrl(tunnel, path), { headers: { upgrade: "websocket" } });
	const open = await client.next((frame) => frame.type === FrameType.Open);
	client.head(open.stream, { status: 101, body: false });
	const response = await upgrade;
	expect(response.status).toBe(101);
	const ws = response.webSocket as WebSocket;
	ws.accept();
	return { stream: open.stream, ws };
}

describe("tunnel limits", () => {
	it("refuses excess concurrent public WebSockets with 429 without closing the tunnel", async () => {
		const { tunnel, client } = await openWithLimits({ maxPublicWebSockets: 2 });
		const first = await openPublicWs(tunnel, client, "/ws/1");
		const second = await openPublicWs(tunnel, client, "/ws/2");

		const third = await SELF.fetch(publicUrl(tunnel, "/ws/3"), { headers: { upgrade: "websocket" } });
		expect(third.status).toBe(429);
		expect(await third.text()).toContain("Too many WebSockets");
		expect(client.closed).toBeNull();

		// Closing one slot lets another public WebSocket connect right away.
		first.ws.close(1000, "bye");
		await client.next((frame) => frame.type === FrameType.End && frame.stream === first.stream);
		const replacement = await openPublicWs(tunnel, client, "/ws/4");

		second.ws.close(1000, "bye");
		replacement.ws.close(1000, "bye");
		expect(client.closed).toBeNull();
	});

	it("terminates with CLOSE_LIMIT_REACHED when public WebSocket connection quota is exceeded", async () => {
		const { tunnel, client } = await openWithLimits({ maxPublicWebSocketConnections: 2 });
		const first = await openPublicWs(tunnel, client, "/ws/1");
		first.ws.close(1000, "bye");
		await client.next((frame) => frame.type === FrameType.End && frame.stream === first.stream);

		const second = await openPublicWs(tunnel, client, "/ws/2");
		second.ws.close(1000, "bye");
		await client.next((frame) => frame.type === FrameType.End && frame.stream === second.stream);

		const third = await SELF.fetch(publicUrl(tunnel, "/ws/3"), { headers: { upgrade: "websocket" } });
		expect(third.status).toBe(429);
		await client.waitUntil(() => client.closed !== null);
		expect(client.closed?.code).toBe(CLOSE_LIMIT_REACHED);
		expect(client.closed?.reason).toContain("WebSocket connection limit");

		// Tunnel is expired and negatively cached at the edge.
		const after = await SELF.fetch(publicUrl(tunnel, "/after"));
		expect(after.status).toBe(404);
	});

	it("tracks public WebSocket messages across hibernation and client reconnects", async () => {
		const { tunnel, client } = await openWithLimits({ maxPublicWebSocketMessages: 3 });
		const { stream, ws } = await openPublicWs(tunnel, client, "/ws");

		// Message 1: public -> client
		ws.send("one");
		await client.next((frame) => frame.type === FrameType.Text && frame.stream === stream);
		// Message 2: client -> public
		const received = new Promise<string>((resolve) => {
			ws.addEventListener("message", (event) => resolve(String(event.data)), { once: true });
		});
		client.send(FrameType.Text, stream, encodeText("two"));
		expect(await received).toBe("two");

		// Hibernate the Durable Object and verify the counter survived.
		await evictDurableObject(env.TUNNEL.getByName(tunnel.id));

		// Drop and reconnect the client: storage checkpoint must preserve the count.
		client.ws.close(1001, "blip");
		await client.waitUntil(() => client.closed !== null);
		const reconnected = await connect(tunnel);
		const second = await openPublicWs(tunnel, reconnected, "/ws2");

		// Message 3: still within limit.
		second.ws.send("three");
		await reconnected.next((frame) => frame.type === FrameType.Text && frame.stream === second.stream);
		expect(reconnected.closed).toBeNull();

		// Message 4: exceeds maxPublicWebSocketMessages (3).
		second.ws.send("four");
		await reconnected.waitUntil(() => reconnected.closed !== null);
		expect(reconnected.closed?.code).toBe(CLOSE_LIMIT_REACHED);
		expect(reconnected.closed?.reason).toContain("WebSocket message limit");
	});

	it("terminates when public WebSocket transfer bytes exceed the limit", async () => {
		const { tunnel, client } = await openWithLimits({ maxPublicWebSocketBytes: 100 });
		const { stream, ws } = await openPublicWs(tunnel, client, "/ws");

		ws.send(new Uint8Array(60));
		await client.next((frame) => frame.type === FrameType.Data && frame.stream === stream);
		expect(client.closed).toBeNull();

		ws.send(new Uint8Array(60));
		await client.waitUntil(() => client.closed !== null);
		expect(client.closed?.code).toBe(CLOSE_LIMIT_REACHED);
		expect(client.closed?.reason).toContain("WebSocket transfer limit");
	});

	it("terminates public WebSocket floods via the 10-second burst rate limiter without affecting HTTP", async () => {
		const { tunnel, client } = await openWithLimits({ maxPublicWebSocketMessagesPer10s: 3 });

		// HTTP responses do not count toward the public WebSocket burst limit.
		for (let i = 0; i < 4; i += 1) {
			const pending = SELF.fetch(publicUrl(tunnel, `/http/${i}`));
			const open = await client.next((frame) => frame.type === FrameType.Open);
			client.head(open.stream, { status: 200, body: true });
			client.send(FrameType.Data, open.stream, encodeText("chunk"));
			client.send(FrameType.End, open.stream);
			const res = await pending;
			expect(res.status).toBe(200);
			await readAll(res);
		}
		expect(client.closed).toBeNull();

		// Bursting 4 public WS messages immediately breaches maxPublicWebSocketMessagesPer10s = 3.
		const { ws } = await openPublicWs(tunnel, client, "/proxy");
		for (let i = 0; i < 4; i += 1) {
			ws.send(`m${i}`);
		}
		await client.waitUntil(() => client.closed !== null);
		expect(client.closed?.code).toBe(CLOSE_LIMIT_REACHED);
		expect(client.closed?.reason).toContain("rate limit");
	});

	it("terminates when total HTTP requests exceed maxRequests without jumping across hibernations", async () => {
		const { tunnel, client } = await openWithLimits({ maxRequests: 3 });

		for (let i = 0; i < 3; i += 1) {
			// Evicting before each request forces stream ids to advance by STREAM_ID_BLOCK (1024),
			// which must NOT count as 1024 requests.
			if (i > 0) {
				await evictDurableObject(env.TUNNEL.getByName(tunnel.id));
			}
			const pending = SELF.fetch(publicUrl(tunnel, `/r/${i}`));
			const open = await client.next((frame) => frame.type === FrameType.Open);
			client.head(open.stream, { status: 204, body: false });
			expect((await pending).status).toBe(204);
		}
		expect(client.closed).toBeNull();

		const fourth = await SELF.fetch(publicUrl(tunnel, "/r/4"));
		expect(fourth.status).toBe(429);
		await client.waitUntil(() => client.closed !== null);
		expect(client.closed?.code).toBe(CLOSE_LIMIT_REACHED);
		expect(client.closed?.reason).toContain("request limit");
	});

	it("terminates when total HTTP transfer bytes exceed maxBytes", async () => {
		const { tunnel, client } = await openWithLimits({ maxBytes: 128 });
		const pending = SELF.fetch(publicUrl(tunnel, "/download"));
		const open = await client.next((frame) => frame.type === FrameType.Open);
		client.head(open.stream, { status: 200, body: true });
		client.send(FrameType.Data, open.stream, new Uint8Array(200));

		const response = await pending;
		await expect(readAll(response)).rejects.toThrow();
		await client.waitUntil(() => client.closed !== null);
		expect(client.closed?.code).toBe(CLOSE_LIMIT_REACHED);
		expect(client.closed?.reason).toContain("transfer limit");
	});

	it("terminates when total DO frames exceed maxTotalFrames", async () => {
		const { tunnel, client } = await openWithLimits({ maxTotalFrames: 2 });
		const pending = SELF.fetch(publicUrl(tunnel, "/frames"));
		const open = await client.next((frame) => frame.type === FrameType.Open);
		// Frame 1 (HEAD), Frame 2 (DATA), Frame 3 (END -> breaches maxTotalFrames = 2).
		client.head(open.stream, { status: 200, body: true });
		client.send(FrameType.Data, open.stream, encodeText("hi"));
		client.send(FrameType.End, open.stream);

		const response = await pending;
		await readAll(response).catch(() => {});
		await client.waitUntil(() => client.closed !== null);
		expect(client.closed?.code).toBe(CLOSE_LIMIT_REACHED);
		expect(client.closed?.reason).toContain("frame limit");
	});

	it("terminates via alarm once maxDurationMs has elapsed", async () => {
		const { tunnel, client } = await openWithLimits({ maxDurationMs: 40 });
		await client.waitUntil(() => client.closed !== null, 2000);
		expect(client.closed?.code).toBe(CLOSE_LIMIT_REACHED);
		expect(client.closed?.reason).toContain("duration limit");
		expect((await SELF.fetch(publicUrl(tunnel, "/expired"))).status).toBe(404);
	});

	it("exports sane default FREE_LIMITS and supports TUNNEL_LIMITS JSON overrides", () => {
		expect(FREE_LIMITS.maxDurationMs).toBe(12 * 60 * 60_000);
		expect(FREE_LIMITS.maxStreams).toBe(128);
		expect(FREE_LIMITS.maxWaiting).toBe(256);
		expect(FREE_LIMITS.maxBytes).toBe(10 * 1024 * 1024 * 1024);
		expect(FREE_LIMITS.maxRequests).toBe(100_000);
		expect(FREE_LIMITS.maxTotalFrames).toBe(500_000);
		expect(FREE_LIMITS.maxPublicWebSockets).toBe(16);
		expect(FREE_LIMITS.maxPublicWebSocketConnections).toBe(300);
		expect(FREE_LIMITS.maxPublicWebSocketMessages).toBe(50_000);
		expect(FREE_LIMITS.maxPublicWebSocketBytes).toBe(250 * 1024 * 1024);
		expect(FREE_LIMITS.maxPublicWebSocketMessagesPer10s).toBe(2_000);

		expect(PRO_LIMITS.maxDurationMs).toBeNull();
		expect(resolveTunnelLimits("free", "")).toEqual(FREE_LIMITS);
		expect(resolveTunnelLimits("free", "not-json")).toEqual(FREE_LIMITS);
		expect(
			resolveTunnelLimits(
				"free",
				JSON.stringify({ maxDurationMs: null, maxBytes: null, maxPublicWebSockets: 24, maxStreams: -5 }),
			),
		).toEqual({
			...FREE_LIMITS,
			maxDurationMs: null,
			maxBytes: null,
			maxPublicWebSockets: 24,
		});
	});
});
