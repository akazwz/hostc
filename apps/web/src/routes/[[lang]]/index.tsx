import { defineFileRoute } from "@solidjs/router/fs";
import { For } from "solid-js";

import { Command } from "../../components/Command.tsx";
import { Head } from "../../components/Head.tsx";
import { JsonLd } from "../../components/JsonLd.tsx";
import { Terminal } from "../../components/Terminal.tsx";
import { ALTERNATIVES } from "../../content/alternatives.ts";
import { GUIDES } from "../../content/guides.tsx";
import { currentLocale, localized } from "../../i18n.ts";
import { site } from "../../site.ts";

export const route = defineFileRoute("/:lang?", { matchFilters: { lang: ["zh"] } });

const COPY = {
	en: {
		title: "hostc · Share localhost with a public URL, hot reload included",
		socialTitle: "hostc · Localhost, anywhere",
		description:
			"One command gives your dev server a public HTTPS URL. WebSockets and hot reload work through it. Free, open source, no account.",
		headline: ["Localhost,", "anywhere."],
		lead: "One command turns the app running on your computer into a public link, and the page updates as you save. Free, open source, no account.",
		note: "Needs Node.js 22.1 or later.",
		featuresTitle: "Made for dev servers",
		features: [
			[
				"Updates as you save",
				"Change your code and every open device refreshes by itself. WebSockets pass straight through, so hot reload works.",
			],
			["No config changes", "Requests arrive addressed to localhost, so dev servers accept them as they are."],
			["Everything gets through", "Pages, APIs, forms, Server-Sent Events, streaming responses and uploads."],
			["The URL stays put", "After a network drop or a server restart, hostc reconnects and your link keeps working."],
			["No warning page", "Visitors go straight to your app, with nothing to click through."],
			["Nothing to set up", "No sign-up, no auth token, no binary to download. Press Ctrl+C and the URL is gone."],
		],
		guidesTitle: "Use it to",
		compareTitle: "Coming from another tool?",
		compareAll: "All comparisons",
		codexTitle: "Codex from any browser · Experimental",
		codexBody:
			"Keep working with the Codex CLI on your computer from your phone. The private link can read any file and run any command as you, so keep it to yourself.",
		safetyTitle: "The URL is public",
		safetyBody: "Anyone who has it reaches your server. Share only what you mean to, never anything holding secrets.",
		openTitle: "Free and open source",
		open: [
			"The server is open source too, and you can ",
			"run your own",
			". If hostc helps you, ",
			"a star on GitHub",
			" helps others find it.",
		],
	},
	zh: {
		title: "hostc · 免费内网穿透，一条命令分享 localhost",
		socialTitle: "hostc · localhost，随处可达",
		description:
			"一条命令给你的开发服务器一个公网 HTTPS 地址，支持 WebSocket 和热更新。免费、开源、不用注册的内网穿透工具。",
		headline: ["localhost，", "随处可达。"],
		lead: "一条命令，把你电脑上正在开发的网站变成公网链接，改完代码页面自动更新。免费开源的内网穿透工具，不用注册。",
		note: "需要 Node.js 22.1 或更高版本。",
		featuresTitle: "为开发服务而生",
		features: [
			["保存后自动更新", "改完代码一保存，所有打开的设备都会自动刷新（也就是热更新）。"],
			["不用改配置", "请求到达时的地址就是 localhost，开发服务直接接受。"],
			["什么都能过", "页面、接口、表单、Server-Sent Events、流式响应和上传。"],
			["地址不会变", "断网或服务端重启后，hostc 会自己重连，发出去的链接继续有效。"],
			["没有警告页", "访客直接看到你的应用，不用先点什么。"],
			["什么都不用配", "不用注册，不用 token，不用下载二进制。按 Ctrl+C，地址就没了。"],
		],
		guidesTitle: "适合用来",
		compareTitle: "在用别的工具？",
		compareAll: "全部对比",
		codexTitle: "在任何浏览器里用 Codex · 实验性",
		codexBody: "在手机上继续用你电脑上的 Codex CLI。私密链接能以你的身份读取任何文件、运行任何命令，请只留给自己。",
		safetyTitle: "地址是公开的",
		safetyBody: "拿到地址的人都能访问你的服务。只分享你打算公开的东西，不要暴露任何含有密钥的服务。",
		openTitle: "免费、开源",
		open: [
			"服务端也是开源的，你可以",
			"自己部署",
			"。如果 hostc 帮到了你，",
			"在 GitHub 上点个 Star",
			"能让更多人发现它。",
		],
	},
};

export default function Home() {
	const locale = currentLocale();
	const copy = COPY[locale];
	const to = (path: string) => localized(locale, path);
	return (
		<main>
			<Head title={copy.title} socialTitle={copy.socialTitle} description={copy.description} path="/" />
			<JsonLd
				data={{
					"@type": "SoftwareApplication",
					name: site.name,
					url: site.origin,
					applicationCategory: "DeveloperApplication",
					operatingSystem: "Windows, macOS, Linux",
					description: copy.description,
					license: "https://www.apache.org/licenses/LICENSE-2.0",
					offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
				}}
			/>
			<div class="hero">
				<h1>
					{copy.headline[0]}
					<br />
					<span>{copy.headline[1]}</span>
				</h1>
				<p class="lead">{copy.lead}</p>
				<Command>npx hostc@latest 3000</Command>
				<p class="note">{copy.note}</p>
				<Terminal />
			</div>

			<section>
				<h2>{copy.featuresTitle}</h2>
				<dl>
					<For each={copy.features}>
						{(feature) => (
							<div>
								<dt>{feature[0]}</dt>
								<dd>{feature[1]}</dd>
							</div>
						)}
					</For>
				</dl>
			</section>

			<section>
				<h2>{copy.guidesTitle}</h2>
				<ul class="index">
					<For each={GUIDES}>
						{(guide) => (
							<li>
								<a href={to(guide.path)}>{guide[locale].title}</a>
								<span>{guide[locale].description}</span>
							</li>
						)}
					</For>
				</ul>
			</section>

			<section>
				<h2>{copy.compareTitle}</h2>
				<ul class="chips">
					<For each={ALTERNATIVES}>
						{(item) => (
							<li>
								<a href={to(`/alternatives/${item.slug}`)}>{item.name}</a>
							</li>
						)}
					</For>
					<li>
						<a href={to("/alternatives")}>{copy.compareAll}</a>
					</li>
				</ul>
			</section>

			<section>
				<dl>
					<div>
						<dt>{copy.safetyTitle}</dt>
						<dd>{copy.safetyBody}</dd>
					</div>
					<div>
						<dt>{copy.openTitle}</dt>
						<dd>
							{copy.open[0]}
							<a href={`${site.github}#self-hosting`}>{copy.open[1]}</a>
							{copy.open[2]}
							<a href={site.github}>{copy.open[3]}</a>
							{copy.open[4]}
						</dd>
					</div>
					<div>
						<dt>{copy.codexTitle}</dt>
						<dd>{copy.codexBody}</dd>
					</div>
				</dl>
			</section>
		</main>
	);
}
