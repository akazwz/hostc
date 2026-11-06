---
title: Three bugs we hit moving a static site to Solid
description: Three bugs we hit moving hostc.dev to prerendered Solid, and how we found them.
date: 2026-11-06
---

hostc.dev was one HTML file. Adding Chinese and more pages meant a dozen copies of the same head, header and footer, so it became Solid 2 routes rendered to static HTML at build time.

Pages are text and links, so they don't need hydration and the browser loads no framework. We hit three bugs along the way that the build, the type checker and the status codes all missed.

## Rendering at build time

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

With no hydration, server and client output don't have to match, so a component can read the request during the build.

## Bug 1: JSX ate a space

The migration shouldn't change any content, so we compared the text with the live site, along with screenshots at desktop, phone and dark settings. The text had one difference:

```text
- Down to the server, which you can deploy yourself.
+ Down to the server, which you candeploy yourself.
```

JSX removes the line break between text and a tag, and the space went with it. The build and the linter don't report this. After the fix, the three screenshots differed by zero pixels.

## Bug 2: a build that wrote over a file

After we shipped, pages loaded and `/llms.txt`, the guide for coding agents, returned 200. For about half an hour its content was HTML.

The crawler follows links, and pages link to `/llms.txt`. It requested the path, the app's catch-all route rendered the 404 page, and the crawler saved the output as `llms.txt`, over the real file. A status check saw 200, and our link checker had skipped `.txt` files.

Later Lighthouse reported that the file had no heading, although the source starts with `# hostc`. Fetching it with curl showed `<!DOCTYPE html>`.

The fix was one line, a filter so the crawl skips paths with a file extension. We also added a build check:

```ts
for (const file of readdirSync(publicDir)) {
	if (!readFileSync(join(output, file)).equals(readFileSync(join(publicDir, file)))) {
		throw new Error(`The build changed public/${file}.`);
	}
}
```

Files in `public/` should come out unchanged, and the build now fails if they don't. We removed the filter once to confirm the check works.

## Bug 3: extra quotes in titles

Blog titles appeared in lists with quotes around them: `'Fix Vite "Blocked request"...'`. Titles containing a quote mark have to be quoted in the front matter, and our parser didn't remove the outer quotes. We noticed it in a screenshot.

## What we check now

The build now checks two things: every page has a stylesheet, and files in `public/` come out unchanged. For a migration you can compare with the old site, so we did that with text and screenshots. For files that machines read, check the content as well as the status. We also keep running Lighthouse and looking at screenshots, since those found two of these three bugs.
