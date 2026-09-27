# hostc website

hostc.dev is plain HTML and CSS in `public/`, served as Workers static assets. No framework, no
component library, no build step, no JavaScript, no web fonts.

- The site is one page. Users need one command and `--help`; don't add a docs site. Anything longer
  belongs in the repository README, which the page links to.
- Colors come from the logo: zinc neutrals (dark scheme on a soft #1c1c1f, never pure black), white, and the logo's orange-to-pink gradient, used only on "anywhere." in the headline; links are
  orange. Don't bring in other hues or a tinted paper background.
- One layout for the whole page, left aligned on an 880px column: the hero (headline, one lead
  sentence, the command in a plain box, a note pointing at `--help`), then sections split by hairlines,
  each a small label on the left and content on the right (a `dl` of title and sentence, or the
  comparison table). New content fits that pattern; no cards, icons, bands, demos or second actions.
- `style.css` holds every color as a variable, with a `prefers-color-scheme: dark` block; check both
  schemes and a 390px-wide phone after changes.
- Every statement about hostc must match the code; check the server, client and CLI before writing it.
- The social card `og-image.png` (1200×630) is `og-image.svg` rendered by Chrome, which has the
  system font the SVG names:
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --user-data-dir=/tmp/og-profile --hide-scrollbars --window-size=1200,630 --screenshot=og-image.png "file://$PWD/og-image.svg"`
  (it may not exit; stop it once the file exists). GitHub's social preview wants 1280×640: widen the
  `viewBox` and the background rectangles instead of padding the PNG, or the glow shows a seam.
- `llms.txt` is the guide for coding agents; keep it in step with the CLI's behaviour and messages.
- Deploy: `WEB_DOMAIN=hostc.dev pnpm deploy:web` from the repository root.
