import {
	DocsCard,
	DocsCodeBlock,
	DocsGrid,
	DocsLayout,
	DocsSection,
	type DocsTocItem,
	InlineCode,
} from "~/components/docs-layout";
import type { Route } from "./+types/docs-cli";

const toc: DocsTocItem[] = [
	{ title: "Usage", href: "#usage" },
	{ title: "Configuration", href: "#config" },
	{ title: "Diagnostics", href: "#diagnostics" },
];

const cliUsage = `hostc <port>
hostc 5173 --data-channels 4
hostc 8080 --local-host 127.0.0.1
hostc 3000 --server https://hostc.example.com
hostc 3000 --qr
hostc doctor 5173`;

const cliConfig = `hostc config get
hostc config set server-url https://hostc.example.com
hostc config unset server-url
hostc config path`;

export function meta(_args: Route.MetaArgs) {
	return [
		{ title: "CLI | hostc Docs" },
		{
			name: "description",
			content: "Use the hostc CLI to expose local HTTP and WebSocket services.",
		},
	];
}

export default function CliDocs() {
	return (
		<DocsLayout
			eyebrow="CLI"
			title="Expose localhost from the command line."
			description="The CLI is the easiest way to share a local development server, test webhooks, or preview a Vite/Next.js app with WebSocket and HMR support."
			toc={toc}
		>
			<DocsSection
				id="usage"
				title="Usage"
				description="Run hostc with a local port. The CLI prints a public URL when the tunnel is ready."
			>
				<DocsCodeBlock label="Commands" code={cliUsage} />
			</DocsSection>

			<DocsSection
				id="config"
				title="Configuration"
				description="Use config commands to persist a custom server URL or inspect the config path."
			>
				<DocsCodeBlock label="Config" code={cliConfig} />
				<DocsGrid>
					<DocsCard title="Default server">
						The public CLI defaults to{" "}
						<InlineCode>https://hostc.dev</InlineCode>. Use{" "}
						<InlineCode>--server</InlineCode> or{" "}
						<InlineCode>HOSTC_SERVER_URL</InlineCode> for a self-hosted server.
					</DocsCard>
					<DocsCard title="Keep it current">
						Use <InlineCode>npx hostc@latest</InlineCode> or update global
						installs when the server protocol changes.
					</DocsCard>
				</DocsGrid>
			</DocsSection>

			<DocsSection
				id="diagnostics"
				title="Diagnostics"
				description="Run doctor before opening a tunnel if you want to check that the local port is reachable."
			>
				<DocsCodeBlock label="Doctor" code="hostc doctor 5173" />
			</DocsSection>
		</DocsLayout>
	);
}
