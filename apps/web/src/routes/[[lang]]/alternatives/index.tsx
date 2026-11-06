import { defineFileRoute } from "@solidjs/router/fs";

import { Crumbs } from "../../../components/Crumbs.tsx";
import { Head } from "../../../components/Head.tsx";
import { ALTERNATIVES } from "../../../content/alternatives.ts";
import { currentLocale, localized } from "../../../i18n.ts";
import { Lead, Page, PageTitle } from "../../../ui/Page.tsx";
import { PageList } from "../../../ui/PageList.tsx";

export const route = defineFileRoute("/:lang?/alternatives", { matchFilters: { lang: ["zh"] } });

const COPY = {
	en: {
		title: "Alternatives to ngrok, Cloudflare Tunnel and others",
		lead: "How hostc compares with other ways to give localhost a public URL, and when each of them is the better choice.",
		description:
			"hostc compared with ngrok, Cloudflare Tunnel, localtunnel, frp, Tailscale Funnel and Microsoft dev tunnels.",
		vs: "hostc vs",
	},
	zh: {
		title: "ngrok、Cloudflare Tunnel 等内网穿透工具的替代方案",
		lead: "hostc 和其他内网穿透工具的对比，以及各自更适合什么场景。",
		description: "hostc 与 ngrok、Cloudflare Tunnel、localtunnel、frp、Tailscale Funnel、微软 dev tunnels 的对比。",
		vs: "hostc 对比",
	},
};

export default function Alternatives() {
	const locale = currentLocale();
	const copy = COPY[locale];
	return (
		<Page>
			<Head title={`${copy.title} · hostc`} description={copy.description} path="/alternatives" />
			<Crumbs />
			<PageTitle>{copy.title}</PageTitle>
			<Lead>{copy.lead}</Lead>
			<PageList
				items={ALTERNATIVES.map((item) => ({
					href: localized(locale, `/alternatives/${item.slug}`),
					title: `${copy.vs} ${item.name}`,
					detail: item.summary[locale],
				}))}
			/>
		</Page>
	);
}
