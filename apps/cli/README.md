# hostc CLI

Expose a local HTTP/WebSocket service through a hostc tunnel.

`hostc` is the thin command-line product layer on top of the hostc client SDK. It handles arguments, config, diagnostics, terminal output, and local service checks. Protocol logic lives in the shared protocol and client packages.

## Install

```sh
npm install -g hostc
```

Or run it without installing:

```sh
npx hostc@latest 3000
```

## Usage

```sh
hostc <port> [--local-host <host>] [--server <url>] [--data-channels <count>] [--qr]
hostc config get
hostc config set server-url https://hostc.example.com
hostc config unset server-url
hostc config path
hostc doctor [port]
```

## Examples

```sh
hostc 3000
hostc 5173 --data-channels 4
hostc 8080 --local-host 127.0.0.1
hostc 3000 --server https://hostc.example.com
hostc 3000 --qr
```

## Options

- `--local-host <host>`: host of the local service. Defaults to `localhost`.
- `--server <url>`: hostc server URL. Defaults to `https://hostc.dev`.
- `--data-channels <count>`: number of binary data channel WebSockets. Defaults to `2`.
- `--qr`: show a QR code for the public URL when stdout is a TTY.

## Environment variables

- `HOSTC_SERVER_URL`: override the hostc server URL for local development, staging, or self-hosted deployments.
- `HOSTC_CONFIG`: override the config file path.
- `HOSTC_DEBUG`: set to `1` for protocol and reconnect debug output.
- `HOSTC_DISABLE_UPDATE_CHECK`: set to `1` to disable the interactive npm update check.

## What it does

- Creates an ephemeral tunnel.
- Opens one or more binary data channel WebSockets.
- Proxies HTTP requests to your local service.
- Proxies WebSocket upgrades on the same local port.
- Recreates a new ephemeral tunnel after a data channel disconnect.
- Prints spinner, success, warning, reconnect reason, and upgrade hints.
- Provides `hostc doctor` for local diagnostics.

## Current limitations

- Anonymous tunnels are temporary.
- Reconnects may create a new tunnel id and public URL.
- Reserved domains, accounts, dashboard, and daemon mode are not included yet.
- Early protocol versions may require CLI upgrades.

## Links

- Repository: https://github.com/akazwz/hostc
