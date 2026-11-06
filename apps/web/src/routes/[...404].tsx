import { Head } from "../components/Head.tsx";

/** Built as 404.html, which Cloudflare serves with a 404 status for any address with no file. */
export default function NotFound() {
	return (
		<main class="missing">
			<Head title="Page not found · hostc" description="This page doesn't exist." />
			<h1>Page not found</h1>
			<p>This page doesn't exist.</p>
			<p>
				<a href="/">Go to the home page</a>
			</p>
		</main>
	);
}
