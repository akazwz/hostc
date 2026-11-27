import { MAX_STREAMS } from "@hostc/protocol";

export type PlanTier = "free" | "pro";

/**
 * Per-tunnel resource limits enforced inside the Durable Object.
 * `null` disables a limit. Stored in `TUNNEL_KEY` at `init()` time so the data
 * plane never needs a database lookup and remains hibernation-safe.
 */
export type TunnelLimits = {
	/** Maximum wall-clock lifetime of a tunnel from creation. */
	maxDurationMs: number | null;
	/** Concurrent in-flight HTTP requests plus open and pending public WebSockets. */
	maxStreams: number;
	/** Maximum requests queued waiting for a free stream. */
	maxWaiting: number;
	/** Maximum total streams (HTTP requests + public WebSocket handshakes) over the tunnel's lifetime. */
	maxRequests: number | null;
	/** Maximum total transferred payload bytes (HTTP bodies + public WebSockets, both directions). */
	maxBytes: number | null;
	/** Hard cap on total WebSocket frames waking the Durable Object (client + public). */
	maxTotalFrames: number | null;
	/** Concurrent open and pending public WebSockets. */
	maxPublicWebSockets: number;
	/** Total public WebSocket connections opened over the tunnel's lifetime. */
	maxPublicWebSocketConnections: number | null;
	/** Total public WebSocket messages (both directions) over the tunnel's lifetime. */
	maxPublicWebSocketMessages: number | null;
	/** Total public WebSocket payload bytes (both directions) over the tunnel's lifetime. */
	maxPublicWebSocketBytes: number | null;
	/** Sustained public WebSocket message burst cap per 10-second sliding window (both directions). */
	maxPublicWebSocketMessagesPer10s: number | null;
};

/** Edge rate limit on `POST /api/tunnels` per client IP. Imported by `cloudflare.config.ts`. */
export const CREATE_RATE_LIMIT = {
	limit: 10,
	period: 60,
} as const;

const HOUR_MS = 60 * 60_000;
const GIB = 1024 * 1024 * 1024;

/**
 * Generous for local development (including multi-GB web apps, Vite/Next.js HMR, and `hostc codex`),
 * while strictly cutting off public proxy / VPN-over-WebSocket relays before they can burn DO quota.
 */
export const FREE_LIMITS: TunnelLimits = {
	maxDurationMs: 12 * HOUR_MS,
	maxStreams: 128,
	maxWaiting: 256,
	maxRequests: 100_000,
	// Cloudflare Workers/DO egress is unbilled; total DO cost is already bounded by maxRequests + maxTotalFrames.
	maxBytes: null,
	maxTotalFrames: 500_000,
	maxPublicWebSockets: 16,
	maxPublicWebSocketConnections: 300,
	maxPublicWebSocketMessages: 50_000,
	maxPublicWebSocketBytes: 1 * GIB,
	maxPublicWebSocketMessagesPer10s: 2_000,
};

/** Reserved for authenticated paid tunnels once billing is connected. */
export const PRO_LIMITS: TunnelLimits = {
	maxDurationMs: null,
	maxStreams: MAX_STREAMS,
	maxWaiting: 4 * MAX_STREAMS,
	maxRequests: null,
	maxBytes: null,
	maxTotalFrames: null,
	maxPublicWebSockets: 64,
	maxPublicWebSocketConnections: null,
	maxPublicWebSocketMessages: null,
	maxPublicWebSocketBytes: null,
	maxPublicWebSocketMessagesPer10s: 20_000,
};

const REQUIRED_NUMBER_KEYS = ["maxStreams", "maxWaiting", "maxPublicWebSockets"] as const;
const NULLABLE_NUMBER_KEYS = [
	"maxDurationMs",
	"maxRequests",
	"maxBytes",
	"maxTotalFrames",
	"maxPublicWebSocketConnections",
	"maxPublicWebSocketMessages",
	"maxPublicWebSocketBytes",
	"maxPublicWebSocketMessagesPer10s",
] as const;

export function limitsForTier(tier: PlanTier): TunnelLimits {
	return tier === "pro" ? PRO_LIMITS : FREE_LIMITS;
}

/**
 * Resolves effective limits for a tier, applying an optional JSON override from `env.TUNNEL_LIMITS`
 * so self-hosted deployments can adjust or disable limits without modifying source code.
 */
export function resolveTunnelLimits(tier: PlanTier, overrideJson?: string): TunnelLimits {
	const base: TunnelLimits = { ...limitsForTier(tier) };
	const raw = overrideJson?.trim();
	if (!raw) {
		return base;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return base;
	}
	if (typeof parsed !== "object" || parsed === null) {
		return base;
	}
	const record = parsed as Record<string, unknown>;
	for (const key of REQUIRED_NUMBER_KEYS) {
		const value = record[key];
		if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
			base[key] = Math.floor(value);
		}
	}
	for (const key of NULLABLE_NUMBER_KEYS) {
		const value = record[key];
		if (value === null) {
			base[key] = null;
		} else if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
			base[key] = Math.floor(value);
		}
	}
	return base;
}
