---
title: Three bugs we hit moving a static site to Solid
description: How we moved hostc.dev to Solid with no JavaScript in the browser, the bugs that passed every check, and the comparisons that caught them.
date: 2026-11-06
---

hostc.dev was one HTML file. Adding Chinese and more pages meant a dozen copies of the same head, header and footer, so it became Solid 2 routes rendered to static HTML at build time.

The pages load no framework. They are text and links, so hydrating them would only cost download time. Three bugs got past the build, the type checker and the status codes. Here is what they were and how we found them.

## Rendering without shipping the framework

`prerender-crawler` runs the app during the build and writes each page as HTML, following links to find them:

```ts
prerender({
  mode: "static",
  pages: ["/", "/zh", { path: "/404", filename: "404.html" }, { path: "/zh/404", filename: "zh/404.html" }],
  concurrency: 1,
  integrations: [sitemap({ hostname: site.origin })],
}),
```

A small plugin then strips what Solid added for hydration: its scripts, module preloads and hydration attributes. Our first build had no scripts at all, and the home page came to about 6 KB of HTML. A small script for copy buttons came later, which is all the browser runs now.

Because nothing hydrates, the usual worry about server and client output matching goes away. A component can read the request during the build, and there is no second render to disagree with it.

## Bug 1: JSX ate a space

The migration was meant to change nothing, so we compared it with the live site: the text of both pages, and screenshots at desktop, phone and dark settings, counting differing pixels.

The text differed:

```text
- Down to the server, which you can deploy yourself.
+ Down to the server, which you candeploy yourself.
```

JSX drops the line break between text and a tag, along with the space you see in the source. No tool complains. After the fix, the three screenshots differed by zero pixels.

## Bug 2: a build that wrote over a file

We then shipped. Pages loaded and `/llms.txt`, the guide for coding agents, returned 200. For about half an hour that file was HTML.

The crawler follows links, and pages link to `/llms.txt`. It requested the path, the app's catch-all route rendered the 404 page, and the crawler saved the output as `llms.txt`, over the real file. A status check saw 200, and our link checker had skipped `.txt` files.

Lighthouse's llms.txt audit reported that the file had no heading, and that made no sense for a file starting with `# hostc`. Fetching it showed `<!DOCTYPE html>`.

The fix was one line, a filter so the crawl only follows paths without a file extension. The better fix was a guard:

```ts
for (const file of readdirSync(publicDir)) {
	if (!readFileSync(join(output, file)).equals(readFileSync(join(publicDir, file)))) {
		throw new Error(`The build changed public/${file}.`);
	}
}
```

Files in `public/` should come out byte for byte the same. Now a build that breaks that fails. We removed the filter once to watch it trip.

## Bug 3: visible only in a screenshot

Blog titles appeared in lists with quotes around them: `'Fix Vite "Blocked request"...'`. Titles containing a quote mark were quoted in the front matter, and the little parser kept those quotes. Everything passed, and only reading a screenshot showed it.

## What we check now

- **Compare with what you replace.** A migration has a perfect test: the old site.
- **Read the content, not the status.** Assert what a file contains, especially anything machines read.
- **Make the build fail on impossible states.** A page with no stylesheet, or a changed public file, should stop a deploy. Some setups render pages with no styles while the build succeeds.
- **Run an outside auditor.** Lighthouse found a bug it wasn't looking for.
- **Look at the pages.** Bug 3 only showed up in a screenshot.
