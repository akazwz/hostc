import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
	layout("routes/_layout.tsx", [
		index("routes/home.tsx"),
		route("waitlist", "routes/waitlist.tsx"),
	]),
	route("errors/tunnel-not-found", "routes/error-tunnel-not-found.tsx"),
	route("errors/local-server-down", "routes/error-local-server-down.tsx"),
	route("404", "routes/error-404.tsx"),
] satisfies RouteConfig;
