---
title: Building a Cloudflare Workers project with cf and cloudflare.config.ts
description: What we learned running a production Worker and Durable Object on Cloudflare's new cf CLI and TypeScript config, including the traps.
date: 2026-11-06
---

hostc's server runs on Cloudflare Workers and Durable Objects. We deploy it with `cf`, Cloudflare's newer command line tool, and describe it in a TypeScript config instead of `wrangler.toml`. `cf` is still in beta, so pin its version. Here is what works, and where it surprised us.

## A config that is a program

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

Read the option types rather than guessing. We wrote `dataset:` for that binding from memory of the Wrangler format, and the right key is `name`.

## Configuration that depends on the mode

The config can be a function of the mode, which keeps domains out of the code:

```ts
export default defineConfig(({ mode }) => {
	const production = mode === "production";
	// Throw here if a production setting is missing.
	return { worker: {/* ... */} };
});
```

Our deploy command is `cf deploy --mode production`. Failing fast when a domain is missing beats deploying a Worker with no routes.

## Set every switch explicitly

An option you leave out gets Cloudflare's default, and that default can change or surprise you. Logging is on unless you turn it off. We write every observability switch out, so reading the config tells you what happens. A compatibility date moves forward on purpose, after reading what it turns on. One such change: after 2026-03, WebSocket `binaryType` defaults to `"blob"`.

## Traps we hit

- **`cf dev --host` is not the listen address.** It changes the host your Worker sees and drops the port from `request.url`, which broke the URLs we generate. `cf dev` takes only `--mode`, `--host` and `--port`, so pass everything else through the environment.
- **Wrangler is still around.** `cf` delegates some work to it, and `wrangler secret put` is how you set a secret today.
- **`pnpm deploy` is a built-in pnpm command.** A package script called `deploy` has to run as `pnpm run deploy`.
- **Workers Builds doesn't read `packageManager`.** Set `PNPM_VERSION` and `NODE_VERSION` as build variables, or it uses older ones.

## Discovering commands

`cf` has a search built in, and it is better than guessing at subcommands:

```sh
cf cli search "update a build trigger"
```

We change all our Cloudflare settings this way, so nothing depends on someone remembering a dashboard click.
