import type { JSX } from "@solidjs/web";

import type { Locale } from "../i18n.ts";

type Copy = { title: string; lead: string; description: string; body: JSX.Element };
export type GuideContent = { path: string } & Record<Locale, Copy>;

function Command(props: { children: string }) {
	return (
		<p class="command">
			<span>$</span>
			<code>{props.children}</code>
		</p>
	);
}

export const WEBHOOKS: GuideContent = {
	path: "/test-webhooks-locally",
	en: {
		title: "Test webhooks on localhost",
		lead: "Stripe, GitHub and Slack can only call a public URL. hostc gives the server on your machine one, so webhooks reach the code you are editing.",
		description:
			"Receive Stripe, GitHub and Slack webhooks on your local server with one command. Free, with no account.",
		body: (
			<>
				<h2>How to do it</h2>
				<ol>
					<li>
						<p>Start your server, then point hostc at its port:</p>
						<Command>npx hostc@latest 3000</Command>
					</li>
					<li>
						Add the printed URL plus your route to the provider, for example{" "}
						<code>https://k7m2xq9pa4dn.hostc.app/webhooks/stripe</code>.
					</li>
					<li>Trigger an event. Each request shows up in your terminal with its status and duration.</li>
				</ol>
				<h2>Good to know</h2>
				<ul>
					<li>
						Signature checks work: the body and headers such as Stripe-Signature reach your server as they were sent.
					</li>
					<li>
						Every start of hostc gives a new URL, so update the provider when you restart it. Network drops keep the URL
						for up to 10 minutes.
					</li>
					<li>hostc waits up to 2 minutes for your server, but providers often give up sooner and retry.</li>
					<li>Anyone with the URL can call it, so verify signatures as you would in production.</li>
				</ul>
			</>
		),
	},
	zh: {
		title: "在本地调试 Webhook",
		lead: "Stripe、GitHub、Slack 只能调用公网地址。hostc 给你电脑上的服务一个公网地址，让 Webhook 直接打到你正在改的代码上。",
		description: "一条命令，在本地服务上接收 Stripe、GitHub、Slack 的 Webhook。免费，不用注册。",
		body: (
			<>
				<h2>怎么做</h2>
				<ol>
					<li>
						<p>启动你的服务，再让 hostc 指向它的端口：</p>
						<Command>npx hostc@latest 3000</Command>
					</li>
					<li>
						把打印出来的地址加上你的路由，填到服务商的后台，例如{" "}
						<code>https://k7m2xq9pa4dn.hostc.app/webhooks/stripe</code>。
					</li>
					<li>触发一个事件。每个请求都会出现在终端里，带状态码和耗时。</li>
				</ol>
				<h2>需要知道的</h2>
				<ul>
					<li>签名校验可以正常工作：请求体和 Stripe-Signature 这类请求头会原样到达你的服务。</li>
					<li>每次启动 hostc 都会换新地址，重启后要去服务商后台更新。断网时地址最多保留 10 分钟。</li>
					<li>hostc 最多等你的服务 2 分钟，但服务商通常更早放弃并重试。</li>
					<li>拿到地址的人都能调用它，所以要像生产环境一样校验签名。</li>
				</ul>
			</>
		),
	},
};

export const PHONE: GuideContent = {
	path: "/test-localhost-on-phone",
	en: {
		title: "Test localhost on a real phone",
		lead: "Open the site on your computer from your phone, over HTTPS, on any network. Hot reload keeps working, so the phone updates when you save.",
		description:
			"Open your local dev server on a real phone with a QR code. HTTPS, hot reload and any network. Free, with no account.",
		body: (
			<>
				<h2>How to do it</h2>
				<ol>
					<li>
						<p>Start your dev server, then run hostc with a QR code:</p>
						<Command>npx hostc@latest 3000 --qr</Command>
					</li>
					<li>Scan the code with your phone.</li>
					<li>Edit a file. The page on your phone updates with the save.</li>
				</ol>
				<h2>Why not the local IP address</h2>
				<ul>
					<li>The phone can be on mobile data. It doesn't have to share your Wi-Fi.</li>
					<li>
						The page is HTTPS, so browser features that need a secure context work, such as the camera, service workers
						and geolocation. They don't work on <code>http://192.168.x.x</code>.
					</li>
					<li>Your dev server can keep listening on localhost.</li>
				</ul>
				<h2>Good to know</h2>
				<ul>
					<li>Anyone with the URL reaches your server, so don't post it anywhere public.</li>
				</ul>
			</>
		),
	},
	zh: {
		title: "在手机上调试 localhost",
		lead: "用手机打开你电脑上的网站，走 HTTPS，什么网络都行。热更新照常工作，一保存手机就跟着更新。",
		description: "扫二维码，在真机上打开本地开发服务。支持 HTTPS、热更新，不限网络。免费，不用注册。",
		body: (
			<>
				<h2>怎么做</h2>
				<ol>
					<li>
						<p>启动开发服务，再带上二维码运行 hostc：</p>
						<Command>npx hostc@latest 3000 --qr</Command>
					</li>
					<li>用手机扫码。</li>
					<li>改一个文件，手机上的页面会跟着保存更新。</li>
				</ol>
				<h2>为什么不用局域网 IP</h2>
				<ul>
					<li>手机可以用流量，不必和电脑连同一个 Wi-Fi。</li>
					<li>
						页面是 HTTPS，所以摄像头、Service Worker、定位这些要求安全上下文的功能都能用。在{" "}
						<code>http://192.168.x.x</code> 上用不了。
					</li>
					<li>开发服务继续监听 localhost 就行。</li>
				</ul>
				<h2>需要知道的</h2>
				<ul>
					<li>拿到地址的人都能访问你的服务，不要发到公开的地方。</li>
				</ul>
			</>
		),
	},
};

export const DEV_SERVERS: GuideContent = {
	path: "/share-vite-nextjs-dev-server",
	en: {
		title: "Share a Vite or Next.js dev server",
		lead: "Send someone a link to your running dev server, with no config changes. Hot reload reaches them too.",
		description:
			"Share a Vite or Next.js dev server through a public URL, with hot reload and no allowedHosts or allowedDevOrigins changes.",
		body: (
			<>
				<h2>How to do it</h2>
				<Command>npx hostc@latest 5173</Command>
				<p>Use your dev server's port: Vite defaults to 5173, Next.js to 3000. Then send the printed URL.</p>
				<h2>Why it needs no configuration</h2>
				<p>
					Dev servers refuse requests from names they don't know. Vite has <code>server.allowedHosts</code> and Next.js
					has <code>allowedDevOrigins</code>, and most tunnels make you add their domain to one of them.
				</p>
				<p>
					hostc rewrites the <code>Host</code>, <code>Origin</code> and <code>Referer</code> headers on the way in, so
					to your dev server each request looks local. Redirects to localhost are rewritten back to the public URL.
					WebSockets pass straight through, which is what hot reload runs on.
				</p>
				<h2>Good to know</h2>
				<ul>
					<li>
						Your app sees localhost as its host. Links it builds from the request, such as OAuth callback URLs, point at
						localhost.
					</li>
					<li>Anyone with the URL reaches your server, so stop hostc with Ctrl+C when you are done.</li>
				</ul>
			</>
		),
	},
	zh: {
		title: "分享 Vite 或 Next.js 开发服务",
		lead: "给别人发一个链接，打开就是你正在跑的开发服务，不用改配置，热更新也能到对方那里。",
		description: "通过公网地址分享 Vite、Next.js 开发服务，支持热更新，不用改 allowedHosts 或 allowedDevOrigins。",
		body: (
			<>
				<h2>怎么做</h2>
				<Command>npx hostc@latest 5173</Command>
				<p>换成你的开发服务端口：Vite 默认 5173，Next.js 默认 3000。然后把打印出来的地址发给对方。</p>
				<h2>为什么不用配置</h2>
				<p>
					开发服务会拒绝来自陌生域名的请求。Vite 有 <code>server.allowedHosts</code>，Next.js 有{" "}
					<code>allowedDevOrigins</code>，大多数隧道都要你把它们的域名加进去。
				</p>
				<p>
					hostc 会改写进来的 <code>Host</code>、<code>Origin</code> 和 <code>Referer</code>
					请求头，在开发服务看来，每个请求都来自本地。指向 localhost 的跳转会改写回公网地址。WebSocket
					直接透传，热更新靠的就是它。
				</p>
				<h2>需要知道的</h2>
				<ul>
					<li>你的应用看到的 host 是 localhost。它根据请求拼出来的链接（比如 OAuth 回调地址）会指向 localhost。</li>
					<li>拿到地址的人都能访问你的服务，用完按 Ctrl+C 停掉。</li>
				</ul>
			</>
		),
	},
};

const COMPARED_ON = "2026-11-06";

export const COMPARISON: GuideContent = {
	path: "/ngrok-alternative",
	en: {
		title: "hostc vs ngrok and Cloudflare Tunnel",
		lead: "hostc does one job: sharing a dev server for a while, with nothing to sign up for. The others do more, and for some work you'll want them.",
		description:
			"How hostc compares with ngrok's free plan and Cloudflare Tunnel: accounts, URLs, warning pages and limits.",
		body: (
			<>
				<div class="table">
					<table>
						<thead>
							<tr>
								<th />
								<th>hostc</th>
								<th>ngrok free plan</th>
								<th>Cloudflare Quick Tunnel</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<th>Install</th>
								<td>Node.js only</td>
								<td>ngrok agent</td>
								<td>cloudflared</td>
							</tr>
							<tr>
								<th>Account</th>
								<td>None</td>
								<td>Required</td>
								<td>None</td>
							</tr>
							<tr>
								<th>URL</th>
								<td>New on every start</td>
								<td>One fixed dev domain</td>
								<td>New on every start</td>
							</tr>
							<tr>
								<th>Page before your app</th>
								<td>None</td>
								<td>Warning page for browsers</td>
								<td>None</td>
							</tr>
							<tr>
								<th>Monthly limit</th>
								<td>None</td>
								<td>1 GB out, 20,000 requests</td>
								<td>None published</td>
							</tr>
							<tr>
								<th>Server-Sent Events</th>
								<td>Yes</td>
								<td>Not stated</td>
								<td>No</td>
							</tr>
							<tr>
								<th>Dev server config</th>
								<td>None</td>
								<td>May need the host allowed</td>
								<td>May need the host allowed</td>
							</tr>
						</tbody>
					</table>
				</div>
				<p class="note">
					From each product's documentation on {COMPARED_ON}. Plans change, so check theirs before you decide.
				</p>
				<h2>Use something else when</h2>
				<ul>
					<li>You need a URL that survives restarts, or your own domain.</li>
					<li>You need to restrict who can open the link. hostc has no access control.</li>
					<li>You expose something other than HTTP and WebSockets, such as raw TCP.</li>
					<li>It's production. Cloudflare Tunnel with your own hostname is made for that.</li>
				</ul>
			</>
		),
	},
	zh: {
		title: "hostc、ngrok 与 Cloudflare Tunnel 对比",
		lead: "hostc 只做一件事：临时分享开发服务，什么都不用注册。另外两个能做的更多，有些场景你确实需要它们。",
		description:
			"hostc 与 ngrok 免费版、Cloudflare Tunnel 的对比：账号、地址、警告页和用量限制。一个免费的内网穿透替代方案。",
		body: (
			<>
				<div class="table">
					<table>
						<thead>
							<tr>
								<th />
								<th>hostc</th>
								<th>ngrok 免费版</th>
								<th>Cloudflare Quick Tunnel</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<th>安装</th>
								<td>只需 Node.js</td>
								<td>ngrok agent</td>
								<td>cloudflared</td>
							</tr>
							<tr>
								<th>账号</th>
								<td>不需要</td>
								<td>需要</td>
								<td>不需要</td>
							</tr>
							<tr>
								<th>地址</th>
								<td>每次启动都换</td>
								<td>一个固定的开发域名</td>
								<td>每次启动都换</td>
							</tr>
							<tr>
								<th>打开前的页面</th>
								<td>没有</td>
								<td>浏览器会看到警告页</td>
								<td>没有</td>
							</tr>
							<tr>
								<th>每月额度</th>
								<td>没有</td>
								<td>出站 1 GB，20,000 次请求</td>
								<td>未公布</td>
							</tr>
							<tr>
								<th>Server-Sent Events</th>
								<td>支持</td>
								<td>文档未说明</td>
								<td>不支持</td>
							</tr>
							<tr>
								<th>开发服务配置</th>
								<td>不用改</td>
								<td>可能要放行 host</td>
								<td>可能要放行 host</td>
							</tr>
						</tbody>
					</table>
				</div>
				<p class="note">内容来自各产品 {COMPARED_ON} 的文档。套餐会变，决定之前请以它们的文档为准。</p>
				<h2>这些情况请用别的</h2>
				<ul>
					<li>需要重启后不变的地址，或者自己的域名。</li>
					<li>需要限制谁能打开链接。hostc 没有访问控制。</li>
					<li>要暴露 HTTP 和 WebSocket 以外的协议，比如 TCP。</li>
					<li>用在生产环境。这是 Cloudflare Tunnel 加自有域名的场景。</li>
				</ul>
			</>
		),
	},
};

export const GUIDES = [WEBHOOKS, PHONE, DEV_SERVERS, COMPARISON];
