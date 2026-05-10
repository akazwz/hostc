import { HostcClient } from "../packages/client/dist/index.js";
import {
	createEchoUpstream,
	printJsonSummary,
	readIntEnv,
	runConcurrent,
	settleClient,
	WebSocket,
	waitForClientReady,
} from "./sdk-harness.mjs";

const serverUrl = process.env.HOSTC_SERVER_URL ?? "https://envoq.dev";
const streams = readIntEnv("HOSTC_STRESS_STREAMS", 1000);
const concurrency = readIntEnv("HOSTC_STRESS_CONCURRENCY", 64);
const dataChannels = readIntEnv("HOSTC_DATA_CHANNELS", 4);
const bodyBytes = readIntEnv("HOSTC_STRESS_BODY_BYTES", 1024);
const webSocketClients = readIntEnv("HOSTC_STRESS_WS", 20);

const client = new HostcClient({
	serverUrl,
	upstream: createEchoUpstream(),
	dataChannels,
});
const running = client.start();

try {
	const snapshot = await waitForClientReady(client, running);
	const publicUrl = snapshot.publicUrl;
	if (!publicUrl) throw new Error("client did not expose a public URL");

	const httpResult = await runConcurrent(
		streams,
		concurrency,
		async (index) => {
			const method = index % 3 === 0 ? "POST" : "GET";
			const response = await fetch(new URL(`/stress/${index}`, publicUrl), {
				method,
				body: method === "POST" ? Buffer.alloc(bodyBytes, "x") : undefined,
			});
			const text = await response.text();
			if (response.status !== 200 || text !== "ok") {
				throw new Error(`unexpected response ${response.status}: ${text}`);
			}
		},
	);

	const wsResult = await runConcurrent(
		webSocketClients,
		Math.min(webSocketClients, 20),
		async (index) => {
			const url = new URL(`/ws/${index}`, publicUrl);
			url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
			await runWebSocketEcho(url, `hostc-${index}`);
		},
	);

	printJsonSummary({
		name: "hostc-sdk-remote-stress",
		serverUrl,
		publicUrl,
		client: "@hostc/client",
		streams,
		concurrency,
		dataChannels,
		bodyBytes,
		webSocketClients,
		http: httpResult,
		webSocket: wsResult,
		clientSnapshot: client.getSnapshot(),
	});

	if (httpResult.failed > 0 || wsResult.failed > 0) process.exitCode = 1;
} finally {
	await client.stop();
	await settleClient(running);
}

async function runWebSocketEcho(url, message) {
	const socket = new WebSocket(url);
	await new Promise((resolve, reject) => {
		socket.once("open", resolve);
		socket.once("error", reject);
	});

	const echoed = new Promise((resolve, reject) => {
		const timeout = setTimeout(
			() => reject(new Error("websocket echo timed out")),
			10_000,
		);
		socket.once("message", (data) => {
			clearTimeout(timeout);
			const text =
				typeof data === "string" ? data : Buffer.from(data).toString();
			if (text !== message) {
				reject(new Error(`unexpected websocket echo ${text}`));
				return;
			}
			resolve();
		});
		socket.once("error", reject);
	});

	socket.send(message);
	await echoed;
	socket.close(1000, "done");
}
