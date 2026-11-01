# 给这个项目加测试

核对时的版本：Solid 2.0.0-rc.20、`@solidjs/vite-plugin` 3.0.0-next.54、`@stylexjs/unplugin` 0.19.1、Vite 8.3.5、TypeScript 7.0.2、Node.js 26.13.0、pnpm 12.16.1，加上下面表里的测试包。日期 2026-10-31。

模板本身不带测试。这份文档写的是怎么加：下面的配置和测试都在这个项目的一份副本里实际跑过（5 个文件、11 个测试全部通过），`pnpm check` 通过，`pnpm build` 的产物和不加测试时逐字节相同。没跑过的放在最后一节，明确标出。

## 装什么

```sh
pnpm add -D -E vitest@5.0.5 @solidjs/testing-library@1.0.0-rc.2 @testing-library/jest-dom@7.0.1 jsdom@30.1.3
```

| 包                          | 版本       | 发布标签                                                  |
| --------------------------- | ---------- | --------------------------------------------------------- |
| `vitest`                    | 5.0.5      | `latest`                                                  |
| `@solidjs/testing-library`  | 1.0.0-rc.2 | `next`（`latest` 是 0.8.10，它的 peer 里要 Solid Router） |
| `@testing-library/jest-dom` | 7.0.1      | `latest`                                                  |
| `jsdom`                     | 30.1.3     | `latest`                                                  |

装之前照样逐个 `npm view <包> dist-tags`。`@solidjs/testing-library` 和 Solid 其他包一样，要的版本不在 `latest` 下；1.0 系列的 peer 是 `solid-js >=2.0.0-0`。

对安装的影响：

- `pnpm-workspace.yaml` 不用改。`pnpm peers check` 输出 `No peer dependency issues found`，也没有被拦下的安装脚本。`@solidjs/testing-library` 落在已有的 `minimumReleaseAgeExclude` 的 `@solidjs/*` 里。
- 锁文件里 `@solidjs/diagnostics` 和 `@solidjs/vite-plugin` 的版本没有变，只是括号里的 peer 后缀变长：它们分别把 `vitest` 和 `@testing-library/jest-dom` 声明成可选 peer，现在解析到了。
- 只装了一份 `@testing-library/dom`（10.4.2）。它是 `@solidjs/testing-library` 的依赖，同时满足 jest-dom 的 peer。

## 配置

`vite.config.ts` 和 `vitest/config` 的 `defineConfig` 能共存，不需要单独的 `vitest.config.ts`。Solid 和 `fileRoutes` 两个插件不用改，StyleX 插件要改一处（原因见下）：

```ts
import solid from "@solidjs/vite-plugin";
import stylex from "@stylexjs/unplugin";
import { fileRoutes } from "filesystem-routing/vite";
import { defineConfig } from "vitest/config";

// StyleX must compile before Solid transforms JSX.
const stylexPlugin = stylex.vite({
  useCSSLayers: true,
  lightningcssOptions: { minify: true },
});

export default defineConfig(({ mode }) => ({
  plugins: [
    // Its dev-server hook starts a timer that only stops when the HTTP server closes, and
    // vitest's server has none: with the hook, every run waits out teardownTimeout.
    mode === "test" ? { ...stylexPlugin, configureServer: () => {} } : stylexPlugin,
    solid({ start: true, extensions: [".jsx", ".tsx"], diagnostics: true }),
    fileRoutes({ types: true }),
  ],
  server: {
    forwardConsole: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest-setup.ts"],
  },
}));
```

这里只列了和测试有关的改动，原文件里解释各个插件的注释照留。也可以保留 `import { defineConfig } from "vite"`，在文件第一行加 `/// <reference types="vitest/config" />`：`tsc` 和测试同样通过。

`vitest-setup.ts`，放在项目根目录：

```ts
// Registers jest-dom's matchers (toHaveTextContent and so on) with vitest's expect, types
// included.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@solidjs/testing-library";
import { afterEach } from "vitest";

// The testing library only unmounts by itself where `afterEach` is a global, and `globals`
// is off here.
afterEach(cleanup);
```

其余三处：

- `package.json` 的 `scripts` 加 `"test": "vitest run"`。不带 `run` 时，`vitest` 在交互终端里进入监听模式，不退出（这是读 vitest 默认配置得出的，监听模式本身没有跑过）。
- `tsconfig.json` 的 `include` 加 `"vitest-setup.ts"`。`types` 不用动，测试文件都显式 `import ... from "vitest"`。不用装 `@types/node`。
- `mise.toml` 加一个任务，`mise run test` 跑过：

  ```toml
  [tasks.test]
  description = "Run the tests once with vitest"
  run = "pnpm test"
  ```

### 这些配置为什么是这样

- **StyleX 插件必须留在测试里。** 去掉它，所有引用了 `tokens.stylex.ts` 的测试文件在加载时就失败：`Unexpected 'stylex.defineConsts' call at runtime. Styles must be compiled by '@stylexjs/babel-plugin'.` 它在 vitest 下能正常编译，组件上能拿到 StyleX 生成的类名。
- **不改 `configureServer`，每次运行多等 10 秒。** 测试全过、退出码 0，但结尾打印 `close timed out after 10000ms` 和 `Tests closed successfully but something prevents 2 Vite servers from exiting`。逐个去掉插件确认是 StyleX：它的 `configureServer` 开了一个 150ms 的 `setInterval`，只在 `server.httpServer` 关闭时清掉，而 vitest 的服务是中间件模式，`httpServer` 是 `null`（打印确认过）。去掉这个钩子后，一次运行从约 11 秒降到约 2 秒。`hanging-process` 报告里列的是一个文件句柄，指不到这里，别被它带偏。开发服务和构建走的是原来的插件，不受影响；改了之后用 curl 请求开发服务的首页和 `/virtual:stylex.css`，都返回 200。
- **`environment: "jsdom"` 要自己写。** Solid 插件的 README 说明它不再替你设，vitest 的默认值是 `node`。
- **`cleanup` 要自己挂。** `@solidjs/testing-library` 的自动清理写的是 `typeof afterEach === "function"`，只认全局的 `afterEach`，而 `globals` 默认关闭。不挂的话，上一个测试的页面留在 `document` 里，`screen.getByRole("button")` 报 `Found multiple elements with the role "button"`。设 `globals: true` 也能解决（跑过，同样通过），这里选择显式导入。
- **`import "@testing-library/jest-dom/vitest"` 只为了类型。** Solid 插件检测到装了 jest-dom，会自己把它加进 `setupFiles`，所以运行时不写也行；但不写的话 `tsc` 报 `Property 'toHaveTextContent' does not exist`。
- **官方模板里的 `isolate: false` 这里没有用。** 那是性能上的选择，它自己的注释也说测试少时可以去掉。这里 11 个测试用默认的隔离，一次不到 1 秒；`--no-isolate` 也跑过，同样通过。

Vitest 检测到自己运行在编码 agent 里时，默认报告器换成 `minimal`，通过的测试不显示，它们的 `console.log` 也不显示。要看就加 `--reporter=default`。

## 写测试

测试文件放在被测文件旁边，叫 `*.test.ts` 或 `*.test.tsx`。

**放在 `src/routes` 下也可以，只要没有默认导出。** `fileRoutes` 按“有默认导出”判断页面。`src/routes/index.test.tsx` 放进去之后，`file-routes.d.ts` 没有变化，构建产物也没有变化。测试文件里不要写 `export default`。

**用 `screen`，不要解构 `render` 的结果。** `const { getByRole } = render(...)` 过不了这个项目的 lint：`typescript(unbound-method)`。这条规则不压，查询都写成 `screen.getByRole(...)`，它依赖上面的 `cleanup`。

### 纯逻辑

模板里没有纯逻辑，核对时临时加了一个函数。不碰 DOM 的测试可以用文件顶部的注释换成 Node 环境，省掉 jsdom 的启动时间（在一次运行里，环境准备占了约一半时间）：

```ts
// @vitest-environment node
import { expect, test } from "vitest";
import { plural } from "./format.ts";

test("plural", () => {
  expect(plural(1, "item", "items")).toBe("item");
  expect(plural(2, "item", "items")).toBe("items");
});
```

### 组件：`src/ui/Button.tsx`

`render` 接受的是一个函数，不是元素。

```tsx
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, test, vi } from "vitest";
import { Button } from "./Button.tsx";

describe("Button", () => {
  test("renders a type=button with its label and compiled StyleX classes", () => {
    render(() => <Button>保存</Button>);
    const button = screen.getByRole("button", { name: "保存" });
    expect(button).toHaveAttribute("type", "button");
    // The class names are StyleX's output; the rules behind them are not on the page here.
    expect(button.className).not.toBe("");
  });

  test("calls onClick", () => {
    const onClick = vi.fn();
    render(() => <Button onClick={onClick}>保存</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  test("a disabled button does not fire", () => {
    const onClick = vi.fn();
    render(() => (
      <Button disabled onClick={onClick}>
        保存
      </Button>
    ));
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
```

### Solid 的写入要 `flush()`

点击后信号的写入不会马上到页面上。下面这个测试通过，也就是说点击刚返回时按钮上还是 `0`：

```tsx
fireEvent.click(button);
expect(button).toHaveTextContent("0");
flush(); // from "solid-js"
expect(button).toHaveTextContent("1");
```

自己写的组件在断言前调 `flush()`，或者用 `await screen.findBy...`。走 `src/ui/transition.ts` 的 `transition()` 的写入不用：它自己调了 `flush()`。

### 页面：`src/routes/index.tsx`

jsdom 没有 `document.startViewTransition`，所以 `transition()` 走直接应用的那条路，点击返回时数字已经变了。首页不依赖路由，可以直接渲染。

```tsx
import { captureArtifact, expectNoDiagnostics, expectRerunBudget } from "@solidjs/diagnostics";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, test } from "vitest";
import Home from "./index.tsx";

describe("home page", () => {
  test("counts clicks", () => {
    render(() => <Home />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("计数：0");
    fireEvent.click(screen.getByRole("button", { name: "加一" }));
    // transition() flushes, so the count is on the page as soon as the click returns.
    expect(status).toHaveTextContent("计数：1");
    fireEvent.click(screen.getByRole("button", { name: "加一" }));
    expect(status).toHaveTextContent("计数：2");
  });

  test("a click re-runs one scope and trips no diagnostic", async () => {
    const { artifact } = await captureArtifact(
      () => {
        render(() => <Home />);
        fireEvent.click(screen.getByRole("button"));
        expect(screen.getByRole("status")).toHaveTextContent("计数：1");
      },
      { scenario: "home-click" },
    );
    expectNoDiagnostics(artifact);
    expectRerunBudget(artifact, 1);
  });
});
```

### 诊断

`@solidjs/diagnostics` 已经是模板的开发依赖。Solid 插件让 vitest 用开发构建，所以 `captureArtifact` 能用。它有两个作用：`expectNoDiagnostics` 抓响应式的错误写法，`expectRerunBudget` 限制一次操作重跑多少个作用域。首页点一次只重跑 1 个，`artifact.attribution.reruns` 里写的是 `span.children`，起因是对 `count` 的写入。

把上限写成多少，就是把现在的行为钉住。放宽之前先看 `artifact.attribution.reruns` 里是什么重跑了、为什么。诊断代码的修法见 `node_modules/solid-js/skills/reactivity-diagnostics/SKILL.md`。

### 假的视图过渡

只能检查“改动是不是经过了 `startViewTransition`”，看不到动画。一旦有了 `startViewTransition`，`transition()` 就会调 `matchMedia`，jsdom 也没有它，不一起补上会报 `TypeError: matchMedia is not a function`。

```tsx
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, test, vi } from "vitest";
import Home from "./index.tsx";

describe("with view transitions", () => {
  afterEach(() => {
    Reflect.deleteProperty(document, "startViewTransition");
    vi.unstubAllGlobals();
  });

  test("the change runs inside startViewTransition", () => {
    // jsdom has neither of these. This checks the call, not the animation.
    const start = vi.fn((change: () => void) => {
      change();
      return { ready: Promise.resolve() };
    });
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: start });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));

    render(() => <Home />);
    fireEvent.click(screen.getByRole("button"));
    expect(start).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("计数：1");
  });
});
```

### 整个应用，带路由

`src/App.tsx` 和 `virtual:file-routes` 在 vitest 下都能用。每个路由是单独的块，页面在 `render` 返回之后才到，要用 `findBy...` 等。地址用 `history.pushState` 设，测试结束后改回来。

```tsx
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, test } from "vitest";
import App from "./App.tsx";

afterEach(() => {
  window.history.pushState({}, "", "/");
});

test("the home route, through the router", async () => {
  render(() => <App />);
  // Each route is a chunk of its own, so the page arrives after render() returns.
  const status = await screen.findByRole("status");
  expect(status).toHaveTextContent("计数：0");
  fireEvent.click(screen.getByRole("button", { name: "加一" }));
  expect(status).toHaveTextContent("计数：1");
});

test("an unknown address gets the 404 route", async () => {
  window.history.pushState({}, "", "/nope");
  render(() => <App />);
  expect(await screen.findByRole("heading", { name: "页面不存在" })).toBeInTheDocument();
});
```

`render` 的类型和注释里有个 `location` 选项，说是“包一层内存路由”。在 1.0.0-rc.2 上它没有实现：源码只读了 `container`、`baseElement`、`queries`、`hydrate`、`wrapper`，传 `{ location: "/nope" }` 渲染出来的还是首页。

## jsdom 告诉不了你什么

测试通过只说明结构和行为对。下面这些在 jsdom 30.1.3 里实际打印过：

| 要看的                                 | jsdom 里                                                                                                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| StyleX 的样式                          | 类名有，规则没有：`document.styleSheets` 是 0 条，`getComputedStyle` 的 `display` 是 `inline-block`（按钮的默认值，不是 `inline-flex`），`minHeight` 是 `auto` |
| 布局                                   | `getBoundingClientRect()` 宽高都是 0                                                                                                                           |
| 视图过渡                               | `document.startViewTransition` 不存在                                                                                                                          |
| 媒体查询（深浅色、减少动态效果、窄屏） | `matchMedia` 不存在                                                                                                                                            |
| 对话框、浮层                           | `HTMLDialogElement.prototype.showModal`、`HTMLElement.prototype.showPopover` 不存在                                                                            |
| 动画、观察器                           | `element.animate`、`ResizeObserver`、`IntersectionObserver` 不存在                                                                                             |

[web-platform.md](web-platform.md) 推荐的平台能力，这里有不少测不到：用了 `<dialog>` 和 `popover` 的组件在 jsdom 里调不了 `showModal()`、`showPopover()`。这些和视觉、动效、深浅色、手机宽度一样，仍然要按 `AGENTS.md` 的第 3、4 步在真实浏览器里走。测试也不替代第 2 步的 `pnpm build`：生成的 CSS 不在这些测试的断言范围里。

## 确认测试真的会失败

逐项临时改代码，跑 `pnpm test`，确认失败，再改回来。这些都做过：

| 临时的改动                                      | 结果                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| 纯函数里 `count === 1` 改成 `count === 2`       | `plural` 失败：`expected 'items' to be 'item'`                               |
| `Button.tsx` 的 `type="button"` 改成 `"submit"` | 第 1 个 `Button` 测试失败                                                    |
| `Button.tsx` 删掉 `{...rest}`                   | `Button` 和首页共 6 个失败（文字、`onClick`、`disabled` 都丢了）             |
| `transition.ts` 删掉 `flush()`                  | 首页 3 个失败，数字没有到页面上                                              |
| 首页 `value + 1` 改成 `value + 2`               | 首页 3 个失败                                                                |
| 首页组件体里加一句 `const seen = count();`      | 只有诊断那个失败：`STRICT_READ_UNTRACKED`，`"count" read directly in <Home>` |
| `vitest-setup.ts` 去掉 `afterEach(cleanup)`     | 5 个失败：`Found multiple elements with the role "button"`                   |
| 测试模式下去掉 StyleX 插件                      | 引用 StyleX 的文件全部加载失败，见上面的报错                                 |

改回来之后全部通过。

## 对检查和构建的影响

- `pnpm check`（oxfmt、`tsc`、带类型信息的 oxlint 加 `eslint-plugin-solid`）带着测试文件通过，退出码 0。`check` 不包含测试，要单独跑 `pnpm test`。
- `pnpm build`：加了测试包、测试文件（包括 `src/routes/index.test.tsx`）和上面的配置之后，`dist/` 和不加时 `diff -r` 没有任何差别。测试文件没有被任何入口引用，不进产物。
- `file-routes.d.ts` 不变。
- 运行测试不会在项目目录里留下文件，缓存都在 `node_modules` 下。

## 没有做的

- `happy-dom` 没有试过。Solid 插件的 README 说它也行。
- `vitest` 的监听模式、覆盖率、浏览器模式（`@vitest/browser-playwright`）都没有试过。要在测试里拿到真实样式和视图过渡，浏览器模式是可以查的方向，这里不保证能用。
- 这些测试只在 macOS 上跑过，没有进 CI。
