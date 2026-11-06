---
title: Share an app you built with AI before you deploy it
description: Your AI coding tool built something that runs on localhost. How to let other people try it in a minute, and what to check first.
date: 2026-11-06
---

You asked a coding agent for an app, and it runs. It says `Local: http://localhost:3000`. Now you want a friend to try it, and that link only works on your computer.

Deploying is the usual answer, but it is a lot for something you built an hour ago. You may not have an account on a hosting service, the app may rely on a local database, and you may just want to know whether the idea is any good.

## The one-minute way

Leave the app running, open a second terminal, and use the port it printed:

```sh
npx hostc@latest 3000
```

You get a public HTTPS link. Send it to anyone and they can use the app running on your computer, on any device. As the agent keeps changing the code, their page updates too.

## Let the agent do it

Coding agents can run this themselves. Tell yours:

```text
Read https://hostc.dev/llms.txt, then share this app with a public link.
```

That file tells the agent how to start hostc and read the URL.

## Check these first

AI-built apps tend to skip the boring parts, so look before you share.

- **Secrets.** API keys in frontend code are visible to everyone who opens the page. Keep them on the server side.
- **Open admin pages.** If the app has an admin route with no login, the link exposes it.
- **Your AI bill.** If the app calls a paid API, every visitor spends your money. Share the link with people you know, and set a spending limit.
- **Real data.** Use test data, not your own files or customer records.

## When to deploy

A link from your computer works while your computer is on and hostc is running. When people need it tomorrow, or without you around, it is time to deploy. Until then, this is the quickest way to find out whether it was worth building.
