import {
	DocsCard,
	DocsGrid,
	DocsLayout,
	DocsSection,
	type DocsTocItem,
} from "~/components/docs-layout";
import type { Route } from "./+types/docs-limits";

const toc: DocsTocItem[] = [
	{ title: "Current limits", href: "#current-limits" },
	{ title: "Protocol upgrades", href: "#protocol-upgrades" },
	{ title: "Data channels", href: "#data-channels" },
];

export function meta(_args: Route.MetaArgs) {
	return [
		{ title: "Limits | hostc Docs" },
		{
			name: "description",
			content: "Current preview limitations and protocol behavior for hostc.",
		},
	];
}

export default function LimitsDocs() {
	return (
		<DocsLayout
			eyebrow="Limits"
			title="Preview behavior and boundaries."
			description="hostc is in preview. The core tunnel path is usable, but anonymous tunnels intentionally stay simple while the product hardens."
			toc={toc}
		>
			<DocsSection
				id="current-limits"
				title="Current limits"
				description="Anonymous tunnels are temporary and do not yet include accounts, reserved domains, dashboards, or daemon mode."
			>
				<DocsGrid>
					<DocsCard title="Temporary tunnels">
						Anonymous tunnels are ephemeral. If the client connection is lost,
						hostc may create a new tunnel id and public URL.
					</DocsCard>
					<DocsCard title="HTTP and WebSocket">
						hostc supports normal HTTP requests and WebSocket upgrades over the
						same local port.
					</DocsCard>
				</DocsGrid>
			</DocsSection>

			<DocsSection
				id="protocol-upgrades"
				title="Protocol upgrades"
				description="Early protocol versions are intentionally not backward compatible."
			>
				<DocsCard title="Upgrade the CLI or SDK">
					If the server protocol changes, update the CLI or SDK so client and
					server speak the same protocol version.
				</DocsCard>
			</DocsSection>

			<DocsSection
				id="data-channels"
				title="Data channels"
				description="The v4 protocol represents public requests as streams and carries them over binary WebSocket data channels."
			>
				<DocsCard title="Streams over channels">
					Requests are represented as streams and carried over binary data channel
					WebSockets with credit-based flow control.
				</DocsCard>
			</DocsSection>
		</DocsLayout>
	);
}
