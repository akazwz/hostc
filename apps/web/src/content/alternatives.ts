import type { Locale } from "../i18n.ts";

type Text = Record<Locale, string>;

export type Row = "install" | "account" | "url" | "visitors" | "traffic" | "limits";

export type Alternative = {
	slug: string;
	name: string;
	/** Short phrase for titles and lists. */
	summary: Text;
	lead: Text;
	rows: Record<Row, Text>;
	/** When the other product is the better choice. */
	chooseThem: Record<Locale, string[]>;
	sources: { label: string; url: string }[];
};

/** The day the facts below were last read from each product's documentation. */
export const CHECKED_ON = "2026-11-06";

export const ROW_LABELS: Record<Row, Text> = {
	install: { en: "Install", zh: "安装" },
	account: { en: "Account", zh: "账号" },
	url: { en: "URL", zh: "地址" },
	visitors: { en: "What visitors see", zh: "访客看到什么" },
	traffic: { en: "Traffic", zh: "支持的流量" },
	limits: { en: "Limits", zh: "限制" },
};

export const HOSTC: Record<Row, Text> = {
	install: { en: "Nothing beyond Node.js", zh: "只需 Node.js" },
	account: { en: "None", zh: "不需要" },
	url: { en: "New on every start, kept across reconnects", zh: "每次启动换新，重连时不变" },
	visitors: { en: "Your app, with no page in front", zh: "直接是你的应用，没有中间页" },
	traffic: { en: "HTTP, WebSocket, Server-Sent Events", zh: "HTTP、WebSocket、Server-Sent Events" },
	limits: {
		en: "256 requests at once, 1024 waiting, no monthly quota",
		zh: "同时 256 个请求，1024 个排队，没有月度额度",
	},
};

export const ALTERNATIVES: Alternative[] = [
	{
		slug: "ngrok",
		name: "ngrok",
		summary: { en: "No account, no warning page", zh: "不用注册，没有警告页" },
		lead: {
			en: "ngrok is the best-known tunnel and does far more than hostc. If you only want to share a dev server, hostc skips the sign-up and the page visitors click through.",
			zh: "ngrok 是最知名的隧道工具，功能比 hostc 多得多。如果你只想分享开发服务，hostc 不用注册，访客打开链接也不用先点确认。",
		},
		rows: {
			install: { en: "ngrok agent", zh: "ngrok agent" },
			account: { en: "Required, with an authtoken", zh: "需要，并配置 authtoken" },
			url: { en: "One fixed dev domain on the free plan", zh: "免费版一个固定的开发域名" },
			visitors: { en: "A warning page in browsers on the free plan", zh: "免费版浏览器访客先看到警告页" },
			traffic: { en: "HTTP, TLS and TCP", zh: "HTTP、TLS 和 TCP" },
			limits: {
				en: "Free plan: 1 GB out and 20,000 requests a month",
				zh: "免费版：每月出站 1 GB，20,000 次请求",
			},
		},
		chooseThem: {
			en: [
				"You want a URL that stays the same across restarts.",
				"You need TCP tunnels, traffic policies or an inspection dashboard.",
				"You run it in production or need a support contract.",
			],
			zh: ["需要重启后不变的地址。", "需要 TCP 隧道、流量策略或请求检查面板。", "用在生产环境，或者需要商业支持。"],
		},
		sources: [
			{ label: "ngrok free plan limits", url: "https://ngrok.com/docs/pricing-limits/free-plan-limits" },
			{ label: "ngrok error ERR_NGROK_4018", url: "https://ngrok.com/docs/errors/err_ngrok_4018" },
		],
	},
	{
		slug: "cloudflare-tunnel",
		name: "Cloudflare Tunnel",
		summary: { en: "No cloudflared, Server-Sent Events work", zh: "不用 cloudflared，支持 Server-Sent Events" },
		lead: {
			en: "hostc runs on Cloudflare too, but does a narrower job. Compared with a Quick Tunnel, it needs no binary, carries Server-Sent Events and works with dev servers as they are. A named Cloudflare Tunnel is a different tool, made for production.",
			zh: "hostc 同样运行在 Cloudflare 上，只是做的事更窄。和 Quick Tunnel 相比，它不用装二进制，支持 Server-Sent Events，开发服务也不用改配置。Cloudflare 的命名隧道是另一类工具，面向生产环境。",
		},
		rows: {
			install: { en: "cloudflared", zh: "cloudflared" },
			account: { en: "None for a Quick Tunnel", zh: "Quick Tunnel 不需要" },
			url: { en: "New for every Quick Tunnel", zh: "每个 Quick Tunnel 都换新" },
			visitors: { en: "Your app; an email check is optional", zh: "你的应用；可选邮箱校验" },
			traffic: { en: "HTTP; no Server-Sent Events", zh: "HTTP；不支持 Server-Sent Events" },
			limits: { en: "200 requests in flight, no uptime guarantee", zh: "同时 200 个请求，无可用性保证" },
		},
		chooseThem: {
			en: [
				"It is production: use a named tunnel with your own hostname.",
				"You need to limit who can open the link. Quick Tunnels offer an email allowlist, and hostc has no access control.",
			],
			zh: [
				"用在生产环境：用命名隧道加自己的域名。",
				"需要限制谁能打开链接。Quick Tunnel 有邮箱白名单，hostc 没有访问控制。",
			],
		},
		sources: [
			{
				label: "Cloudflare Quick Tunnels",
				url: "https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/",
			},
		],
	},
	{
		slug: "localtunnel",
		name: "localtunnel",
		summary: { en: "The same one command, built for dev servers", zh: "同样一条命令，专为开发服务设计" },
		lead: {
			en: "localtunnel and hostc start the same way: one npx command and no sign-up. hostc is built around dev servers, with hot reload, Host and Origin rewriting, and URLs that survive a network drop.",
			zh: "localtunnel 和 hostc 的用法一样：一条 npx 命令，不用注册。hostc 专为开发服务设计，支持热更新、改写 Host 和 Origin，断网后地址也不变。",
		},
		rows: {
			install: { en: "Nothing beyond Node.js", zh: "只需 Node.js" },
			account: { en: "None mentioned", zh: "文档未提及" },
			url: { en: "Random; you can ask for a subdomain", zh: "随机；可以请求指定子域名" },
			visitors: { en: "Not stated in its README", zh: "README 未说明" },
			traffic: { en: "WebSockets not stated in its README", zh: "README 未说明 WebSocket" },
			limits: { en: "Not stated in its README", zh: "README 未说明" },
		},
		chooseThem: {
			en: ["You want to request a specific subdomain.", "You already run its open source server."],
			zh: ["想请求一个指定的子域名。", "已经在运行它的开源服务端。"],
		},
		sources: [{ label: "localtunnel README", url: "https://github.com/localtunnel/localtunnel" }],
	},
	{
		slug: "frp",
		name: "frp",
		summary: { en: "No server to run", zh: "不用自己准备服务器" },
		lead: {
			en: "frp is a powerful reverse proxy you run yourself, and it needs a server with a public IP. hostc is for when you just want a link in a few seconds, with no server to pay for or configure.",
			zh: "frp 是一个强大的内网穿透反向代理，需要你自己准备一台有公网 IP 的服务器。hostc 适合只想几秒钟拿到一个链接的场景，不用买服务器，也不用写配置。",
		},
		rows: {
			install: { en: "frpc locally, frps on your server", zh: "本地 frpc，服务器 frps" },
			account: { en: "None, but you need a public server", zh: "不需要，但要有公网服务器" },
			url: { en: "Your own server or domain", zh: "你自己的服务器或域名" },
			visitors: { en: "Your app", zh: "你的应用" },
			traffic: { en: "TCP, UDP, HTTP and HTTPS", zh: "TCP、UDP、HTTP 和 HTTPS" },
			limits: { en: "Those of your server", zh: "取决于你的服务器" },
		},
		chooseThem: {
			en: [
				"You need TCP or UDP, for example SSH or game servers.",
				"You want a long-running tunnel on your own domain.",
				"Traffic must stay on servers you control.",
			],
			zh: [
				"需要 TCP 或 UDP，比如 SSH、游戏服务器。",
				"需要长期运行的隧道，并使用自己的域名。",
				"流量必须留在自己控制的服务器上。",
			],
		},
		sources: [{ label: "frp README", url: "https://github.com/fatedier/frp" }],
	},
	{
		slug: "tailscale-funnel",
		name: "Tailscale Funnel",
		summary: { en: "No tailnet to set up", zh: "不用配置 tailnet" },
		lead: {
			en: "Tailscale Funnel exposes a device on your tailnet to the internet, which is ideal if you already use Tailscale. hostc needs no VPN, account or admin settings, so it also works on a machine that has none of that.",
			zh: "Tailscale Funnel 把 tailnet 里的设备暴露到公网，如果你已经在用 Tailscale，它很合适。hostc 不需要 VPN、账号和管理设置，在什么都没配的机器上也能用。",
		},
		rows: {
			install: { en: "Tailscale client, MagicDNS and HTTPS on", zh: "Tailscale 客户端，开启 MagicDNS 和 HTTPS" },
			account: { en: "A tailnet, with Funnel allowed in its policy", zh: "需要 tailnet，并在策略里允许 Funnel" },
			url: { en: "A stable name under your ts.net domain", zh: "ts.net 下的固定名称" },
			visitors: { en: "Your app", zh: "你的应用" },
			traffic: { en: "TLS on ports 443, 8443 and 10000", zh: "TLS，端口 443、8443、10000" },
			limits: { en: "In beta, with bandwidth limits you can't change", zh: "Beta 阶段，带宽限制不可调整" },
		},
		chooseThem: {
			en: [
				"You already run Tailscale.",
				"You want a URL that doesn't change.",
				"You also want private access to the same machine.",
			],
			zh: ["已经在用 Tailscale。", "需要不变的地址。", "同时需要私密访问这台机器。"],
		},
		sources: [{ label: "Tailscale Funnel", url: "https://tailscale.com/kb/1223/funnel" }],
	},
	{
		slug: "dev-tunnels",
		name: "Microsoft dev tunnels",
		summary: { en: "No sign-in, public by design", zh: "不用登录，链接默认公开" },
		lead: {
			en: "Microsoft dev tunnels, also built into VS Code, are private by default and need a sign-in. hostc takes the opposite approach: no account, and a link anyone can open, so it suits sharing with people outside your organization.",
			zh: "微软的 dev tunnels 也内置在 VS Code 里，默认私有，需要登录。hostc 的取舍相反：不用账号，拿到链接的人都能打开，所以更适合分享给组织外的人。",
		},
		rows: {
			install: { en: "devtunnel CLI, or VS Code", zh: "devtunnel CLI 或 VS Code" },
			account: { en: "Microsoft, Entra ID or GitHub account", zh: "需要微软、Entra ID 或 GitHub 账号" },
			url: { en: "Can stay the same for as long as you need", zh: "可以长期保持不变" },
			visitors: { en: "Only you by default; anonymous access is opt-in", zh: "默认只有你；匿名访问需要开启" },
			traffic: { en: "Several ports per tunnel, HTTP and HTTPS", zh: "每条隧道多个端口，HTTP 和 HTTPS" },
			limits: { en: "Public preview; unused tunnels go after 30 days", zh: "公开预览；闲置 30 天后删除" },
		},
		chooseThem: {
			en: [
				"The link must stay private by default.",
				"You need several ports on one tunnel.",
				"You already work in VS Code and want it built in.",
			],
			zh: ["链接默认必须私有。", "一条隧道需要多个端口。", "已经在用 VS Code，想直接用内置功能。"],
		},
		sources: [
			{ label: "What are dev tunnels?", url: "https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/overview" },
			{ label: "Dev tunnels FAQ", url: "https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/faq" },
		],
	},
];
