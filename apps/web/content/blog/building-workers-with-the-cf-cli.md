---
title: Deploying Cloudflare Workers with the cf CLI
description: What we learned running a production Worker and Durable Object on Cloudflare's cf CLI and TypeScript config, and the problems we hit.
date: 2026-11-06
---

hostc's server runs on Cloudflare Workers and Durable Objects. We deploy it with `cf`, Cloudflare's newer command line tool, and describe it in a TypeScript config instead of `wrangler.toml`. `cf` is still in beta, so pin its version. These are our notes on the setup and the problems we hit.

## Writing the config in TypeScript

`cloudflare.config.ts` is TypeScript, so a Worker's types come from its config, and a mistake fails at build time:

```ts
import { bindings, defineConfig, exports } from "cf/config";

import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
	worker: {
		name: "my-worker",
		entrypoint,
		compatibilityDate: "2026-10-30",
		workersDev: false,
		exports: { Room: exports.durableObject({ storage: "sqlite" }) },
		env: { ERRORS: bindings.analyticsEngineDataset({ name: "my_errors" }) },
	},
});
```

`cf workers types` generates the `Env` type from this file, so a binding you declare is typed everywhere.

Check option names in the type definitions. We wrote `dataset:` for that binding out of habit from Wrangler, and the right key is `name`.

## Configuration that depends on the mode

The config can be a function of the mode, which keeps domains out of the code:

```ts
export default defineConfig(({ mode }) => {
	const production = mode === "production";
	// Throw here if a production setting is missing.
	return { worker: {/* ... */} };
});
```

Our deploy command is `cf deploy --mode production`. If a domain is missing it throws, so we never deploy a Worker with no routes.

## Writing out the switches

An option you leave out gets Cloudflare's default, and logging, for example, is on by default. So we write the observability switches in the config. Before moving the compatibility date forward, check what it turns on. For example: after 2026-03, WebSocket `binaryType` defaults to `"blob"`.

## Problems we hit

- `cf dev --host` is not the listen address. It changes the host your Worker sees and drops the port from `request.url`, which broke the URLs we generate. `cf dev` takes only `--mode`, `--host` and `--port`, so pass everything else through the environment.
- `cf` still hands some work to Wrangler, and secrets are set with `wrangler secret put`.
- `pnpm deploy` is a built-in pnpm command, so a package script called `deploy` has to run as `pnpm run deploy`.
- Workers Builds doesn't read `packageManager`, so set `PNPM_VERSION` and `NODE_VERSION` as build variables, or it uses older ones.

## Discovering commands

`cf` has a built-in command search:

```sh
cf cli search "update a build trigger"
```

We change Cloudflare settings from the command line rather than the dashboard.
