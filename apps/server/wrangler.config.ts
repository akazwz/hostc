import { defineWranglerConfig } from "wrangler/experimental-config";

export default defineWranglerConfig({
	uploadSourceMaps: true,
	// Types are generated explicitly with `cf workers types`.
	types: { generate: false },
});
