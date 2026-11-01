# 工作约定

这个目录是 `hostc codex` 的网页客户端：Solid 2 + StyleX，界面组件写在项目里，不依赖组件库。它从客户端模板复制而来，构建产物随 `hostc` CLI 一起发到 npm，由本机的桥接程序（`apps/cli/src/codex`）提供给浏览器。

和模板不同的地方：依赖、格式化、lint 和测试都走仓库根目录（`pnpm check`、`pnpm -F @hostc/codex-web test`），没有单独的 `mise.toml`、`pnpm-workspace.yaml` 和 `oxlint.config.ts`。下文提到 `mise run` 的地方，以根目录的命令为准。

- **协议类型是生成的：** `src/codex/protocol` 由 `pnpm generate:protocol`（`codex app-server generate-ts`）生成，只有类型，不手改，不进打包产物。生成物没有“方法对应哪种响应”，这张表在 `src/codex/api.ts`，用到新方法时加一行，并在桥接程序的允许列表里加上它。
- **界面不认识 Codex：** 最终目标是通用的 Agent Harness，Codex 只是第一个适配器，以后还可能有 ACP、Claude Code、自填 API Key。`src/harness/model.ts` 是界面和智能体之间唯一的约定；`src/components` 和 `src/routes` 只依赖它，不引用 `src/codex` 里的协议类型（唯一的例外是 `routes/index.tsx` 选择用哪个适配器）。文案也不写具体智能体的名字；要显示名字时用 `harness.agent`，由适配器提供。`src/harness` 下的 `diff`、`highlight`、`markdown`、`elicitation` 是纯函数，同样不依赖协议。
- **分层：** `src/codex/connection.ts`、`state.ts`、`segments.ts`、`translate.ts` 不依赖框架，竞态和顺序问题在 `engine.test.ts` 里测；只有 `src/codex/harness.ts` 知道 Solid，它把协议翻译成 `Harness`。
- **设计语言：** 改界面之前读 [docs/design-language.md](docs/design-language.md)。这是监督智能体工作的界面，不是聊天窗口；决定、结果、过程三层注意力，强调色只留给“等你决定”。`/design` 路由集中展示 `src/ui` 所有组件的所有状态，改基础组件时对照它看。
- **支持下限比模板高一点：** 菜单用 Popover（iOS Safari 18.3 起）。这是这个产品定的，其余仍按 Baseline 广泛可用。
- **调界面不花额度：** `pnpm fixture` 用 `dev/fixture-codex.mjs` 这个假 Codex 跑页面，消息里带 `approve`、`edit`、`ask`、`background`、`permission`、`form`、`plan`、`async`、`fail`、`long` 就会走对应的分支。
- **协议用最新的：** 权限走命名配置 `permissions`，不用旧的 `sandbox`；历史走分页；废弃的 `autoResolutionMs` 不用。
- **内容安全策略很严：** `script-src 'self'`、`style-src 'self'`，不能有内联脚本和内联样式属性。模型输出一律按文本渲染，不用 `innerHTML`。

## 动手之前

停一下。Solid 2 还是候选版本，它不是 React，也不是 Solid 1.x；凭习惯写会错。

1. 先读 [docs/solid2-stylex.md](docs/solid2-stylex.md)：这套技术栈的实战经验（版本和发布标签、官方模板、Solid 2 的要点、路由、StyleX 的坑、组件怎么按组件库封装、文档外壳、怎么验证、怎么托管）。
2. 写界面之前读 [docs/web-platform.md](docs/web-platform.md)：浏览器已经自带了什么（对话框、浮层、表单校验、容器查询、进出场和视图过渡、深浅色），每一样在这套技术栈里怎么写，以及这个模板的浏览器支持下限。想手搭一个控件或者引一个库之前，先在那里查有没有自带的。
3. 再读装好的包里自带的、和版本严格对应的文档（没有 `node_modules` 就先 `pnpm install`）：
   - `node_modules/solid-js/CHEATSHEET.md`
   - `node_modules/@solidjs/vite-plugin/README.md`
   - `node_modules/@solidjs/router/README.md`
   - 控制台出现诊断代码时：`node_modules/solid-js/skills/reactivity-diagnostics/SKILL.md`
   - 要查“哪个作用域重跑了、为什么”时：`node_modules/@solidjs/diagnostics/skills/agent-loops/SKILL.md`
4. 用一个库的组件或接口之前，读它自己的文档、类型定义和源码，**包括没有设置的参数的默认值**。约定不清楚时和官方模板（`solidjs/templates` 的 `solid-v2/basic`）对照，不要自己发明。

## 约定

- **结构照官方模板。** 没有 `index.html`，没有挂载文件：入口由 Vite 插件围绕 `src/App.tsx` 和 `src/Document.tsx` 生成。不加别的路由库，不手写入口。`vite.config.ts` 里 StyleX 插件在 Solid 插件前面。
- **路由是文件。** `src/routes` 下一个有默认导出的文件就是一个页面：`index.tsx` 是 `/`，`posts/[id].tsx` 是 `/posts/:id`，`[...404].tsx` 兜底。链接是普通的 `<a>`，地址用 `src/router.ts` 的 `paths` 拼。`file-routes.d.ts` 是生成的，不手改，要提交。
- **`src/ui` 是组件库，`src/components` 是业务组件。** `src/ui` 里是通用的、带行为和无障碍的控件，不含业务；调用处只能通过 `xstyle` 调布局（位置、尺寸、外边距），不能传 `class` 和 `style`。布局和带业务含义的拼装写在 `src/components`，自己 `stylex.create`、直接引用设计变量。`src/ui` 分两层：原子（一个控件或元素：按钮、图标、文字链接、状态点、卡片底）和用原子拼出来的组合件（对话框、空状态、确认框）。**写一页之前先把它要用的原子写好，再写组合件，最后写页面**；通用的东西（换一个产品还会原样用到）第一次用到就进 `src/ui`，业务拼装件第二次出现再抽，只用一次的不提前抽。不做 `Stack`、`Row`、`Text` 这类把 CSS 包成 props 的包装。
- **设计变量在 `src/ui/tokens.stylex.ts`。** 组件里不写死颜色、间距、圆角、字号，也不写死媒体查询（用 `media.narrow`、`media.dark`、`media.hover`、`media.reducedMotion`）。深浅色写在变量里，跟随系统。新颜色先算对比度（文字 4.5:1，轮廓和焦点环 3:1，两种外观都要），把数写在注释里。几处共用的样式（焦点环）在 `src/ui/base.ts`。
- **先用平台自带的。** 原生元素和 CSS 能做到的事不用脚本和库重做；怎么选、怎么写在 docs/web-platform.md。
- **支持下限是 Baseline 广泛可用**，写在 `package.json` 的 `browserslist` 里。广泛可用的直接用；新近可用的只用来锦上添花，不支持时页面照样能用；有限可用的只当增强，并用 `@supports` 或特性检测包起来。用一个特性之前查当天的支持数据，不凭记忆；要抬高下限是产品的决定，改 `browserslist` 和文档。
- **会动的东西都要尊重 `prefers-reduced-motion`。** 时长一律用 `motion` 变量，它们在这项设置下是 `0s`。状态变化的过渡走 `src/ui/transition.ts` 的 `transition()`，它已经处理了这项设置和 Solid 的延迟写入；帧率很低时过渡开始的那一段会丢点击，不能丢的高频操作不要用它（docs/web-platform.md 的“视图过渡在这里怎么用”）。
- **悬停样式写在 `media.hover` 里**，不直接写 `:hover`：触屏点完之后 `:hover` 会一直成立。
- **样式用 `{...stylex.attrs(…)}`**，不是 `stylex.props`；Solid 2 没有 `className`。
- **版本全部写死**，不用范围，锁文件要提交。`mise run outdated` 按各包该跟的发布标签列出落后的版本。升级 Solid 的包之前逐个 `npm view <包> dist-tags`（`@solidjs/vite-plugin` 的最新版在 `latest` 下，`next` 是旧的），整套一起升：`solid-js`、`@solidjs/web`、`@solidjs/diagnostics` 同一个版本，`@solidjs/router`、`@solidjs/vite-plugin`、`filesystem-routing` 各取最新。`unplugin` 是 3.x，在 StyleX 声明的范围之外，升它或升 StyleX 之后要重新验证（原因在 docs/solid2-stylex.md 的“版本”）。步骤在 docs/solid2-stylex.md 的“升级 Solid 的包”。升完更新那里的版本表。
- **代码注释用英文，文档用中文。** 组件上方的注释写清它是干什么的、什么时候用。
- **这个目录自成一体。** 文档和注释里不引用这个目录之外的路径或别的项目；后来的人需要的东西都写在这里。
- **新学到的写回文档。** 踩到 docs/solid2-stylex.md 里没有的坑，修完就补进去，写清在哪个版本上、怎么验证的。docs/web-platform.md 只写核对过的：能不能写进 StyleX 以实际构建为准，浏览器支持以当天的数据为准并写上日期，没核对的不写或者明说。

## 测试

模板本身不带测试。产品要加时照 [docs/testing.md](docs/testing.md)：vitest 加 jsdom，那里写清了要改哪几处配置，以及 jsdom 看不到什么。

## 改完之后怎么验证

按成本从低到高，每次改动至少走到第 2 步，动了界面走到第 4 步：

1. `pnpm check`：格式（`oxfmt --check`）、类型（`tsc --noEmit`）、lint（`oxlint`，带 Solid 的规则，通过时没有输出）。格式不对用 `pnpm format` 修。
2. `pnpm build`：StyleX 的编译错误只在这里和开发服务里暴露；`tsc` 通过不代表页面能打开。
3. `pnpm dev`，打开页面，看控制台。浏览器的警告和错误会转到开发服务的日志里，Solid 的诊断都要修；唯一可以不管的是开着热更新时超过约 50 行的列表报的 `WIDE_SCOPE_DEPS`。
4. 在浏览器里走真实流程：桌面宽度和手机宽度、浅色和深色各看一遍；有动效的地方再看一遍“减少动态效果”，并快速连点确认没有丢操作。用无界面的浏览器驱动；窗口不在前台时帧率受限，动画和连点的结果不可信，先确认 `requestAnimationFrame` 的帧率；驱动脚本和截图放在系统的临时目录，不放进这个目录。
5. 发布前 `pnpm preview`，对着构建产物再看一遍。

起了开发服务或预览服务，验证完要停掉。汇报时说清楚哪些是在浏览器里看到的，哪些只是命令通过；没有跑的检查不要说通过。

## Code Review 工作方式

- 用户要求 review 或检查代码时，先只读检查并记录问题，不要发现一处就立即修一处。除非用户明确要求同时修复，否则 review 本身不代表授权修改实现。
- 发现问题后，沿同类调用路径、状态流和接口检查有没有相同根因的问题，在约定范围内查完再统一汇总，不把同类路径的检查留给用户反复催。
- 每个问题记录触发场景、代码位置、实际影响和证据；区分已确认的问题和待核实的疑点，不把猜测当结论。
- 汇总时按根因和关联整理，一起评估能不能用一个直接、可维护的方案解决多个问题。和用户确定修复范围后再改，避免发现一个问题打一个补丁。
- 聚焦约定的功能和正常使用中的正确性、状态归属、架构边界；不扩展功能，不为了优雅重构，不罗列没有实际依据的罕见边界情况。
- 检查结束时说明覆盖范围、发现的问题和验证的限制，不因为检查或测试通过就声称绝无遗漏。
