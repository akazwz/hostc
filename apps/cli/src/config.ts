import { constants as fsConstants } from "node:fs";
import {
	access,
	chmod,
	mkdir,
	readFile,
	rename,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_DATA_CHANNELS, MAX_DATA_CHANNELS } from "@hostc/protocol";

export type StoredConfig = {
	serverUrl?: string;
	localHost?: string;
	dataChannels?: number;
	qr?: boolean;
};

export type ResolvedConfig = {
	serverUrl: string;
	localHost: string;
	dataChannels: number;
	qr: boolean;
	configPath: string;
	debug: boolean;
	disableUpdateCheck: boolean;
};

export type ResolveInput = Partial<{
	serverUrl: string;
	localHost: string;
	dataChannels: number;
	qr: boolean;
}>;

export const DEFAULT_SERVER_URL = "https://hostc.dev";
export const DEFAULT_LOCAL_HOST = "localhost";

const CONFIG_ENV = "HOSTC_CONFIG";
const SERVER_URL_ENV = "HOSTC_SERVER_URL";
const DEBUG_ENV = "HOSTC_DEBUG";
const DISABLE_UPDATE_CHECK_ENV = "HOSTC_DISABLE_UPDATE_CHECK";

export function getConfigPath(env: NodeJS.ProcessEnv = process.env): string {
	if (env[CONFIG_ENV]) {
		return resolve(env[CONFIG_ENV]);
	}
	const home = homedir();
	if (!home) {
		throw new Error("Home directory is unavailable; set HOSTC_CONFIG");
	}
	return join(home, ".hostc", "config.json");
}

export async function readConfig(
	env: NodeJS.ProcessEnv = process.env,
): Promise<StoredConfig> {
	const path = getConfigPath(env);
	try {
		const raw = await readFile(path, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		return sanitizeStoredConfig(parsed);
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			return {};
		}
		throw error;
	}
}

export async function writeConfig(
	config: StoredConfig,
	env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
	const path = getConfigPath(env);
	await mkdir(dirname(path), { recursive: true });
	const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(
		tmpPath,
		`${JSON.stringify(sanitizeStoredConfig(config), null, 2)}\n`,
		{
			mode: 0o600,
		},
	);
	await rename(tmpPath, path);
	try {
		await chmod(path, 0o600);
	} catch {
		// Best effort on filesystems that do not support chmod.
	}
}

export async function configExists(
	env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
	try {
		await access(getConfigPath(env), fsConstants.F_OK);
		return true;
	} catch {
		return false;
	}
}

export async function setConfigValue(
	key: keyof StoredConfig,
	value: string,
	env: NodeJS.ProcessEnv = process.env,
): Promise<StoredConfig> {
	const config = await readConfig(env);
	config[key] = parseConfigValue(key, value) as never;
	await writeConfig(config, env);
	return config;
}

export async function unsetConfigValue(
	key: keyof StoredConfig,
	env: NodeJS.ProcessEnv = process.env,
): Promise<StoredConfig> {
	const config = await readConfig(env);
	delete config[key];
	await writeConfig(config, env);
	return config;
}

export async function resolveConfig(
	input: ResolveInput = {},
	env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedConfig> {
	const fileConfig = await readConfig(env);
	const serverUrl = normalizeServerUrl(
		input.serverUrl ??
			env[SERVER_URL_ENV] ??
			fileConfig.serverUrl ??
			DEFAULT_SERVER_URL,
	);
	const localHost = validateLocalHost(
		input.localHost ?? fileConfig.localHost ?? DEFAULT_LOCAL_HOST,
	);
	const dataChannels = validateDataChannels(
		input.dataChannels ?? fileConfig.dataChannels ?? DEFAULT_DATA_CHANNELS,
	);
	const qr = input.qr ?? fileConfig.qr ?? false;

	return {
		serverUrl,
		localHost,
		dataChannels,
		qr,
		configPath: getConfigPath(env),
		debug: isTruthyEnv(env[DEBUG_ENV]),
		disableUpdateCheck: isTruthyEnv(env[DISABLE_UPDATE_CHECK_ENV]),
	};
}

export function normalizeServerUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("server-url must be a valid http(s) URL");
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error("server-url must use http or https");
	}
	url.pathname = url.pathname.replace(/\/+$/, "");
	if (url.pathname === "") {
		url.pathname = "/";
	}
	url.search = "";
	url.hash = "";
	return url.toString().replace(/\/$/, "");
}

export function validateLocalHost(value: string): string {
	const trimmed = value.trim();
	if (!trimmed || trimmed.includes("/") || trimmed.includes("\\")) {
		throw new Error("local-host must be a host name or IP address");
	}
	return trimmed;
}

export function validateDataChannels(value: number): number {
	if (!Number.isInteger(value) || value < 1 || value > MAX_DATA_CHANNELS) {
		throw new Error(
			`data-channels must be an integer from 1 to ${MAX_DATA_CHANNELS}`,
		);
	}
	return value;
}

export function parseConfigKey(key: string): keyof StoredConfig {
	switch (key) {
		case "server-url":
			return "serverUrl";
		case "local-host":
			return "localHost";
		case "data-channels":
			return "dataChannels";
		case "qr":
			return "qr";
		default:
			throw new Error(`Unknown config key: ${key}`);
	}
}

function parseConfigValue(
	key: keyof StoredConfig,
	value: string,
): StoredConfig[keyof StoredConfig] {
	switch (key) {
		case "serverUrl":
			return normalizeServerUrl(value);
		case "localHost":
			return validateLocalHost(value);
		case "dataChannels":
			return validateDataChannels(Number(value));
		case "qr":
			if (value !== "true" && value !== "false") {
				throw new Error("qr must be true or false");
			}
			return value === "true";
	}
}

function sanitizeStoredConfig(value: unknown): StoredConfig {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return {};
	}
	const record = value as Record<string, unknown>;
	const config: StoredConfig = {};
	if (typeof record.serverUrl === "string") {
		config.serverUrl = normalizeServerUrl(record.serverUrl);
	}
	if (typeof record.localHost === "string") {
		config.localHost = validateLocalHost(record.localHost);
	}
	if (typeof record.dataChannels === "number") {
		config.dataChannels = validateDataChannels(record.dataChannels);
	}
	if (typeof record.qr === "boolean") {
		config.qr = record.qr;
	}
	return config;
}

function isTruthyEnv(value: string | undefined): boolean {
	return value === "1" || value === "true" || value === "yes";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return typeof error === "object" && error !== null && "code" in error;
}
