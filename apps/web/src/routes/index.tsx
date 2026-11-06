import { Head } from "../components/Head.tsx";
import { site } from "../site.ts";

const DESCRIPTION =
	"One command gives your dev server a public HTTPS URL. WebSockets and hot reload work through it. Free, no account.";

export default function Home() {
	return (
		<main>
			<Head
				title="hostc · Share localhost with a public URL, hot reload included"
				socialTitle="hostc · Localhost, anywhere"
				description={DESCRIPTION}
				path="/"
			/>
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
					Needs Node.js 22 or later. Run it with <code>--help</code> to see every option.
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
		</main>
	);
}
