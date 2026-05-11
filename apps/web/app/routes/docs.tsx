import { Link } from "react-router";
import {
	DocsCard,
	DocsCodeBlock,
	DocsGrid,
	DocsLayout,
	DocsSection,
	InlineCode,
	type DocsTocItem,
} from "~/components/docs-layout";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import type { Route } from "./+types/docs";

const toc: DocsTocItem[] = [
	{ title: "Create your first tunnel", href: "#quick-start" },
	{ title: "What happens next", href: "#what-happens-next" },
	{ title: "Where to go next", href: "#next" },
];

const quickstart = `npx hostc@latest 3000`;

export function meta(_args: Route.MetaArgs) {
	return [
		{ title: "Docs | hostc" },
		{
			name: "description",
			content: "Start using hostc with the CLI or client SDK.",
		},
		{ property: "og:type", content: "website" },
		{ property: "og:url", content: "https://hostc.dev/docs" },
		{ property: "og:title", content: "Docs | hostc" },
		{
			property: "og:description",
			content: "Start using hostc with the CLI or client SDK.",
		},
		{ property: "og:image", content: "https://hostc.dev/og-image.png" },
		{ name: "twitter:card", content: "summary_large_image" },
		{ name: "twitter:url", content: "https://hostc.dev/docs" },
		{ name: "twitter:title", content: "Docs | hostc" },
		{
			name: "twitter:description",
			content: "Start using hostc with the CLI or client SDK.",
		},
		{ name: "twitter:image", content: "https://hostc.dev/og-image.png" },
	];
}

export default function Docs() {
	return (
		<DocsLayout
			eyebrow="hostc docs"
			title="Create a public tunnel in one command."
			description="hostc exposes local HTTP and WebSocket services through a temporary public HTTPS URL. Start with the CLI, then use the SDK when you need tunnels inside your own product."
			toc={toc}
		>
			<DocsSection
				id="quick-start"
				title="Create your first tunnel"
				description="Run hostc against a local port. Use @latest while hostc is in preview so the CLI matches the current server protocol."
			>
				<DocsCodeBlock label="Recommended" code={quickstart} />
				<Alert id="what-happens-next">
					<AlertTitle>What happens next?</AlertTitle>
					<AlertDescription>
						hostc creates a temporary tunnel, opens binary data channels, and
						prints a public HTTPS URL that forwards to your local service.
					</AlertDescription>
				</Alert>
			</DocsSection>

			<DocsSection
				id="next"
				title="Where to go next"
				description="Use the CLI for local development workflows. Use the SDK when hostc should be embedded in another app."
			>
				<DocsGrid>
					<DocsCard title="Use the CLI">
						Expose <InlineCode>localhost:3000</InlineCode>, configure a custom
						server URL, show a QR code, or run diagnostics before opening a tunnel.
					</DocsCard>
					<DocsCard title="Embed the SDK">
						Install <InlineCode>@hostc/client</InlineCode> and create tunnels from
						Node.js, desktop apps, daemons, or your own command-line tools.
					</DocsCard>
				</DocsGrid>
				<div className="grid gap-3 sm:grid-cols-2">
					<Button nativeButton={false} render={(props) => <Link {...props} to="/docs/cli" />}>
						CLI docs
					</Button>
					<Button
						variant="outline"
						nativeButton={false}
						render={(props) => <Link {...props} to="/docs/sdk" />}
					>
						SDK docs
					</Button>
				</div>
			</DocsSection>
		</DocsLayout>
	);
}
