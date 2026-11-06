// Installs a packed CLI in an empty directory, as npm users get it, and runs the end-to-end tests
// against it. Catches what tests on the source tree cannot: a file left out of the package, or a
// dependency that only resolves inside the workspace.
// Usage: pnpm test:package <hostc-x.y.z.tgz>
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tarball = path.resolve(process.argv[2] ?? "");
if (!process.argv[2] || !existsSync(tarball)) {
	throw new Error("Usage: pnpm test:package <hostc-x.y.z.tgz>");
}

const directory = mkdtempSync(path.join(tmpdir(), "hostc-package-"));
try {
	writeFileSync(path.join(directory, "package.json"), "{}");
	execFileSync("npm", ["install", "--no-audit", "--no-fund", tarball], { cwd: directory, stdio: "inherit" });

	const installed = path.join(directory, "node_modules/hostc");
	const entry = path.join(installed, "dist/hostc.mjs");
	const { version } = JSON.parse(readFileSync(path.join(installed, "package.json"), "utf8"));
	const printed = execFileSync(process.execPath, [entry, "--version"], { encoding: "utf8" }).trim();
	if (printed !== version) {
		throw new Error(`The package is ${version}, but the CLI says ${printed}.`);
	}

	execFileSync("pnpm", ["exec", "vitest", "run", "test/e2e.test.ts"], {
		cwd: path.resolve(import.meta.dirname, ".."),
		env: { ...process.env, HOSTC_E2E_CLI: entry },
		stdio: "inherit",
	});
} finally {
	rmSync(directory, { recursive: true, force: true });
}
