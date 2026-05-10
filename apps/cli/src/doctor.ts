import { createConnection } from "node:net";
import chalk from "chalk";
import { getConfigPath, resolveConfig, validateLocalHost } from "./config";
import { formatError } from "./redact";

export type DoctorOptions = {
	port?: number;
	server?: string;
	localHost?: string;
};

export type DoctorCheck = {
	name: string;
	status: "ok" | "warn" | "fail";
	message: string;
};

export async function runDoctor(
	options: DoctorOptions,
): Promise<DoctorCheck[]> {
	const checks: DoctorCheck[] = [];
	checks.push(checkNodeVersion());

	let resolved: Awaited<ReturnType<typeof resolveConfig>> | null = null;
	try {
		resolved = await resolveConfig({
			serverUrl: options.server,
			localHost: options.localHost,
		});
		checks.push({
			name: "Config",
			status: "ok",
			message: getConfigPath(),
		});
	} catch (error) {
		checks.push({
			name: "Config",
			status: "fail",
			message: formatError(error),
		});
	}

	if (resolved) {
		checks.push(await checkServerHealth(resolved.serverUrl));
	}

	if (options.port !== undefined) {
		const host = validateLocalHost(
			options.localHost ?? resolved?.localHost ?? "localhost",
		);
		const local = await checkLocalPort(host, options.port);
		checks.push({
			name: "Local service",
			status: local.ok ? "ok" : "warn",
			message: local.ok
				? `${host}:${options.port} is accepting connections`
				: `${host}:${options.port} is not accepting connections yet`,
		});
	}

	return checks;
}

export function printDoctorChecks(checks: DoctorCheck[]): void {
	console.log(chalk.bold("Doctor"));
	for (const check of checks) {
		const label =
			check.status === "ok"
				? chalk.green("OK")
				: check.status === "warn"
					? chalk.yellow("WARN")
					: chalk.red("FAIL");
		console.log(`  ${label}  ${check.name}: ${check.message}`);
	}
}

export function hasDoctorFailure(checks: DoctorCheck[]): boolean {
	return checks.some((check) => check.status === "fail");
}

export async function checkLocalPort(
	host: string,
	port: number,
	timeoutMs = 700,
): Promise<{ ok: boolean }> {
	const hosts = localConnectHosts(host);
	for (const candidate of hosts) {
		if (await canConnect(candidate, port, timeoutMs)) {
			return { ok: true };
		}
	}
	return { ok: false };
}

export async function warnIfLocalPortClosed(
	host: string,
	port: number,
): Promise<void> {
	const result = await checkLocalPort(host, port);
	if (result.ok) {
		return;
	}
	console.error(
		`${chalk.yellow("Warning")}  Local service ${host}:${port} is not accepting connections yet.`,
	);
	console.error(chalk.dim("         The tunnel will still start."));
}

async function checkServerHealth(serverUrl: string): Promise<DoctorCheck> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 5000);
	timeout.unref?.();
	try {
		const response = await fetch(new URL("/health", serverUrl), {
			signal: controller.signal,
		});
		return {
			name: "Server",
			status: response.ok ? "ok" : "fail",
			message: response.ok
				? `${serverUrl} is healthy`
				: `${serverUrl} returned HTTP ${response.status}`,
		};
	} catch (error) {
		return {
			name: "Server",
			status: "fail",
			message: `cannot reach ${serverUrl}: ${formatError(error)}`,
		};
	} finally {
		clearTimeout(timeout);
	}
}

function checkNodeVersion(): DoctorCheck {
	const major = Number(process.versions.node.split(".")[0]);
	return {
		name: "Node.js",
		status: major >= 18 ? "ok" : "fail",
		message: process.version,
	};
}

function localConnectHosts(host: string): string[] {
	const normalized = host.replace(/^\[(.*)]$/, "$1");
	if (normalized === "localhost") {
		return ["127.0.0.1", "::1"];
	}
	return [normalized];
}

function canConnect(
	host: string,
	port: number,
	timeoutMs: number,
): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ host, port });
		const finish = (ok: boolean): void => {
			socket.removeAllListeners();
			socket.destroy();
			resolve(ok);
		};
		socket.setTimeout(timeoutMs);
		socket.once("connect", () => finish(true));
		socket.once("error", () => finish(false));
		socket.once("timeout", () => finish(false));
	});
}
