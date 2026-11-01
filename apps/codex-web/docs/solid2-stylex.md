# 用 Solid 2 + StyleX 做前端：实战经验

这份文档是写给要在这个目录里写代码的人和智能体的指引：这套技术栈里每件事该怎么做、为什么，以及它替换的是哪个旧习惯。每一条都来自用它把几个真实产品从零做到上线时踩过、验证过的事，不是从文档里抄的；只写**换个项目仍然成立**的部分。

动这个目录里的代码之前先读它，再读装好的包里自带的文档（见“动手之前”）。写界面之前还要读 [web-platform.md](web-platform.md)：浏览器自带了什么、在这套技术栈里怎么写。

活的例子就是这个模板本身：`vite.config.ts`、`src/App.tsx`、`src/Document.tsx`、`src/routes/`、`src/ui/`、`src/components/`。文末“这个模板里核对过什么”写明了哪些条目在这里用当前版本重新验证过，哪些是带过来的。

## 版本

2026-10-31 安装并验证的版本（上一次核对是 2026-10-12）。全部在 `package.json` 里写死，不用范围。

| 包                                                 | 版本                     | 取自哪个发布标签                                                                                                                   |
| -------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `solid-js`、`@solidjs/web`、`@solidjs/diagnostics` | 2.0.0-rc.20              | `next`                                                                                                                             |
| `@solidjs/router`                                  | 2.0.0-next.43            | `next`                                                                                                                             |
| `@solidjs/vite-plugin`                             | 3.0.0-next.54            | `latest`（它的 `next` 是旧的 next.35）                                                                                             |
| `filesystem-routing`                               | 0.4.2                    | `latest`                                                                                                                           |
| `@stylexjs/stylex`、`@stylexjs/unplugin`           | 0.19.1                   | `latest`                                                                                                                           |
| `unplugin`                                         | 3.7.0                    | `latest`（在 StyleX 声明的范围之外，见下）                                                                                         |
| `vite`                                             | 8.3.5                    | `latest`                                                                                                                           |
| `typescript`                                       | 7.0.2                    | `latest`                                                                                                                           |
| `eslint-plugin-solid`                              | 0.18.1                   | `latest`                                                                                                                           |
| `oxlint`、`oxfmt`、`oxlint-tsgolint`               | 1.90.0、0.75.0、7.0.2005 | `latest`                                                                                                                           |
| Node.js、pnpm（`mise.toml`）                       | 26.13.0、12.16.1         | Node.js 是 `mise ls-remote` 里最新的正式版；pnpm 取 npm 的 `latest`（`mise ls-remote` 里还列着 12.17.0，不在 `latest` 下，没有用） |

这一组最新版本一次就构建、运行通过，没有哪个包需要退回旧版。

几件和版本有关的事：

- **Solid 2 还是候选版本**，正式版之前接口可能变。升级后以包里自带的文档为准。
- **`unplugin` 用的是 3.x，在 StyleX 声明的范围之外。** `@stylexjs/unplugin` 0.19.1（它的 `latest`）的 `peerDependencies` 是 `unplugin ^2.3.11`，还没有发过放宽到 3.x 的版本。实际上能用：2026-10-12 换成 `unplugin` 3.4.0 后，构建出的 CSS 和页面脚本与 2.3.11 时逐字节相同，开发服务上样式照常生效、日志里没有错误；2026-10-31 升到 3.7.0 后没有再和 2.x 比字节，构建和开发服务上的样式照常。两个版本的差别在打包方式：3.x 只发 ES 模块（2.x 两种都发），所以要 Node.js 20.19 或 22.12 以上；StyleX 的插件只用到它的 `createUnplugin`。`pnpm-workspace.yaml` 里用 `peerDependencyRules.allowedVersions` 把这一处不匹配写明了，安装时不再报警告；StyleX 放宽声明之后把那一条删掉。升级 StyleX 或 `unplugin` 之后照“怎么验证”重新走一遍，这个组合没有上游替我们测。
- **`eslint-plugin-solid` 不经过 eslint，也不在 TypeScript 7 的声明范围里。** 它声明 `eslint` 是对等依赖，这里由 oxlint 运行它，所以不装 eslint；它带进来的 `@typescript-eslint/*` 声明 `typescript <6.1`，这里是 7.0.2。实测（0.18.1、oxlint 1.90.0）：解构 props 报 `solid(no-destructure)`，从不写入的信号报 `solid(no-unused-signal)`。这两处不匹配写在 `pnpm-workspace.yaml` 的 `peerDependencyRules` 里。
- **`@solidjs/router` 跟着 `solid-js` 走。** next.43 的 `peerDependencies` 要求 `solid-js` 和 `@solidjs/web` 是 `^2.0.0-rc.19`，`filesystem-routing` 是 `>=0.4.0`。升级前用 `npm view @solidjs/router@<版本> peerDependencies` 看一眼。
- **`@solidjs/vite-plugin` 从 next.47 到 next.49 有两处行为变了**（读的是装好的包里的 `dist/esm/index.mjs`，第二条在一份临时拷贝里构建确认过）：外壳渲染失败（处理器回的不是 2xx）时构建直接报错，不再把错误页写成 `index.html`；配置里只要还有别的插件带 `buildApp` 钩子，它就不再删 `dist/server`，留给那个钩子用。后一条关系到“按地址各渲染一份外壳”的做法，见“文档外壳”一节。
- **间接依赖由锁文件固定。** `@solidjs/compiler`、`@solidjs/babel-plugin`、`@solidjs/signals` 是 Solid 的包自己带进来的，跟 `solid-js` 同一套发布。`pnpm-lock.yaml` 要提交。

### 升级 Solid 的包

整套一起升，不单独升某一个：

1. `mise run outdated` 列出落后的包（它按上表的标签查）；要看别的通道，逐个看标签：`npm view <包名> dist-tags`，必要时 `npm view <包名> versions`。发布标签变了就改 `mise.toml` 里那张表。
2. `solid-js`、`@solidjs/web`、`@solidjs/diagnostics` 改成同一个版本；`@solidjs/router`、`@solidjs/vite-plugin`、`filesystem-routing` 各取自己那条线上最新的。
3. 改 `package.json` 里的版本号，`pnpm install`。
4. 重读 `node_modules/solid-js/CHEATSHEET.md` 末尾“和 1.x 的区别”和各包 README 里变了的部分。
5. 把“怎么验证”一节从头走一遍。最新的组合构建不过或跑不起来时，退到能跑的最新一组，并把具体哪里失败写进这份文档的“版本”一节。
6. 更新上面的表。

### pnpm 的发布时间策略

pnpm 12 默认不安装发布不足 1 天（`minimumReleaseAge` 是 1440 分钟）的版本。Solid 2 的包成套发布、发得很勤，写死的版本常常是当天的，所以 `pnpm-workspace.yaml` 里把 `solid-js`、`@solidjs/*`、`filesystem-routing` 排除在这条策略之外（官方模板也是这样做的）。Solid 2 出正式版之后把这几行删掉。

别的包钉到一个发布不足 1 天的版本时，pnpm 不会报错：它自动往 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 里加一条带确切版本号的记录，并在安装输出里说明（2026-10-12 的 `vite@8.3.4` 就是这样加进去的，安装时它发布了约 6 小时）。这种记录在下次升级那个包时删掉。想让它先问一声，设 `minimumReleaseAgeStrict: true`。

**pnpm 12.16 的 Agent 技能权限。** `@solidjs/diagnostics`、`@solidjs/web`、`solid-js` 自带给智能体看的技能，没有决定时每次安装都提示 `Agent skills awaiting approval`。批准会在这个目录建 `.claude/skills`（只对一种智能体有用）。这个模板在 `pnpm-workspace.yaml` 的 `permissions` 里把它们设成 `skills: false`：提示消失，技能文件仍然在 `node_modules` 里，下面“动手之前”列的路径照样能读，换哪个智能体都一样。

`pnpm-workspace.yaml` 还有一个作用：它把这个目录标成自己的根。这个目录放在更大的仓库里时，依赖和锁文件仍然留在这里。

## 动手之前

**Solid 2 不是 React，也不是 Solid 1.x。** AI 和人对它的“常识”大多来自 1.x，照着写会错。安装之后先读包里自带的这几份，它们和装的版本严格对应：

- `node_modules/solid-js/CHEATSHEET.md`：一页速查，末尾有“和 1.x 的区别”清单，必读。
- `node_modules/@solidjs/vite-plugin/README.md`：start 模式、入口生成、文档外壳、各个选项的默认值。
- `node_modules/@solidjs/router/README.md`：路由、链接、预加载、文件路由。
- `node_modules/filesystem-routing/README.md`：文件名到地址的约定。
- `node_modules/@stylexjs/unplugin/README.md`：StyleX 插件的选项和开发环境的接法。
- `node_modules/solid-js/skills/reactivity-diagnostics/SKILL.md`：控制台出现诊断代码时查它，每个代码对应一种修法。
- `node_modules/@solidjs/diagnostics/skills/agent-loops/SKILL.md`：怎么取“哪个作用域重跑了、为什么”的证据，而不是靠读代码猜。

**读文档要读到“我没有设置的参数的默认值”。** 这套技术栈里好几个坑都出在默认值上：StyleX 生成的 CSS 默认不压缩、默认追加到构建里的第一个 CSS 文件、默认按一组没人选过的浏览器目标降级；Vite 默认只在检测到编码智能体时才把浏览器控制台转到终端；pnpm 默认有发布时间策略。它们各自在下面对应的小节里。

**装包前先看发布标签。** 运行 `npm view <包名> dist-tags`。Solid 2 系列在预发布通道上，而且各包不一致：`solid-js` 的 2.0 在 `next` 标签下，`@solidjs/vite-plugin` 的最新版却在 `latest` 下，它的 `next` 是旧的。照习惯装 `@next` 会装到旧版本。

## 起步：照官方模板来

不要自己拼。官方模板是 `solidjs/templates` 仓库里的 `solid-v2/basic`（`npx degit solidjs/templates/solid-v2/basic`），这个模板就是照它的结构来的：

- **没有 `index.html`，也没有挂载文件。** Vite 插件的 start 模式围绕两个约定文件生成入口：`src/App.tsx` 是应用，`src/Document.tsx` 是文档外壳（相当于以前的 `index.html`）。
- **路由就是文件。** `filesystem-routing` 扫描 `src/routes`，`@solidjs/router/fs` 把它变成路由（`src/router.ts`）。`index.tsx` 是 `/`，`posts/[id].tsx` 是 `/posts/:id`，`[...404].tsx` 兜底。不需要第三方路由库，也不要手写入口。
- **纯客户端渲染时**，`vite build` 产出纯静态的 `dist/client`，可以放到任何静态托管上。

`vite.config.ts` 里插件的顺序有讲究，StyleX 必须在 Solid 前面：

```ts
plugins: [
  stylex.vite({ useCSSLayers: true, lightningcssOptions: { minify: true } }),
  solid({ start: true, extensions: [".jsx", ".tsx"], diagnostics: true }),
  fileRoutes({ types: true }),
],
```

`extensions` 不能省：`fileRoutes` 产出的路由模块地址以查询串结尾（`?pick=…`），有了它 Solid 插件才会编译这些模块。

`tsconfig.json` 里 `"jsx": "preserve"`、`"jsxImportSource": "@solidjs/web"`。DOM 相关的东西从 `@solidjs/web` 导入，不是 `solid-js/web`。

`file-routes.d.ts` 是插件生成的路由类型文件，要提交到仓库（类型检查需要它，`src/router.ts` 里 `paths` 的类型也来自它），但要从格式化和 lint 里排除。增删路由文件后，开着的开发服务或下一次构建会重写它。

这个模板和官方模板不一样的地方：加了 StyleX；版本写死；格式化用 oxfmt、lint 用带类型信息的 oxlint（`oxlint.config.ts`，和官方模板一样通过 `jsPlugins` 接入 `eslint-plugin-solid` 的 2.0 规则集）；没有带官方模板里的 `@solidjs/meta`（每页各自的标题）和 vitest。要写测试时看 [testing.md](testing.md)。

## Solid 2 的要点

先看这张表。左边是从 React 和 Solid 1.x 带来的习惯，右边是这里的写法；每一行在 `node_modules/solid-js/CHEATSHEET.md` 或路由的 README 里都有出处。

| 带来的习惯                                | 这里的写法                                                        |
| ----------------------------------------- | ----------------------------------------------------------------- |
| 组件函数每次更新都重跑（React）           | 组件函数只跑一次；会变的东西在 JSX、memo、effect 里读             |
| `useState`、`useEffect`、依赖数组         | `createSignal`、两段式的 `createEffect(计算, 执行)`，依赖自动追踪 |
| 解构 props：`function Card({ title })`    | `props.title`；传的时候调用访问器：`title={title()}`              |
| `className`、拼类名字符串                 | `{...stylex.attrs(…)}`（原生的 `class` 也支持对象和数组）         |
| `onMount` 加 `onCleanup`                  | `onSettled`，返回的函数就是清理                                   |
| `Suspense`、`ErrorBoundary`               | `Loading`、`Errored`                                              |
| `createResource`                          | 返回 Promise 的 `createMemo`，外面包 `<Loading>`                  |
| `splitProps`、`mergeProps`                | `omit`、`merge`                                                   |
| `<Index>`                                 | `<For keyed={false}>`                                             |
| `batch()`                                 | 不需要：写入本来就攒到下一个微任务；要立刻生效用 `flush()`        |
| `produce`、路径式的 store 写法            | `setStore((草稿) => { 草稿.x = 1 })`                              |
| `Context.Provider`                        | `<Context value={…}>`                                             |
| `use:指令`                                | `ref={指令(参数)}`                                                |
| 从 `solid-js/web`、`solid-js/store` 导入  | `@solidjs/web`、`solid-js`                                        |
| `<A>` / `<Link>` 组件，JSX 里的 `<Route>` | 普通的 `<a>`；路由是 `src/routes` 下的文件                        |
| `index.html` 加 `render()` 的挂载文件     | `src/Document.tsx` 和 `src/App.tsx`，入口由插件生成               |
| 手搭弹窗、菜单、校验、深色模式开关        | 浏览器自带的那一个，见 [web-platform.md](web-platform.md)         |

下面每一条都是实际写错过、被诊断或审查纠正的地方，写的是该怎么做和为什么。

**状态写入要到下一个微任务才生效。** `setCount(1)` 之后立刻读 `count()` 还是旧值。所以：

- 事件处理里要用“刚输入的值”时，直接读页面元素（比如 `input.value`），不要读信号。
- 在旧值上算新值用函数形式：`setCount((value) => value + 1)`（`src/routes/index.tsx`）。
- 要让浏览器在同一个回调里就看到新的 DOM（视图过渡、紧接着量尺寸）时，写完调用 `flush()`。`src/ui/transition.ts` 就是这样把一次状态变化交给视图过渡的：不刷新，浏览器拍到的“之后”和“之前”是同一个画面。
- 和框架无关的业务逻辑（同步、重连、缓存）放在框架外面，自己持有真实状态，只把结果“发布”给界面，绝不反过来从界面状态里读。

**渲染过程中不能写状态。** 组件函数体、memo、effect 的计算阶段里写状态，开发模式会直接报错并停掉整个响应式系统。写操作放在事件处理、`onSettled` 或 effect 的第二个函数里。特别注意：路由的 `preload` 可能在渲染过程中被调用，里面要写状态就包一层 `queueMicrotask`。

**effect 是两段式的。** `createEffect(计算, 执行)`：第一个函数里读的东西才会被追踪，第二个函数里读响应式的值不会被追踪，还可能是旧的。需要的值都在第一个函数里读出来，作为参数传给第二个。第一个函数依赖的东西一变，第二个函数就会再跑，**哪怕算出来的值和上次一样**：`createEffect(() => props.open, …)` 在 `open={step.status === "failed"}` 从运行中变成已完成时也会跑一次，把人手动展开的折叠收起来（Solid 2.0.0 RC，浏览器里实测）。只想在值变化时才跑，先读一个 memo：`const wanted = createMemo(() => props.open)`，它默认用 `===` 比较。

**不要解构 props，传值时要调用。** 子组件里用 `props.x`；父组件传的是 `value={count()}`，不是 `value={count}`。要去掉自己的属性再把其余的透传下去，用 `omit(props, …)`（`src/ui/Button.tsx`）。

**组件函数体里读 props、信号或 store 要有说法。** 组件函数体不是追踪范围，在里面直接读响应式的值只会读到初始值，开发模式报 `STRICT_READ_UNTRACKED`。要它跟着变，就在 JSX、memo 或 effect 的计算函数里读；确实只要读一次（“这个实例只属于这一个 id”），把意图写出来：`untrack(() => props.item.id)`。

**流程组件的回调不是追踪范围。** `<For>`、`<Show>` 的回调函数体里直接读访问器只会读到初始值，要在 JSX 里读。回调直接返回一个算出来的值也算在函数体里读：`{(item) => name(item())}` 会报 `STRICT_READ_UNTRACKED`，写成 `{(item) => <>{name(item())}</>}`。`<For>` 默认按对象身份区分条目，回调拿到的是原始条目和索引访问器。

**列表行按“种类”分支时，用小函数配 `<Show>`。** 写一个“是这种就返回它、不是就返回 `undefined`”的函数（比如 `asReply(message)`），交给 `<Show when={…}>`，不要在回调体里读 `message.kind`。

**交给命令式对象的回调，可能在 effect 的执行函数里被同步调用。** 典型情形：effect 把新状态推给一个命令式的对象（画布场景、地图、编辑器），对象在这次调用的途中回调页面，回调里读了信号。读到的值是对的，但开发模式报 `STRICT_READ_UNTRACKED`（实测：同一个回调从事件处理里调不报，从 effect 的执行函数里调就报）。交给这类对象的回调统一包一层：`onChanged: () => untrack(() => props.onChanged())`，包上之后不再报。自己写的函数如果既会从事件里调、又会从 effect 的执行函数里调，里面读响应式的值也要 `untrack`。

**组件生命周期用 `onSettled`**，它返回的函数就是清理函数。没有 `onMount`。

**`ref` 回调里拿到元素时它还没进文档。** 要量尺寸、要聚焦的事放到 `requestAnimationFrame`、`queueMicrotask` 或 `onSettled` 里。

**ARIA 的布尔属性要写成字符串。** `aria-expanded={open()}` 这类属性类型不让传布尔值（类型检查报错），写 `open() ? "true" : "false"`。普通的布尔属性（`disabled`、`hidden`）按“有或没有”处理，直接传布尔值。

**内置属性名是小写的**（`tabindex`、`charset`），事件处理仍然是驼峰（`onClick`）。事件处理只绑定一次，绑定的表达式不是响应式的：要按条件换处理函数，把判断写进一个固定的处理函数里面。

**列表更新按键值做增量。** 用 store 存列表时，更新要逐个字段写，列表用 `reconcile(新数据, "id")(草稿.列表)`。整体替换一个“大部分内容没变”的对象，诊断会警告，而且所有读它的地方都会重跑。从框架外的引擎往 store 里发布快照时也一样：没变的东西保持同一个对象，列表里的东西都带 `id`。

**同一个对象不能同时放在 store 的两个位置。** 比如一条消息既在“消息列表”里又在“会话预览”里。store 对每个对象只维护一套订阅，改了之后只有一处会更新。要放两处就复制一份。

**需要“换一个就整个重来”的组件，用带 `keyed` 的 `<Show>`。** 比如按 id 切换的详情窗口：`<Show when={id} keyed>{(id) => <Thread id={id} />}</Show>`，每个 id 得到一个全新的实例，滚动位置、草稿这些状态自然归零，不用写一堆重置逻辑。

**跟着地址读数据，不用 effect 转手。** “地址变了 → effect 里叫引擎去读 → 引擎写回 store”会让同时读地址和读结果的地方先画一帧对不上的（诊断 `EFFECT_RELAY_TEAR`）。做法同上一条：用带 `keyed` 的 `<Show>` 给每个值一个新的组件实例，实例在 `onSettled` 里开始读、在它返回的函数里放手；数据那边按值各存一份，实例只读自己的那份。

**列表的每一行只返回一个根元素。** 行组件返回片段、里面又有条件渲染时，父级会去追踪每一行内部的东西，行数一多就触发诊断。

**很长的列表，屏幕外的行不排版。** 每一行设 `content-visibility: auto`，浏览器只排看得见的那几条，靠滚动锚定保持正在读的位置不动。上百条长内容的列表，打开和流式更新的帧率差别很大。

**把开发模式的诊断当工具。** 开发服务用的是 Solid 的开发构建（插件的 `dev` 选项，默认开），写得不对的地方会在控制台给出带代码的提示（比如 `IMMUTABLE_UPDATE_IN_STORE`、`STRICT_READ_UNTRACKED`、`EFFECT_RELAY_TEAR`），每个代码在 `reactivity-diagnostics/SKILL.md` 里都有对应的修法。改完代码打开页面看一眼控制台，是成本最低的检查。唯一可以忽略的是：开着热更新时，超过约 50 行的组件列表会报 `WIDE_SCOPE_DEPS`，那是热更新包装带来的，关掉热更新（`refresh: false`，Vite 插件 next.49 里叫 `hot`）或生产构建里没有。其余的诊断都是真的，要修。

## 路由

- **链接就是 `<a>`。** 没有链接组件。路由通过事件委托接管同源的点击，不重新加载页面（`src/routes/[...404].tsx`）。当前页的链接自动带 `aria-current="page"`，路径匹配的带 `data-active`；样式里把属性选择器当键来选中它们：`fontWeight: { default: 400, "[aria-current='page']": 600 }`（这个写法构建过，也在浏览器里看过）。给 `<a>` 加 `target` 就不归路由管。**“跳到正文”这种页内锚点（`href="#main"`）也会被路由接管**，地址变了但焦点不动，用键盘的人还停在页首；给它加 `target="_self"`，浏览器自己滚过去并把焦点移到目标上（目标要有 `tabindex="-1"`）。
- **地址用 `paths` 拼。** `src/router.ts` 导出的 `paths` 是从路由文件推出来的带类型的地址：`paths()` 是 `/`，`paths.posts(2)` 是 `/posts/2`，直接放进 `href` 和 `navigate()`。写错的地址在类型检查时报错。
- **两个地址共用一个页面实例，用可选参数加 `matchFilters`。** 文件名 `[[lang]].tsx` 是 `/:lang?`；`export const route = defineFileRoute("/:lang?", { matchFilters: { lang: ["zh"] } })` 让它只认不带这一段和这一段是 `zh` 的地址，别的值落到 `[...404].tsx`。在两个地址之间切换时页面组件不重新挂载（实测挂载次数一直是 1），页面里的状态、画布、播放中的东西都留着；适合“语言写在地址里、切语言不能丢现场”这类需求。
- **一个路由文件是页面，当且仅当它有默认导出。** 别的配置放在具名导出 `route` 里（`preload`、`matchFilters` 等）。
- **每个路由是自己的一块代码。** `App.tsx` 里用 `<Loading>` 包住 `props.children`，等正在打开的那一块。页面都很薄、希望换地址时同一帧就换页面的应用，可以用 `fileRoutes({ codeSplitting: false })` 打成一个包；大的库在用它的那一处 `import()`，别的文件只 `import type` 它。
- **`preload` 不只在导航时跑。** 链接被悬停或聚焦时也会调用它（`intent` 是 `"preload"`），而且真正点击时不一定再调用一次。“标记已读”这类副作用不要放在里面，放在挂载后的组件里。
- **一页里“正在看哪个”写在查询串里**，窄屏上的“下一页”就是多了一个参数的同一个地址，浏览器的返回因此是对的。
- **页面自己的地址不能和服务端答的路径撞上。** 有后端时，把服务端答的路径列成一张表；这张表在 Vite 代理和托管配置里各有一份，服务端加了路径要一起改。
- **悬停样式写在 `media.hover` 里。** 写法和原因见 web-platform.md 的“布局和响应式”。
- **两种版式。** 宽屏和窄屏只是样式不同的地方用媒体查询；结构上不同的地方才用 JS 分支（`matchMedia`）。两处用同一条断点线：`src/ui/tokens.stylex.ts` 的 `media.narrow`（767px）。

## StyleX 配 Solid

**用 `stylex.attrs`，不用 `stylex.props`。** Solid 2 没有 `className`。写法是 `<div {...stylex.attrs(styles.a, 条件 && styles.b)} />`。

**StyleX 能写的比想的多。** 伪类、伪元素、属性选择器、`:has()`、容器查询、`@supports`、`@starting-style`、视图过渡的定制动画都能写进 `stylex.create`，不要因为“StyleX 可能不支持”就退回手写 CSS 或脚本。逐项的写法和核对结果在 [web-platform.md](web-platform.md) 的“StyleX 能表达什么”。只有不属于某一个元素的规则（`:root` 上的声明、`::view-transition`）才进 `src/global.css`。

**类型检查帮不上忙。** StyleX 的类型不检查属性名和取值：`colour: "red"`、`display: 5` 都能通过 `tsc`，写错的属性只是不生效。下面这些则是编译阶段才报错的：

1. **条件必须是单个表达式。** `stylex.attrs(a, x() && y() && styles.b)` 编译失败，页面直接打不开。把组合条件写成一个辅助函数再调用。
2. **条件里不能出现 `undefined`，也不能出现解构出来的常量。** `x === undefined && styles.a`、`!(personal && live()) && styles.b`（`personal` 来自解构）都编译失败，报 `Unsupported expression`。和上一条是同一个坑，同一个修法。
3. **用函数结果做下标也不行。** `styles[helper()]` 编译失败；`styles[props.size ?? "md"]` 可以（`src/ui/Button.tsx` 的变体就是这样取的）。
4. **后面的样式会整体替换前面的同名属性。** 一个“只在窄屏隐藏”的样式写成 `display: { default: null, "@media …": "none" }`，会把元素原本的 `display: flex` 冲掉变回 `block`。默认值要把原来的值重复写一遍（`src/routes/index.tsx` 的 `action` 把 `width` 的默认值 `auto` 写了出来）。
5. **简写盖不住展开写法，和顺序无关。** `padding: 0` 清不掉 `paddingBlock` 和 `paddingInline`，因为 StyleX 把简写放在更低的优先级层里。要清就写对应的展开属性。
6. **同一个属性上两个伪类同时成立时，StyleX 有自己的先后，`:hover` 排在 `:disabled` 后面生效。** 所以禁用的按钮在指针底下会变成悬停的颜色。要哪个赢就嵌套着写：`":hover": { default: 悬停色, ":disabled": 禁用色 }`（`src/ui/Button.tsx`）。

7. **动态样式的属性名带大写字母时悄悄失效。** `box: (w: string) => ({ maxWidth: w })` 编译出的规则读的是 `var(--x-maxWidth)`，而 `stylex.attrs()` 写到元素上的内联样式是 `--x-max-width: …`。自定义属性名区分大小写，变量找不到，这条样式等于没写：不报错，`tsc` 和构建都过，计算值是 `none`。动态样式只用不带大写字母的属性（`width`、`top`、`bottom`、`transform`、`translate`），需要 `maxWidth` 这类时换一个等价的单词属性（比如让元素可以收缩，直接设 `width`）。

下面四条是写一套控件（按钮、分段、滑块、开关）时在构建产物里看到的层级规律，没有逐条在浏览器里对着计算值复核：

- **所有伪类规则落在同一层里。** `:has(:checked)` 对 `:has(:disabled)`、`:active` 对 `:disabled` 谁赢，看特异性和书写顺序；要输的那个状态得嵌在每个它必须盖过的状态里面（上面第 6 条是它的一个特例）。
- **规则（媒体查询等）里的条件，层级高于任何单独的伪类。** `[media.hover]: { ":hover": … }` 会盖过顶层的 `:active`，所以 `:active`、`:disabled` 要在悬停那一块里再写一遍。同理，套在媒体查询里的 `@starting-style` 会盖过外面那条 `@starting-style`，窄屏要换一种进场方式时就这样写。
- **伪元素拿不到宿主的状态。** 滑块的拨钮、开关的圆点要跟着禁用、选中变色时，在宿主上按状态设 `color`，伪元素用 `currentColor` 画。
- **值是 JSX 的 prop 每读一次就重新生成一次。** `<Show when={props.footer}>{props.footer}</Show>` 会把它生成两遍，用函数子节点的写法：`<Show when={props.footer}>{(footer) => <footer>{footer()}</footer>}</Show>`。

**样式编译错误只有在浏览器或构建时才暴露。** `tsc` 通过不代表页面能打开。改完样式至少跑一次 `pnpm build`，或者打开页面看开发服务的日志。

**设计变量用 `defineVars`，必须放在 `*.stylex.ts` 文件里。** 深浅色直接写在变量里：`bg: { default: "#fff", [media.dark]: "#111" }`。组件里不写死颜色、间距、圆角，全部引用变量；以后换肤用 `createTheme` 覆盖一组变量即可。

**媒体查询用 `defineConsts` 定义一次。** `src/ui/tokens.stylex.ts` 里的 `media.narrow`、`media.dark` 既可以当 `stylex.create` 里的键（`[media.narrow]: "100%"`），也可以当同一个文件里 `defineVars` 的键，生成的 CSS 和把查询字符串原样写出来完全一样。断点只写在这一处。

**新颜色先算对比度。** 文字 4.5:1，控件的轮廓和焦点环 3:1，深色浅色两种外观都要算，算出来的数写在变量旁边的注释里。强调色当填充色用（实心按钮）和当文字色用（链接、焦点环）是两个变量：填充色放在深色背景上当文字太暗，所以 `color.accent` 之外另有 `color.accentText`。

**没有 `index.html` 时，开发环境的样式要自己接。** StyleX 的 Vite 插件只会往 `index.html` 里注入开发样式表。start 模式下要在 `Document.tsx` 的 `<head>` 里自己加：开发环境下 `<link rel="stylesheet" href="/virtual:stylex.css">` 和 `<script type="module" src="/@id/virtual:stylex:runtime">`。两样都要：只留脚本时样式也会出来（它运行后插入一个 `<style>`），但那是在脚本执行之后，在那之前页面没有 StyleX 的样式；`<link>` 让样式不用等脚本，脚本负责热更新。

**应用里要有一个被导入的 CSS 文件**（`src/global.css`，哪怕只有几行全局样式），StyleX 会把生成的规则追加到它里面。

**StyleX 把规则追加到构建里的“第一个”CSS 文件。** 准确地说：名字是 `index.css` 或 `style.css` 的优先，否则取第一个。第二个 CSS 文件一出现（比如某个按需加载的依赖自带样式），规则就可能进了它，页面在那个依赖没加载时整个没有样式，而且只有构建产物里才这样。这时在 `vite.config.ts` 里用 `stylex.vite({ cssInjectionTarget: (file) => … })` 指明追加到哪个。加了带 CSS 的依赖后看一眼 `dist/client/assets` 里主 CSS 的大小。

**StyleX 生成的 CSS 默认不压缩。** 插件在 Vite 压缩完 CSS 之后才把自己的规则追加上去，而且是带缩进和换行的原样。`vite.config.ts` 里的 `lightningcssOptions: { minify: true }` 让它自己压缩；这个模板的 CSS 2026-10-31 量到的是不压缩 5.47 kB、压缩后 4.10 kB，页面越大差得越多。

**StyleX 的 CSS 会按 browserslist 的目标降级，所以目标要自己写明。** 没有配置时它用 browserslist 的默认目标（里面有 Chrome 109），那不是谁选的。这个模板在 `package.json` 里写了 `"browserslist": ["baseline widely available"]`，这就是模板的支持下限（怎么定的、怎么查，见 [web-platform.md](web-platform.md)）。差别看得见：同一句 `oklch(…)`，默认目标下被改写成一个十六进制颜色加一条 `lab()` 的回退，写明目标后原样保留。

**`light-dark()` 现在不要写进 StyleX。** 它在下限之外，会被降级成依赖两个辅助变量的写法。实测构建产物里颜色是对的，开发服务里是错的（声明无效，元素悄悄用了继承来的颜色）。深浅色用变量里的 `[media.dark]`。细节在 web-platform.md 的“颜色和主题”。

**StyleX 自己解析 `*.stylex.ts` 的导入，不读 `package.json` 的 `imports`，也不读 Vite 的别名。** 用了路径别名（比如 `#/`）就要在 `stylex.vite({ aliases })` 里再配一遍。这个模板用相对路径，没有别名。

**开发服务的日志里冒出 `Invalid empty selector` 一类的样式错误，而代码没问题时，重启开发服务。** 改样式改到一半保存过的中间状态会留在热更新里；重启后消失的就不是真错误。构建（`pnpm build`）不受影响。

**带颜色过渡动画的元素，切换深浅色后要等过渡走完才是最终颜色。** 截图比对时等一两秒，不然会误以为没切换。

## 组件按组件库来封装

没有现成的组件库可用，`src/ui` 就是自己的组件库，要按“库”的标准写，不是把页面上的样式挪个地方。这一节来自先后三个产品的实践，其中两个各走过一次弯路：一个做了一整套布局包装又全删了，一个先写页面、回头才补库。

**分三层，从下往上写。** 组件库都是这样搭的，自己写也一样：

| 层       | 是什么                                                                                       | 例子                                                                                                                                                      | 放在哪           |
| -------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 原子     | 一个控件或一个元素，通常建在一个原生元素上，不依赖库里别的组件（图标、加载圈这种最小的除外） | `Button`、`Icon`、`Spinner`、`TextLink`、`Dot`、`Card`、`Switch`、`Slider`、分段选择                                                                      | `src/ui`         |
| 组合件   | 用原子拼出来的、仍然通用不含业务的东西                                                       | `Dialog`（里面的关闭按钮是 `Button`）、toast、`EmptyState`（图标、标题、说明、可选的一个 `Button`）、带标题的一节、确认对话框（`Dialog` 加两个 `Button`） | `src/ui`         |
| 业务组件 | 把上面两层拼成这个产品的界面，加上自己的布局                                                 | 页面骨架、顶栏、设置面板、结算卡片                                                                                                                        | `src/components` |

- **顺序是先原子、再组合件、最后页面。** 写一页之前，先把这一页要用到的原子列出来，库里没有的先写好，再写页面。组合件只通过原子的 props 用它们，不伸手改原子的样式；业务组件对两层都一样。
- **反过来的代价量过一次。** 有一个产品是把整套界面移到这套技术栈上的：库里先只有按钮、对话框等几样，页面一口气写完，缺什么就在页面里就地写。回头一数：带焦点环的文字链接各写各的有 3 处，空状态 4 处，状态点 2 处，“带小标题的一节”2 处，同一组工具栏按钮的属性原样重复了 8 遍，卡片底的样式被 3 个业务组件各引一遍。功能都对，但每一样都得回头再抽一轮，调用处再改一轮。
- **判断一样东西属于哪层，问“换一个产品还会原样用到吗”。** 会，它就是库里的（链接、状态点、卡片底、空状态、确认框）；不会，它是业务组件（带着这个产品的文案、数据和布局）。

**库里放什么。** 有语义、有行为的控件和元素：`Button`、`Icon`、`Dialog`、`Field`、`Select`、`Spinner`、`EmptyState`、`Dot`、`Avatar`、`Card`、`TextLink`、`Brand` 这一类。每一个都通用、不含业务，靠 props 和变体驱动，换个项目能直接搬走。这个模板里只有页面用到的 `Button`，其余的用到再加。

**库里不放什么。** `Stack`、`Row`、`Text`、`Heading` 这种把 CSS 属性包成 props 的通用包装。曾经有一个产品一开始做了一整套，页面变成了一堆包装的嵌套，样子平庸，细节也调不动，后来全删了。布局属于业务组件：业务组件（`src/components`）自己写 `stylex.create`，直接引用设计变量，把库里的控件拼起来。带业务含义的拼装件（地址卡片、列表面板、页面骨架）也放在 `src/components`，不进库。这个模板里的 `src/components/Page.tsx` 就是页面骨架。

**一个库组件的写法**（照着 `src/ui/Button.tsx` 看）：

- 一个组件一个文件，`styles` 写在最上面。
- 包的是原生元素就把原生属性透传出去：类型用 `Omit<JSX.ButtonHTMLAttributes<…>, "class" | "style">`，实现里用 `omit(props, …)` 拿掉自己的属性再展开。不让调用处传 `class` 和 `style`。
- 变体是一组具名样式，用属性直接取：`styles[props.variant ?? "solid"]`。形态上的开关用布尔属性（`icon`、`compact`、`fill`）。
- 调用处要改样式只有 `xstyle` 一个口子，而且只用来调布局（位置、尺寸、外边距）。如果调用处需要“撤销”某个变体，说明组件缺一个变体。
- 无障碍写在组件里，不留给调用处：装饰性图标 `aria-hidden`；只有图标的按钮必须有 `aria-label`；`Spinner` 是 `role="status"` 加一段隐藏文字；纯装饰的头像对读屏器隐藏。
- 每个可以交互的元素（包括链接）都有键盘焦点环：共用的那一份在 `src/ui/base.ts` 的 `focusRing`，和组件自己的样式并排用。
- 组件上方用一段注释说清“它是干什么的、什么时候用、什么时候不用”。不是一眼能看懂的 CSS 决定（为什么 `minWidth: 0`、为什么焦点环画在里面）也写一句。下次换人或换 AI 来用，读注释就够，不用翻实现。

**按钮的文字不换行。** 中文在任意两个字之间都能断行，被挤窄的按钮文字会竖起来。所以按钮 `whiteSpace: "nowrap"`、`flexShrink: 0`，拥挤的一行里让步的是旁边的文字。

**表单项是一个 `Field`**：它把标签、提示和错误信息同输入框连起来，调用处不自己拼 `for` 和 `aria-describedby`。

**图标自己维护一张表。** 一个 `Icon` 组件加一张路径表：24 网格、`stroke="currentColor"`、2px 圆头线条，名字由表的键推导出类型（`keyof typeof paths`）。需要哪个加哪个，不引图标库。图标永远是装饰，名称由包着它的控件给。图标要是人们预期的意思（铅笔是编辑、齿轮是设置、加号是添加）；没有哪个图标能说清楚时用文字。

**用计算结果选样式时，把结果先算好。** `styles[pickTone(seed)]` 编译失败（就是上面“用函数结果做下标”那个坑）。按内容选颜色的组件（头像底色）这样写：在模块顶层把每种颜色的 `stylex.attrs(styles.avatar, styles.tomato)` 先算成一个数组，运行时只是从数组里取一个现成的对象。

**第二次出现再抽，说的是业务拼装件。** 曾经有“带边框的圆角白底”先后出现在三处，第三处才抽成 `Card`，太晚了；第二处就该抽。反过来，只用了一次的业务拼装（某一页独有的一块）不要提前抽成组件。这条不适用于库里的通用词汇：文字链接、状态点、卡片底、空状态这类东西第一次用到就写进 `src/ui`，它们一定会再出现，等到第二次才抽，中间那一处就已经是各写各的了（见上面“分三层”）。这个模板里两个路由共用同一个页面骨架，所以它是 `Page`；404 页上的链接只出现了一次，所以样式还留在那个路由文件里。

**页面骨架的宽度放进设计变量。** 页眉、正文、页脚要对齐同一个宽度和左右留白，把它们定义成一组变量（`frame.width`、`frame.gutter`），三处都引用。不要在三个文件里各写一遍 `72rem`。内容宽度按正常网站来（70rem 上下），大屏用两栏把空间用起来，只有正文阅读栏保持 44rem 左右的行宽；整站都收成一根窄栏在大屏上很难看。

**精致感来自基础件，不来自布局。** 同一套设计变量，只有文字按钮和方框时显得粗糙；补上统一的线性图标、带图标的按钮和图标按钮、头像、状态点、加载圈，数字用 `fontVariantNumeric: "tabular-nums"`，悬停和焦点有 120ms 的过渡之后，观感差一个档次。所以顺序是：先把这些基础件做好，再拼页面。

## 文档外壳（`Document.tsx`）

- 它只在构建时渲染一次，变成 `dist/client/index.html`，所有地址返回的都是这同一份文件。它不带任何客户端脚本；应用渲染在 `<body>` 里已有内容的后面。
- `<HydrationScript />` 照官方模板留着：纯客户端渲染时插件会把它从外壳里去掉（构建出来的 `index.html` 里没有它），打开 `ssr: true` 时才起作用。
- 所以**“应用加载之前就要因人而异”的东西**（比如老用户不显示介绍页、按语言显示不同文字），只能靠 `<head>` 里一小段内联脚本加 CSS 来做：脚本读 `localStorage`，往 `<html>` 上设属性，CSS 根据属性显示或隐藏。内联脚本和样式要用 `innerHTML` 写，直接写文字会被转义。按语言分地址的站点是一个现成的例子：默认语言的首页 `<head>` 里放一小段脚本，读存下的语言选择和 `navigator.languages`，该去另一种语言时在画面出来之前就 `location.replace()` 过去，访问者不会先看到一眼别的语言；爬虫不运行它，或者按自己的语言运行它，每个地址仍然被按各自的语言收录。应用里原有的跳转逻辑留着兜底，两处用同一条规则、同一个存储键。
- **外壳里用到的组件是按服务端编译的。** 它可以用 StyleX，前提是样式定义在应用也导入了的模块里，这样规则才会进外壳链接的那份样式表。应用状态、路由和加载时就读浏览器的模块不要引进来。
- **给搜索引擎看的内容**要以静态 HTML 的形式写在外壳里，应用挂载后再把这份静态内容移除。纯客户端渲染的页面，搜索引擎不运行脚本就什么都读不到。
- **外壳可以按地址各渲染一份，不用打开 `ssr: true`。** 这只解决 `<head>` 里的标记；正文也要进 HTML 时，直接做整页预渲染（见“整页预渲染（SSG）”一节），不要停在这里。 外壳走的是和服务端渲染同一个请求处理器，所以在 `Document.tsx` 里能读到请求：`new URL(getRequestEvent()?.request.url ?? "http://localhost/").pathname`（`getRequestEvent` 从 `@solidjs/web` 导入）。开发服务本来就按请求渲染外壳，不同地址当场拿到不同的 `<html lang>`、标题和分享标记。构建时插件只渲染 `/` 这一份，其余的自己加一个构建钩子：

  ```ts
  function prerenderShells(pages: { url: string; file: string }[]): Plugin {
    return {
      name: "prerender-shells",
      apply: "build",
      buildApp: {
        order: "post",
        async handler(builder) {
          const { client, ssr } = builder.environments;
          if (client && !client.isBuilt) await builder.build(client);
          if (ssr && !ssr.isBuilt) await builder.build(ssr);
          const root = builder.config.root;
          const handler = await import(pathToFileURL(resolve(root, "dist/server/server.js")).href);
          for (const page of pages) {
            const response = await handler.handleRequest(
              new Request(new URL(page.url, "http://localhost")),
            );
            if (!response.ok)
              throw new Error(`rendering the shell of ${page.url} failed: ${response.status}`);
            const file = resolve(root, "dist/client", page.file);
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, await response.text());
          }
        },
      },
    };
  }
  ```

  把它放在插件列表里 `solid()` 的前面（`prerenderShells([{ url: "/en", file: "en/index.html" }])`）。三件事要知道：它自己先把两个环境构建完，Solid 的钩子随后发现已经构建过就只渲染 `index.html`；有了它，next.49 的 Solid 插件不再删 `dist/server`，发布前自己删掉（只发 `dist/client`）；`vite.config.ts` 用到了 `node:fs`、`node:path`、`node:url`，要装 `@types/node` 并加进 `tsconfig.json` 的 `types`，否则 `tsc` 报找不到这些模块。这样两种语言的首页、托管平台按状态码返回的 404 页，都可以各有一份带着自己标记的静态 HTML。托管那边要改成按路径找文件、找不到时回 404 页，而不是一律回 `index.html`。

- 标题、描述、规范地址、分享预览的各种标记都放在这里。`public/` 目录下的文件（`robots.txt`、站点地图、图标、预览图）会原样输出。
- **`robots.txt` 不要挡掉用户会分享出去的地址。** 生成链接预览的爬虫（X、LinkedIn 等）也遵守它，被挡的地址发出去就没有标题和图片。不想被收录的页面用规范地址指回首页。
- **页面画出来之前的底色**靠 `src/global.css` 里的 `color-scheme: light dark`：浏览器在深色模式下自己用深色画布，应用加载前不会白一下。颜色本身只写在 `src/ui/tokens.stylex.ts` 一处。

## 整页预渲染（SSG）

内容要被搜索引擎读到的页面，不要停在“只渲染外壳”：外壳里只有 `<head>` 的标记，正文是脚本画的，不运行脚本的爬虫读不到。官方有现成的工具把整页在构建时渲染成静态 HTML，浏览器里再接管，线上仍然没有服务端。

**新产品一开始就定：页面要不要被搜索引擎读到。** 要的话从第一天就按这一节搭。有一个产品先按“只渲染外壳”上了线，回头补成整页预渲染，要把所有读浏览器状态的地方（偏好、屏幕宽度、设备判断、对话框内容）逐个改一遍，再把全部流程重测一轮。

下面是 2026-10-12 在一个产品上做通并上线的做法（Solid 2.0.0-rc.14、`@solidjs/vite-plugin` 3.0.0-next.49、`prerender-crawler` 0.2.0；这个模板里没有重做）。

```ts
import { prerender } from "prerender-crawler/vite";

plugins: [
  stylex.vite({ … }),
  solid({ start: { renderMode: "async" }, ssr: true, extensions: [".jsx", ".tsx"] }),
  fileRoutes({ types: true }),
  prerender({
    mode: "static",
    pages: ["/", "/zh", { path: "/404", filename: "404.html" }],
    crawlLinks: false,
    concurrency: 1,
  }),
],
```

- `renderMode: "async"` 等页面里所有的等待都落定再出一份完整的 HTML；默认的流式渲染留给不运行脚本的读者的是占位。`concurrency: 1` 一次渲染一页：rc.13 上并发渲染出过把一页的内容写进另一页的问题，没有在 rc.14 上重试并发。
- 构建后 `dist/client` 里是每个地址一份 HTML，`dist/server` 是渲染用的，发布前删掉。托管改成按路径找文件、找不到回 `404.html`，不再一律回 `index.html`。
- 按路由拆出来的代码块照常工作：预渲染的 HTML 里带着它们的预加载，接管前会先加载好。

下面几条是 2026-10-15 在一个双语的内容站上做通并上线时补上的（Solid 2.0.0-rc.15、`@solidjs/router` 2.0.0-next.39、`@solidjs/meta` 1.0.0-next.2、`@solidjs/vite-plugin` 3.0.0-next.50、`prerender-crawler` 0.2.0；这个模板里没有重做）：

- **每种语言各一份 404 页，要显式写成种子。** `pages` 里写 `{ path: "/zh/404", filename: "zh/404.html" }`，和 `/404` 一样给出文件名；只靠爬链接，它会被当成普通页面写成 `zh/404/index.html`，托管找不到 `zh/404.html`，中文地址的 404 就回了英文那份。托管那边按“最近的 `404.html`”回退（Cloudflare 的 `notFoundHandling: "404-page"` 就是这样），`/zh/` 下找不到的地址就回中文的那份。
- **`@solidjs/meta` 的 `<Link>` 按 `rel` 加 `href` 去重，会悄悄吞掉标签。** `hreflang="en"` 和 `hreflang="x-default"` 指向同一个地址时只剩一条，不报错。给每条加 `key`（`key={`alternate-${lang}`}`、`key="alternate-default"`）。
- **结构化数据用 `@solidjs/meta` 的 `<Script type="application/ld+json" key="…">`**，内容是 `JSON.stringify(…)` 的字符串。预渲染出来的是原样的 JSON（没有被转义成实体），站内跳到别的页面时它被移除，回来时再加上。
- **页面要按需加载的数据（比如一篇文章的正文，单独成一块），在路由的 `preload` 里就开始加载，页面读同一个 promise。** 只在页面组件里加载的话，开发服务会报 `SSR_BOUNDARY_WATERFALL`：页面代码到了才开始等数据，两段等待串在一起。做法：一个模块级的缓存函数 `load(key)`，第一次调用时发起加载、存下 promise 并用 `solid-js/attribution` 的 `attribution.markFlight(promise)` 标记它真正开始的时刻，`preload` 和页面都调它。
- **多份构建之间要共用一份插件实例时，设 `builder.sharedPlugins: true`。** Solid 插件在客户端构建里记下客户端产物的目录，服务端构建和预渲染靠同一份实例读到它；如果另一个插件（比如 Cloudflare 的 Vite 插件）把客户端产物挪到了别处，又没有这个设置，服务端那份回退到默认的 `dist/client`、读不到客户端清单。构建照样“成功”，但每一页都没有样式表和脚本；用 curl 看 HTML 看不出来，在浏览器里打开构建产物才发现。
- **客户端产物里的 `.vite/manifest.json` 会跟着发布出去。** 预渲染时服务端构建要读它，之后没人用。在构建末尾删掉：一个 `apply: "build"` 的插件，`buildApp: { order: "post", async handler() { … } }` 里删客户端输出目录下的 `.vite`。

要让它能渲染、能接管，代码要守三条：

1. **组件函数体里不碰只有浏览器才有的东西**（`window`、`document`、`localStorage`、`matchMedia`、`navigator`）：构建时是在 Node 里渲染的。放进 `onSettled`、事件处理或 effect 的执行函数。
2. **构建时和接管时画出来的必须一样。** 只有浏览器才知道的值（存下的偏好、屏幕宽度、是什么设备）先用确定的默认值，`onSettled` 里再换成真的。换的那一下会让界面跳一次，所以依赖这些值的区域在接管前先不显示（`visibility: hidden`，文字仍在 HTML 里），换好了再出现。
3. **`Document.tsx` 也在接管的范围里。** 它在浏览器里会再执行一遍，`getRequestEvent()` 在那里是空的：按地址出不同内容时，地址在构建时取自请求，在浏览器里取自 `location`。两边差一个标签，接管时编号就全错位，报的是一条看上去毫不相干的错：`lazy() module "…" (hydration id "…") was not preloaded before hydration`。遇到这条先比对两边渲染出来的 `<head>`。

关着的对话框里的文字默认不在 HTML 里（内容是打开时才建的）。要让它被读到，就让内容在关着时也渲染（对话框组件加一个“保持挂载”的开关），同时把里面费事的计算挡到打开之后。

核对预渲染的结果：对构建出的 HTML 去掉标签数一下正文的词数、列出 `<head>` 里的标记，和预期逐项比；再在浏览器里打开，确认控制台没有接管的报错。

## 项目结构上的建议

这些不是框架要求，是实际觉得好用、值得照搬的做法。

- **`src/ui`：自己的组件库。** 一份 `tokens.stylex.ts` 加基础组件。怎么封装见上面“组件按组件库来封装”一节。
- **`src/components`：业务组件。** 布局和带业务含义的拼装，自己 `stylex.create`、直接引用设计变量。
- **对话框用原生 `<dialog>`**（`showModal()`），焦点锁定和背景不可操作由浏览器负责。注意三点：给它本身设 `display` 会让它关着也显示，布局要放在里面的元素上；浏览器在用户没有交互过时允许按 Esc 强行关闭，“不可关闭”的对话框要在 `close` 事件里重新打开；它可以叠，第二个 `<dialog>` 写在第一个的里面就行，浏览器自己把后开的放在上面。
- **对话框开着时，页面里的轻提示（toast）被遮住、也点不到。** 模态 `<dialog>` 以外的内容全部不可交互，又都压在它的遮罩下面。做法：对话框打开时在自己里面再挂一个 toast 区（面板的兄弟节点），模块里记一个“已挂载的 toast 区”的栈，只有最后挂上的那个显示消息。位移和缩放加在对话框里面的面板上，不加在 `<dialog>` 本身：带变换的祖先会成为固定定位元素的参照，toast 区会跟着它走。toast 的底色要比面板高一档：它会压在对话框、底部面板这些同是“面板底色”的东西上，又没有阴影和描边，同色就看不出边界。
- **对话框要有退场动画时，等的是退场那几个过渡本身，不是 `transitionend` 事件。** 做法：`open` 变成假之后先不调 `close()`，给面板加上“离开”的样式，取 `panel.getAnimations()`，等它们的 `finished` 都兑现再 `close()` 并卸载内容；没有在跑的过渡（用户要求减少动态效果，时长是 0）就立刻关；被重新打开打断时 `finished` 会被拒绝，忽略即可；再加一个比最长退场略长的定时器兜底。用 `transitionend` 会出错：进场过渡的结束事件可能在点了关闭之后才送到，被当成退场结束，对话框一关就没。“正在离开”要从 `open` 和“原生对话框是否已经关上”两个状态派生出来，离开的样式才会和 `open` 的变化在同一轮生效；调用处关闭后内容还会多渲染一小会儿，标题这类文字不能跟着 `open` 一起清空。
- **退场中的对话框里什么都不能再用。** 内容在退场那一两百毫秒里还渲染着：给面板加 `inert={正在离开}`，否则关闭它的那个按钮能被再点一次、动作跑两遍；对话框里挂的 toast 区在开始离开时就卸掉，否则“确认后弹的提示”会先出现在正在消失的对话框里，再跳到页面上重播一遍进场。
- **点完就消失的按钮，要把焦点交出去。** 关闭一张卡片、退出一个临时的工具栏，按钮随即被卸载，焦点掉回 `<body>`，用键盘的人得从页首重新 Tab。在同一个事件处理里写完状态后调 `flush()`（这时旧按钮才真的没了、新内容才出现），如果 `document.activeElement` 是 `body`，就聚焦接替它的那块区域里第一个能用的按钮。不要用 `requestAnimationFrame` 等：后台窗口里它可能迟到很久。
- **给读屏的播报区要一直在页面里。** 随内容一起新建的 `aria-live` 元素不会被念出来；`aria-label` 放在没有角色的 `<div>` 上也不暴露。画出来的文字（SVG 字形、画布）旁边放一个常驻的、视觉隐藏的 `aria-live="polite"` 元素，只换它里面的文字。
- **手机上从底部升起的面板**：面板不透明地滑上来（`translate` 从 `0 100%` 到 `0 0`），不要同时从透明淡入，否则前半程几乎看不见，观感是“淡入”而不是“升起”；遮罩的淡入用和面板同一个时长、同一条曲线。时长和曲线用底部面板通行的那一组就行：`cubic-bezier(0.32, 0.72, 0, 1)`，升起 450ms 上下，收回 300ms 上下。
- **大件的入场动画，晚一帧再开始。** 内容在打开时才建的面板，如果用 `@starting-style` 做入场，过渡的时钟从“建内容”的那一帧就开始走，而那一帧偏偏最长；曲线开头又快的话，面板第一次被看到时已经跳出去一截，观感是起步卡一下。做法：面板带着“起点”的样式挂载（比如 `translate: 0 100%`），等两个 `requestAnimationFrame` 再把这组样式拿掉，过渡这时才开始（外加一个一百来毫秒的定时器兜底，后台标签页里没有帧）；面板可以加 `will-change`，让它在动之前就有自己的图层。小东西（toast、几像素的淡入）继续用 `@starting-style` 没问题。量出来的数：一个一百五十个节点的设置面板，生产构建里从点击到建好要 3–13 毫秒，CPU 降到四分之一时 14–21 毫秒；**开发构建慢得多，同样条件下是 106 毫秒**，所以动效的观感要对着生产构建评，不要对着开发服务评。
- **`<dialog>` 自己要 `overflow: clip`，不是 `hidden`。** `overflow: hidden` 的盒子仍然可以被滚动，而浏览器真的会去滚它：`showModal()` 把焦点放到面板里的按钮上，从屏幕外滑入的面板这时还在盒子外面，浏览器为了让获得焦点的按钮可见，把 `<dialog>` 滚了几百像素。结果是面板一出现就在半途、一百来毫秒就到位，而且不管把过渡的时长和曲线改成什么都一样：读 `getAnimations()` 看到的参数全是对的，画面却不对。这个坑让“太快了”被改了三轮时长才找到。核对一段位移动画不能只看参数：把过渡暂停，逐步设 `currentTime`，每一步读 `getBoundingClientRect()`，看位置是不是从起点一路走到终点（修之前第 0 毫秒的上沿在 392，修之后在视口底 844，一路降到 160）。
- **悬停说明自己做一层，不用原生的 `title`。** `title` 要等一秒多才出，键盘聚焦时不出，样子也改不了。做法：全页挂一个提示层（一个 `popover="manual"` 的元素，这样它在顶层，对话框开着时也盖得住），在 `document` 上用捕获监听 `pointerover`、`pointerout`、`focusin`、`focusout`、`pointerdown`、`keydown`、`scroll`；控件只带一个 `data-tooltip` 属性。指针停留约 450 毫秒后显示（刚关掉一个时立刻显示，方便沿着工具栏扫过去），键盘聚焦（`:focus-visible`）时立刻显示，触屏不显示；位置按目标的 `getBoundingClientRect()` 算，上方放不下就放下方，左右夹在视口内。无障碍上，提示只是重复或补充控件已有的名字：只有图标的按钮名字来自 `aria-label`；提示说得比名字多时，把这段话放进按钮里一个带 `hidden` 的元素，用 `aria-describedby` 指过去（被 `aria-describedby` 直接指到的隐藏元素会算进描述，又不会算进按钮的名字）。这一条是做产品时在 Chromium 152 里确认的，没有在这个模板里重做。
- **多语言用两份带类型的文案表。** 一份语言定义结构，其他语言必须满足同一类型，漏翻译在类型检查时就报错。组件里不出现任何面向用户的文字。错误信息在状态里存代码，渲染时再翻译，否则切换语言后还是旧语言。句子中间有链接时，文案写成片段数组：`["我在 ", { text: "某公司", href: "https://…" }, " 工作。"]`，`src/ui` 里一个小组件用 `<For>` 把字符串原样输出、对象画成文字链接；这样语序不同的语言各写各的，链接也不会从文案里漏出去。这个模板只有几句界面文字，没有这套机制；产品名在 `src/site.ts`。
- **文章这类内容写成 Markdown，在构建时解析，不把解析器发给浏览器。** 一个 Vite 插件读 Markdown 文件，用 Markdoc（`@markdoc/markdoc`）把正文解析成一棵普通的 JSON 树（`{ name, attributes, children }`），作为一个虚拟模块导出；页面用自己的组件按标签名逐个画出来（标题、段落、列表、链接、代码……），样式全在 StyleX 里。列一张“组件认识的标签”的清单，正文里出现清单之外的元素就让构建失败，而不是在页面上悄悄丢掉那一段。frontmatter 也在插件里校验（缺字段、日期格式不对就失败）。每篇的正文单独成一块按需加载，列表只带摘要。（2026-10-15 在一个内容站上做通，Markdoc 0.5.10。）
- **业务引擎和界面分开。** 同步、网络、缓存这类逻辑写成不依赖框架的纯 TS 模块（不导入 `solid-js`，不直接用 `window`、`localStorage`、`fetch`、`WebSocket`，平台能力从一个接口传进来），通过一个很窄的接口把快照发布给界面；只有一个文件把它接到 Solid 的 store 上。好处是可以脱离浏览器用假的 `fetch`、`WebSocket` 直接测，竞态和断网这类问题在这里比在界面上好验证得多。顺序要紧的逻辑（应答和事件的先后、重连后的重读、重发、翻页）先写测试。
- **自己写的组件要过审查。** 自己写比套组件库更贴合需要，但容易漏细节：键盘操作、焦点、无障碍标记、对比度。独立审查查出的问题里很多是这一类。

## 开发服务给智能体的三个出口

`pnpm dev` 启动后，除了页面本身，还有三样不开浏览器窗口也能读的东西：

- **终端里的浏览器控制台。** `vite.config.ts` 设了 `server.forwardConsole: true`，页面里的 `console.warn`、`console.error` 和没接住的异常会出现在开发服务的日志里，Solid 的诊断连同组件路径和修法文档的位置一起打出来。Vite 默认只在检测到编码智能体时才这样做，所以这里写死。前提是有一个页面开着并连着开发服务。
- **`/__solid/diagnostics`。** Solid 插件的 `diagnostics` 选项（装了 `@solidjs/diagnostics` 就自动开，这里显式写了 `true`）在开发服务上提供这个地址：`GET` 看状态和连着的页面数；`POST {"method":"begin"}`、操作页面、再 `POST {"method":"end"}` 得到这一段里的诊断和重跑记录；`whyDidRun`、`costs` 查某个作用域为什么重跑、花了多少。用法在 `node_modules/@solidjs/diagnostics/skills/agent-loops/SKILL.md`。同时开着几个页面时先答的那个算数，测的时候只留一个。它只在开发服务上有，构建和预览里没有。
- **样式的编译错误。** StyleX 编译不过时，错误在开发服务的日志里，页面打不开。

Chrome 的 Performance 面板里还有一组 Solid 的轨道（effect 和 memo 的重跑、导航、等待），开发服务默认就开着（插件的 `performanceTracks`）。

## 怎么验证

按成本从低到高：

1. `pnpm check`：格式、`tsc --noEmit`、lint。oxlint 通过时什么都不输出，看退出码。
2. `pnpm build`：能抓到 StyleX 的编译错误。
3. 打开页面看控制台（或者看开发服务日志里转出来的那一份）：Solid 的诊断。
4. 业务引擎用脚本脱离浏览器测。
5. 在浏览器里走真实流程，深色、浅色、窄屏各看一遍。用无界面的浏览器驱动，脚本不放进项目（不为这个给项目加测试运行器的依赖）。
6. 阶段性地让独立的审查从“逻辑正确性、组件代码、实际上手的界面体验”三个角度各看一遍。有一次三路审查一共查出四十多个问题，没有一个是前面几步能发现的。

**量一次点击卡主线程多久。** 在页面里记下时间、触发点击、用微任务等结果出现、强制排一次版（读一个 `getBoundingClientRect()`）、再记时间；用 DevTools 协议的 `Emulation.setCPUThrottlingRate`（4 倍）近似手机，对着生产构建量。超过一帧（16 毫秒）的就值得看一眼是什么。有一次这样量出来的两处：列表每一行各建一个 `Intl.DateTimeFormat`（建它比用它贵得多，六十行的列表打开时多花一倍时间，改成每种语言一个）；几十行的列表一次全排版（屏幕外的行加 `content-visibility: auto` 和 `contain-intrinsic-size`）。两处一起改，打开那个面板从 42–57 毫秒降到 16–28 毫秒。还有一处是“跟错了信号”：一个列表为了在某件事发生时刷新（一条记录存进了本机存储），被写成跟着另一个变得勤得多的值重读（每一次操作），于是每次操作都把整份存储解析一遍、几十行逐行重算。重读只该跟着数据来源真的会变的那一刻；改完之后，面板开着时一次操作从 44–51 毫秒降到 15–18 毫秒（开发构建、CPU 降到四分之一）。

**量加载性能用 Lighthouse，对着构建产物。** `pnpm dlx lighthouse <地址> --output=json`（默认就是模拟手机和慢速网络），同一页跑三次取中位数，单次波动很大。`vite preview` 不压缩，下载量会比线上（brotli）大两三倍，比较体积时要么对着线上量，要么自己用压缩算一遍。作为参照：一个整页预渲染、只用系统字体、不放图片的站，每页 JS 约 42 KB（brotli，其中 Solid 2 运行时加路由约 100 KB 原始体积），四项评分都是 100，LCP 约 1.2 秒。

两条和动效、对话框有关的验证经验：

- **自动化驱动的窗口不在前台时，浏览器把动画帧限到每秒一两帧**，过渡看起来卡在起点，按时间截图、按帧采样都不可信。核对一段过渡，读它本身：在页面里触发之后取 `元素.getAnimations()`（遮罩这类伪元素用 `对话框.getAnimations({ subtree: true })`，看 `effect.pseudoElement`），每一项的 `transitionProperty`、`effect.getKeyframes()` 的起止值、`effect.getComputedTiming()` 的时长和曲线都是确定的，和帧率无关；要等它走完就等 `finished`。
- **有的截图方式拍不实顶层元素**：模态对话框在截图里是半透明的，像是压在页面下面，而 DOM 和计算样式都正常。换用 DevTools 协议的 `Page.captureScreenshot` 就是对的。截图和计算样式对不上时，先怀疑截图。

汇报时说清楚哪些是在浏览器里看到的、哪些是对着脚本化的数据看到的、哪些只在测试里验证过。

## 构建产物和托管

`pnpm build` 之后 `dist/client` 是全部要发布的东西：

- `index.html`：文档外壳，带着哈希过的入口脚本和样式表的地址。**所有找不到文件的地址都要返回它**（单页应用的回退），否则直接打开或刷新一个子页面会得到托管自己的 404。各家的写法不一样（Netlify 的 `_redirects`、Vercel 的 `rewrites`，见 `@solidjs/router` README 末尾）。
- `assets/`：文件名带内容哈希的脚本和样式，可以长期缓存；`index.html` 不要长期缓存。
- `public/` 里的文件原样在根上。
- `.vite/manifest.json`：构建清单，只在构建时有用，发布前可以删。
- 构建过程中会出现 `dist/server`，那是用来把外壳渲染成 `index.html` 的，纯客户端模式下构建结束后不留。

`pnpm preview` 在本地按同样的回退规则把构建产物跑起来。

因为每个地址返回的都是同一份 `index.html`，`[...404].tsx` 那一页的 HTTP 状态码也是 200。要真正的 404 状态码得有服务端（`ssr: true`，或者托管平台按路径配置）。

### 和 Cloudflare Workers 一起部署

- 前端构建产物作为同一个 Worker 的静态资源（Static Assets）一起发布：前端和接口同源，不用处理跨域。配置是“接口路径先走 Worker，其余找静态文件，找不到的返回 `index.html`”。
- 开发时用 Vite 代理（`server.proxy`）把接口转给本地的 Worker。Vite 代理默认保留 Host，后端做同源检查时不需要特殊处理。
- Vite 代理里用正则写的规则是拿“路径加查询串”去比的：结尾不能只写 `$`，带查询串的请求会匹配不上。
- 托管平台的构建环境里钉的 Node.js 和 pnpm 版本（Cloudflare Workers Builds 是构建变量 `NODE_VERSION`、`PNPM_VERSION`）要和 `mise.toml`、`package.json` 的 `packageManager` 一致，升级时几处一起改。推送就是上线的项目，上线前从一份干净的拷贝（不带 `node_modules` 和构建产物）用锁定安装（`pnpm install --frozen-lockfile`）加 `pnpm build` 预演一次，本机能构建不代表构建服务上能。
- 整页预渲染的站点只发静态资源时，Worker 不需要代码：Cloudflare 的配置里不写入口，只写静态资源的规则（找不到回 `404.html`）。和 Solid 插件一起构建时的两个坑（`builder.sharedPlugins`、`.vite/manifest.json`）见“整页预渲染（SSG）”。
- 查 Cloudflare 文档时在页面地址后面加 `index.md`（例如 `https://developers.cloudflare.com/workers-ai/models/index.md`），直接拿到 Markdown，比抓网页稳。

## 什么时候不用这套

- **需要和别人协作或者招人**：会 Solid 的人比会 React 的少得多。
- **需要服务端渲染**：官方说 start 模式下改一个开关（`ssr: true`）就行，`App`、`Document`、路由都不用动。带服务端的部署在这个模板里没有验证过。**构建时整页预渲染（SSG）是走通过的**，见“整页预渲染（SSG）”一节。

没有哪样东西是“只有 React 才能做”的。富文本、图表、地图、支付这类重的库，核心几乎都不依赖框架，在 Solid 里直接用核心、自己包一层即可；普通界面组件自己写。原生 App 用各平台自己的技术写，和网页用什么框架无关。

## 这个模板里核对过什么

2026-10-08，用“版本”一节的那一组版本，在这个目录里实际跑过、看过的：

- `pnpm install`、`pnpm check`、`pnpm build` 通过；`pnpm dev` 和 `pnpm preview` 都能打开页面。把这个目录单独复制到别处（不带 `node_modules` 和 `dist`），`pnpm install --frozen-lockfile`、`pnpm check`、`pnpm build` 同样通过。
- 在浏览器里对着开发服务：首页渲染，点按钮计数增加，控制台没有 Solid 的诊断和错误；浅色和深色、1280 宽和 390 宽四种组合都看过；不存在的地址显示 404 页，点“回到首页”不重新加载页面就回到首页。
- 在浏览器里对着构建产物（`pnpm preview`）：390 宽、深色下首页渲染、计数增加、控制台干净；直接打开一个不存在的子地址得到 404 页。
- `/__solid/diagnostics`：`begin`、点三次按钮、`end`，得到 0 条诊断和 3 次重跑（每次点击一次）。
- 首页的数字滚动（视图过渡）：连点、键盘、减少动态效果、没有这个接口时的表现，记录在 [web-platform.md](web-platform.md) 末尾。
- StyleX 能不能表达各种现代 CSS：逐项构建的结果同样记录在那里。
- `Button` 的两个变体、禁用态、键盘焦点环，在一个临时路由里深浅色各看过；禁用的按钮在指针底下颜色不变。
- 故意在组件函数体里读信号：浏览器控制台和开发服务日志里都出现了 `STRICT_READ_UNTRACKED`。
- 给 `aria-expanded` 传布尔值：`tsc` 报错；传 `"true"` / `"false"` 正常。
- `defineConsts` 的媒体查询在 `stylex.create` 和同文件的 `defineVars` 里当键用：构建通过，生成的 CSS 和写字符串时逐字节相同。
- 去掉 `Document.tsx` 里的开发样式表 `<link>`、只留运行时脚本：样式仍然会出来，但要等脚本运行。
- `lightningcssOptions: { minify: true }` 前后的 CSS 大小；构建出的 `index.html` 里没有 `<HydrationScript />` 的脚本。
- 增删路由文件后 `file-routes.d.ts` 被开发服务重写。

2026-10-12，升级到“版本”一节现在这一组之后：

- 在这个目录里：`pnpm install`、`pnpm check`、`pnpm build` 通过，构建后 `dist` 里只有 `client`；对着开发服务在浏览器里（Chromium 152）点三次按钮计数是 3，不存在的地址显示 404 页，点“回到首页”不重新加载页面就回到首页，开发服务的日志里没有警告和错误。
- 在这个目录的一份临时拷贝里加了几个临时路由，对着开发服务和构建产物核对（没有文件留在这里）：
  - 动态样式：`maxWidth` 的那一个，内联样式是 `--x-max-width`、规则读 `--x-maxWidth`、计算出的 `max-width` 是 `none`；`width` 的那一个正常。
  - 回调读信号：从 effect 的执行函数里同步调用的回调读信号，报 `STRICT_READ_UNTRACKED`；包了 `untrack` 的不报；同一个读法放在事件处理里不报。
  - `[[lang]].tsx` 加 `matchFilters`：两个地址之间切换，挂载次数一直是 1；第三个值显示 404 页。
  - 按地址渲染外壳：开发服务上 `/` 和 `/en` 返回的 `<html lang>` 不同；加了“文档外壳”一节那个构建钩子后，`dist/client/en/index.html` 的 `lang` 是 `en`，并且构建结束后 `dist/server` 还在。
  - `<dialog>`：`showModal()` 后焦点落在第一个按钮上，给另一个按钮加 `autofocus` 后落在它上面；对话框开着时点它外面的按钮，按钮收不到点击。

2026-10-31，升级到“版本”一节现在这一组之后：

- 在这个目录里：`pnpm install`、`pnpm check`、`pnpm build` 通过，构建后 `dist` 里只有 `client`；单独复制到别处（不带 `node_modules` 和 `dist`），`pnpm install --frozen-lockfile`、`pnpm check`、`pnpm build` 同样通过。
- 在浏览器里对着开发服务：1280 宽和 390 宽、浅色和深色各点三次，计数正确，页面没有横向溢出；一次任务里连点 20 下得到 20；40 毫秒一次的真实指针点击 15 下得到 15；模拟“减少动态效果”时没有发起视图过渡；不存在的地址显示 404 页，点“回到首页”不重新加载页面。开发服务的日志里没有警告和错误。
- 在浏览器里对着构建产物（`pnpm preview`）：同样的计数和 404 流程，页面没有报错。
- 同样的连点测试也对着升级前的版本跑过，结果一致。后来查清这个测试受帧率影响，结论见 web-platform.md 的“视图过渡在这里怎么用”。
- 悬停样式、`motion` 变量、安全区内边距、`eslint-plugin-solid`、和另外两端对齐后的首页：在浏览器里（开发服务和构建产物）核对过，结果写在 web-platform.md。
- 这次重读了包里自带文档的差异（`CHEATSHEET.md`、Vite 插件和路由的 README）。这份文档引用的诊断代码和文件路径都还在；和这份文档相关的改动只有一处：Vite 插件的 `hot` 选项改名成了 `refresh`，上面已经改了。路由的 `action` 改名成了 `formAction`，start 模式的 `node`、`setup` 等选项也改了名，这份文档都没有用到。

“组件按组件库来封装”一节里“分三层”的顺序和那组重复次数，来自 2026-10-12 把一个产品的界面整体移到这套技术栈上的那一次；这个模板里只有 `Button` 一个原子，没有组合件，所以没有可以在这里重新验证的东西。

没有在这里重新验证、从之前的产品带过来的（退场中的对话框要 `inert`、点完就消失的按钮交出焦点、常驻的播报区这三条，和下面这一句之后新增的几项，都是在 Solid 2.0.0-rc.14、路由 next.38、Vite 插件 next.49、StyleX 0.19.1、Chromium 152 上做产品时确认的：对话框里再挂一个 toast 区、对话框的退场动画和 `transitionend` 的那个竞态、底部面板的时长与曲线、后台窗口的帧率限制和截图的问题；四条 StyleX 层级规律只在构建产物里看过）：store、`reconcile`、`<For>`、effect、`preload`、`<dialog>`、多语言、业务引擎、文档外壳里的内联脚本、StyleX 条件表达式的几种编译失败、`cssInjectionTarget`、路径别名、Cloudflare Workers 部署、服务端渲染。它们是在 2.0.0-rc.13 和 rc.14、StyleX 0.19.1 上踩到的；这个模板里没有用到它们的代码。
