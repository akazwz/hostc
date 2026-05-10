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

const streams = readIntEnv("HOSTC_STRESS_STREAMS", 5000);
const concurrency = readIntEnv("HOSTC_STRESS_CONCURRENCY", 128);
const dataChannels = readIntEnv("HOSTC_DATA_CHANNELS", 4);
const bodyBytes = readIntEnv("HOSTC_STRESS_BODY_BYTES", 1024);

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

	const result = await runConcurrent(streams, concurrency, (index) =>
		harness.sendHttpRequest({
			method: index % 3 === 0 ? "POST" : "GET",
			path: `/stress/${index}`,
			bodyBytes: index % 3 === 0 ? bodyBytes : 0,
		}),
	);

	const harnessSnapshot = harness.snapshot();
	printJsonSummary({
		name: "hostc-sdk-local-stress",
		server: "simulated-v4",
		client: "@hostc/client",
		streams,
		concurrency,
		dataChannels,
		bodyBytes,
		...result,
		harness: harnessSnapshot,
		clientSnapshot: client.getSnapshot(),
	});

	if (result.failed > 0 || harnessSnapshot.pendingStreams !== 0)
		process.exitCode = 1;
} finally {
	await client.stop();
	await harness.close();
	await settleClient(running);
}
