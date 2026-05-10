import { HostcClient } from "../packages/client/dist/index.js";
import {
	createEchoUpstream,
	createLocalTunnelHarness,
	printJsonSummary,
	readIntEnv,
	runConcurrent,
	settleClient,
	waitForClientReady,
} from "./sdk-harness.mjs";

const iterations = readIntEnv("HOSTC_BENCH_ITERATIONS", 1000);
const concurrency = readIntEnv("HOSTC_BENCH_CONCURRENCY", 32);
const dataChannels = readIntEnv("HOSTC_DATA_CHANNELS", 2);
const bodyBytes = readIntEnv("HOSTC_BENCH_BODY_BYTES", 0);

const harness = await createLocalTunnelHarness({ dataChannels });
const client = new HostcClient({
	serverUrl: harness.serverUrl,
	upstream: createEchoUpstream(),
	dataChannels,
	createBackoffMs: () => 50,
	reconnectBackoffMs: () => 50,
});
const running = client.start();

try {
	await waitForClientReady(client, running);
	await harness.ready;

	const result = await runConcurrent(iterations, concurrency, (index) =>
		harness.sendHttpRequest({
			method: bodyBytes > 0 ? "POST" : "GET",
			path: `/bench/${index}`,
			bodyBytes,
		}),
	);

	printJsonSummary({
		name: "hostc-sdk-local-bench",
		server: "simulated-v4",
		client: "@hostc/client",
		iterations,
		concurrency,
		dataChannels,
		bodyBytes,
		...result,
		harness: harness.snapshot(),
	});

	if (result.failed > 0) process.exitCode = 1;
} finally {
	await client.stop();
	await harness.close();
	await settleClient(running);
}
