import { ErrorPage } from "~/components/error-page";
import type { Route } from "./+types/error-tunnel-not-found";

export function meta({}: Route.MetaArgs) {
	return [
		{ title: "Tunnel Not Found | hostc" },
		{
			name: "description",
			content:
				"The requested tunnel either does not exist or the local service has disconnected.",
		},
	];
}

export default function TunnelNotFound() {
	return (
		<ErrorPage
			statusCode="404"
			title="Tunnel Not Found"
			description="The requested tunnel either does not exist or the local service has disconnected."
		/>
	);
}