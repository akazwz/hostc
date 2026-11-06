---
title: How to share an AI-built app before deploying it
description: Your AI coding tool built something that runs on localhost. How to let other people try it in a minute, and what to check first.
date: 2026-11-06
---

You asked a coding agent for an app, and it runs. It says `Local: http://localhost:3000`. Now you want a friend to try it, and that link only works on your computer.

You could deploy it, but that can be a hassle for something new: you may not have a hosting account, and the app may rely on a local database.

## Share it with a tunnel

Leave the app running, open a second terminal, and use the port it printed:

```sh
npx hostc@latest 3000
```

You get a public HTTPS link. Send it to anyone and they can use the app running on your computer, on any device. As the agent keeps changing the code, their page updates too.

## Ask your coding agent

Coding agents can run this themselves. Tell yours:

```text
Read https://hostc.dev/llms.txt, then share this app with a public link.
```

That file tells the agent how to start hostc and read the URL.

## Check these first

AI-built apps may not handle these, so check before you share:

- API keys in frontend code are visible to everyone who opens the page. Keep them on the server side.
- If the app has an admin route with no login, the link exposes it.
- If the app calls a paid API, visitors use your quota. Share the link with people you know, and set a spending limit.
- Use test data, not your own files or customer records.

## When to deploy

A link from your computer works while your computer is on and hostc is running. If people need it tomorrow, or when you aren't around, deploy it.
