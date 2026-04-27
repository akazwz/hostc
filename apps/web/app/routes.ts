import {
	index,
	layout,
	type RouteConfig,
	route,
} from "@react-router/dev/routes";

export default [
	layout("routes/_layout.tsx", [
		index("routes/home.tsx"),
		route("waitlist", "routes/waitlist.tsx"),
	]),
	route("404", "routes/error-404.tsx"),
] satisfies RouteConfig;
