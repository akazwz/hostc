---
title: Camera or service worker not working on a phone? Use HTTPS
description: Camera, service workers and other browser features need a secure context. Localhost gets a pass and a LAN address doesn't. Here is how to fix it.
date: 2026-11-06
---

Everything works on your laptop. You open the same site on your phone at `http://192.168.1.20:3000` and the camera button does nothing, the service worker never registers, or copy to clipboard fails. Your code is fine. The address is the problem.

## Secure contexts

Browsers only give powerful features to pages in a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts). In practice that means HTTPS, with one exception: `http://localhost` also counts, so development feels easy.

A local network address like `192.168.1.20` doesn't get that exception, because it is plain HTTP over a network.

## What stops working

Over plain HTTP on a local network, these are unavailable or restricted:

- `navigator.mediaDevices`, used for the camera and microphone
- Service workers, and so offline support and web push
- `navigator.clipboard`
- Geolocation in most browsers
- Cookies marked `Secure`

The failure is often quiet. `navigator.mediaDevices` is simply `undefined`, which shows up as a confusing `TypeError`. To check, run this in the console:

```js
console.log(window.isSecureContext);
```

## How to fix it

**Use a tunnel.** You get a real HTTPS address that any phone trusts, on any network, with no certificates to manage:

```sh
npx hostc@latest 3000 --qr
```

Scan the QR code. Details are in [testing localhost on a phone](/test-localhost-on-phone).

**Use a local certificate.** Tools like [mkcert](https://github.com/FiloSottile/mkcert) create a certificate your computer trusts. It suits work on one machine, but each phone has to trust the certificate authority too, and that is fiddly on iOS and Android.

**Use your framework's option.** Vite has `server.https` and a basic SSL plugin, and Next.js has `next dev --experimental-https`. Self-signed certificates show a browser warning on other devices, and some features may still refuse to work.

If you just need to try something on a real phone, a tunnel is the fastest. If you work with HTTPS locally every day, a local certificate is worth setting up once.
