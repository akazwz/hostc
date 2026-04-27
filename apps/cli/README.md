# hostc

Expose a local web service (HTTP + WebSocket) through a hostc tunnel.

`hostc` creates a public URL for a local web service, forwards HTTP requests and WebSocket upgrades, keeps the session alive, and reconnects automatically when the control connection drops.

## Install

```sh
npm install -g hostc
```

Or run it without installing:

```sh
npx hostc@latest 3000
```

## Requirements

- Node.js 18 or newer
- A local HTTP service or WebSocket-capable web service listening on a port

## Usage

```sh
hostc <port> [--local-host <host>] [--qr]
```

## Examples

```sh
hostc 3000
hostc 3000 --local-host 0.0.0.0
hostc 3000 --qr
```

## Options

- `--local-host <host>`: Host of the local service. Defaults to `127.0.0.1`.
- `--qr`: Show a scannable QR code for the public URL when stdout is a TTY.

## Environment Variables

- `HOSTC_SERVER_URL`: Override the Hostc server URL for local development, staging, or self-hosted testing. Defaults to `https://hostc.dev`.
- `HOSTC_DISABLE_UPDATE_CHECK`: Set to `1` to disable the interactive npm update check.

Example:

```sh
HOSTC_SERVER_URL=http://127.0.0.1:8787 hostc 3000
```

## What It Does

- Opens a tunnel to a public `*.hostc.dev` URL
- Proxies HTTP requests to your local service
- Proxies WebSocket upgrades on the same local port
- Refreshes the session automatically
- Reconnects after transient tunnel disconnects

## Example Output

```text
$ hostc 3000
Tunnel ready t-a1b2c3d4 -> http://127.0.0.1:3000/
Public URL: https://t-a1b2c3d4.hostc.dev
```

```text
$ hostc 3000 --qr
Tunnel ready t-a1b2c3d4 -> http://127.0.0.1:3000/
Public URL: https://t-a1b2c3d4.hostc.dev
Scan on your phone:
<QR code shown in interactive terminals>
```

## Notes

- Tunnel subdomains are assigned automatically
- Custom subdomains are not currently exposed by the CLI
- QR code output is shown only when `--qr` is passed and stdout is a TTY
- Press `Ctrl+C` to close the tunnel

## Links

- Website: https://hostc.dev
- Repository: https://github.com/akazwz/hostc