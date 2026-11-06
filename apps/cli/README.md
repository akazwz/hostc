# hostc

Expose a local HTTP/WebSocket server through a public URL.

```sh
npx hostc@latest 3000
```

```text
  https://k7m2xq9pa4dn.hostc.app  → http://localhost:3000
```

- Works with dev servers and hot reload (Vite, Next.js, …), WebSockets and Server-Sent Events.
- The URL survives network drops and server restarts; Ctrl+C releases it.
- No account and nothing to configure.

```text
hostc <target> [options]

  3000                     http://localhost:3000
  127.0.0.1:8080           http://127.0.0.1:8080
  https://localhost:5173   any http(s) origin

  --server <url>   tunnel server (env HOSTC_SERVER)
  --qr             print a QR code of the public URL
  --here           hostc codex: show only this directory (commands still reach
                   the whole machine)
  -h, --help       show this help
  -v, --version    show the version
```

Anyone with the URL can reach your local server, so don't expose anything sensitive.

`hostc codex` (experimental) uses the Codex CLI on your machine from any browser. Its link can read
any file and run any command as you. Read
[the risks](https://github.com/akazwz/hostc#hostc-codex-experimental) before using it.

hostc is free and moves fast: server updates can break older CLIs. Always use `npx hostc@latest`
rather than installing it globally or as a dependency, which would pin an old version; an outdated
version stops at startup and tells you to upgrade.

Docs: https://hostc.dev · Requires Node.js 22.1+.

hostc is free and open source. If it helps you, a star on https://github.com/akazwz/hostc helps
others find it and encourages the project.
