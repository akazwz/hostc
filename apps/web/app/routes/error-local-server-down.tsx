import { ErrorPage } from "~/components/error-page";
import type { Route } from "./+types/error-local-server-down";

export function meta({}: Route.MetaArgs) {
	return [
		{ title: "Local Server Down | hostc" },
		{
			name: "description",
			content:
				"The hostc CLI is connected, but the local service failed to respond.",
		},
	];
}

export default function LocalServerDown() {
	return (
		<ErrorPage
			statusCode="502"
			statusTone="warning"
			title="Local Server Down"
			description="The hostc CLI is connected, but the local service refused the connection or timed out before responding."
		/>
	);
}