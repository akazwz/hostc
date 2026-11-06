import { readFileSync } from "node:fs";
import path from "node:path";

import { MAX_STREAMS } from "@hostc/protocol";
import { describe, expect, it } from "vitest";

import { USAGE } from "../src/args.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

// People and agents read these instead of --help, and nothing else keeps them in step with the CLI.
describe.each(["README.md", "README.zh-CN.md", "apps/cli/README.md"])("%s", (file) => {
	const text = read(file);

	it.each(USAGE.match(/--[a-z]+/g) ?? [])("documents %s", (flag) => {
		expect(text).toContain(flag);
	});
});

describe.each(["README.md", "README.zh-CN.md", "apps/web/public/llms.txt", "apps/web/src/content/alternatives.ts"])(
	"%s",
	(file) => {
		it("states the stream limit", () => {
			expect(read(file)).toContain(String(MAX_STREAMS));
		});
	},
);
