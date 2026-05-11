import {
	index,
	layout,
	type RouteConfig,
	route,
} from "@react-router/dev/routes";

export default [
	layout("routes/_layout.tsx", [index("routes/home.tsx")]),
	layout("routes/docs-layout.tsx", [
		route("docs", "routes/docs.tsx"),
		route("docs/cli", "routes/docs-cli.tsx"),
		route("docs/sdk", "routes/docs-sdk.tsx"),
		route("docs/self-hosting", "routes/docs-self-hosting.tsx"),
		route("docs/limits", "routes/docs-limits.tsx"),
	]),
	route("404", "routes/error-404.tsx"),
] satisfies RouteConfig;
