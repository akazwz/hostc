---
title: Test localhost on a real phone
lead: Open the site on your computer from your phone, over HTTPS, on any network. Hot reload keeps working, so the phone updates when you save.
description: Open your local dev server on a real phone with a QR code. HTTPS, hot reload and any network. Free, with no account.
---
## How to do it

1. Start your dev server, then run hostc with a QR code:

   ```sh
   npx hostc@latest 3000 --qr
   ```

2. Scan the code with your phone.
3. Edit a file. The page on your phone updates with the save.

## Why not the local IP address

- The phone can be on mobile data. It doesn't have to share your Wi-Fi.
- The page is HTTPS, so browser features that need a secure context work, such as the camera, service workers and geolocation. They don't work on `http://192.168.x.x`.
- Your dev server can keep listening on localhost.

## Good to know

- Anyone with the URL reaches your server, so don't post it anywhere public.
