---
title: Publishing to npm with no token, and testing what you ship
description: How hostc publishes with npm trusted publishing and OIDC, why 2.0.0 shipped without its executable, and how to test the exact tarball before it goes out.
date: 2026-11-06
---

Everyone who runs `npx hostc@latest` executes whatever we published last. That makes the release workflow one of the most sensitive parts of the project. It rests on two ideas: no long-lived secret, and never publish something you haven't run.

## No token to steal

A classic npm token in CI secrets lasts until someone revokes it. With [trusted publishing](https://docs.npmjs.com/trusted-publishers), npm trusts a specific workflow in a specific repository instead. GitHub Actions proves its identity with a short-lived OIDC token, and no npm token is stored anywhere.

On npm, you name the repository and the workflow file. In the workflow, you allow the identity token:

```yaml
permissions:
  contents: read
  id-token: write
```

Three things to know:

- It needs npm 11.5.1 or later, newer than the npm that ships with Node.js 22. We build releases on Node.js 24.
- npm adds [provenance](https://docs.npmjs.com/generating-provenance-statements) by default for a public package from a public repository, so anyone can see which commit built a release.
- npm doesn't validate the settings when you save them. A misspelled workflow name shows up only when you publish.

## Pin your actions

`id-token: write` means every step in that job can obtain the identity that publishes the package. `uses: some/action@v6` follows a tag its owner can move. If that action is compromised, an attacker's code runs with your publishing rights.

So every action is pinned to a full commit:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  with:
    persist-credentials: false
```

`persist-credentials: false` keeps the checkout's Git token out of later steps, since nothing here pushes code.

## The release that had no program in it

hostc 2.0.0 went out without its executable. The `dist` folder was missing from the package.

We pack with pnpm and publish the resulting tarball with npm, and `prepublishOnly` doesn't run for `pnpm pack` or for `npm publish <tarball>`. Nothing built the CLI. Tests on the source tree can't catch that, because everything exists there.

The build moved to `prepack`, which does run. But the real lesson is that tests on your source tree say nothing about your package.

## Test the tarball

The release now installs the packed file the way a user would, and runs the end-to-end tests against that copy:

```sh
pnpm -F hostc pack --pack-destination "$RUNNER_TEMP"
pnpm -F hostc test:package "$RUNNER_TEMP"/hostc-*.tgz
npm publish "$RUNNER_TEMP"/hostc-*.tgz --tag latest
```

`test:package` creates an empty directory, runs `npm install` on the tarball, checks that the installed CLI prints the right version, and points the end-to-end tests at it. Those start a real server, a real local origin, and traffic through the tunnel.

That catches a missing file, and a dependency that only resolves inside the workspace. The file that gets published is the file that was tested. CI runs the same step on every pull request, so a broken package fails long before release day.

## The cost of a mistake

Versions on npm are permanent. 2.0.0 can't be fixed, only followed. We released 2.0.1 as the same code packaged correctly, and moving a dist-tag needs interactive 2FA, which trusted publishing doesn't cover. So when a release goes wrong, the way forward is a new version. It is worth a few extra minutes in CI to not need one.
