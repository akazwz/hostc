import {
	isRouteErrorResponse,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
} from "react-router";
import notoSansLatinWghtNormal from "@fontsource-variable/noto-sans/files/noto-sans-latin-wght-normal.woff2";
import playfairDisplayLatinWghtNormal from "@fontsource-variable/playfair-display/files/playfair-display-latin-wght-normal.woff2";

import type { Route } from "./+types/root";
import "./app.css";

export const links: Route.LinksFunction = () => [
	{
		rel: "preload",
		href: notoSansLatinWghtNormal,
		as: "font",
		type: "font/woff2",
		crossOrigin: "anonymous",
	},
	{
		rel: "preload",
		href: playfairDisplayLatinWghtNormal,
		as: "font",
		type: "font/woff2",
		crossOrigin: "anonymous",
	},
	{ rel: "icon", href: "/favicon.ico", sizes: "32x32" },
	{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
];

export function Layout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" className="dark">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<Meta />
				<Links />
			</head>
			<body>
				{children}
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

export default function App() {
	return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	let message = "Oops!";
	let details = "An unexpected error occurred.";
	let stack: string | undefined;

	if (isRouteErrorResponse(error)) {
		message = error.status === 404 ? "404" : "Error";
		details =
			error.status === 404
				? "The requested page could not be found."
				: error.statusText || details;
	} else if (import.meta.env.DEV && error && error instanceof Error) {
		details = error.message;
		stack = error.stack;
	}

	return (
		<main className="pt-16 p-4 container mx-auto">
			<h1>{message}</h1>
			<p>{details}</p>
			{stack && (
				<pre className="w-full p-4 overflow-x-auto">
					<code>{stack}</code>
				</pre>
			)}
		</main>
	);
}
