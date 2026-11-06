import { defineFileRoute } from "@solidjs/router/fs";
import { For } from "solid-js";

import { Head } from "../../components/Head.tsx";
import { GUIDES } from "../../content/guides.tsx";
import { currentLocale } from "../../i18n.ts";
import { site } from "../../site.ts";

export const route = defineFileRoute("/:lang?", { matchFilters: { lang: ["zh"] } });

const HEAD = {
	en: {
		title: "hostc · Share localhost with a public URL, hot reload included",
		socialTitle: "hostc · Localhost, anywhere",
		description:
			"One command gives your dev server a public HTTPS URL. WebSockets and hot reload work through it. Free, no account.",
	},
	zh: {
		title: "hostc · 免费内网穿透，一条命令分享 localhost",
		socialTitle: "hostc · localhost，随处可达",
		description: "一条命令给你的开发服务器一个公网 HTTPS 地址，支持 WebSocket 和热更新。免费、开源、不用注册。",
	},
};

function English() {
	return (
		<>
			<div class="hero">
				<h1>
					Localhost,
					<br />
					<span>anywhere.</span>
				</h1>
				<p class="lead">
					One command gives your dev server a public HTTPS URL, hot reload included. Free, with no account.
				</p>
				<p class="command">
					<span>$</span>
					<code>npx hostc@latest 3000</code>
				</p>
				<p class="note">
					Needs Node.js 22.1 or later. Run it with <code>--help</code> to see every option.
				</p>
			</div>

			<section>
				<h2>Codex from any browser · Experimental</h2>
				<dl>
					<div>
						<dt>Your Codex, on your phone</dt>
						<dd>
							Keep working with the Codex CLI on your computer from any browser: threads across your folders, approvals,
							diffs and goals.
						</dd>
					</div>
					<div>
						<dt>One command</dt>
						<dd>
							<code>npx hostc@latest codex --qr</code> prints a private link and a QR code to scan.
						</dd>
					</div>
				</dl>
			</section>

			<section>
				<h2>What you get</h2>
				<dl>
					<div>
						<dt>Hot reload works</dt>
						<dd>WebSockets pass straight through, so Vite and Next.js update on every device the moment you save.</dd>
					</div>
					<div>
						<dt>Dev servers just work</dt>
						<dd>Requests arrive addressed to localhost, so dev servers accept them without configuration.</dd>
					</div>
					<div>
						<dt>Everything gets through</dt>
						<dd>Pages, APIs and forms, Server-Sent Events, streaming responses and uploads.</dd>
					</div>
					<div>
						<dt>The URL stays put</dt>
						<dd>After a network drop or a server restart, hostc reconnects and the link you shared keeps working.</dd>
					</div>
					<div>
						<dt>No warning page</dt>
						<dd>Visitors go straight to your app, with nothing to click through.</dd>
					</div>
					<div>
						<dt>Nothing to set up</dt>
						<dd>No sign-up, no auth token, no binary to download. Press Ctrl+C and the URL is gone.</dd>
					</div>
				</dl>
			</section>

			<section>
				<h2>Use it to</h2>
				<ul>
					<li>Share what you built with AI before you deploy it</li>
					<li>Let a teammate or a client click through work in progress</li>
					<li>Debug Stripe, GitHub or Slack webhooks against your machine</li>
					<li>Try your app on a real phone, in step with every save</li>
					<li>Keep working with Codex from your phone when you leave your desk</li>
				</ul>
			</section>

			<section>
				<h2>Guides</h2>
				<ul>
					<For each={GUIDES}>
						{(guide) => (
							<li>
								<a href={guide.path}>{guide.en.title}</a>
							</li>
						)}
					</For>
				</ul>
			</section>

			<section>
				<h2>Good to know</h2>
				<dl>
					<div>
						<dt>The URL is public</dt>
						<dd>Anyone who has it reaches your server. Share only what you mean to, never anything holding secrets.</dd>
					</div>
					<div>
						<dt>A Codex link controls your computer</dt>
						<dd>
							Anyone who has it can read any file and run any command as you, so keep it private. It stops working when
							you press Ctrl+C.
						</dd>
					</div>
					<div>
						<dt>Free and open source</dt>
						<dd>
							Down to the server, which you can <a href={`${site.github}#self-hosting`}>deploy yourself</a>. If hostc
							helps you, <a href={site.github}>a star on GitHub</a> helps others find it.
						</dd>
					</div>
				</dl>
			</section>
		</>
	);
}

function Chinese() {
	return (
		<>
			<div class="hero">
				<h1>
					localhost，
					<br />
					<span>随处可达。</span>
				</h1>
				<p class="lead">一条命令，给你的开发服务器一个公网 HTTPS 地址，热更新也能用。免费，不用注册。</p>
				<p class="command">
					<span>$</span>
					<code>npx hostc@latest 3000</code>
				</p>
				<p class="note">
					需要 Node.js 22.1 或更高版本。运行 <code>--help</code> 可以看到全部选项。
				</p>
			</div>

			<section>
				<h2>在任何浏览器里用 Codex · 实验性</h2>
				<dl>
					<div>
						<dt>手机上的 Codex</dt>
						<dd>在任何浏览器里继续用你电脑上的 Codex CLI：各个目录的会话、批准操作、查看改动和目标。</dd>
					</div>
					<div>
						<dt>一条命令</dt>
						<dd>
							<code>npx hostc@latest codex --qr</code> 会打印一个私密链接和二维码。
						</dd>
					</div>
				</dl>
			</section>

			<section>
				<h2>你能得到什么</h2>
				<dl>
					<div>
						<dt>热更新能用</dt>
						<dd>WebSocket 直接透传，Vite、Next.js 一保存，所有打开的设备都会跟着更新。</dd>
					</div>
					<div>
						<dt>开发服务不用改配置</dt>
						<dd>请求到达时的地址就是 localhost，开发服务直接接受。</dd>
					</div>
					<div>
						<dt>什么都能过</dt>
						<dd>页面、接口、表单、Server-Sent Events、流式响应和上传。</dd>
					</div>
					<div>
						<dt>地址不会变</dt>
						<dd>断网或服务端重启后，hostc 会自己重连，发出去的链接继续有效。</dd>
					</div>
					<div>
						<dt>没有警告页</dt>
						<dd>访客直接看到你的应用，不用先点什么。</dd>
					</div>
					<div>
						<dt>什么都不用配</dt>
						<dd>不用注册，不用 token，不用下载二进制。按 Ctrl+C，地址就没了。</dd>
					</div>
				</dl>
			</section>

			<section>
				<h2>适合用来</h2>
				<ul>
					<li>用 AI 写了个东西，部署之前先分享给别人看</li>
					<li>让同事或客户试用开发中的页面</li>
					<li>用本机的代码调试 Stripe、GitHub、Slack 的 Webhook</li>
					<li>在真机上试你的应用，一保存就更新</li>
					<li>离开电脑后，继续在手机上用 Codex</li>
				</ul>
			</section>

			<section>
				<h2>指南</h2>
				<ul>
					<For each={GUIDES}>
						{(guide) => (
							<li>
								<a href={`/zh${guide.path}`}>{guide.zh.title}</a>
							</li>
						)}
					</For>
				</ul>
			</section>

			<section>
				<h2>需要知道的</h2>
				<dl>
					<div>
						<dt>地址是公开的</dt>
						<dd>拿到地址的人都能访问你的服务。只分享你打算公开的东西，不要暴露任何含有密钥的服务。</dd>
					</div>
					<div>
						<dt>Codex 链接能控制你的电脑</dt>
						<dd>拿到链接的人能以你的身份读取任何文件、运行任何命令，所以请保管好。按 Ctrl+C 后链接失效。</dd>
					</div>
					<div>
						<dt>免费、开源</dt>
						<dd>
							包括服务端，你也可以<a href={`${site.github}#self-hosting`}>自己部署</a>。如果 hostc 帮到了你，
							<a href={site.github}>在 GitHub 上点个 Star</a>能让更多人发现它。
						</dd>
					</div>
				</dl>
			</section>
		</>
	);
}

export default function Home() {
	const locale = currentLocale();
	return (
		<main>
			<Head {...HEAD[locale]} path="/" />
			{locale === "zh" ? <Chinese /> : <English />}
		</main>
	);
}
