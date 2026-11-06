# hostc website

hostc.dev is Solid 2 with file routes in `src/routes`, rendered to static HTML at build time by
`prerender-crawler`. Solid only runs during the build: `vite.config.ts` removes every script from
the output, so browsers get HTML and CSS, no JavaScript, and no page may need any. No component
library, no web fonts. Solid 2 is a release candidate and is not React or Solid 1: read
`node_modules/solid-js/CHEATSHEET.md` before writing components.

- Keep Solid, the router and the Vite plugin on the versions `apps/codex-web` uses.
- A page sets its head through `src/components/Head.tsx`. A page nothing links to is not built: add
  it to `pages` in `vite.config.ts`.
- The site has few pages. Users need one command and `--help`, so don't add a docs site. Anything
  longer belongs in the repository README, which the pages link to.
- Colors come from the logo: zinc neutrals (dark scheme on a soft #1c1c1f, never pure black), white
  and orange, used for links and the command's prompt. The orange-to-pink gradient stays in the logo.
  Don't bring in other hues or a tinted paper background.
- One layout for the whole page, left aligned on one narrow column (640px of content): the hero
  (headline, one lead sentence, the command in a plain box, a note pointing at `--help`), then
  sections separated by space, each a small label above its content (a two-column `dl` of title and
  sentence, or a hairline list). Keep the copy short; the page should read in a minute. Longer
  material, such as the comparison with Cloudflare Tunnel, lives in the README. New content fits that pattern; no cards, icons, bands, demos or second actions.
- `src/global.css` holds every color as a variable, with a `prefers-color-scheme: dark` block; check both
  schemes and a 390px-wide phone after changes.
- After a change, run `WEB_DOMAIN=hostc.dev pnpm -F web build` and open the built pages in a browser. A build can succeed with
  pages that look wrong.
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
