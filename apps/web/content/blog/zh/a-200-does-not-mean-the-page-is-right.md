---
title: 把静态站迁到 Solid 时踩的三个坑
description: 把 hostc.dev 迁到 Solid 预渲染时遇到的三个 bug，以及我们是怎么发现的。
date: 2026-11-06
---

hostc.dev 原来是一个 HTML 文件。加上中文和更多页面后，同样的头部、导航和页脚要复制十几份，所以它改成了 Solid 2 路由，在构建时渲染成静态 HTML。

页面只有文字和链接，用不上水合（hydration），所以浏览器不加载框架。迁移时遇到了三个 bug，构建、类型检查和状态码都没发现它们。

## 构建时渲染，浏览器不加载 Solid

`prerender-crawler` 在构建时运行应用，顺着链接找到页面，把每一页写成 HTML：

```ts
prerender({
  mode: "static",
  pages: ["/", "/zh", { path: "/404", filename: "404.html" }, { path: "/zh/404", filename: "zh/404.html" }],
  concurrency: 1,
  integrations: [sitemap({ hostname: site.origin })],
}),
```

然后一个小插件删掉 Solid 为水合添加的东西：脚本、模块预加载和水合属性。第一版构建完全没有脚本，首页 HTML 约 6 KB。后来为复制按钮加了一个小脚本，浏览器现在只运行它。

没有水合，也就不用保证服务端和客户端的输出一致，组件在构建时可以直接读取请求。

## Bug 1：JSX 吞了一个空格

这次迁移不该改变页面内容，所以我们拿它和线上版本对比了文字，又比较了桌面、手机、深色三种截图的像素差异。文字有一处不同：

```text
- Down to the server, which you can deploy yourself.
+ Down to the server, which you candeploy yourself.
```

JSX 会去掉文字和标签之间的换行，这里的空格也一起没了，构建和 lint 都不报错。修好后，三张截图的差异都是 0 像素。

## Bug 2：构建覆盖了一个文件

上线后页面正常，给 AI 助手看的 `/llms.txt` 也返回 200，但有大约半小时，这个文件的内容其实是 HTML。

爬虫会顺着链接走，而页面链接了 `/llms.txt`。它请求这个路径，应用的兜底路由渲染出 404 页面，爬虫就把结果存成 `llms.txt`，覆盖了真文件。状态检查看到的是 200，我们的链接检查又跳过了 `.txt`。

后来 Lighthouse 报告这个文件没有标题，可源文件是以 `# hostc` 开头的。我们用 curl 取回来一看，内容是 `<!DOCTYPE html>`。

修复只要一行，让爬虫跳过带扩展名的路径。我们又加了一个构建检查：

```ts
for (const file of readdirSync(publicDir)) {
	if (!readFileSync(join(output, file)).equals(readFileSync(join(publicDir, file)))) {
		throw new Error(`The build changed public/${file}.`);
	}
}
```

`public/` 里的文件输出后应该和原来完全一样，不一样就让构建失败。我们临时去掉过滤规则试过，这个检查确实会报错。

## Bug 3：标题多了引号

博客标题在列表里多了一对引号：`'Fix Vite "Blocked request"...'`。含引号的标题在 front matter 里要用引号包住，我们写的解析器没有去掉外层引号。这个问题是看截图时发现的。

## 现在的检查

现在构建时会检查两件事：每个页面都有样式表，`public/` 里的文件没被改动。迁移时可以拿旧网站做对比，所以这次用了文字和截图比对。机器要读的文件不能只看状态码，要看内容。Lighthouse 和截图我们也会继续看，这三个 bug 里有两个是靠它们发现的。
