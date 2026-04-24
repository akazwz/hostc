import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workersDir = resolve(scriptDir, "..");
const webClientDir = resolve(workersDir, "../web/build/client");
const workersPublicDir = resolve(workersDir, "public");
const outputDir = resolve(workersDir, ".static-assets");

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

await cp(webClientDir, outputDir, {
	recursive: true,
	force: true,
});

for (const entry of ["errors", "404.html"]) {
	await cp(resolve(workersPublicDir, entry), resolve(outputDir, entry), {
		recursive: true,
		force: true,
	});
}