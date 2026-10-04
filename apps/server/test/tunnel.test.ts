import {
	CLOSE_PROTOCOL_ERROR,
	CLOSE_REPLACED,
	CLOSE_SHUTDOWN,
	decodeClose,
	decodeOpen,
	decodeText,
	decodeWindow,
	encodeClose,
	encodeText,
	encodeWindow,
	FrameType,
	MAX_CHUNK_BYTES,
	PING,
	PONG,
	STREAM_WINDOW_BYTES,
} from "@hostc/protocol";
import { env, evictDurableObject, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { API, connect, createTunnel, PROTOCOL, publicUrl, readAll } from "./helpers.ts";

function createFromSameClient(): Promise<Response> {
	return SELF.fetch(`${API}/api/tunnels`, {
		method: "POST",
		headers: { ...PROTOCOL, "cf-connecting-ip": "203.0.113.7" },
	});
}

describe("tunnel API", () => {
	it("requires the current protocol version", async () => {
		const response = await SELF.fetch(`${API}/api/tunnels`, { method: "POST" });
		expect(response.status).toBe(426);
	});

	it("tells clients on an older protocol to upgrade, whatever path they use", async () => {
		const legacy = await SELF.fetch(`${API}/api/tunnels/ephemeral`, { method: "POST" });
		expect(legacy.status).toBe(426);
		expect(await legacy.json()).toMatchObject({ error: expect.stringContaining("npx hostc@latest") });
		const oldHeader = await SELF.fetch(`${API}/api/tunnels`, { method: "POST", headers: { "hostc-protocol": "4" } });
		expect(oldHeader.status).toBe(426);
	});

	it("creates a tunnel with a public URL under the tunnel domain", async () => {
		const tunnel = await createTunnel();
		expect(tunnel.id).toMatch(/^[a-z2-9]{12}$/);
		expect(tunnel.url).toBe(`https://${tunnel.id}.tunnel.test`);
		expect(tunnel.connectUrl).toBe(`wss://api.test/api/tunnels/${tunnel.id}/connect`);
	});

	it("rejects connects with a bad token", async () => {
		const tunnel = await createTunnel();
		const response = await SELF.fetch(tunnel.connectUrl.replace(/^ws/, "http"), {
			headers: { upgrade: "websocket", authorization: "Bearer nope", ...PROTOCOL },
		});
		expect(response.status).toBe(401);
	});

	it("rate limits tunnel creation per client IP", async () => {
		for (let index = 0; index < 20; index += 1) {
			expect((await createFromSameClient()).status).toBe(201);
		}
		expect((await createFromSameClient()).status).toBe(429);
	});

	it("answers heartbeats", async () => {
		const client = await connect(await createTunnel());
		client.ws.send(PING);
		await client.waitUntil(() => client.texts.includes(PONG));
	});
});

describe("public HTTP", () => {
	it("shows not found and offline pages", async () => {
		const missing = await SELF.fetch("https://abcdefghijkm.tunnel.test/", { headers: { accept: "text/html" } });
		expect(missing.status).toBe(404);
		expect(await missing.text()).toContain("Tunnel not found");

		const invalid = await SELF.fetch("https://not-a-tunnel.tunnel.test/");
		expect(invalid.status).toBe(404);

		const tunnel = await createTunnel();
		const offline = await SELF.fetch(publicUrl(tunnel));
		expect(offline.status).toBe(502);
		expect(await offline.json()).toMatchObject({ error: "Tunnel offline" });
	});

	it("proxies a request and streams the response under flow control", async () => {
		const tunnel = await createTunnel();
		const client = await connect(tunnel);

		const pending = SELF.fetch(publicUrl(tunnel, "/hello?x=1"), {
			headers: { "cf-connecting-ip": "1.2.3.4", cookie: "a=1", "x-custom": "yes" },
		});
		const open = await client.next((frame) => frame.type === FrameType.Open);
		const request = decodeOpen(open.payload);
		expect(request).toMatchObject({ method: "GET", path: "/hello?x=1", body: false });
		const headers = Object.fromEntries(request.headers);
		expect(headers).toMatchObject({ cookie: "a=1", "x-custom": "yes" });
		expect(headers).not.toHaveProperty("host");
		expect(headers).not.toHaveProperty("cf-connecting-ip");

		client.head(open.stream, {
			status: 201,
			headers: [
				["content-type", "text/plain"],
				["set-cookie", "session=1; Domain=tunnel.test; Path=/"],
			],
		});
		const response = await pending;
		expect(response.status).toBe(201);
		expect(response.headers.get("set-cookie")).toBe("session=1; Path=/");

		const chunk = new Uint8Array(MAX_CHUNK_BYTES).fill(7);
		const chunks = STREAM_WINDOW_BYTES / MAX_CHUNK_BYTES + 2;
		const body = readAll(response);
		// Send a full window, then wait for grants before sending more.
		for (let index = 0; index < chunks; index += 1) {
			if (index >= STREAM_WINDOW_BYTES / MAX_CHUNK_BYTES) {
				const grant = await client.next((frame) => frame.type === FrameType.Window);
				expect(decodeWindow(grant.payload)).toBe(MAX_CHUNK_BYTES);
			}
			client.send(FrameType.Data, open.stream, chunk);
		}
		client.send(FrameType.End, open.stream);
		expect((await body).byteLength).toBe(chunks * MAX_CHUNK_BYTES);
	});

	it("uploads request bodies without exceeding the window", async () => {
		const tunnel = await createTunnel();
		const client = await connect(tunnel);
		const size = STREAM_WINDOW_BYTES * 3;
		const pending = SELF.fetch(publicUrl(tunnel, "/upload"), { method: "POST", body: new Uint8Array(size).fill(1) });

		const open = await client.next((frame) => frame.type === FrameType.Open);
		expect(decodeOpen(open.payload).body).toBe(true);

		let received = 0;
		let granted = STREAM_WINDOW_BYTES;
		while (received < size) {
			const frame = await client.next((f) => f.stream === open.stream);
			expect(frame.type).toBe(FrameType.Data);
			received += frame.payload.byteLength;
			expect(received).toBeLessThanOrEqual(granted);
			if (received === granted) {
				client.send(FrameType.Window, open.stream, encodeWindow(STREAM_WINDOW_BYTES));
				granted += STREAM_WINDOW_BYTES;
			}
		}
		const end = await client.next((f) => f.stream === open.stream);
		expect(end.type).toBe(FrameType.End);

		client.head(open.stream, { status: 204, body: false });
		expect((await pending).status).toBe(204);
	});

	it("turns a client reset into a 502 without dropping the connection", async () => {
		const tunnel = await createTunnel();
		const client = await connect(tunnel);
		const pending = SELF.fetch(publicUrl(tunnel), { headers: { accept: "text/html" } });
		const open = await client.next((frame) => frame.type === FrameType.Open);
		client.send(FrameType.Reset, open.stream, encodeText("connection refused"));
		const response = await pending;
		expect(response.status).toBe(502);
		expect(await response.text()).toContain("Local server unavailable");
		expect(client.closed).toBeNull();
	});

	it("closes the connection when the client exceeds the window", async () => {
		const tunnel = await createTunnel();
		const client = await connect(tunnel);
		const pending = SELF.fetch(publicUrl(tunnel));
		const open = await client.next((frame) => frame.type === FrameType.Open);
		client.head(open.stream);
		const response = await pending;
		const bodyFailed = expect(response.arrayBuffer()).rejects.toThrow("Tunnel offline");
		client.send(FrameType.Data, open.stream, new Uint8Array(STREAM_WINDOW_BYTES + 1));
		await client.waitUntil(() => client.closed !== null);
		expect(client.closed?.code).toBe(CLOSE_PROTOCOL_ERROR);
		await bodyFailed;
	});

	it("fails only the affected request when a response head is invalid", async () => {
		const tunnel = await createTunnel();
		const client = await connect(tunnel);
		const pending = SELF.fetch(publicUrl(tunnel));
		const open = await client.next((frame) => frame.type === FrameType.Open);
		client.send(FrameType.Head, open.stream, encodeText(JSON.stringify({ status: 600, headers: [], body: false })));
		expect((await pending).status).toBe(502);
		expect((await client.next((f) => f.stream === open.stream)).type).toBe(FrameType.Reset);
		expect(client.closed).toBeNull();
	});

	it("fails only the affected request when a response header cannot be sent", async () => {
		const tunnel = await createTunnel();
		const client = await connect(tunnel);
		const pending = SELF.fetch(publicUrl(tunnel));
		const open = await client.next((frame) => frame.type === FrameType.Open);
		client.head(open.stream, { headers: [["bad name", "x"]] });
		expect((await pending).status).toBe(502);
		expect((await client.next((f) => f.stream === open.stream)).type).toBe(FrameType.Reset);
		expect(client.closed).toBeNull();
	});

	it("strips cookie domains however they are spelled", async () => {
		const tunnel = await createTunnel();
		const client = await connect(tunnel);
		const pending = SELF.fetch(publicUrl(tunnel));
		const open = await client.next((frame) => frame.type === FrameType.Open);
		client.head(open.stream, {
			body: false,
			headers: [
				["set-cookie", "a=1; Domain =tunnel.test; Path=/"],
				["set-cookie", "b=2;DOMAIN=.tunnel.test;HttpOnly"],
			],
		});
		const response = await pending;
		expect(response.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2;HttpOnly"]);
	});

	it("never reuses stream ids, even across hibernation", async () => {
		const tunnel = await createTunnel();
		const client = await connect(tunnel);
		const request = async () => {
			const pending = SELF.fetch(publicUrl(tunnel));
			const open = await client.next((frame) => frame.type === FrameType.Open);
			client.head(open.stream, { body: false });
			await pending;
			return open.stream;
		};
		const first = await request();
		await evictDurableObject(env.TUNNEL.getByName(tunnel.id), { webSockets: "hibernate" });
		expect(await request()).toBeGreaterThan(first);
	});

	it("passes compressed bodies through", async () => {
		const tunnel = await createTunnel();
		const client = await connect(tunnel);
		const pending = SELF.fetch(publicUrl(tunnel));
		const open = await client.next((frame) => frame.type === FrameType.Open);
		client.head(open.stream, { headers: [["content-encoding", "gzip"]] });
		client.send(FrameType.End, open.stream);
		const response = await pending;
		expect(response.headers.get("content-encoding")).toBe("gzip");
	});
});

async function openWebSocket() {
	const tunnel = await createTunnel();
	const client = await connect(tunnel);
	const pending = SELF.fetch(publicUrl(tunnel, "/ws"), {
		headers: { upgrade: "websocket", "sec-websocket-protocol": "chat, other" },
	});
	const open = await client.next((frame) => frame.type === FrameType.Open);
	expect(decodeOpen(open.payload).websocket).toEqual(["chat", "other"]);
	client.head(open.stream, { status: 101, body: false, protocol: "chat" });
	const response = await pending;
	expect(response.status).toBe(101);
	expect(response.headers.get("sec-websocket-protocol")).toBe("chat");
	const socket = response.webSocket as WebSocket;
	socket.binaryType = "arraybuffer";
	socket.accept();
	const received: (string | ArrayBuffer)[] = [];
	socket.addEventListener("message", (event) => {
		received.push(event.data as string | ArrayBuffer);
	});
	return { tunnel, client, socket, stream: open.stream, received };
}

describe("public WebSockets", () => {
	it("forwards handshake cookies without copying connection-specific headers", async () => {
		const tunnel = await createTunnel();
		const client = await connect(tunnel);
		const pending = SELF.fetch(publicUrl(tunnel, "/ws"), {
			headers: { upgrade: "websocket", "sec-websocket-protocol": "chat" },
		});
		const open = await client.next((frame) => frame.type === FrameType.Open);
		client.head(open.stream, {
			status: 101,
			body: false,
			protocol: "chat",
			headers: [
				["set-cookie", "session=abc; Domain=localhost; Path=/; HttpOnly"],
				["set-cookie", "theme=dark; Path=/"],
				["x-app", "local"],
				["connection", "Upgrade, x-private"],
				["x-private", "hidden"],
				["sec-websocket-accept", "local-accept"],
				["sec-websocket-key", "local-key"],
				["sec-websocket-extensions", "permessage-deflate"],
				["sec-websocket-protocol", "wrong"],
			],
		});
		const response = await pending;
		expect(response.status).toBe(101);
		expect(response.headers.getSetCookie()).toEqual(["session=abc; Path=/; HttpOnly", "theme=dark; Path=/"]);
		expect(response.headers.get("x-app")).toBe("local");
		expect(response.headers.get("x-private")).toBeNull();
		expect(response.headers.get("sec-websocket-accept")).toBeNull();
		expect(response.headers.get("sec-websocket-key")).toBeNull();
		expect(response.headers.get("sec-websocket-extensions")).toBeNull();
		expect(response.headers.get("sec-websocket-protocol")).toBe("chat");
		response.webSocket?.accept();
		response.webSocket?.close();
		client.ws.close(CLOSE_SHUTDOWN);
	});

	it("does not forward a subprotocol the local server only named in its headers", async () => {
		const tunnel = await createTunnel();
		const client = await connect(tunnel);
		const pending = SELF.fetch(publicUrl(tunnel, "/ws"), {
			headers: { upgrade: "websocket", "sec-websocket-protocol": "chat" },
		});
		const open = await client.next((frame) => frame.type === FrameType.Open);
		client.head(open.stream, { status: 101, body: false, headers: [["sec-websocket-protocol", "other"]] });
		const response = await pending;
		expect(response.status).toBe(101);
		expect(response.headers.get("sec-websocket-protocol")).toBeNull();
		response.webSocket?.accept();
		response.webSocket?.close();
		client.ws.close(CLOSE_SHUTDOWN);
	});

	it("fails only the upgrade when a handshake header cannot be sent", async () => {
		const tunnel = await createTunnel();
		const client = await connect(tunnel);
		// Accepted and rejected upgrades alike.
		for (const status of [101, 403]) {
			const pending = SELF.fetch(publicUrl(tunnel, "/ws"), { headers: { upgrade: "websocket" } });
			const open = await client.next((frame) => frame.type === FrameType.Open);
			client.head(open.stream, { status, body: false, headers: [["x-app", "a\nb"]] });
			expect((await pending).status).toBe(502);
			expect((await client.next((f) => f.stream === open.stream)).type).toBe(FrameType.Reset);
		}
		expect(client.closed).toBeNull();
		expect(
			await runInDurableObject(env.TUNNEL.getByName(tunnel.id), (_, state) => state.getWebSockets("public")),
		).toEqual([]);
	});

	it("relays messages and closes in both directions", async () => {
		const { client, socket, stream, received } = await openWebSocket();

		socket.send("hi");
		socket.send(new Uint8Array([1, 2, 3]));
		expect(decodeText((await client.next((f) => f.type === FrameType.Text)).payload)).toBe("hi");
		expect([...(await client.next((f) => f.type === FrameType.Data)).payload]).toEqual([1, 2, 3]);

		client.send(FrameType.Text, stream, encodeText("hello"));
		client.send(FrameType.Data, stream, new Uint8Array([9]));
		await client.waitUntil(() => received.length === 2);
		expect(received[0]).toBe("hello");
		expect([...new Uint8Array(received[1] as ArrayBuffer)]).toEqual([9]);

		socket.close(4321, "bye");
		const end = await client.next((f) => f.type === FrameType.End);
		expect(decodeClose(end.payload)).toEqual({ code: 4321, reason: "bye" });
	});

	it("relays the words ping and pong instead of answering them", async () => {
		// The heartbeat auto-response applies to every socket of the object, visitors' included.
		const { client, socket, stream, received } = await openWebSocket();
		socket.send("ping");
		expect(decodeText((await client.next((f) => f.type === FrameType.Text)).payload)).toBe("ping");
		client.send(FrameType.Text, stream, encodeText("pong"));
		await client.waitUntil(() => received.length === 1);
		expect(received).toEqual(["pong"]);
	});

	it("forwards a local close to the public socket", async () => {
		const { client, socket, stream } = await openWebSocket();
		const closed = new Promise<CloseEvent>((resolve) => socket.addEventListener("close", resolve));
		client.send(FrameType.End, stream, encodeClose({ code: 4000, reason: "done" }));
		const event = await closed;
		expect(event.code).toBe(4000);
	});

	it("rejects malformed subprotocol headers before reaching the client", async () => {
		const tunnel = await createTunnel();
		const client = await connect(tunnel);
		const response = await SELF.fetch(publicUrl(tunnel, "/ws"), {
			headers: { upgrade: "websocket", "sec-websocket-protocol": "a, a" },
		});
		expect(response.status).toBe(400);
		expect(client.frames).toEqual([]);
	});

	it("passes a rejected upgrade through", async () => {
		const tunnel = await createTunnel();
		const client = await connect(tunnel);
		const pending = SELF.fetch(publicUrl(tunnel, "/ws"), { headers: { upgrade: "websocket" } });
		const open = await client.next((frame) => frame.type === FrameType.Open);
		client.head(open.stream, { status: 403, body: false });
		expect((await pending).status).toBe(403);
	});

	it("keeps working after the object hibernates", async () => {
		const { tunnel, client, socket, stream, received } = await openWebSocket();
		await evictDurableObject(env.TUNNEL.getByName(tunnel.id), { webSockets: "hibernate" });

		socket.send("after");
		expect(decodeText((await client.next((f) => f.type === FrameType.Text)).payload)).toBe("after");
		client.send(FrameType.Text, stream, encodeText("back"));
		await client.waitUntil(() => received.includes("back"));

		// New streams do not reuse the id of the open WebSocket.
		const pending = SELF.fetch(publicUrl(tunnel));
		const open = await client.next((frame) => frame.type === FrameType.Open);
		expect(open.stream).toBeGreaterThan(stream);
		client.head(open.stream, { body: false });
		expect((await pending).status).toBe(200);
	});
});

describe("connection lifecycle", () => {
	it("keeps the URL across reconnects", async () => {
		const tunnel = await createTunnel();
		const first = await connect(tunnel);
		first.ws.close(1001, "network changed");
		await first.waitUntil(() => first.closed !== null);

		const offline = await SELF.fetch(publicUrl(tunnel));
		expect(offline.status).toBe(502);

		const second = await connect(tunnel);
		const pending = SELF.fetch(publicUrl(tunnel));
		const open = await second.next((frame) => frame.type === FrameType.Open);
		second.head(open.stream, { body: false });
		expect((await pending).status).toBe(200);
	});

	it("replaces an older connection", async () => {
		const tunnel = await createTunnel();
		const first = await connect(tunnel);
		const second = await connect(tunnel);
		await first.waitUntil(() => first.closed !== null);
		expect(first.closed?.code).toBe(CLOSE_REPLACED);
		expect(second.closed).toBeNull();
	});

	it("releases the tunnel immediately on shutdown", async () => {
		const tunnel = await createTunnel();
		const client = await connect(tunnel);
		client.ws.close(CLOSE_SHUTDOWN, "bye");
		await client.waitUntil(() => client.closed !== null);
		await expect.poll(async () => (await SELF.fetch(publicUrl(tunnel))).status).toBe(404);
	});

	it("expires tunnels that never connect or do not come back", async () => {
		const unused = await createTunnel();
		expect(await runDurableObjectAlarm(env.TUNNEL.getByName(unused.id))).toBe(true);
		expect((await SELF.fetch(publicUrl(unused))).status).toBe(404);

		const left = await createTunnel();
		const client = await connect(left);
		client.ws.close(1001, "gone");
		await client.waitUntil(() => client.closed !== null);
		await expect.poll(() => runDurableObjectAlarm(env.TUNNEL.getByName(left.id))).toBe(true);
		expect((await SELF.fetch(publicUrl(left))).status).toBe(404);
		const reconnect = await SELF.fetch(left.connectUrl.replace(/^ws/, "http"), {
			headers: { upgrade: "websocket", authorization: `Bearer ${left.token}`, ...PROTOCOL },
		});
		expect(reconnect.status).toBe(404);
	});

	it("keeps a connected tunnel alive when its alarm fires", async () => {
		const tunnel = await createTunnel();
		const client = await connect(tunnel);
		client.ws.send(PING);
		await client.waitUntil(() => client.texts.includes(PONG));
		expect(await runDurableObjectAlarm(env.TUNNEL.getByName(tunnel.id))).toBe(true);
		expect(client.closed).toBeNull();
	});
});
