---
title: Camera or service worker not working on a phone? Use HTTPS
description: Camera, service workers and other browser features need a secure context. Localhost counts and a LAN address doesn't. How to fix it.
date: 2026-11-06
---

Your site works on your laptop, but on your phone at `http://192.168.1.20:3000` the camera button does nothing, the service worker doesn't register, or copying to the clipboard fails. This is usually because the page isn't HTTPS.

## Secure contexts

Features like the camera only work in a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts). That mostly means HTTPS, with one exception: `http://localhost` also counts, which is why it works on your computer.

A local network address like `192.168.1.20` doesn't count.

## What stops working

Over plain HTTP on a local network, these are unavailable or restricted:

- `navigator.mediaDevices`, used for the camera and microphone
- Service workers, and so offline support and web push
- `navigator.clipboard`
- Geolocation in most browsers
- Cookies marked `Secure`

Often there is no clear error. `navigator.mediaDevices` is `undefined`, and your code throws a `TypeError`. To check, run this in the console:

```js
console.log(window.isSecureContext);
```

## How to fix it

A tunnel is the simplest option. You get a normal HTTPS address, on any network, with no certificates to manage:

```sh
npx hostc@latest 3000 --qr
```

Scan the QR code. Details are in [testing localhost on a phone](/test-localhost-on-phone).

You can also use a local certificate. Tools like [mkcert](https://github.com/FiloSottile/mkcert) create a certificate your computer trusts. It suits work on one machine, but each phone has to trust the certificate authority too, which takes some setup on iOS and Android.

Frameworks have options too. Vite has `server.https` and a basic SSL plugin, and Next.js has `next dev --experimental-https`. Self-signed certificates show a browser warning on other devices, and some features may still refuse to work.

If you just need to try something on a real phone, a tunnel is the fastest. If you work with HTTPS locally every day, a local certificate is worth setting up once.
