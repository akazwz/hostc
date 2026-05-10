# AGENT INSTRUCTIONS: hostc Monorepo

## 项目结构

- **Monorepo** 管理，使用 pnpm。所有应用在 `apps/`，共享包在 `packages/`。
- **主要子项目：**
  - `apps/server`：Cloudflare Worker + Durable Object tunnel server，包名 `@hostc/server`。
  - `apps/cli`：Node.js CLI 工具，包名 `hostc`。
  - `packages/protocol`：CLI/server 共用协议包，包名 `@hostc/protocol`。
  - `apps/web`：本轮 server 重构不依赖的 web app。

`docs/refactor/` 是本轮 tunnel 重构的唯一规格来源。实现、测试、bench、load、staging 配置和验收都必须优先对照该目录。

## 常用命令（根目录执行）

| 命令                  | 说明                       |
|----------------------|----------------------------|
| `pnpm install`       | 安装所有 workspace 依赖     |
| `pnpm build`         | 构建 protocol、server、CLI  |
| `pnpm test`          | 运行 protocol、server、CLI 测试 |
| `pnpm lint`          | 运行 Biome 检查             |
| `pnpm dev:server`    | 启动 server 本地 Wrangler dev |
| `pnpm test:e2e:local`| 运行本地 CLI + server E2E   |
| `pnpm test:stress:local` | 运行本地协议压力测试     |
| `pnpm deploy:server:staging` | 部署 staging server 到 Cloudflare |
| `pnpm preflight:staging` | 只读检查 staging Worker/secret/health |
| `pnpm run audit:refactor` | 检查重构最终验收缺口 |
| `pnpm run cleanup:legacy -- --dry-run` | 预览旧 Worker/protocol 目录和临时 Biome 排除清理 |
| `pnpm run cleanup:legacy -- --yes` | 经明确批准后删除旧 Worker/protocol 目录和临时 Biome 排除 |

> 子项目有更多命令，详见各自的 `package.json`。

> 也可以直接使用 pnpm filter 语法，例如 `pnpm -F @hostc/server dev`、`pnpm -F @hostc/protocol bench`、`pnpm -F hostc build`。

## 约定与建议

- 新增共享代码请放在 `packages/`，并通过 pnpm workspace 依赖引用。
- 新 tunnel 协议字段、状态机、limits、credit、codec 必须来自 `@hostc/protocol`，不要在 CLI 或 server 里重复发明。
- `apps/server` 只做 tunnel server；不要重新引入 web/static assets、waitlist API、cli-error API、D1 或 `nodejs_compat`。
- 详细 server 相关约定见 `apps/server/AGENTS.md`。
- staging 使用 `envoq.dev` 和 `*.envoq.dev`；`TOKEN_SECRET` 只能通过 Wrangler secret 管理。
- 详细 CLI 相关约定见 `apps/cli/` 目录。

## 参考文档

- [pnpm workspace](https://pnpm.io/workspaces)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)

---
---
各子项目（如 apps/server、apps/cli）有专属 AGENTS.md，具体开发约定请优先参考对应目录下的说明文件。
如需补充全局约定或有特殊需求，请在本文件补充说明。

## v4 验证矩阵

- `pnpm test:unit`：运行 protocol、client SDK、server、CLI 单测。
- `pnpm test:integration`：运行 client SDK 和 server 的集成类测试。
- `pnpm test:e2e:local`：本地 Wrangler server + CLI + 本地 origin 完整链路。
- `pnpm test:e2e:staging`：staging Worker + CLI + 本地 origin 完整链路。
- `pnpm bench:protocol`：protocol 纯 codec/credit 微基准。
- `pnpm bench:local`：client SDK + 模拟 v4 server 本地 bench，不经过 CLI。
- `pnpm bench:remote`：client SDK + staging server remote bench，不经过 CLI。
- `pnpm stress:protocol`：protocol 纯状态机压力测试。
- `pnpm stress:local`：client SDK + 模拟 v4 server 本地压测，不经过 CLI。
- `pnpm stress:remote`：client SDK + staging server remote 压测，不经过 CLI。
- `pnpm verify:local`：本地完整验收，包含 build、lint、unit test、local bench、local stress。
- `pnpm verify:staging`：staging 完整验收，包含 deploy、preflight、E2E、remote bench、remote stress。

详细测试分层、环境变量和推荐验收顺序见 `docs/refactor/testing.md`。

## Staging 部署流程

- `pnpm staging:deploy`：只部署 `@hostc/server` 的 staging Worker，即 `hostc-server-staging`。
- `pnpm staging:secret`：使用 `apps/server/.env.staging` 批量写入 staging secrets，等价于 `wrangler secret bulk .env.staging --env staging`。
- `pnpm staging:preflight`：只读检查 staging Worker、`TOKEN_SECRET` 和 `/health`。
- `pnpm staging:test`：使用 `https://envoq.dev` 跑 staging E2E、remote bench、remote stress。
- `pnpm staging:verify`：deploy staging 后执行 preflight 和完整 staging 测试矩阵。

staging 详细流程见 `docs/refactor/staging.md`。

- `pnpm staging:deploy:secrets`：使用 `apps/server/.env.staging` 通过 `wrangler deploy --env staging --secrets-file .env.staging` 部署 staging 代码和 secrets。
- `pnpm staging:init`：首次初始化 staging 的推荐入口，等价于 `staging:deploy:secrets` 后执行 `staging:preflight`。
- `apps/server/.env.staging` 不允许提交；只提交 `apps/server/.env.staging.example`。

- `pnpm test:e2e:cli`：本地模拟 v4 server + 真实 CLI 进程，验证 CLI ready 输出、HTTP proxy、stdin reconnect 和 SIGTERM 退出。
