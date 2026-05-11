import {
	DocsCodeBlock,
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
import type { Route } from "./+types/docs-sdk";

const toc: DocsTocItem[] = [
	{ title: "Install", href: "#install" },
	{ title: "Node.js integration", href: "#example" },
	{ title: "Protocol boundary", href: "#protocol-boundary" },
];

const sdkInstall = `npm install @hostc/client`;

const sdkUsage = `import { HostcClient, localOriginAdapter } from "@hostc/client";

const client = new HostcClient({
  serverUrl: "https://hostc.example.com",
  upstream: localOriginAdapter({
    origin: "http://127.0.0.1:3000",
  }),
});

client.on("ready", ({ publicUrl }) => {
  console.log(\`Tunnel ready: \${publicUrl}\`);
});

client.on("reconnecting", ({ reason }) => {
  console.log(\`Reconnecting: \${reason}\`);
});

await client.start();`;

export function meta(_args: Route.MetaArgs) {
	return [
		{ title: "Client SDK | hostc Docs" },
		{
			name: "description",
			content: "Embed hostc tunnels with the @hostc/client SDK.",
		},
	];
}

export default function SdkDocs() {
	return (
		<DocsLayout
			eyebrow="Client SDK"
			title="Embed hostc in your own product."
			description="Use @hostc/client when tunnels need to live inside a desktop app, daemon, custom CLI, or Node.js runtime."
			toc={toc}
		>
			<DocsSection
				id="install"
				title="Install"
				description="The SDK is the public integration boundary. Application code only needs @hostc/client."
			>
				<DocsCodeBlock label="npm" code={sdkInstall} />
			</DocsSection>

			<DocsSection
				id="example"
				title="Node.js integration"
				description="Create a client, point it at your hostc server, and forward traffic to a local origin."
			>
				<DocsCodeBlock label="Example" code={sdkUsage} language="ts" />
			</DocsSection>

			<DocsSection
				id="protocol-boundary"
				title="Protocol boundary"
				description="The SDK uses the v4 protocol internally, but protocol frames and stream internals are not public SDK API."
			>
				<Alert>
					<AlertTitle>Use the SDK, not the protocol package.</AlertTitle>
					<AlertDescription>
						<InlineCode>@hostc/protocol</InlineCode> is the internal wire-contract
						source of truth. It is bundled into{" "}
						<InlineCode>@hostc/client</InlineCode> so your app only needs one
						public dependency.
					</AlertDescription>
				</Alert>
			</DocsSection>
		</DocsLayout>
	);
}
