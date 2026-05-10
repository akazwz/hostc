import chalk from "chalk";

type LatestPackage = {
	version?: string;
};

export function maybePrintUpdateNotice(
	currentVersion: string,
	options: { disabled?: boolean; fetcher?: typeof fetch } = {},
): void {
	if (options.disabled || !process.stderr.isTTY) {
		return;
	}
	void checkLatestVersion(currentVersion, options.fetcher ?? fetch)
		.then((latest) => {
			if (!latest) {
				return;
			}
			console.error(
				`${chalk.cyan("Update")}   hostc ${currentVersion} -> ${latest}`,
			);
			console.error(chalk.dim("         npm i -g hostc@latest"));
		})
		.catch(() => undefined);
}

export async function checkLatestVersion(
	currentVersion: string,
	fetcher: typeof fetch = fetch,
): Promise<string | null> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 1500);
	timeout.unref?.();
	try {
		const response = await fetcher("https://registry.npmjs.org/hostc/latest", {
			signal: controller.signal,
			headers: { accept: "application/json" },
		});
		if (!response.ok) {
			return null;
		}
		const body = (await response.json()) as LatestPackage;
		return body.version && compareVersions(body.version, currentVersion) > 0
			? body.version
			: null;
	} finally {
		clearTimeout(timeout);
	}
}

export function compareVersions(left: string, right: string): number {
	const leftParts = parseVersion(left);
	const rightParts = parseVersion(right);
	for (let index = 0; index < 3; index += 1) {
		const diff = leftParts[index] - rightParts[index];
		if (diff !== 0) {
			return diff;
		}
	}
	return 0;
}

function parseVersion(value: string): [number, number, number] {
	const [major = "0", minor = "0", patch = "0"] = value.split(".");
	return [Number(major) || 0, Number(minor) || 0, Number(patch) || 0];
}
