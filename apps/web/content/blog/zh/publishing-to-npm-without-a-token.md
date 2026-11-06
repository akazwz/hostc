---
title: 用 GitHub Actions 发布 npm 包，不存 token
description: hostc 如何用 npm 可信发布和 OIDC 发版，2.0.0 为什么发布时没有可执行文件，以及如何在发布前测试打好的包。
date: 2026-11-06
---

用户运行 `npx hostc@latest` 时，执行的就是我们最新发布的包。所以发版流程有两条规则：不存长期密钥，发布前先测试打好的包。

## 不用 token 怎么发布

放在 CI 密钥里的传统 npm token，在被吊销之前一直有效。用[可信发布](https://docs.npmjs.com/trusted-publishers)时，npm 信任的是某个仓库里的某个工作流。GitHub Actions 用短期的 OIDC 令牌证明身份，任何地方都不存 npm token。

在 npm 上填写仓库和工作流文件名，再在工作流里允许身份令牌：

```yaml
permissions:
  contents: read
  id-token: write
```

有三点要知道：

- 需要 npm 11.5.1 或更高版本，比 Node.js 22 自带的 npm 新。我们用 Node.js 24 发版。
- 公开仓库的公开包，npm 默认会附上[来源证明](https://docs.npmjs.com/generating-provenance-statements)，任何人都能看到版本是哪个提交构建的。
- npm 保存设置时不做校验。工作流文件名写错，要到发布时才暴露。

## 固定 Action 版本

`id-token: write` 意味着这个 job 里的每一步都能拿到发布包的身份。`uses: some/action@v6` 跟随一个所有者可以移动的标签。一旦这个 Action 被攻破，攻击者的代码就带着你的发布权限运行。

所以每个 Action 都固定到完整的提交：

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  with:
    persist-credentials: false
```

`persist-credentials: false` 让后续步骤拿不到 checkout 的 Git 令牌，这个工作流不需要推送代码。

## 2.0.0 为什么没有可执行文件

hostc 2.0.0 发布时没有可执行文件，包里缺了 `dist` 目录。

我们用 pnpm 打包，再用 npm 发布打好的文件，而 `pnpm pack` 和 `npm publish <tarball>` 都不会运行 `prepublishOnly`。于是没有东西构建 CLI。源码树上的测试抓不到这个问题，因为那里什么都有。

构建挪到了确实会运行的 `prepack`，我们也加上了对包本身的测试。

## 测试打好的包

现在发版时会像用户一样安装打好的文件，再用这份副本跑端到端测试：

```sh
pnpm -F hostc pack --pack-destination "$RUNNER_TEMP"
pnpm -F hostc test:package "$RUNNER_TEMP"/hostc-*.tgz
npm publish "$RUNNER_TEMP"/hostc-*.tgz --tag latest
```

`test:package` 新建一个空目录，用 `npm install` 安装这个文件，检查安装后的 CLI 打印的版本对不对，再让端到端测试指向它。这些测试会启动真实的服务端和本地源站，让流量经过隧道。

这样能发现缺文件，也能发现只在工作区内才能解析的依赖。CI 在每个 PR 上都跑同样的步骤。

## 发版出错怎么办

npm 上已发布的版本改不了。我们把同样的代码正确打包，发成 2.0.1。移动 dist-tag 需要交互式 2FA，可信发布管不到这一步，所以修复只能靠发新版本。
