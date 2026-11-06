---
title: 用 cf 和 cloudflare.config.ts 构建 Cloudflare Workers 项目
description: 用 Cloudflare 新的 cf 命令行和 TypeScript 配置运行生产环境 Worker 与 Durable Object 的经验，以及踩过的坑。
date: 2026-11-06
---

hostc 的服务端运行在 Cloudflare Workers 和 Durable Objects 上。我们用 Cloudflare 较新的命令行工具 `cf` 部署，用 TypeScript 配置代替 `wrangler.toml`。`cf` 还在 beta，记得固定版本。下面是好用的地方，和让我们意外的地方。

## 配置就是程序

`cloudflare.config.ts` 是 TypeScript，所以 Worker 的类型来自配置，写错了在构建时就会报错：

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

`cf workers types` 会根据这个文件生成 `Env` 类型，声明的绑定在哪里用都有类型。

要读选项的类型定义，不要猜。我们凭 Wrangler 格式的记忆给这个绑定写了 `dataset:`，正确的键其实是 `name`。

## 随模式变化的配置

配置可以是模式的函数，这样域名就不用写死在代码里：

```ts
export default defineConfig(({ mode }) => {
	const production = mode === "production";
	// 缺少生产环境配置时在这里抛错。
	return { worker: {/* ... */} };
});
```

我们的部署命令是 `cf deploy --mode production`。缺域名时立刻失败，好过部署一个没有路由的 Worker。

## 每个开关都显式写出来

省略的选项会用 Cloudflare 的默认值，而默认值可能会变，也可能出乎意料。比如日志默认是开的，除非你关掉。我们把可观测性的每个开关都写出来，读配置就知道会发生什么。兼容性日期要有意识地往前挪，先看清它开启了什么。比如 2026-03 之后，WebSocket 的 `binaryType` 默认变成了 `"blob"`。

## 踩过的坑

- **`cf dev --host` 不是监听地址。** 它改变的是 Worker 看到的 host，还会去掉 `request.url` 里的端口，弄坏了我们生成的地址。`cf dev` 只接受 `--mode`、`--host` 和 `--port`，其他都要通过环境变量传。
- **Wrangler 还在。** `cf` 把部分工作交给它，目前设置密钥也要用 `wrangler secret put`。
- **`pnpm deploy` 是 pnpm 内置命令。** 名为 `deploy` 的脚本要用 `pnpm run deploy` 运行。
- **Workers Builds 不读 `packageManager`。** 要把 `PNPM_VERSION` 和 `NODE_VERSION` 设为构建变量，否则用的是旧版本。

## 查命令

`cf` 自带搜索，比猜子命令好用：

```sh
cf cli search "update a build trigger"
```

我们所有 Cloudflare 设置都这样改，不依赖谁还记得在控制台点过什么。
