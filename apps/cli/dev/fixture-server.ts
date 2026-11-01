// Serves the web client against the scripted Codex, with no tunnel, for work on the interface:
// `pnpm -F @hostc/codex-web fixture` prints a link to open. Not part of the package.
import path from "node:path";

import { Bridge } from "../src/codex/bridge.ts";
import { CodexProcess } from "../src/codex/process.ts";

const assets = path.resolve("dist/client");
const cwd = process.env.FIXTURE_CWD ?? "/Users/you/projects/shop";
const codex = new CodexProcess(process.env.HOSTC_CODEX_BIN as string, ["app-server"], process.cwd());
await codex.request("initialize", {});
const token = "f".repeat(64);
const bridge = new Bridge({ codex, token, assets, cwd, here: process.env.FIXTURE_HERE === "1" });
const target = await bridge.listen();
console.log(`${target.origin}/#${token}`);
