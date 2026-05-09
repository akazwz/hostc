#!/usr/bin/env node

import {
	type CreateTunnelResponse,
	defaultTunnelLimits,
} from "@hostc/protocol";
import chalk from "chalk";
import { Command, InvalidArgumentError } from "commander";
import { renderUnicode } from "uqr";
import { createTunnel } from "./api";
import {
	getConfigPath,
	parseConfigKey,
	readConfig,
	resolveConfig,
	setConfigValue,
	unsetConfigValue,
	validateDataChannels,
	validateLocalHost,
} from "./config";
import { formatError } from "./redact";
import { TunnelClient } from "./runtime";

const CLI_VERSION = "1.3.0";

type TunnelCommandOptions = {
	server?: string;
	localHost?: string;
	dataChannels?: number;
	qr?: boolean;
};

async function main(): Promise<void> {
	const program = new Command()
		.name("hostc")
		.description("Expose a local HTTP/WebSocket service through a hostc tunnel")
		.version(CLI_VERSION)
		.showHelpAfterError();

	program
		.argument("<port>", "local port to expose", parsePort)
		.option(
			"--local-host <host>",
			"host of the local service",
			validateLocalHost,
		)
		.option("--server <url>", "hostc server URL")
		.option(
			"--data-channels <count>",
			"number of data channel WebSockets",
			parseDataChannels,
		)
		.option("--qr", "print a terminal QR code for the public URL", false)
		.action(async (port: number, options: TunnelCommandOptions) => {
			await runTunnel(port, options);
		});

	const config = program.command("config").description("Manage hostc config");
	config
		.command("path")
		.description("Print config file path")
		.action(() => {
			console.log(getConfigPath());
		});
	config
		.command("get")
		.description("Print config JSON")
		.action(async () => {
			console.log(JSON.stringify(await readConfig(), null, 2));
		});
	config
		.command("set")
		.argument("<key>", "server-url, local-host, data-channels, or qr")
		.argument("<value>")
		.description("Set a config value")
		.action(async (key: string, value: string) => {
			const configKey = parseConfigKey(key);
			const next = await setConfigValue(configKey, value);
			console.log(JSON.stringify(next, null, 2));
		});
	config
		.command("unset")
		.argument("<key>", "server-url, local-host, data-channels, or qr")
		.description("Unset a config value")
		.action(async (key: string) => {
			const configKey = parseConfigKey(key);
			const next = await unsetConfigValue(configKey);
			console.log(JSON.stringify(next, null, 2));
		});

	if (process.argv.length <= 2) {
		program.outputHelp();
		return;
	}

	await program.parseAsync(process.argv);
}

async function runTunnel(
	port: number,
	options: TunnelCommandOptions,
): Promise<void> {
	const resolved = await resolveConfig({
		serverUrl: options.server,
		localHost: options.localHost,
		dataChannels: options.dataChannels,
		qr: options.qr,
	});
	const localOrigin = new URL(`http://${resolved.localHost}:${port}/`);
	let tunnel: CreateTunnelResponse;

	try {
		tunnel = await createTunnel(resolved.serverUrl, resolved.dataChannels);
	} catch (error) {
		throw new Error(formatError(error));
	}

	if (resolved.qr && process.stdout.isTTY) {
		console.log(renderUnicode(tunnel.publicUrl));
	}

	const client = new TunnelClient({
		serverUrl: resolved.serverUrl,
		localOrigin,
		tunnelId: tunnel.tunnelId,
		publicUrl: tunnel.publicUrl,
		connectionId: tunnel.connectionId,
		controlUrl: tunnel.controlUrl,
		dataUrl: tunnel.dataUrl,
		connectToken: tunnel.connectToken,
		refreshToken: tunnel.refreshToken,
		dataChannels: tunnel.dataChannels,
		limits: tunnel.limits ?? defaultTunnelLimits(),
		debug: resolved.debug,
	});

	const close = (): void => client.close();
	process.once("SIGINT", close);
	process.once("SIGTERM", close);
	if (process.env.HOSTC_E2E_RECONNECT_SIGNAL === "1") {
		process.on("SIGUSR2", () => client.forceReconnect("e2e reconnect"));
	}
	if (process.env.HOSTC_E2E_RECONNECT_STDIN === "1") {
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => {
			if (chunk.includes("reconnect")) {
				client.forceReconnect("e2e reconnect");
			}
		});
		process.stdin.resume();
	}
	await client.run();
}

function parsePort(value: string): number {
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new InvalidArgumentError("port must be an integer from 1 to 65535");
	}
	return port;
}

function parseDataChannels(value: string): number {
	try {
		return validateDataChannels(Number(value));
	} catch (error) {
		throw new InvalidArgumentError(formatError(error));
	}
}

main().catch((error) => {
	console.error(chalk.red(formatError(error)));
	process.exitCode = 1;
});
