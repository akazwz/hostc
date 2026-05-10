#!/usr/bin/env node

import { HostcClient, localOriginAdapter } from "@hostc/client";
import chalk from "chalk";
import { Command, InvalidArgumentError } from "commander";
import { renderUnicode } from "uqr";
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
import {
	hasDoctorFailure,
	printDoctorChecks,
	runDoctor,
	warnIfLocalPortClosed,
} from "./doctor";
import { formatError } from "./redact";
import { TerminalSpinner } from "./spinner";
import { maybePrintUpdateNotice } from "./update";

declare const __HOSTC_CLI_VERSION__: string;

const CLI_VERSION = __HOSTC_CLI_VERSION__;

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
		.option("--qr", "print a terminal QR code for the public URL")
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

	program
		.command("doctor")
		.argument("[port]", "local port to check", parseOptionalPort)
		.option("--server <url>", "hostc server URL")
		.option(
			"--local-host <host>",
			"host of the local service",
			validateLocalHost,
		)
		.description("Check hostc CLI, server, config, and optional local port")
		.action(async (port: number | undefined, options: TunnelCommandOptions) => {
			const checks = await runDoctor({
				port,
				server: options.server,
				localHost: options.localHost,
			});
			printDoctorChecks(checks);
			if (hasDoctorFailure(checks)) {
				process.exitCode = 1;
			}
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
	const spinner = new TerminalSpinner("Creating tunnel...");
	let printedFirstQr = false;

	maybePrintUpdateNotice(CLI_VERSION, {
		disabled: resolved.disableUpdateCheck,
	});
	await warnIfLocalPortClosed(resolved.localHost, port);

	const client = new HostcClient({
		serverUrl: resolved.serverUrl,
		dataChannels: resolved.dataChannels,
		debug: resolved.debug,
		upstream: localOriginAdapter({ origin: localOrigin }),
	});

	client.on("state", (state) => {
		if (state === "creatingTunnel") {
			spinner.update("Creating tunnel...");
			spinner.start();
		}
		if (state === "connecting") {
			spinner.update("Connecting tunnel...");
			spinner.start();
		}
		if (state === "reconnecting") {
			spinner.update("Reconnecting...");
			spinner.start();
		}
		if (state === "ready" || state === "closed") {
			spinner.stop();
		}
	});
	client.on("ready", (event) => {
		if (resolved.qr && process.stdout.isTTY && !printedFirstQr) {
			console.log(renderUnicode(event.publicUrl));
			printedFirstQr = true;
		}
		const snapshot = client.getSnapshot();
		console.log(`${chalk.green("Success")}  ${chalk.bold("Tunnel ready")}`);
		console.log(`  Public URL: ${event.publicUrl}`);
		console.log(`  Local:      ${chalk.dim(localOrigin.href)}`);
		console.log(`  Tunnel:     ${chalk.dim(event.tunnelId)}`);
		console.log(`  Channels:   ${chalk.dim(String(snapshot.dataChannels))}`);
	});
	client.on("reconnecting", (event) => {
		spinner.stop();
		console.error(
			`${chalk.yellow("Reconnect")} ${formatError(event.reason)}; retrying in ${event.delayMs}ms`,
		);
	});
	client.on("log", (event) => {
		if (resolved.debug) {
			const fields = event.fields
				? ` ${formatError(JSON.stringify(event.fields))}`
				: "";
			console.error(`[hostc:debug] ${event.message}${fields}`);
		}
	});

	let closing = false;
	const close = (): void => {
		if (closing) {
			return;
		}
		closing = true;
		spinner.stop();
		process.stdin.pause();
		void client.stop();
	};
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

	try {
		await client.start();
	} catch (error) {
		spinner.stop();
		throw new Error(formatError(error));
	}
}

function parsePort(value: string): number {
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new InvalidArgumentError("port must be an integer from 1 to 65535");
	}
	return port;
}

function parseOptionalPort(value: string): number {
	return parsePort(value);
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
