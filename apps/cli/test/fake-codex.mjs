#!/usr/bin/env node
// A stand-in for `codex app-server --listen stdio://`: answers just enough of the protocol for tests.
import { createInterface } from "node:readline";

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const notify = (method, params) => send({ method, params });

createInterface({ input: process.stdin }).on("line", (line) => {
	const { id, method, params } = JSON.parse(line);
	switch (method) {
		case "initialize":
			send({ id, result: { userAgent: "fake" } });
			return;
		case "thread/start":
			send({ id, result: { thread: { id: "t1", safety: params } } });
			notify("thread/started", { thread: { id: "t1" } });
			return;
		case "thread/resume":
			send({ id, result: { thread: { id: params.threadId } } });
			return;
		case "turn/start":
			send({ id, result: { turn: { id: "u1", received: params } } });
			notify("turn/started", { threadId: "t1", turn: { id: "u1" } });
			notify("rawResponseItem/completed", { threadId: "t1" });
			for (const delta of params.input[0].text.split(" ")) {
				notify("item/agentMessage/delta", { threadId: "t1", turnId: "u1", itemId: "i1", delta });
			}
			send({ id: 500, method: "item/commandExecution/requestApproval", params: { command: "ls" } });
			send({ id: 501, method: "account/chatgptAuthTokens/refresh", params: {} });
			return;
		case "fs/readFile":
		case "fuzzyFileSearch":
		case "skills/list":
		case "gitDiffToRemote":
			send({ id, result: { received: params } });
			return;
		case "thread/list":
			send({
				id,
				result: { data: [{ id: "t1", cwd: params.cwd, preview: "x".repeat(params.size ?? 0) }], nextCursor: null },
			});
			return;
		default:
			if (method === undefined) {
				// An answer to one of our requests: report it so that the test can see it.
				const answer = JSON.parse(line);
				notify("warning", { message: `answered ${answer.id}: ${JSON.stringify(answer.result ?? answer.error)}` });
			}
	}
});
