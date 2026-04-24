import { ErrorPage } from "~/components/error-page";
import type { Route } from "./+types/error-404";

export function meta({}: Route.MetaArgs) {
	return [
		{ title: "404 Not Found | hostc" },
		{ name: "description", content: "The page you are looking for does not exist." },
	];
}

export default function NotFound() {
	return (
		<ErrorPage
			statusCode="404"
			title="Page Not Found"
			description="The page you are looking for does not exist."
		/>
	);
}
