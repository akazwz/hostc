import {
	DocsCard,
	DocsCodeBlock,
	DocsGrid,
	DocsLayout,
	DocsSection,
	InlineCode,
	type DocsTocItem,
} from "~/components/docs-layout";
import type { Route } from "./+types/docs-self-hosting";

const toc: DocsTocItem[] = [
	{ title: "Server URL", href: "#server-url" },
	{ title: "CLI configuration", href: "#cli-configuration" },
	{ title: "Hosted vs self-hosted", href: "#hosted-vs-self-hosted" },
];

const persistentConfig = `hostc config set server-url https://hostc.example.com
hostc config get server-url
hostc config unset server-url`;

const envUsage = `HOSTC_SERVER_URL=https://hostc.example.com npx hostc@latest 3000
HOSTC_DEBUG=1 npx hostc@latest 3000
HOSTC_DISABLE_UPDATE_CHECK=1 npx hostc@latest 3000`;

export function meta(_args: Route.MetaArgs) {
	return [
		{ title: "Self-hosting | hostc Docs" },
		{
			name: "description",
			content: "Configure hostc to use hostc.dev or your own tunnel server.",
		},
	];
}

export default function SelfHostingDocs() {
	return (
		<DocsLayout
			eyebrow="Self-hosting"
			title="Use hostc.dev or your own server."
			description="hostc can use the hosted service or a server you deploy yourself. The CLI and SDK both accept a server URL."
			toc={toc}
		>
			<DocsSection
				id="server-url"
				title="Server URL"
				description="Point the CLI or SDK at the base URL of your hostc server."
			>
				<DocsGrid>
					<DocsCard title="Hosted">
						Use <InlineCode>https://hostc.dev</InlineCode> for the hosted
						service.
					</DocsCard>
					<DocsCard title="Self-hosted">
						Use your own Worker origin, for example{" "}
						<InlineCode>https://hostc.example.com</InlineCode>.
					</DocsCard>
				</DocsGrid>
			</DocsSection>

			<DocsSection
				id="cli-configuration"
				title="CLI configuration"
				description="Use config for a persistent self-hosted server URL. Use environment variables for one-off local, staging, or temporary overrides."
			>
				<div className="grid gap-6 lg:grid-cols-2">
					<DocsCodeBlock
						label="Persistent config"
						code={persistentConfig}
					/>
					<DocsCodeBlock label="One-off environment" code={envUsage} />
				</div>
			</DocsSection>

			<DocsSection
				id="hosted-vs-self-hosted"
				title="Hosted vs self-hosted"
				description="The protocol is the same. Only the server URL changes."
			>
				<DocsGrid>
					<DocsCard title="CLI">
						For everyday self-hosted usage, prefer{" "}
						<InlineCode>hostc config set server-url</InlineCode>. Use{" "}
						<InlineCode>--server</InlineCode> or{" "}
						<InlineCode>HOSTC_SERVER_URL</InlineCode> for temporary overrides.
					</DocsCard>
					<DocsCard title="SDK">
						Set the <InlineCode>serverUrl</InlineCode> option when creating a
						<InlineCode>HostcClient</InlineCode>.
					</DocsCard>
				</DocsGrid>
			</DocsSection>
		</DocsLayout>
	);
}
