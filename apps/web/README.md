# @hostc/web

This package contains the hostc.dev frontend assets.

It is a fully static React Router v7 app built with `ssr: false` and `prerender: true`. The refactored tunnel server in [`apps/server`](../server) intentionally does not serve static assets or web UI. Treat [`docs/refactor`](../../docs/refactor) as the current source of truth for tunnel server behavior.

## Stack

- [React Router v7](https://reactrouter.com/) for SPA routing plus prerendering
- [Tailwind CSS v4](https://tailwindcss.com/) via `@tailwindcss/vite`
- [shadcn/ui](https://ui.shadcn.com/) plus [@base-ui/react](https://base-ui.com/)
- Self-hosted fonts from [Fontsource](https://fontsource.org/)
- Vite 8 and TypeScript

## Project Layout

```text
app/
|- app.css                 # Tailwind entry, theme tokens, and font definitions
|- root.tsx                # Document shell, font preloads, ErrorBoundary
|- routes.ts               # Route table
|- routes/
|  |- _layout.tsx          # Shared layout: nav, footer, background grid
|  |- home.tsx             # /
|  |- error-404.tsx        # /404
|- components/
|  |- ui/                  # shadcn UI components
|  |- icons.tsx
|  `- error-page.tsx
`- lib/utils.ts
public/                    # Favicon, OG images, and other static files
build/client/              # Static build output
```

## Routes

| Path | Purpose |
| --- | --- |
| `/` | Landing page |
| `/404` | Generic 404 page |

All routes are prerendered to static HTML at build time.

## Local Development

Run these commands from the repository root:

```bash
pnpm install
pnpm -F web dev
```

## Build And Typecheck

```bash
pnpm -F web build
pnpm -F web typecheck
```

`pnpm -F web build` writes the static site to `apps/web/build/client/`.

## Deployment

This app is not deployed by the refactored tunnel server. A future web deployment should be configured separately from [`apps/server`](../server), which is tunnel-only and has no Static Assets binding.

## Styling And Theme

- [`app/app.css`](app/app.css) is both the Tailwind entrypoint and the theme definition.
- It imports Tailwind, `tw-animate-css`, and `shadcn/tailwind.css`.
- It defines the `@font-face` rules used by the app.
- It defines the OKLCH design tokens in `:root` and `.dark`.
- It exposes those tokens through `@theme inline`, so classes like `bg-background` and `text-foreground` map to the custom theme values.
- The site is dark-only right now: [`app/root.tsx`](app/root.tsx) hardcodes `className="dark"` on the `<html>` element.
- New shadcn components can be added with `pnpm dlx shadcn@latest add <name>`.

## Font Loading

The font setup is optimized to reduce both FOUT (flash of unstyled text) and CLS (layout shift during font swaps).

### Fonts In Use

- `Noto Sans Variable` for body text via `--font-sans`
- `Playfair Display Variable` for headings via `--font-heading`

Both are self-hosted through `@fontsource-variable`, so the app does not depend on Google Fonts or any third-party font CDN.

### What Is Optimized

1. **Latin-only subsets**
   [`app/app.css`](app/app.css) defines `@font-face` rules that point directly to `*-latin-wght-normal.woff2` files and sets `unicode-range` explicitly. That avoids downloading unused Cyrillic, Vietnamese, and other subsets.

   - Noto Sans full package: about 200 KB+ -> latin subset about 36 KB
   - Playfair Display full package: about 150 KB+ -> latin subset about 38 KB

2. **Preload in the document head**
   [`app/root.tsx`](app/root.tsx) imports the two WOFF2 files and exposes them through React Router's `links` export using `rel="preload" as="font" type="font/woff2" crossOrigin="anonymous"`.

   That starts the font requests as soon as the HTML arrives instead of waiting for CSS parsing.

3. **Per-font `font-display` strategy**
   - Noto Sans uses `font-display: swap` so body copy stays readable immediately.
   - Playfair Display uses `font-display: fallback` to reduce visible jumps on large heading text.

4. **Metric-adjusted fallback fonts**
   The app uses [fontpie](https://github.com/pixel-point/fontpie) to generate fallback metrics for the actual font files. Two fallback faces are defined:

   - `Noto Sans Fallback` -> `local('Arial')`
   - `Playfair Display Fallback` -> `local('Times New Roman')`

   The theme variables are set up like this:

   ```css
   --font-sans: "Noto Sans Variable", "Noto Sans Fallback", sans-serif;
   --font-heading: "Playfair Display Variable", "Playfair Display Fallback", serif;
   ```

   Because the fallback fonts are metric-adjusted with `ascent-override`, `descent-override`, `line-gap-override`, and `size-adjust`, the browser reserves nearly identical space before the real font finishes loading. That removes the layout jump during the swap.

### Regenerating Metrics After A Font Change

If the font files change, run these commands from `apps/web`:

```bash
npx --yes fontpie \
  node_modules/@fontsource-variable/noto-sans/files/noto-sans-latin-wght-normal.woff2 \
  --fallback system-ui --name "Noto Sans Variable" --style normal --weight "100 900"

npx --yes fontpie \
  node_modules/@fontsource-variable/playfair-display/files/playfair-display-latin-wght-normal.woff2 \
  --fallback serif --name "Playfair Display Variable" --style normal --weight "400 900"
```

Copy the generated `ascent-override`, `descent-override`, `line-gap-override`, and `size-adjust` values back into the corresponding fallback `@font-face` rules in [`app/app.css`](app/app.css).

### Why This Does Not Use Fontaine

We tried [fontaine](https://github.com/unjs/fontaine) for automatic fallback generation, but its Vite integration broke `font-family` values containing multi-word names such as `"Noto Sans Variable"`. In this project, using fontpie output directly is more predictable and safer.
