---
title: 把静态站迁到 Solid 预渲染：返回 200 不代表页面是对的
description: 我们如何把 hostc.dev 迁到 Solid 而浏览器里没有框架 JS，那些通过了所有检查的 bug，以及最后抓住它们的对比方法。
date: 2026-11-06
---

hostc.dev 原来是一个 HTML 文件。加上中文和更多页面后，同样的头部、导航和页脚要复制十几份，所以它改成了 Solid 2 路由，在构建时渲染成静态 HTML。

页面不加载任何框架。它们只有文字和链接，水合（hydration）只会白白增加下载量。这次有三个 bug 通过了构建、类型检查和状态码，每一个都在提醒我们，“能跑”到底是什么意思。

## 渲染了，但不把框架发出去

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

因为没有水合，常见的“服务端和客户端输出要一致”的担心也就没有了。组件可以在构建时读取请求，不会有第二次渲染来跟它对不上。

## Bug 1：JSX 吞了一个空格

这次迁移本来就不该改变任何东西，所以我们拿它和线上版本对比：比较两边的文字，再比较桌面、手机、深色三种截图的差异像素数。

文字不一样：

```text
- Down to the server, which you can deploy yourself.
+ Down to the server, which you candeploy yourself.
```

JSX 会丢掉文字和标签之间的换行，连同你在源码里看到的空格一起。没有工具会提醒。修好后，三张截图的差异都是 0 像素，这比“看起来一样”有力得多。

## Bug 2：构建覆盖了一个文件

然后我们上线了。页面正常，给 AI 助手看的 `/llms.txt` 也返回 200。但大约半小时里，这个文件其实是 HTML。

爬虫会顺着链接走，而页面链接了 `/llms.txt`。它请求这个路径，应用的兜底路由渲染出 404 页面，爬虫就把结果存成 `llms.txt`，覆盖了真文件。状态检查看到的是 200，我们的链接检查又跳过了 `.txt`。

Lighthouse 的 llms.txt 审计说这个文件没有标题，而它明明以 `# hostc` 开头，这说不通。实际取回来一看，内容是 `<!DOCTYPE html>`。

修复只要一行：让爬虫只跟随没有扩展名的路径。更好的修复是加一道防线：

```ts
for (const file of readdirSync(publicDir)) {
	if (!readFileSync(join(output, file)).equals(readFileSync(join(publicDir, file)))) {
		throw new Error(`The build changed public/${file}.`);
	}
}
```

`public/` 里的文件应该逐字节不变。现在只要破坏了这一点，构建就会失败。我们还特意去掉过滤规则，亲眼看它报错。

## Bug 3：只有截图才看得出

博客标题在列表里多了一对引号：`'Fix Vite "Blocked request"...'`。含引号的标题在 front matter 里用引号包着，那个小解析器把它们留了下来。所有检查都通过了，只有看截图才发现。

## 现在我们检查什么

- **和被替换的东西对比。** 迁移有一个完美的测试：旧网站。
- **看内容，不看状态码。** 断言文件里到底是什么，机器要读的东西尤其如此。
- **让构建在不可能的状态下失败。** 页面没有样式表、公共文件被改动，都应该拦住部署。有些配置下页面确实没有样式，构建却照样成功。
- **找一个外部审计。** Lighthouse 发现了一个它本来没在找的 bug。
- **亲眼看页面。** 有些错误只有眼睛能发现。
