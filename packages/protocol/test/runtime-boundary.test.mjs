import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const sourceFiles = collectSourceFiles(new URL("../src/", import.meta.url));
const manifest = readFileSync(
	new URL("../package.json", import.meta.url),
	"utf8",
);

test("@hostc/protocol runtime has no forbidden platform dependencies", () => {
	const forbiddenPatterns = [
		[/from\s+["']node:/, "node built-in imports"],
		[/\bBuffer\b/, "Node Buffer"],
		[/cloudflare:/, "Cloudflare runtime imports"],
		[/\bHono\b/, "Hono"],
		[/\bWebSocket\b/, "WebSocket runtime"],
		[/\bfetch\s*\(/, "fetch runtime"],
	];
	for (const [pattern, label] of forbiddenPatterns) {
		const offender = sourceFiles.find(({ source }) => pattern.test(source));
		assert.equal(
			offender,
			undefined,
			`protocol source must not contain ${label}`,
		);
	}
});

test("@hostc/protocol package exposes only the runtime-agnostic build", () => {
	const parsed = JSON.parse(manifest);
	assert.equal(parsed.name, "@hostc/protocol");
	assert.equal(parsed.type, "module");
	assert.deepEqual(Object.keys(parsed.dependencies ?? {}), []);
});

function collectSourceFiles(directoryUrl) {
	const entries = [];
	for (const dirent of readdirSync(directoryUrl, { withFileTypes: true })) {
		const url = new URL(dirent.name, directoryUrl);
		if (dirent.isDirectory()) {
			entries.push(
				...collectSourceFiles(new URL(`${dirent.name}/`, directoryUrl)),
			);
		} else if (dirent.isFile() && dirent.name.endsWith(".ts")) {
			entries.push({
				path: url.pathname,
				source: readFileSync(url, "utf8"),
			});
		}
	}
	return entries;
}
