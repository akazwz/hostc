import { HostcClient } from "../packages/client/dist/index.js";
import {
	createEchoUpstream,
	printJsonSummary,
	readIntEnv,
	runConcurrent,
	settleClient,
	waitForClientReady,
} from "./sdk-harness.mjs";

const serverUrl = process.env.HOSTC_SERVER_URL ?? "https://envoq.dev";
const iterations = readIntEnv("HOSTC_BENCH_ITERATIONS", 200);
const concurrency = readIntEnv("HOSTC_BENCH_CONCURRENCY", 16);
const dataChannels = readIntEnv("HOSTC_DATA_CHANNELS", 2);

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

	const result = await runConcurrent(iterations, concurrency, async (index) => {
		const response = await fetch(new URL(`/bench/${index}`, publicUrl));
		const text = await response.text();
		if (response.status !== 200 || text !== "ok") {
			throw new Error(`unexpected response ${response.status}: ${text}`);
		}
	});

	printJsonSummary({
		name: "hostc-sdk-remote-bench",
		serverUrl,
		publicUrl,
		client: "@hostc/client",
		iterations,
		concurrency,
		dataChannels,
		...result,
		clientSnapshot: client.getSnapshot(),
	});

	if (result.failed > 0) process.exitCode = 1;
} finally {
	await client.stop();
	await settleClient(running);
}
