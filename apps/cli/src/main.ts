#!/usr/bin/env node
import net from "node:net";
import { styleText } from "node:util";

import { type RequestLog, Tunnel, TunnelError } from "@hostc/client";
import { renderUnicodeCompact } from "uqr";

import { parseCommand, USAGE } from "./args.ts";

declare const __HOSTC_VERSION__: string;
declare const __HOSTC_DEFAULT_SERVER__: string;

async function main(): Promise<number> {
	const command = parseCommand(process.argv.slice(2), process.env, __HOSTC_DEFAULT_SERVER__);
	switch (command.kind) {
		case "help":
			console.log(USAGE);
			return 0;
		case "version":
			console.log(__HOSTC_VERSION__);
			return 0;
		case "error":
			console.error(`${styleText("red", "error")} ${command.message}\n\n${USAGE}`);
			return 2;
	}

	const { target, server, qr } = command;
	if (!(await isListening(target))) {
		console.log(styleText("yellow", `Nothing is listening on ${target.host} yet; requests will fail until it starts.`));
	}

	let tunnel: Tunnel;
	try {
		tunnel = await Tunnel.open({ server, target });
	} catch (error) {
		console.error(`${styleText("red", "error")} ${describe(error)}`);
		return 1;
	}

	printUrl(tunnel.url, target, qr);
	tunnel.on("request", printRequest);
	tunnel.on("disconnected", ({ reason }) => {
		console.log(styleText("yellow", `Connection lost (${reason}). Reconnecting…`));
	});
	tunnel.on("reconnecting", ({ attempt, error }) => {
		if (error && attempt % 5 === 0) {
			console.log(styleText("yellow", `Still reconnecting: ${describe(error)}`));
		}
	});
	tunnel.on("reconnected", ({ url, urlChanged }) => {
		if (urlChanged) {
			console.log(styleText("yellow", "The tunnel expired while offline. It has a new URL:"));
			printUrl(url, target, qr);
		} else {
			console.log(styleText("green", "Reconnected."));
		}
	});

	return new Promise((resolve) => {
		tunnel.on("failed", (error) => {
			console.error(`${styleText("red", "error")} ${describe(error)}`);
			resolve(1);
		});
		let stopping = false;
		const stop = () => {
			if (stopping) {
				resolve(130);
				return;
			}
			stopping = true;
			void tunnel.close().then(() => resolve(0));
		};
		process.on("SIGINT", stop);
		process.on("SIGTERM", stop);
	});
}

function printUrl(url: string, target: URL, qr: boolean): void {
	console.log(`\n  ${styleText("bold", url)}  ${styleText("dim", `→ ${target.origin}`)}\n`);
	if (qr) {
		console.log(
			renderUnicodeCompact(url)
				.split("\n")
				.map((line) => `  ${line}`)
				.join("\n"),
		);
		console.log();
	}
	console.log(styleText("dim", "  Anyone with this URL can reach your local server. Press Ctrl+C to stop.\n"));
}

function printRequest(entry: RequestLog): void {
	const time = new Date().toTimeString().slice(0, 8);
	const method = (entry.websocket ? "WS" : entry.method).padEnd(7);
	const color = entry.status >= 500 ? "red" : entry.status >= 400 ? "yellow" : "green";
	const status = styleText(color, String(entry.status));
	const duration = entry.websocket ? "" : styleText("dim", ` ${entry.durationMs}ms`);
	console.log(`${styleText("dim", time)}  ${method}${status}  ${entry.path}${duration}`);
}

function describe(error: unknown): string {
	if (error instanceof TunnelError) {
		return error.message;
	}
	return error instanceof Error ? error.message : String(error);
}

function isListening(target: URL): Promise<boolean> {
	const port = Number(target.port || (target.protocol === "https:" ? 443 : 80));
	return new Promise((resolve) => {
		const socket = net.connect({ host: target.hostname.replace(/^\[|\]$/g, ""), port });
		socket.setTimeout(1000);
		socket.once("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.once("timeout", () => {
			socket.destroy();
			resolve(false);
		});
		socket.once("error", () => resolve(false));
	});
}

process.exitCode = await main();
process.exit();
