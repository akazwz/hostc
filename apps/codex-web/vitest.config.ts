import { defineConfig } from "vitest/config";

// The engine is plain TypeScript: its tests need neither the Solid nor the StyleX plugin.
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
