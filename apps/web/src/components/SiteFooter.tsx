import { site } from "../site.ts";

export function SiteFooter() {
	return (
		<footer>
			<span>© 2026 hostc · Apache-2.0</span>
			<nav aria-label="Footer">
				<a href="/llms.txt">llms.txt</a>
				<a href={`${site.github}#hostc-vs-cloudflare-tunnel`}>vs Cloudflare Tunnel</a>
				<a href={site.github}>Star on GitHub</a>
			</nav>
		</footer>
	);
}
