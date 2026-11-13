# 1. 基础体验期

## 已定

- 默认占位搜索示例（example.com），搜索引擎可在设置中选择，并保存在 prefs；搜索设置的执行单见 [B2a 搜索引擎与地址解析](1-basics/B2a-search-engine.md)。
- 证书错误页提供“高级 → 继续前往”；例外仅在当前应用会话内按主机与证书指纹保存在内存，退出或重置环境时清除。返回和重试为主要操作。

> 本页其余任务仍是旧草案，尚未拆解成完整执行单；下文与已定决策冲突之处以本节为准。

## 概览与依赖图

目标是让日常导航、网站交互和错误恢复达到现代浏览器的基本体验。基础 Preact/i18n/store 接线合入后开始；每个任务遵守 [总约定](README.md)，尤其禁止触碰网络核心、闸门、指纹。B1 先于 B2；B3–B5 逻辑独立，但共享文件必须串行合入。所有 IPC 均限制发送窗口和当前标签，异步请求在标签销毁、导航或窗口关闭时取消。

## L0 剩余文案

### 目标与用户可见行为
打开设置，将界面语言从中文切到 English，再暂停、恢复、选择节点或触发校验失败：状态、错误、报告和确认内容均使用当前语言；变量如国家、HTTP 状态和节点名保持原值。再切回中文，无需重启即可更新当前仍显示的状态。窗口关闭或请求结束时不留下旧语言的异步提示；原始系统错误无法翻译时保留有意义的错误细节。不得通过翻译改变开关语义、状态机或安全策略。

### 要改/新增的文件
清点 `src/main/gate.ts` 的 `view` reason、`gatekeeper.ts`、`network.ts`、`proxy/subscription.ts`、`proxy/process.ts`、`checks.ts`，以及 `src/shared/profile.ts` 校验、`src/shared/switch.ts` 确认；在 `src/shared/i18n/{zh,en}.ts` 和必要的 settings 词典成对加 key。保留错误类别与参数，以 key 和参数延迟渲染，而不是缓存已翻译字符串；`Browser.setLocale` 已广播状态，确保已有 reason、notice 和 `panelData()` 刷新。避免把用户提供的节点名当 key。仅在上述 gate/network 文件替换字符串及其呈现，不改控制流、配置、网络或 fingerprint。

### IPC 合同增量
```ts
// 无新增 CaveCalls、CaveEvents、ShellState、TabState 或 SurfaceName。
// 如内部 reason 改成 key + params，仍在发送 ShellState 前转换为本地化 string。
```
命令、浮层和存储：无新增；沿用 `Dialog` 和现有 `Prefs.get<T>(key, fallback)` / `set(key, value)`，不迁移数据库。i18n 至少新增 `gate_paused: '已手动暂停外网' / 'Connection paused'`、`gate_coreStarting: '代理核心启动中' / 'Starting proxy core'`、`gate_noNode: '还没有导入节点' / 'No nodes imported'`、`gate_checking: '正在核对出口国家' / 'Checking exit country'`；逐项清点其余原文并配对英文，插值占位符两种语言一致。不得遗漏验证错误与切换确认。

### 边界、测试与验收
多窗口切换语言应同步；闸门关闭、暂停、检查中和已放行的值都更新，不暴露订阅 URL、密钥或其他窗口的私有数据。两种标签布局及 macOS、Windows/Linux 均检查。单元测试扩展 `test/unit/i18n.test.ts`、`gate.test.ts`、`profile.test.ts`、`switch.test.ts`：每个 key 两种语言、参数与原状态判定不变；`npm test`。e2e 用 `startWorld({extra:['--remote-debugging-port=0']})`、`devtoolsPort(w.log)`、`evaluate` 和 `waitFor` 切语言、暂停及触发校验；不可假定有键盘 helper。macOS 真机点击设置→外观→English→节点→暂停→恢复→中文，观察所有已打开窗口和确认框。验收：无残余固定中文用户可见状态、语义与网络行为未变、两种语言测试通过。依赖与并行：无功能依赖，先于其他任务；与改同一词典或 gate 文件的工作隔离 worktree，L0 先合并，后者解决冲突并重跑测试。

## P0 Windows/Linux 标题区与快捷键验证

### 目标与用户可见行为
在真实 Windows 与 Linux 桌面分别启动现有构建，顶部和侧栏布局下拖动标题区域、点击最小化/最大化/关闭，以及工具栏、标签、新标签、状态按钮；控件可点且不被 caption overlay 覆盖。隐藏菜单栏时逐一按共享命令表的主快捷键和 alternatives，尤其切换标签、地址栏、查找、全屏和开发工具；系统保留组合记录为差异。关闭最后窗口正常退出；恢复窗口尺寸后继续可用。无节点或闸门暂停时本地快捷键仍可操作。

### 文件与合同
检查 `src/main/platform.ts` 的 `titleBar(frame, symbol)`、`src/main/shell/window.ts` 的 `layout()`、`src/shared/layout.ts` 的 `pageBounds()`、`src/main/shell/commands.ts` 的 `appMenu()` 以及 `src/renderer/shell.css` 的 drag/no-drag 区。证据和实际平台、版本、失败项写入 `docs/MANUAL_TESTS.md`；若修复必要，在独立实现变更中修改相应文件并补测试，不能把 CDP 截图称为原生点击验证。
```ts
// CaveCalls、CaveEvents、ShellState、TabState、SurfaceName 均无增量。
// 命令沿用 COMMANDS 的 key/macKey/alternatives/macAlternatives；不增加快捷键。
```
无新增浮层、存储、迁移或 i18n key；现有命令标签沿用 `command_*` 中英文词典。不能改 gate、network core 或 fingerprint。多个窗口分别验证焦点和快捷键，页面标签关闭时窗口控制不失效；长标题、高 DPI、窄窗口、两种布局、深浅色和暂停状态均覆盖。

### 测试与验收
`test/unit/layout.test.ts` 扩充 caption 与视图边界的纯几何断言，`test/unit/ui-logic.test.ts` 测必要的快捷键映射；运行 `npm test` 与 `npm run test:e2e`。e2e 使用 `startWorld`、`devtoolsPort`、`evaluate`、`click`、`waitFor` 验证状态和页面内命中，不能证明窗口实际接收点击。macOS 手动点击 traffic lights、拖标题、切换顶部/侧栏并按 Cmd+L、Cmd+T；Windows/Linux 真实机器重复全部动作并记录机器、窗口管理器、系统缩放、结果。验收：三平台报告真实结果及未验证项；不能用自动化替代真实机器。依赖与并行：与 L0 独立，可隔离 worktree 并行验证；与 B1/B2 共享 shell 布局与命令文件，修复先合并后重新实测。

## B1 菜单与右键

- 行为：工具栏 ⋯ 显示新建标签/窗口、历史、书签、下载、缩放、打印、设置；页面、链接、图片、选区、可编辑区域、标签、地址栏按上下文显示可用动作。禁用不可执行项，支持箭头、Enter、Escape、焦点恢复和窗口边缘定位；右键不得先激活或导航错误标签。
- 文件：改 `src/main/shell/context-menu.ts`, `window.ts`, `commands.ts`, `src/shared/{ipc,commands}.ts`、`src/renderer/` 的 chrome、overlay 注册表和菜单组件、`src/shared/i18n/`；新增 `src/renderer/surfaces/context-menu.tsx`。移除网页右键的原生 Menu，但保留系统应用菜单。
- 契约：`SurfaceName` 加 `'menu' | 'contextMenu'`；`ShellState.contextMenu: { token: string; items: MenuItem[] } | null`，`MenuItem = { id: string; label: string; enabled: boolean; checked?: boolean; separator?: boolean }`；`CaveCalls.contextAction(token: string, id: string): void`；`CaveEvents` 无新增。主进程保存一次性 token 与原始参数，校验窗口/标签/导航代次，选中或关闭后销毁，URL 不当作可执行命令。
- 命令：复用现有 `window.new`, `tab.new`, `page.*`, `zoom.*`, `settings.open`；历史/书签/下载入口等 M4–M6 合入后再启用对应命令。上下文参数动作不塞进无参数命令表。标签菜单的 pin 等由 M2 接线。中英文沿用命令表；无新增快捷键。无数据库查询。
- 测试：单元测菜单项组合、禁用与 token 失效；e2e 用 `startWorld`/CDP 测链接、选区、编辑菜单和 Escape；macOS 真机测网页右键、浮层点击及两个布局。
- 验收：菜单内容与目标一致，键盘可完成操作，切页/失焦/窗口关闭后无残留，打开链接仍经 Navigator 和闸门。


### 实施补充：接口与交互

现有 `pageMenu(wc, p, openLink)` 在 `ShellWindow.contextMenu(tab, p)` 被调用；替换前保留链接、编辑和选区行为。网页坐标需转换到窗口坐标，右键不切换活动标签。 用户打开入口后应能看清当前目标；使用 Tab/Shift+Tab 到达控件、方向键在列表中移动、Enter 执行、Escape 取消并回到原焦点。空数据提供简短空状态；失败保留可重试入口，不把异常堆栈、凭据或完整私人数据放进 UI。正在编辑时广播不能覆盖输入；同一操作重复提交应幂等或禁用，关闭窗口、标签或切换导航时取消或忽略旧结果。所有 URL 再由主进程校验，发起远程加载仍经过 `Navigator.load` 和闸门，关闭或暂停时不得额外发请求。

```ts
// CaveCalls 增量；具体返回类型见本节契约
contextAction(token: string, id: string): void
// CaveEvents 无新增；ShellState / TabState 增量按上文契约。
// SurfaceName 增量：menu | contextMenu
```

**i18n：**在 `src/shared/i18n/zh.ts` 与 `en.ts` 成对加入 `menu: '菜单' / 'Menu'`；设置页专用字符串放对应 settings 词典。其余可见动作、错误、空状态和无障碍名称也需成对翻译，复用已有 `command_*` key；不要以英文或中文硬编码动态反馈。命令 id 与快捷键以本节上方列出的为准；新增命令按 `CommandSpec` 使用 `key`、必要时 `macKey`，无快捷键则省略两字段。未列新命令时无增量。

**浮层与持久化：**本节指定的浮层通过 `src/renderer/overlay.tsx` 的 `surfaces` 注册并以 `Surfaces.open/close` 管理；无新增时沿用现有视图。使用 `Surface` 定位，菜单用 `Menu`，选项列表用 `List`，确认使用 `Dialog`；这些组件按需要组合，不为本任务新造平行 overlay。数据库按上文仓库和迁移执行；未列新表或列即不迁移。所有仓库变更必须测试旧库升级和事务回滚。

**边界和验证：**检查两个窗口同时操作、目标标签中途关闭或导航、闸门关闭/暂停、私人信息不进入日志与无关窗口、顶部与侧栏布局，以及 macOS 和 Windows/Linux。单元测试放 `test/unit/`，覆盖本节的状态转换、非法参数、竞态与存储；运行 `npm test`。e2e 使用 `startWorld({ extra: ['--remote-debugging-port=0'] })`，以 `devtoolsPort(w.log)` 获取端口，`evaluate`/`click`/`waitFor` 针对 shell、overlay 与本地 fixture 断言；需要新服务器行为时扩展 `test/server.mjs`，并在结束调用 `w.stop()`。`click` 仅检查单个页面的命中，不证明原生窗口层级。macOS 人工实际点击入口、键盘操作、取消、切换标签与窗口，在顶部和侧栏各重做；记录结果与未验证的 Windows/Linux 项。

**验收与并行：**功能、空/错误状态、焦点、权限边界和上述测试均通过才完成；报告人工结果及限制。除 D2 审阅批准后的范围外，禁止改 gate、网络核心、fingerprint；L0 的字符串例外与本任务无关。与其他任务共享 `src/shared/ipc.ts`、`src/main/index.ts`、`shell/window.ts`、`overlay.tsx`、i18n 和迁移文件时使用隔离 worktree，按本文依赖顺序合并；后合入者重新协调类型、迁移版本并重跑测试，不以并行开发代替串行合并。
## B2 地址栏

- 行为：聚焦全选；输入显示历史、书签、当前窗口及其他窗口的开放标签和搜索建议（本地，不远程请求），箭头选取、Enter 打开、切换标签项激活所属窗口；Escape 恢复原地址并 `focusPage`。空输入不搜索；粘贴并转到直接解析；有效 URL 使用现有 `toUrl`，其他文本搜索。显示安全指示，点击由 D1 接入。
- 文件：`src/renderer/shell.tsx`、地址栏和 `<List>`、overlay 注册表；`src/main/shell/{browser,window,navigation}.ts`、`src/shared/{ipc,url,commands}.ts`、i18n；如需新建 `src/main/shell/suggestions.ts`。依赖 B1；历史已接入记录，书签仓库需实例化；M5/M6 后补完整数据。
- 契约：`Suggestion = { kind: 'history'|'bookmark'|'tab'|'search'; title: string; url: string; tabId?: number; windowId?: number }`；`CaveCalls.suggest(input: string): Suggestion[]; chooseSuggestion(item: Suggestion): void; pasteAndGo(): void`；`ShellState.address: { editing: boolean; security: 'secure'|'insecure'|'internal'|'unknown' }`；无新事件。服务端重新验证目标而非信任客户端 URL/id；剪贴板只由明确用户动作读取。请求编号防止旧结果覆盖。
- 查询：`History.search(text: string, limit: number)` 的 FTS 与 `Bookmarks.search(text: string, limit: number)`（需在 `index.ts` 实例化 `Bookmarks` 并接入 Browser）、开放标签合并去重、限制 10 条；存储不可用时仍可导航。命令 `address.pasteAndGo`：粘贴并转到 / Paste and Go，无快捷键；`address.focus` 现有 Cmd/Ctrl+L。
- 测试：单元测 URL/搜索、排序去重、过期结果；e2e 测焦点、Escape、粘贴、建议选择和关闭闸门；macOS 手测真实点击。验收：编辑不会被导航更新覆盖，提交/取消后页面可输入。


### 实施补充：接口与交互

`ShellWindow.navigate(input)` 经 `toUrl` 和 `WindowHost.load` 到 `Navigator.load`；当前 `toUrl` 空值返回 about:blank，搜索使用可配置的 HTTPS 模板。默认搜索模板为 `https://example.com/?q={query}`（仅占位），见 B2a 执行单。 用户打开入口后应能看清当前目标；使用 Tab/Shift+Tab 到达控件、方向键在列表中移动、Enter 执行、Escape 取消并回到原焦点。空数据提供简短空状态；失败保留可重试入口，不把异常堆栈、凭据或完整私人数据放进 UI。正在编辑时广播不能覆盖输入；同一操作重复提交应幂等或禁用，关闭窗口、标签或切换导航时取消或忽略旧结果。所有 URL 再由主进程校验，发起远程加载仍经过 `Navigator.load` 和闸门，关闭或暂停时不得额外发请求。

```ts
// CaveCalls 增量；具体返回类型见本节契约
suggest(input: string): Suggestion[]; chooseSuggestion(item: Suggestion): void
// CaveEvents 无新增；ShellState / TabState 增量按上文契约。
// SurfaceName 增量：suggestions
```

**i18n：**在 `src/shared/i18n/zh.ts` 与 `en.ts` 成对加入 `suggestions: '没有建议' / 'No suggestions'`；设置页专用字符串放对应 settings 词典。其余可见动作、错误、空状态和无障碍名称也需成对翻译，复用已有 `command_*` key；不要以英文或中文硬编码动态反馈。命令 id 与快捷键以本节上方列出的为准；新增命令按 `CommandSpec` 使用 `key`、必要时 `macKey`，无快捷键则省略两字段。未列新命令时无增量。

**浮层与持久化：**本节指定的浮层通过 `src/renderer/overlay.tsx` 的 `surfaces` 注册并以 `Surfaces.open/close` 管理；无新增时沿用现有视图。使用 `Surface` 定位，菜单用 `Menu`，选项列表用 `List`，确认使用 `Dialog`；这些组件按需要组合，不为本任务新造平行 overlay。数据库按上文仓库和迁移执行；未列新表或列即不迁移。所有仓库变更必须测试旧库升级和事务回滚。

**边界和验证：**检查两个窗口同时操作、目标标签中途关闭或导航、闸门关闭/暂停、私人信息不进入日志与无关窗口、顶部与侧栏布局，以及 macOS 和 Windows/Linux。单元测试放 `test/unit/`，覆盖本节的状态转换、非法参数、竞态与存储；运行 `npm test`。e2e 使用 `startWorld({ extra: ['--remote-debugging-port=0'] })`，以 `devtoolsPort(w.log)` 获取端口，`evaluate`/`click`/`waitFor` 针对 shell、overlay 与本地 fixture 断言；需要新服务器行为时扩展 `test/server.mjs`，并在结束调用 `w.stop()`。`click` 仅检查单个页面的命中，不证明原生窗口层级。macOS 人工实际点击入口、键盘操作、取消、切换标签与窗口，在顶部和侧栏各重做；记录结果与未验证的 Windows/Linux 项。

**验收与并行：**功能、空/错误状态、焦点、权限边界和上述测试均通过才完成；报告人工结果及限制。除 D2 审阅批准后的范围外，禁止改 gate、网络核心、fingerprint；L0 的字符串例外与本任务无关。与其他任务共享 `src/shared/ipc.ts`、`src/main/index.ts`、`shell/window.ts`、`overlay.tsx`、i18n 和迁移文件时使用隔离 worktree，按本文依赖顺序合并；后合入者重新协调类型、迁移版本并重跑测试，不以并行开发代替串行合并。
## B3 错误、崩溃与证书页

- 行为：`TabState.error` 的失败 URL 和可理解的错误，提供重试；`crashed` 显示“页面崩溃了，重新加载”/ “Page crashed. Reload”及重载。证书错误说明连接不安全，主要操作是返回和重试；高级区域可继续，例外仅在当前会话中按主机和证书指纹生效。取消导航、`ERR_ABORTED`、旧导航失败不能覆盖新页；不泄露证书细节给其他标签。
- 文件：`src/main/shell/{tab,window,navigation}.ts`、`src/main/index.ts`、`src/shared/ipc.ts`、新增 `src/renderer/internal-error.tsx` 和样式、i18n。内部页由壳受控视图按标签状态绘制，不让网页标签加载任何 `file:` 或可导航内部 URL。
- 契约：`TabState.error` 扩为 `{ code: number; description: string; url: string; kind: 'network'|'certificate' } | null`；`CaveCalls.retryTab(id: number): void; backFromError(id: number): void`；无新事件或命令、无表查询、无浮层。验证 id 在当前窗口；使用导航代次关联证书错误。
- 测试：单元测错误分类和竞态；e2e 模拟失败、崩溃、证书拒绝、重试和 `file:` 禁止。验收：重试回原 URL 并经过闸门，关闭/切换标签不显示错误页面于别处。


### 实施补充：接口与交互

`Tab.wire()` 的 did-fail-load 已过滤 -3，但未关联导航代次；错误视图必须属于该标签且位于网页视图之上，不能在网页进程注入壳代码。 用户打开入口后应能看清当前目标；使用 Tab/Shift+Tab 到达控件、方向键在列表中移动、Enter 执行、Escape 取消并回到原焦点。空数据提供简短空状态；失败保留可重试入口，不把异常堆栈、凭据或完整私人数据放进 UI。正在编辑时广播不能覆盖输入；同一操作重复提交应幂等或禁用，关闭窗口、标签或切换导航时取消或忽略旧结果。所有 URL 再由主进程校验，发起远程加载仍经过 `Navigator.load` 和闸门，关闭或暂停时不得额外发请求。

```ts
// CaveCalls 增量；具体返回类型见本节契约
retryTab(id: number): void; backFromError(id: number): void
// CaveEvents 无新增；ShellState / TabState 增量按上文契约。
// SurfaceName 增量：无
```

**i18n：**在 `src/shared/i18n/zh.ts` 与 `en.ts` 成对加入 `error_retry: '重试' / 'Retry'`；设置页专用字符串放对应 settings 词典。其余可见动作、错误、空状态和无障碍名称也需成对翻译，复用已有 `command_*` key；不要以英文或中文硬编码动态反馈。命令 id 与快捷键以本节上方列出的为准；新增命令按 `CommandSpec` 使用 `key`、必要时 `macKey`，无快捷键则省略两字段。未列新命令时无增量。

**浮层与持久化：**本节指定的浮层通过 `src/renderer/overlay.tsx` 的 `surfaces` 注册并以 `Surfaces.open/close` 管理；无新增时沿用现有视图。使用 `Surface` 定位，菜单用 `Menu`，选项列表用 `List`，确认使用 `Dialog`；这些组件按需要组合，不为本任务新造平行 overlay。数据库按上文仓库和迁移执行；未列新表或列即不迁移。所有仓库变更必须测试旧库升级和事务回滚。

**边界和验证：**检查两个窗口同时操作、目标标签中途关闭或导航、闸门关闭/暂停、私人信息不进入日志与无关窗口、顶部与侧栏布局，以及 macOS 和 Windows/Linux。单元测试放 `test/unit/`，覆盖本节的状态转换、非法参数、竞态与存储；运行 `npm test`。e2e 使用 `startWorld({ extra: ['--remote-debugging-port=0'] })`，以 `devtoolsPort(w.log)` 获取端口，`evaluate`/`click`/`waitFor` 针对 shell、overlay 与本地 fixture 断言；需要新服务器行为时扩展 `test/server.mjs`，并在结束调用 `w.stop()`。`click` 仅检查单个页面的命中，不证明原生窗口层级。macOS 人工实际点击入口、键盘操作、取消、切换标签与窗口，在顶部和侧栏各重做；记录结果与未验证的 Windows/Linux 项。

**验收与并行：**功能、空/错误状态、焦点、权限边界和上述测试均通过才完成；报告人工结果及限制。除 D2 审阅批准后的范围外，禁止改 gate、网络核心、fingerprint；L0 的字符串例外与本任务无关。与其他任务共享 `src/shared/ipc.ts`、`src/main/index.ts`、`shell/window.ts`、`overlay.tsx`、i18n 和迁移文件时使用隔离 worktree，按本文依赖顺序合并；后合入者重新协调类型、迁移版本并重跑测试，不以并行开发代替串行合并。
## B4 网站权限

- 行为：相机、麦克风、定位、通知、剪贴板读以 origin 为单位提示允许一次、始终允许、拒绝；定位仅使用 profile 配置坐标，没有坐标直接拒绝。无用户手势的敏感请求、未知权限、设备权限默认拒绝；非安全来源不提示。禁止从 OS 推断位置。多请求排队，相同请求合并，导航/窗口关闭默认拒绝，检查处理器只能读已记决定。
- 文件：`src/main/permissions.ts`, `index.ts`, `shell/{browser,window}.ts`, `store/site-settings.ts`, `shared/ipc.ts`、overlay 注册表、新增 `src/renderer/surfaces/permission.tsx`、i18n。接入 `session.setPermissionRequestHandler` 与 `setPermissionCheckHandler`，核对 requesting origin、webContents 和主框架；使用一次性回调且每个请求只完成一次。
- 契约：`Permission = 'media-camera'|'media-microphone'|'geolocation'|'notifications'|'clipboard-read'`；`ShellState.permissionPrompt: { id: string; origin: string; permissions: Permission[] } | null`；`CaveCalls.respondPermission(id: string, decision: 'once'|'allow'|'deny'): void`；`SurfaceName` 加 `'permission'`；无新事件/命令。`site_settings` key `permission:<Permission>` 保存 `'allow'|'deny'`；一次允许仅内存。遵守 profile 的通知和定位限制，不让存储授权覆盖硬限制。
- 测试：单元测权限映射、origin 和持久化、拒绝默认；e2e 用本地安全 fixture 验证允许、拒绝、跨 origin 与导航取消。人工验收 macOS/Windows 系统设备授权。验收：重启后持久决定有效，无配置定位时绝不回退真实位置。


### 实施补充：接口与交互

`applyPermissions(browserSession(), profile)` 已在 `start()` 调用；先核实现有限制，不可因持久选择放宽 profile 的通知或定位限制。 用户打开入口后应能看清当前目标；使用 Tab/Shift+Tab 到达控件、方向键在列表中移动、Enter 执行、Escape 取消并回到原焦点。空数据提供简短空状态；失败保留可重试入口，不把异常堆栈、凭据或完整私人数据放进 UI。正在编辑时广播不能覆盖输入；同一操作重复提交应幂等或禁用，关闭窗口、标签或切换导航时取消或忽略旧结果。所有 URL 再由主进程校验，发起远程加载仍经过 `Navigator.load` 和闸门，关闭或暂停时不得额外发请求。

```ts
// CaveCalls 增量；具体返回类型见本节契约
respondPermission(id: string, decision: 'once' | 'allow' | 'deny'): void
// CaveEvents 无新增；ShellState / TabState 增量按上文契约。
// SurfaceName 增量：permission
```

**i18n：**在 `src/shared/i18n/zh.ts` 与 `en.ts` 成对加入 `permission_allow_once: '允许一次' / 'Allow once'`；设置页专用字符串放对应 settings 词典。其余可见动作、错误、空状态和无障碍名称也需成对翻译，复用已有 `command_*` key；不要以英文或中文硬编码动态反馈。命令 id 与快捷键以本节上方列出的为准；新增命令按 `CommandSpec` 使用 `key`、必要时 `macKey`，无快捷键则省略两字段。未列新命令时无增量。

**浮层与持久化：**本节指定的浮层通过 `src/renderer/overlay.tsx` 的 `surfaces` 注册并以 `Surfaces.open/close` 管理；无新增时沿用现有视图。使用 `Surface` 定位，菜单用 `Menu`，选项列表用 `List`，确认使用 `Dialog`；这些组件按需要组合，不为本任务新造平行 overlay。数据库按上文仓库和迁移执行；未列新表或列即不迁移。所有仓库变更必须测试旧库升级和事务回滚。

**边界和验证：**检查两个窗口同时操作、目标标签中途关闭或导航、闸门关闭/暂停、私人信息不进入日志与无关窗口、顶部与侧栏布局，以及 macOS 和 Windows/Linux。单元测试放 `test/unit/`，覆盖本节的状态转换、非法参数、竞态与存储；运行 `npm test`。e2e 使用 `startWorld({ extra: ['--remote-debugging-port=0'] })`，以 `devtoolsPort(w.log)` 获取端口，`evaluate`/`click`/`waitFor` 针对 shell、overlay 与本地 fixture 断言；需要新服务器行为时扩展 `test/server.mjs`，并在结束调用 `w.stop()`。`click` 仅检查单个页面的命中，不证明原生窗口层级。macOS 人工实际点击入口、键盘操作、取消、切换标签与窗口，在顶部和侧栏各重做；记录结果与未验证的 Windows/Linux 项。

**验收与并行：**功能、空/错误状态、焦点、权限边界和上述测试均通过才完成；报告人工结果及限制。除 D2 审阅批准后的范围外，禁止改 gate、网络核心、fingerprint；L0 的字符串例外与本任务无关。与其他任务共享 `src/shared/ipc.ts`、`src/main/index.ts`、`shell/window.ts`、`overlay.tsx`、i18n 和迁移文件时使用隔离 worktree，按本文依赖顺序合并；后合入者重新协调类型、迁移版本并重跑测试，不以并行开发代替串行合并。
## B5 全屏、对话、缩放与查找

- 行为：HTML fullscreen 隐藏壳，Escape 退出并恢复视图及焦点；HTTP auth 显示站点和用户名/密码，取消即拒绝，不保存密码；beforeunload 在离开/关闭前询问；alert/confirm/prompt 可取消并串行；窗口销毁时安全结束。缩放非 100% 显示百分比和重置；查找支持下一项、上一项、计数、Escape 结束并回焦页面。
- 文件：`src/main/index.ts`, `shell/{window,tab,commands}.ts`, `shared/ipc.ts`、overlay 注册表，新增 `src/renderer/surfaces/dialog.tsx`，修改 chrome 查找/缩放组件与 i18n。使用 Electron 对应事件/回调，先确认版本实际支持的 JS dialog 拦截机制；若 Electron 无可用 API，保留引擎原生对话框并记录限制，不注入网页脚本。
- 契约：`Dialog = { id: string; kind: 'auth'|'beforeunload'|'alert'|'confirm'|'prompt'; origin: string; message: string; defaultValue?: string }`；`ShellState.dialog: Dialog | null; fullscreen: boolean; zoom: number`；`CaveCalls.answerDialog(id: string, answer: { accepted: boolean; value?: string; username?: string; password?: string }): void`；`SurfaceName` 加 `'dialog'`；沿用 `found` 事件。凭据不进入状态、日志、SQLite；答案只发给关联回调。无新命令，复用 `page.find` Cmd/Ctrl+F 和 `zoom.in/out/reset` Cmd/Ctrl+=/-/0。无数据库查询（站点缩放持久化在 M8）。
- 测试：单元测队列、一次回调、取消和缩放边界；e2e 测 fullscreen、auth、beforeunload、查找计数、切页销毁；原生对话框与 macOS 全屏手测。验收：对话不能被后台标签冒充，取消不泄露凭据，退出全屏与查找恢复焦点。

### 实施补充：接口与交互

`ShellWindow.found(tab, active, total)` 仅向活动标签发 found；切换标签时清除旧计数。认证密码只进入一次回调，不出现在广播状态或日志。 用户打开入口后应能看清当前目标；使用 Tab/Shift+Tab 到达控件、方向键在列表中移动、Enter 执行、Escape 取消并回到原焦点。空数据提供简短空状态；失败保留可重试入口，不把异常堆栈、凭据或完整私人数据放进 UI。正在编辑时广播不能覆盖输入；同一操作重复提交应幂等或禁用，关闭窗口、标签或切换导航时取消或忽略旧结果。所有 URL 再由主进程校验，发起远程加载仍经过 `Navigator.load` 和闸门，关闭或暂停时不得额外发请求。

```ts
// CaveCalls 增量；具体返回类型见本节契约
answerDialog(id: string, answer: { accepted: boolean; value?: string; username?: string; password?: string }): void
// CaveEvents 无新增；ShellState / TabState 增量按上文契约。
// SurfaceName 增量：dialog
```

**i18n：**在 `src/shared/i18n/zh.ts` 与 `en.ts` 成对加入 `dialog_cancel: '取消' / 'Cancel'`；设置页专用字符串放对应 settings 词典。其余可见动作、错误、空状态和无障碍名称也需成对翻译，复用已有 `command_*` key；不要以英文或中文硬编码动态反馈。命令 id 与快捷键以本节上方列出的为准；新增命令按 `CommandSpec` 使用 `key`、必要时 `macKey`，无快捷键则省略两字段。未列新命令时无增量。

**浮层与持久化：**本节指定的浮层通过 `src/renderer/overlay.tsx` 的 `surfaces` 注册并以 `Surfaces.open/close` 管理；无新增时沿用现有视图。使用 `Surface` 定位，菜单用 `Menu`，选项列表用 `List`，确认使用 `Dialog`；这些组件按需要组合，不为本任务新造平行 overlay。数据库按上文仓库和迁移执行；未列新表或列即不迁移。所有仓库变更必须测试旧库升级和事务回滚。

**边界和验证：**检查两个窗口同时操作、目标标签中途关闭或导航、闸门关闭/暂停、私人信息不进入日志与无关窗口、顶部与侧栏布局，以及 macOS 和 Windows/Linux。单元测试放 `test/unit/`，覆盖本节的状态转换、非法参数、竞态与存储；运行 `npm test`。e2e 使用 `startWorld({ extra: ['--remote-debugging-port=0'] })`，以 `devtoolsPort(w.log)` 获取端口，`evaluate`/`click`/`waitFor` 针对 shell、overlay 与本地 fixture 断言；需要新服务器行为时扩展 `test/server.mjs`，并在结束调用 `w.stop()`。`click` 仅检查单个页面的命中，不证明原生窗口层级。macOS 人工实际点击入口、键盘操作、取消、切换标签与窗口，在顶部和侧栏各重做；记录结果与未验证的 Windows/Linux 项。

**验收与并行：**功能、空/错误状态、焦点、权限边界和上述测试均通过才完成；报告人工结果及限制。除 D2 审阅批准后的范围外，禁止改 gate、网络核心、fingerprint；L0 的字符串例外与本任务无关。与其他任务共享 `src/shared/ipc.ts`、`src/main/index.ts`、`shell/window.ts`、`overlay.tsx`、i18n 和迁移文件时使用隔离 worktree，按本文依赖顺序合并；后合入者重新协调类型、迁移版本并重跑测试，不以并行开发代替串行合并。


## 执行顺序与文件归属

下表与各执行单是实现合同；本总览前文的早期草案若与执行单冲突，以执行单为准。各单可在独立 worktree 并行开发，按下列顺序合并并在每次合并后协调共享区域、重跑相关检查；不得互相覆盖增量。无单申请 schema 迁移，全部沿用版本 1。

| 顺序 / 规格 | 专属文件或区域 | 共享文件及触及区域 | 依赖 |
| --- | --- | --- | --- |
| 1 · B1 | `src/main/shell/context-menu.ts`、`src/renderer/surfaces/context-menu.tsx`；菜单单测 | `ipc.ts` 菜单合同；`surfaces.ts` 锚点/关闭、`window.ts`/`tab.ts` 目标生命周期；`overlay.tsx` 注册菜单、`ui/` 菜单定位；`shell.tsx` 菜单按钮；i18n 菜单词条；`test/e2e/cdp.mjs` 多窗口 helper 及 `app.test.mjs` 菜单测试 | 无；拥有共享菜单与多窗口测试接口 |
| 2 · B2a | `src/shared/url.ts` 搜索解析、搜索引擎单测 | `ipc.ts` 搜索设置；`index.ts`/`browser.ts`/`window.ts` 设置与导航；`settings/view.tsx`、`settings.css` 搜索表单；`shell.tsx` 地址焦点；settings i18n 与 e2e 搜索测试 | 无；为 B2b 提供地址解析 |
| 3 · B2b | `src/main/shell/suggestions.ts`、`src/renderer/surfaces/suggestions.tsx`；建议/地址显示单测 | `ipc.ts` 地址会话；`window.ts`/`browser.ts` 建议与跨窗口；`surfaces.ts` 焦点；`shell.tsx`/CSS 地址栏；`overlay.tsx`、`ui/` 列表；命令表 pasteAndGo；i18n 地址词条与 e2e 地址测试；扩展 B1 菜单上下文 | B1 §共享菜单接口、§共享多窗口测试接口；B2a §共享地址解析接口 |
| 4 · B3 | `src/renderer/internal-error.{html,tsx,css}`，恢复页视图与测试 | `ipc.ts` 恢复合同；`index.ts` 证书事件；`window.ts`/`tab.ts` 恢复生命周期、`commands.ts` 导航；`scripts/build.mjs` 入口；i18n 错误词条；`test/server.mjs`、`test/e2e/harness.mjs` TLS fixture 与恢复测试 | B1 §共享多窗口测试接口；拥有内部恢复页及共享测试 TLS 接口 |
| 5 · B4 | `src/main/permissions.ts`、`src/renderer/surfaces/{permission,http-auth}.tsx`、权限单测 | `ipc.ts` 权限及认证合同；`index.ts` handlers/清理；`browser.ts`/`window.ts`/`tab.ts` 生命周期；`surfaces.ts` 队列与模态、`overlay.tsx`/`ui/` 提示；`store/site-settings.ts` 多权限事务；i18n 权限词条、e2e 权限测试 | B1 §共享多窗口测试接口；B3 §共享测试 TLS 接口；拥有模态和每窗口提示 FIFO |
| 6 · B5 | `src/shared/zoom.ts`、全屏/缩放/查找单测 | `ipc.ts` 全屏、缩放、found；`window.ts`/`tab.ts` 全屏及查找；`commands.ts` 缩放；`store/site-settings.ts` zoom key；`surfaces.ts`/`overlay.tsx` 非交互提示；`shell.tsx`/CSS 查找缩放；i18n 全屏、缩放、查找词条及对应 e2e | B1 §共享多窗口测试接口；B4 §共享模态接口 |
