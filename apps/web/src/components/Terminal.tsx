/** What hostc prints, line for line: keep it in step with apps/cli/src/main.ts. */
export function Terminal() {
	return (
		<figure class="terminal" aria-label="Terminal output of hostc">
			<div class="bar" aria-hidden="true">
				<i />
				<i />
				<i />
			</div>
			<pre>
				<code>
					<b>https://k7m2xq9pa4dn.hostc.app</b>
					{"  → http://localhost:3000\n\n"}
					<s>{"Anyone with this URL can reach your local server. Press Ctrl+C to stop.\n\n"}</s>
					<s>10:42:07</s>
					{"  GET    "}
					<em>200</em>
					{"  / "}
					<s>12ms</s>
					{"\n"}
					<s>10:42:07</s>
					{"  GET    "}
					<em>200</em>
					{"  /assets/index.js "}
					<s>31ms</s>
					{"\n"}
					<s>10:42:08</s>
					{"  WS     "}
					<em>101</em>
					{"  /__vite_hmr\n"}
					<s>10:42:15</s>
					{"  POST   "}
					<em>200</em>
					{"  /webhooks/stripe "}
					<s>48ms</s>
				</code>
			</pre>
		</figure>
	);
}
