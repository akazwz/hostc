# hostc website

hostc.dev is Solid 2 with file routes in `src/routes`, rendered to static HTML at build time by
`prerender-crawler`. Solid only runs during the build: `vite.config.ts` removes its scripts from the
output, because pages are text and links and hydrating them would only cost download time. No
component library, no web fonts. Solid 2 is a release candidate and is not React or Solid 1: read
`node_modules/solid-js/CHEATSHEET.md` before writing components.

The site exists to explain hostc and to be found by people searching for what it does. It should
look professional, simple and modern: one column, plenty of space, nothing decorative.

- Keep Solid, the router and the Vite plugin on the versions `apps/codex-web` uses.
- A page sets its head through `src/components/Head.tsx`. A page nothing links to is not built, so
  link it from the footer or a list.
- `/changelog` renders `apps/cli/CHANGELOG.md`. Blog posts are Markdown in `content/blog`, Chinese in
  `content/blog/zh`, with `title`, `description` and `date`. Write a post only when it has something
  to teach, and never to fill a schedule.
- Comparisons live in `src/content/alternatives.ts`. Be fair: each page says when the other product
  is the better choice, and links its sources.
- Colors come from the logo: zinc neutrals (dark scheme on a soft #1c1c1f, never pure black), white
  and orange, used for links and the command's prompt. The orange-to-pink gradient stays in the logo.
  Don't bring in other hues or a tinted paper background. The terminal's green marks status codes only.
- `src/global.css` holds every color as a variable, with a `prefers-color-scheme: dark` block; check both
  schemes and a 390px-wide phone after changes.
- `src/components/Terminal.tsx` copies what the CLI prints; keep them in step.
- After a change, run `WEB_DOMAIN=hostc.dev pnpm -F web build` and open the built pages in a browser. A build can succeed with
  pages that look wrong.
- Statements about other products come from their documentation. Update `CHECKED_ON` in
  `src/content/alternatives.ts` when you recheck them, and write that a thing is not stated rather
  than guess.
- English and Chinese pages say the same thing: change both.
- Every statement about hostc must match the code; check the server, client and CLI before writing it.
- The social card is brand first: the logo mark, the `hostc` wordmark in a bold serif, the slogan and
  one small line, with color only in the mark. The user preferred it over busier redesigns (gradient
  text, glows, a command box); keep it and change only its words.
- The social card `og-image.png` (1200×630) is `og-image.svg` rendered by Chrome, which has the
  system font the SVG names:
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --user-data-dir=/tmp/og-profile --hide-scrollbars --window-size=1200,630 --screenshot=og-image.png "file://$PWD/og-image.svg"`
  (it may not exit; stop it once the file exists). GitHub's social preview wants 1280×640: widen the
  `viewBox` and the background rectangles instead of padding the PNG, or the glow shows a seam.
- `llms.txt` is the guide for coding agents; keep it in step with the CLI's behaviour and messages.
- Merging to `main` deploys the site (Workers Builds). By hand: `WEB_DOMAIN=hostc.dev pnpm deploy:web`
  from the repository root.
