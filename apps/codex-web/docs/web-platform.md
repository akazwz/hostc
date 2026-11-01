# 浏览器已经给了什么：先用平台，再写代码

写界面之前读这一份。它列的是浏览器现在自带、不用 JavaScript 也不用库就能做到的事，以及每一样**在这套技术栈里怎么写**：能不能写进 `stylex.create`，还是要进 `src/global.css`，还是只是 HTML 属性和 DOM 接口。

想到“弹窗、菜单、提示、手风琴、表单校验、按容器大小变版式、进出场动画、滚动联动、深色模式”这些词的时候，先来这里查。手写一个，通常是在重做浏览器已经做对的事（焦点、键盘、读屏器、顶层叠放），而且做得更差。

**准确性规则。** 这里只写核对过的东西，每一条都标了核对到哪一步：

- **构**：用这个模板写死的版本（StyleX 0.19.1、Vite 8.3.4）实际构建过，样式进了生成的 CSS。StyleX 的编译错误只在构建时暴露，所以“能不能写”一律以构建为准。
- **览**：在真实浏览器里看过行为。用的是 Chromium 152，开发服务和构建产物各一遍。**Safari 和 Firefox 没有真机可测**，它们的情况只来自支持数据；明确写了“Playwright 的 WebKit”的除外，它接近 Safari，但不等于 Safari。
- **数据**：只查了支持数据，没有在这里跑过。

支持数据取自 `web-features` 3.41.0（Baseline 背后的那份数据），核对日期 2026-10-08。往这份文档里加东西时守同样的规则：没核对过的不写，或者明说没核对。

## 方法：一个特性能不能用

### 查 Baseline

Baseline 把一个特性分成三档：

- **广泛可用（Widely available）**：四家主流浏览器内核都支持，而且已经满 30 个月。
- **新近可用（Newly available）**：四家的最新版都支持了，还不满 30 个月。
- **有限可用（Limited availability）**：至少有一家还不支持。

不要凭记忆，查当天的数据：

```sh
cd "$(mktemp -d)" && npm pack web-features --silent && tar xzf web-features-*.tgz
node -e 'const s = require("./package/data.json").features["popover"].status; console.log(s.baseline, s.baseline_low_date, s.baseline_high_date, s.support)'
```

`baseline` 是 `"high"`（广泛）、`"low"`（新近）或 `false`（有限）；`support` 是每家浏览器从哪个版本开始支持。特性的键名在 `data.json` 的 `features` 里按名字找。

### 这个模板的支持下限

**下限是“Baseline 广泛可用”。** 它写在 `package.json` 的 `browserslist` 字段里（`"baseline widely available"`），不是只写在文档里：StyleX 处理 CSS 时读它，决定哪些新语法要降级。2026-10-31 它解析出来是 Chrome 124、Edge 124、Firefox 125、Safari 17.4（含 iOS）；`pnpm dlx browserslist` 在这个目录里运行会打印当前的结果。这个范围跟着依赖里的数据走，升级依赖时自己往前挪。

由此得出三条约定：

1. **广泛可用的，直接用**，不写回退。
2. **新近可用的，只用来锦上添花**：不支持的浏览器里页面照样能用，只是少一点效果。首页的数字滚动就是这样（见“动效”）。要让一个新近可用的特性承担“没有它就用不了”的功能（比如用 Popover 做唯一的菜单），先由产品决定抬高下限，改 `browserslist` 和这一节，再用。
3. **有限可用的，只当增强**，并且用 `@supports`（样式）或特性检测（脚本）包起来，保证不支持时什么都不坏。

Vite 自己的构建目标（`build.target`，默认 `"baseline-widely-available"`）是另一个固定的列表：Chrome 111、Edge 111、Firefox 114、Safari 16.4。它管 JavaScript 语法和 `global.css` 的降级，不读 `browserslist`（Vite 8.3.4 的代码里没有读它的地方）。两者不一样不碍事，但要知道降级 CSS 的有两处。

### 在真实浏览器里核对

- 支持数据说“支持”不等于在这套构建里能用。先 `pnpm build`（编译），再开页面看计算样式和行为。
- 特性检测：样式用 `CSS.supports("animation-timeline: scroll()")`，接口用 `typeof document.startViewTransition`、`"popover" in HTMLElement.prototype`。
- 系统设置用无界面浏览器模拟：`prefers-color-scheme`、`prefers-reduced-motion`、`prefers-contrast` 都能通过 DevTools 协议的 `Emulation.setEmulatedMedia` 切换，然后断言 `getComputedStyle` 的结果。
- **开发服务和构建产物都要看。** 两边处理 CSS 的方式不同，`light-dark()` 就是在构建里对、在开发服务里错（见“颜色和主题”）。
- 开发服务第一次编译某个模块时，它的样式会晚一拍到（样式表在模块编译之前就被请求了，由运行时脚本补取）。自动化检查在第一次打开一个页面时读到“没有样式”的值，重新加载再读。

## StyleX 能表达什么

多数现代 CSS 都能写进 `stylex.create`，分四种写法：

| 是什么                   | 怎么写                                                         | 例子                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 属性和值                 | 驼峰属性名，值原样写成字符串                                   | `textWrap: "balance"`、`gridTemplateColumns: "subgrid"`、`width: "min(100%, 40rem)"`                                                 |
| 伪类、伪元素、属性选择器 | 作为键。伪元素包住一组属性，伪类和属性选择器写在某个属性的值里 | `"::backdrop": { … }`、`opacity: { default: 0, ":popover-open": 1 }`、`"[open]"`、`"[aria-current='page']"`、`":has(input:checked)"` |
| 规则（at-rule）          | 作为某个属性的值里的键，可以和伪类嵌套                         | `"@container (min-width: 30rem)"`、`"@media (prefers-reduced-motion: reduce)"`、`"@supports (…)"`、`"@starting-style"`               |
| 要名字的东西             | 用 StyleX 的函数生成名字                                       | `stylex.keyframes()`、`stylex.viewTransitionClass()`、`stylex.defineConsts()`（媒体查询和容器查询的字符串）                          |

以上每一种都构建过（构）。**放进 `src/global.css` 的**是不属于某一个元素的规则：`:root` 上的声明（`color-scheme`、`view-transition-name: none`）和 `::view-transition` 这类挂在文档根上的伪元素。这个模板里只有这几条；`@font-face` 没有在 StyleX 里试过，它也不属于哪个元素，放在那里。

几条实测到的脾气：

- **StyleX 不检查属性名和取值。** `colour: "red"`、`display: 5` 都能通过 `tsc`。写错的属性不报错，只是不生效，所以新写的样式要在浏览器里看计算值。
- **块方向和尺寸的逻辑属性会被改写成物理属性。** `marginBlockStart` 生成 `margin-top`，`inlineSize` 生成 `width`，`blockSize` 生成 `height`；行方向的（`paddingInline`、`insetInlineStart`、`borderStartStartRadius`）原样保留。横排文字没有区别，竖排版式不要指望它们跟着转。
- **`stylex.positionTry()` 在 0.19.1 上构建失败**（生成的 `@position-try` 规则格式不对，CSS 处理报 `Unexpected token`）。锚点定位的回退用关键字：`positionTryFallbacks: "flip-block"`，能编译。
- **`stylex.firstThatWorks("100dvh", "100vh")` 生成的 CSS 里只有 `100dvh`**，回退值被去掉了（应当是因为目标浏览器都支持前一个值）。给下限以外的浏览器留回退，这个办法靠不住。
- **媒体查询会被改写成区间语法**（`max-width: 767px` 变成 `width <= 767px`），在下限以内。

## 原生元素和属性，代替手搭的控件

这些是 HTML 和 DOM，不经过 StyleX；样式部分另说。Solid 2 的 JSX 里属性名一律小写（`popovertarget`、`inputmode`、`enterkeyhint`、`closedby`、`commandfor`、`minlength`），类型定义里都有，`tsc` 通过。布尔属性传布尔值就是“有或没有”：`inert={busy()}`。

| 要做的事               | 用什么                                                                                                          | Baseline（2026-10-08）                      | 核对                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------ |
| 模态对话框             | `<dialog>`，用 `ref` 拿到元素，事件处理里 `showModal()`；关闭后在 `onClose` 里同步状态                          | 广泛（2022-03 起）                          | 览                                         |
| 对话框的遮罩           | `"::backdrop": { backgroundColor: … }`，写在 `stylex.create` 里                                                 | 广泛                                        | 构、览                                     |
| 点遮罩关闭             | `<dialog closedby="any">`                                                                                       | 有限（Safari 不支持）                       | 览                                         |
| 不写脚本开对话框       | `<button commandfor="id" command="show-modal">`                                                                 | 新近（2025-12 起）                          | 览                                         |
| 菜单、提示、浮层       | `<div id="x" popover="auto">` 加 `<button popovertarget="x">`；开着的样式用 `":popover-open"`                   | 新近（2025-01 起，iOS Safari 18.3）         | 构、览                                     |
| 浮层贴着触发它的元素   | 锚点定位：触发元素 `anchorName: "--menu"`，浮层 `positionAnchor: "--menu"`、`positionArea: "bottom span-right"` | 有限（数据里只有 Safari 27 支持完整的一组） | 构、览                                     |
| 展开和收起             | `<details>` 加 `<summary>`；要读它的状态用 `onToggle` 里的 `event.currentTarget.open`                           | 广泛                                        | 览                                         |
| 手风琴（一次只开一个） | 几个 `<details>` 用同一个 `name`                                                                                | 新近（2024-09 起）                          | 览                                         |
| 表单校验               | `required`、`minlength`、`type="email"` 等；不合法时浏览器自己拦住提交，`onSubmit` 不会被调用                   | 广泛                                        | 览                                         |
| 出错的输入框的样式     | `borderColor: { default: …, ":user-invalid": … }`：用户动过之后才算，不会一打开就满屏红                         | 广泛（2023-11 起）                          | 构、览                                     |
| 手机键盘               | `inputmode`、`enterkeyhint`、`autocomplete`                                                                     | 广泛                                        | 属性到了元素上（览）；键盘本身没有手机可测 |
| 让一块区域暂时不可操作 | `inert={条件}`：整块不能交互。实测属性跟着条件加上和去掉，里面的按钮聚焦不到                                    | 广泛（2023-04 起）                          | 览                                         |

在 Chromium 152 里看到的：`showModal()` 之后对话框是模态的（匹配 `:modal`）、焦点进了对话框、按 Esc 关闭、焦点回到打开它的按钮，这些都没有写一行代码。浮层同样：按 Esc 和点它外面都会关。

用法上的几条（前两条是之前做产品时踩到的，这次没有重新验证）：

- 不要给 `<dialog>` 本身设 `display`，那会让它关着也显示；布局写在里面的元素上。
- 用户没有和页面交互过时，浏览器允许按 Esc 强行关闭对话框。“不可关闭”的对话框要在 `close` 事件里重新打开。
- 锚点定位在 Chromium 152 里能用（浮层正好出现在按钮下方、左边对齐），但按数据它是有限可用。只当增强，保证不支持时浮层没有被摆到触发元素旁边也仍然能用。
- `showModal()` 把焦点放在对话框里第一个能聚焦的元素上，通常是关闭按钮。要它落在别处（确认对话框里的“取消”），给那个元素加原生的 `autofocus`：实测加了之后焦点落在它上面（览，2026-10-12）。
- 模态对话框开着时，它以外的内容收不到点击：实测点对话框外面的按钮，按钮的处理函数没有被调用（览，2026-10-12）。页面里的轻提示因此既被遮罩压住又点不到，做法见 solid2-stylex.md 的“项目结构上的建议”。
- 校验规则超出属性能表达的范围时用 `input.setCustomValidity("原因")`：实测它让表单的 `checkValidity()` 不通过，传空字符串恢复（览）。

只查了数据、没有在这里跑的：`dialog.requestClose()`（新近，2025-05 起）、`popover="hint"`（有限）、`::details-content`（新近，2025-09 起；能编译）、`interpolate-size`（有限，只有 Chromium；能编译）、`field-sizing: content`（新近，2026-06 起；能编译）。

## 布局和响应式

全部写在 `stylex.create` 里。

| 要做的事                     | 怎么写                                                                                                                           | Baseline               | 核对   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------ |
| 组件按**自己的**宽度变版式   | 容器 `containerType: "inline-size"`；里面 `padding: { default: …, "@container (min-width: 30rem)": … }`                          | 广泛（2023-02 起）     | 构、览 |
| 按“里面有什么”变样式         | `outlineWidth: { default: …, ":has(input:checked)": … }`                                                                         | 广泛（2023-12 起）     | 构、览 |
| 不分左右的间距和位置         | `paddingInline`、`marginInline`、`insetInlineStart`                                                                              | 广泛                   | 构、览 |
| 占满手机屏幕的高度           | `minHeight: "100dvh"`（跟着地址栏伸缩）、`"100svh"`（地址栏展开时的高度）                                                        | 广泛（2022-12 起）     | 构、览 |
| 在两个尺寸之间平滑变化       | `fontSize: "clamp(1rem, 0.5rem + 2vw, 2rem)"`、`width: "min(100%, 40rem)"`                                                       | 广泛                   | 构、览 |
| 子网格对齐父网格的列         | `gridTemplateColumns: "subgrid"`                                                                                                 | 广泛（2023-09 起）     | 构、览 |
| 标题不留孤字                 | `textWrap: "balance"`                                                                                                            | 新近（2024-05 起）     | 构、览 |
| 正文段落末行不留孤字         | `textWrap: "pretty"`                                                                                                             | 有限（Firefox 不支持） | 构、览 |
| 只有能悬停的设备才有悬停效果 | `backgroundColor: { default: …, [media.hover]: { default: …, ":hover": … } }`（`src/ui/Button.tsx`）                             | 广泛                   | 构、览 |
| 内容避开刘海和底部横条       | `viewport-fit=cover` 加 `` paddingInlineStart: `max(${frame.gutter}, env(safe-area-inset-left))` ``（`src/components/Page.tsx`） | 广泛                   | 构、览 |

- **不把 `:hover` 直接写在顶层。** 触屏点一下之后 `:hover` 会一直成立，按钮停在悬停色，直到点别处。实测（Chromium 触屏模拟）：写在 `media.hover` 里之后，点完 `:hover` 仍然匹配，但背景色回到默认值；鼠标下悬停色和禁用态照常。
- **`viewport-fit=cover` 要配安全区内边距。** 它让页面画到刘海和底部横条下面，内边距要自己留。用 DevTools 协议的 `Emulation.setSafeAreaInsetsOverride` 能模拟：设了上 59、左右 47、下 34 之后，`Page` 的内边距算出来是 59、47、40、47（底部的 40 大于 34，`max()` 取前者）。真机上没有看过。
- **纵向 flex 容器里用 `marginInline: "auto"` 居中的子项不会被拉伸**，宽度按内容收缩。给一张还没加载出来的图留位置（只设了 `aspectRatio`）时，占位框会塌成里面那个加载圈的大小，图出来再撑开，版面跳一下。占位要写明宽度，比如 `width: "min(100%, calc((100dvh - 13rem) * 3 / 4))"`。这一条是做产品时在 Chromium 152 里量到的（改之前约 20×27，改之后加载前后都是 384×512），没有在这个模板里重做。
- **一排控件要在最窄的手机、最长的语言下量过。** 工具栏在 390 宽的中文界面里放得下，不代表在 320 宽的英文界面里放得下：把视口设到 320、切到文字最长的语言，比较这一排的 `scrollWidth` 和 `clientWidth`。放不下时先收紧窄屏下的内边距和间距；再给这一排加 `overflowX: "auto"`（`scrollbarWidth: "none"`）兜底，最坏也只是可以横向拨动，不会有按钮被挤出容器。这一条是做产品时在 Chromium 152 的手机模拟里量到的（内容 290 对可用 288），没有在这个模板里重做。
- **先想容器查询，再想媒体查询。** 媒体查询问的是“窗口多宽”，组件真正关心的是“给我的地方多宽”。同一个卡片放进侧栏和放进正文要不同版式时，媒体查询做不到。整页的骨架（这个模板的 `media.narrow`）才用媒体查询。
- 容器查询的字符串和媒体查询一样可以放进 `defineConsts`（构）。容器单位 `cqi` 能编译（构）。
- `text-wrap` 这两个值是锦上添花：不支持的浏览器照常换行。
- 父元素状态影响子元素、子元素状态影响父元素，StyleX 另有 `stylex.when.ancestor(":hover")` 和 `stylex.when.descendant(":focus-visible")`，配 `stylex.defaultMarker()` 用。两者能编译（构），没有在浏览器里看过。

## 动效

| 要做的事               | 怎么写                                                                                                                       | Baseline                                                                                            | 核对   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------ |
| 一次状态变化前后的过渡 | `transition(() => 写状态)`（`src/ui/transition.ts`），要动的元素设 `viewTransitionName`                                      | 新近（2025-10 起）                                                                                  | 构、览 |
| 给这次过渡定制动画     | `stylex.viewTransitionClass({ old: { … }, new: { … } })`，结果给元素的 `viewTransitionClass`                                 | 新近（2025-10 起）                                                                                  | 构、览 |
| 元素出现时的进场       | `opacity: { default: 0, "[open]": { default: 1, "@starting-style": 0 } }` 加普通的 `transition*`                             | 新近（2024-08 起）                                                                                  | 构、览 |
| 元素消失前的退场       | `transitionBehavior: "allow-discrete"`，`transitionProperty` 里加上 `display` 和 `overlay`                                   | `transition-behavior` 新近；`display` 的过渡有限（Firefox 不支持），`overlay` 有限（只有 Chromium） | 构、览 |
| 跟着滚动走的动画       | `animationTimeline: "scroll()"`（`"view()"` 只构建过），`animationName` 放在 `"@supports (animation-timeline: scroll())"` 里 | 有限（Firefox 不支持）                                                                              | 构、览 |
| 尊重“减少动态效果”     | 时长一律用 `motion` 变量，它们在 `media.reducedMotion` 下是 `0s`（`src/ui/tokens.stylex.ts`）；脚本：`matchMedia(…).matches` | 广泛                                                                                                | 构、览 |

元素要等退场动画走完再从文档里拿掉（或者 `<dialog>` 要等它走完再 `close()`）时，等的是那几个过渡本身：加上离开的样式后取 `元素.getAnimations()`，等它们的 `finished`。不要等 `transitionend` 事件，进场过渡迟到的结束事件会被当成退场结束。这一条是做产品时在 Chromium 152 里确认的，没有在这个模板里重做；写法见 solid2-stylex.md 的“项目结构上的建议”。

`@starting-style` 的进场从元素第一次算样式的那一帧开始计时。元素小、内容现成时没问题；打开时才建一大块内容的面板，那一帧很长，动画的开头会被吃掉一截，这种情况改成“带着起点样式挂载，下一帧再拿掉”，见 solid2-stylex.md 的“项目结构上的建议”。

**每一个会动的东西都要回答“减少动态效果时怎样”。** 这不是可选项。`transition()` 里已经判断了：用户开了这项设置就直接改状态，什么都不动。样式里的时长写在 `motion` 变量里，实测开了这项设置后 `Button` 的 `transition-duration` 是 `0s`。

### 视图过渡在这里怎么用

首页的计数就是例子（`src/routes/index.tsx`）：点“加一”，旧数字向上淡出，新数字从下面进来。

- **写状态要包在 `transition()` 里，它会 `flush()`。** 浏览器在回调返回的那一刻拍“之后”的照片，而 Solid 2 的写入要到下一个微任务才生效；不同步刷新，两张照片一样，什么都不动。
- **只有起了名字的元素参与。** `src/global.css` 里有 `:root { view-transition-name: none }` 和 `::view-transition { pointer-events: none }`。没有这两条时整页都参与过渡，过渡进行中页面上盖着一层照片，**点击落不到按钮上**：实测 40 毫秒一次连点 15 下，只记到 3 下；两条只留任何一条都还是 3 下，两条都在才是 15 下（这个结果是在帧率正常时量到的，下一条是例外）。
- **从 `startViewTransition` 到过渡就绪的这段时间里，点击落不到按钮上。** 这一段指针命中的是 `<html>`（事件序列是 `pointerdown` 在 `HTML`、`pointerup` 在 `BUTTON`，`click` 也就落在 `HTML` 上），上面两条 CSS 管不到它。它通常只有一帧。2026-10-31 对着构建产物量：60fps 下，Chromium 和 Playwright 的 WebKit 在点击间隔 20、40、80、120 毫秒时都是 0/90；间隔 0（同一帧里连发）时分别丢 71/90、3/90；窗口被限到 4fps 时，这一段最长到 1 秒，丢 10% 到 25%，点得慢也一样。所以一根手指在正常帧率下碰不到它；但主线程很忙、帧率很低时会丢操作。**不能丢的高频操作，主线程又可能很忙时，不要包在视图过渡里，改用普通的 CSS 过渡或 Web Animations。**
- **被下一次过渡打断的过渡会让它的 `ready` 承诺被拒绝**，不接住就是控制台里一串 `Transition was skipped`。`transition()` 接住了；状态变化本身不受影响，一次任务里脚本调用 20 次 `click()` 得到 20。
- `viewTransitionName` 在同一时刻整页只能有一个元素用同一个名字，按规范重名时这次过渡会被跳过。实测两个元素同名时状态照常更新、控制台也没有报错，所以动画不出现时先查重名。列表里每一行要各自过渡时，名字要按行生成。
- 定制动画里可以用设计变量（时长用的是 `motion.move`，实测动画时长是 200 毫秒）。按数据，有的浏览器版本支持视图过渡但还不支持 `view-transition-class`；那里定制动画的规则不会匹配，按规范是默认的淡入淡出（没有这样的浏览器可测）。
- 不支持视图过渡的浏览器里，`transition()` 直接改状态。
- **有视图过渡时，状态不是在点击的那一刻改的。** 写入发生在 `startViewTransition` 的回调里，浏览器要等到下一帧才调用它。自动化驱动的窗口帧率受限时差得更明显：点三下之后立刻读是 2，等 400 毫秒再读是 3，一下也没有丢（览，Chromium，2026-10-31）。自动化检查要等到预期的值出现，不要点完就读。

跨文档的视图过渡（有限）和限定在一个元素内的视图过渡（有限，只有 Chromium）只查了数据，没有用。

## 颜色和主题

| 要做的事                     | 怎么写                                                                                   | Baseline           | 核对   |
| ---------------------------- | ---------------------------------------------------------------------------------------- | ------------------ | ------ |
| 声明支持深浅两种外观         | `src/global.css` 里 `:root { color-scheme: light dark }`：页面底色和原生表单控件跟着系统 | 广泛               | 览     |
| 深浅两套颜色                 | 设计变量里 `bg: { default: "#fff", [media.dark]: "#111" }`（`src/ui/tokens.stylex.ts`）  | 广泛               | 构、览 |
| 感知均匀的颜色               | `color: "oklch(55% 0.2 270)"`                                                            | 广泛（2023-05 起） | 构、览 |
| 从一个颜色派生另一个         | `` backgroundColor: `color-mix(in oklch, ${color.accent} 80%, black)` ``                 | 广泛（2023-05 起） | 构、览 |
| 派生时只改一个分量           | `` color: `oklch(from ${color.accent} calc(l + 0.2) c h)` ``                             | 新近（2024-09 起） | 构、览 |
| 跟系统一致的颜色             | 系统颜色：`Canvas`、`CanvasText`、`Highlight`、`ButtonBorder`                            | 广泛               | 构、览 |
| 用户要求更高对比度时         | `borderTopWidth: { default: "1px", "@media (prefers-contrast: more)": "3px" }`           | 广泛（2022-05 起） | 构、览 |
| 强制颜色模式（高对比度主题） | `"@media (forced-colors: active)"` 里用系统颜色                                          | 广泛               | 构     |

- **悬停色、按下色这类“某个颜色深一点浅一点”的，用 `color-mix()` 派生**，不要为每一种再加一个手调的十六进制值。`src/ui/tokens.stylex.ts` 的 `accentHover` 就是这样从强调色来的：换强调色只改一处。两个输入都是字面量时，构建时就被算成了一个 `oklch()` 值；输入里有变量时原样留到浏览器里算。派生出来的颜色照样要算对比度：在浏览器里取计算值再算（`accentHover` 上的白字实测浅色 8.9:1、深色 4.8:1）。
- **深色模式不用类名开关。** 不要在 `<html>` 上切 `class="dark"` 再写两套选择器：`color-scheme` 加变量里的 `media.dark` 就够了，跟随系统，不需要脚本。要给用户一个手动开关，或者把某一块固定成深色时，把 `stylex.createTheme(color, { … })` 的结果和一个 `colorScheme: "dark"` 的样式一起加在外层元素上：实测系统是浅色时这一块用了覆盖后的颜色，里面的原生输入框也变成了深色（构、览）。
- **`light-dark()` 现在不要写进 StyleX。** 它还是新近可用（2024-05 起，2026-11-13 才满 30 个月），在下限之外，所以 StyleX 会把它降级成依赖两个辅助变量的写法。实测结果：**构建产物里是对的**（Vite 处理 `global.css` 的 `color-scheme` 时正好定义了那两个变量），**开发服务里是错的**（开发时 `global.css` 不经过这一步，变量不存在，整条声明无效，元素悄悄用了继承来的颜色）。写在 `stylex.create` 里和写在 `defineVars` 里都一样。深浅色继续用 `[media.dark]`；等下限把它包进去之后再重新验证。
- `accent-color` 按数据是有限可用，能编译（构），没有用。

## 无障碍的默认做法

- **先用对的元素，再考虑 ARIA。** 动作是 `<button>`，去别处是 `<a href>`，页面主体是 `<main>`，标题是 `<h1>` 起的层级，会自己更新的状态是 `<output>` 或 `role="status"`。元素选对了，键盘操作、焦点、读屏器的播报都是自带的；`<div onClick>` 一样都没有。只有原生元素表达不了的才加 `role` 和 `aria-*`（它们的布尔值要写成字符串，见 solid2-stylex.md）。
- **焦点环用 `:focus-visible`**（广泛；构、览）：键盘聚焦时显示，鼠标点击时不显示。全站共用 `src/ui/base.ts` 的 `focusRing`，每个可交互的元素都带上，不要 `outline: none` 之后不补。
- **可点的目标够大。** WCAG 2.2 的最低要求是 24×24 CSS 像素（2.5.8，AA 级），触屏上建议 44×44。`Button` 的最小高度是 2.75rem，实测 44 像素。只有图标的按钮也要到这个尺寸。
- **手指下的点击目标可以比看到的按钮大。** 紧凑的工具栏里按钮只有 32 或 36 像素高，又不想把栏撑高时，给按钮（`position: relative`）加一个透明的 `"::after": { content: '""', position: "absolute", insetInline: 0, insetBlock: { default: 0, "@media (pointer: coarse)": "-0.25rem" } }`：触屏上它向上下各伸出一截，接住手指，鼠标下不变。这一条是做产品时在 Chromium 152 的触屏模拟里确认的（按钮上沿之外 3 像素处的命中元素就是这个按钮），没有在这个模板里重做，也没有在真机上试。
- **对比度**：文字 4.5:1，控件的轮廓和焦点环 3:1，深浅两种外观都算（见 solid2-stylex.md）。
- **不只靠颜色传达状态**，出错的输入框除了变红还要有文字。
- **动效尊重 `prefers-reduced-motion`，对比度尊重 `prefers-contrast`**，见上面两节。

## 过时的写法和现在的写法

| 以前的写法                                                          | 现在用                                                                                 | 说明                                                              |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 用 `<div>` 加脚本搭模态框：自己锁焦点、挡背景、监听 Esc、管叠放层级 | `<dialog>` 加 `showModal()`                                                            | 广泛可用，直接用                                                  |
| 用脚本搭下拉菜单和提示：监听点外面、监听 Esc、`z-index` 竞赛        | `popover` 属性加 `popovertarget`                                                       | 新近可用：承担必需功能前先看“支持下限”那三条约定                  |
| 用脚本或定位库算浮层位置                                            | 锚点定位                                                                               | 有限可用：只当增强                                                |
| 用状态加条件渲染搭手风琴                                            | `<details name="…">`                                                                   | `<details>` 广泛；`name` 的互斥新近可用，不支持时只是能同时开几个 |
| 在 `onInput` 里手写校验、自己管理错误状态                           | 约束校验属性加 `:user-invalid`；规则复杂时用 `setCustomValidity()`                     | 广泛可用                                                          |
| 只用媒体查询做响应式                                                | 组件内部用容器查询，整页骨架才用媒体查询                                               | 广泛可用                                                          |
| 监听 `scroll` 事件做“进入视口”和滚动联动                            | 进入视口用 `IntersectionObserver`；联动的动画用滚动驱动动画                            | 前者广泛；后者有限，只当增强                                      |
| 用脚本量尺寸再设样式                                                | 容器查询、`clamp()`、`min()`；确实要量时用 `ResizeObserver`                            | 都是广泛可用（`ResizeObserver` 只查了数据）                       |
| 条件渲染时元素直接出现和消失，或者用脚本等动画结束再卸载            | `@starting-style` 进场、`transition-behavior: allow-discrete` 退场；状态变化用视图过渡 | 新近可用：都是锦上添花                                            |
| 用 `<html class="dark">` 切深色模式                                 | `color-scheme` 加变量里的媒体查询                                                      | 广泛可用                                                          |
| 为每个悬停色、禁用色手调一个颜色值                                  | `color-mix()` 从设计变量派生                                                           | 广泛可用                                                          |
| `100vh`（手机上被地址栏挡住一截）                                   | `100dvh`                                                                               | 广泛可用                                                          |
| `margin-left`、`padding-right`                                      | `marginInlineStart`、`paddingInlineEnd`                                                | 广泛可用                                                          |

`IntersectionObserver` 在 Solid 2 里的写法（览）：在 `onSettled` 里创建并 `observe`，返回 `() => observer.disconnect()`；回调里写状态没有问题，它不在渲染过程中。

## 这份文档核对过什么

2026-10-08：

- **支持数据**：每一行的 Baseline 状态和日期来自 `web-features` 3.41.0（当天发布的版本）。
- **构建**：标了“构”的写法，各自单独放进一个临时路由，用这个模板的 `vite build` 编译，并确认生成的 CSS 里有对应的规则；`tsc --noEmit` 也过了一遍（它不检查 StyleX 的属性，见上）。逐个编译的一共 51 种写法，50 种通过，失败的一种是 `stylex.positionTry()`；带嵌套的几种（`"[open]"` 里套 `"@starting-style"`、`"@supports"` 里放 `animationName`、`createTheme`）是在下面那几个临时页面里一起构建的。这些都在这个目录的一份临时拷贝里做，没有文件留在这里。
- **浏览器**：标了“览”的行为，写成三个临时页面，在 Chromium 152 里对着开发服务和构建产物各看了一遍，断言的是计算样式和 DOM 状态。除 `light-dark()` 之外两边结果一致。
- **首页的数字滚动**：在开发服务和构建产物上都测了：单次点击时只有计数这一个元素在过渡，用的是定制的两段动画；一次任务里连点 20 下、40 毫秒一次的真实指针点击 15 下、连按 5 次回车，计数都一下不少（2026-10-31 补充：这只在帧率正常时成立，见“视图过渡在这里怎么用”）；模拟“减少动态效果”时没有发起过渡；去掉 `startViewTransition` 时直接更新；控制台没有错误。
- **2026-10-12 补的两条**（`autofocus`、模态对话框外面收不到点击）：在这个目录的一份临时拷贝里加了一个临时页面，对着开发服务在 Chromium 152 里核对，用的是 solid2-stylex.md “版本”一节现在的那一组版本。
- **2026-10-31 补的几条**（`media.hover`、安全区、`motion` 变量、视图过渡开始时的点击）：对着这个模板的开发服务或构建产物核对；点击的数据另外用 Playwright 1.64 的无界面 Chromium 和 WebKit 量过，它们不限帧。
- **没有核对的**：Safari 和 Firefox 里的实际行为；手机上的软键盘、触摸和地址栏伸缩；读屏器的实际播报；强制颜色模式下的样子。
