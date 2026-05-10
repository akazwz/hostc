# v4 refactor acceptance checklist

## Required package boundaries

- `@hostc/protocol` is the only protocol source of truth.
- `@hostc/client` owns SDK transport orchestration and upstream adapters.
- `@hostc/server` owns Worker and Durable Object server behavior.
- `hostc` CLI stays a thin product layer over `@hostc/client`.

## Required behavior

- Anonymous creation uses `POST /api/tunnels/ephemeral`.
- A reconnect creates a new tunnel/client connection.
- Data channels carry binary v4 frames only.
- Each public request maps to one stream and stays pinned to one data channel.
- Stream-level failures close only the affected stream when possible.
- Data-channel/protocol-level failures invalidate the current client connection.
- Oversized WebSocket messages are dropped/closed according to protocol limits.

## Required validation before release

- `pnpm build`
- `pnpm test`
- `pnpm lint`
- `pnpm run audit:refactor`
- `pnpm test:e2e:local`
- `pnpm test:stress:local`
- `pnpm deploy:server:staging`
- `pnpm preflight:staging`
- `pnpm test:e2e:staging`
- `pnpm load:staging`
