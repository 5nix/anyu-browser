# B3 错误、崩溃与证书页

## 目标与用户可见行为

主框架导航失败或网页渲染进程崩溃时，在该标签的页面区域显示 Cave 自己的恢复页；其他标签和窗口不受影响。保留工具栏、标签和地址栏。页面简洁，不添加多余说明；所有文字经 `t()`，适配深浅色、窄窗口与顶部/侧边布局。

- 普通网络错误：显示“无法打开此页面”、脱敏后的失败地址和“重试”。地址显示 scheme、host、path；去掉用户名、密码、查询和 fragment，作为文本而非 HTML。无法解析时只显示标题。地址栏仍显示原目标（不得显示内部页地址）。
- 闸门未放行时的失败：显示“网络尚未放行”、相同地址、“重试”和“网络状态”。后者打开现有 status 浮层。仅依据失败发生时 `gate.view.state !== 'open'` 分类为闸门未放行；这表示时间相关，不声称已证明故障原因。放行时普通失败统一称网络错误，不能判断是代理还是网站，绝不从错误码、reason 文本或主动探测推断。
- 崩溃：显示“页面崩溃了”和“重新加载”；可恢复目标为空或不在 WEB 白名单时禁用按钮。崩溃优先于旧错误，成功开始新导航后清除。空白新标签正常显示，不显示错误。
- 证书错误：显示“连接不安全”、脱敏地址、“返回”、“重试”和“高级”。高级初始折叠，展开显示风险提示及“继续前往”。返回是默认焦点；其他错误默认焦点为重试。无可返回历史时返回到 `about:blank`。继续只授权当前应用会话中该规范化 hostname 与失败叶证书指纹的组合，跨窗口共享；不同证书或主机仍须警告。关闭应用、重启或重置环境清除。不得把证书详情传给其他标签。
- Tab/Shift+Tab 按视觉顺序访问按钮，Enter/Space 激活；高级可再次折叠，Escape 在展开时折叠并回焦高级，否则无动作。网络状态浮层的 Escape、外部点击、失焦按现有 Surfaces 关闭并回焦原按钮。切换标签关闭浮层；后台标签失败不抢焦点。前台失败仅当原网页持有焦点时将焦点交给恢复页，用户在地址栏输入时不得抢焦点。切回失败标签时恢复页接收焦点。成功开始导航后移除恢复页；用户在地址栏继续编辑不被广播覆盖。

## 文件清单

- 修改 `src/main/shell/tab.ts`：维护每标签导航代次、失败/崩溃目标、证书挑战与错误分类；监听 `did-start-navigation`、重定向、`did-fail-load`、`render-process-gone`，沿用 `NavigationFailures` 的 URL 过滤并补强。只处理主框架，忽略 -3、同文档、`chrome-error:` 和失效结果。错误页不是该 webContents 的导航，也不写历史。
- 修改 `src/main/shell/window.ts`：每窗口新增一个受控 `WebContentsView` 恢复页，按活动标签状态添加/移除并置于页面区域，保留原网页 view 和历史；加入 `ui`、广播、焦点、布局、关闭清理。限制其导航和新窗口与现有 shell 页相同。活动失败页改变时重新绑定，不把其他标签证书数据发给它。实现下述针对当前活动标签和代次的动作；命令调用统一接入。
- 修改 `src/main/shell/browser.ts`：持有进程内证书例外及 challenge 协调器（可新增 `src/main/shell/certificates.ts`），在 reset 时先失效并关闭连接，再重置标签；共享 gate 的读取与 Navigator。关闭标签、窗口时清除待处理挑战及排队导航。
- 修改 `src/main/index.ts`：注册 Electron `app` 的 `certificate-error`，只处理浏览会话中属于 Cave web 标签的主框架 HTTPS 失败；对应回调必须恰好调用一次。增加 IPC handler，reset 完成前清理例外。禁止更改 gate、gatekeeper、network、proxy 或 core 的逻辑。
- 修改 `src/main/shell/navigation.ts`：为取消排队与替换目标提供明确路径；所有恢复到远程 URL 均走 `Navigator.load`，关闭闸门时只保留每个 webContents 最后一个目标，沿用现有 notice/status 和打开后 release。
- 修改 `src/main/shell/commands.ts`：将 back/reload/reloadHard 委托窗口的方法，使恢复页与快捷键一致；正常页面沿用原行为。`src/shared/commands.ts` 无新增命令或快捷键。
- 新增 `src/renderer/internal-error.html`、`internal-error.tsx`、`internal-error.css`；修改 `scripts/build.mjs` 打包入口及复制 HTML/CSS，修改 `src/renderer/icons.ts` 按需内联 lucide 图标。HTML 使用与 `shell.html` 相同的严格 CSP，Preact 和现有 `useCave()`；不使用 `innerHTML`。修改 `src/shared/i18n/zh.ts`、`en.ts`。
- 修改 `src/shared/ipc.ts`、`test/e2e/harness.mjs`、`test/e2e/app.test.mjs`；必要时扩展 `test/server.mjs`、`test/socks.mjs` 提供本地 TLS fixture；新增 `test/unit/error-pages.test.ts`。

恢复文档位于打包的 `dist/renderer/internal-error.html`，仅由主进程在专用、sandbox/contextIsolation 开启、nodeIntegration 关闭的 UI view 通过 `loadFile` 加载，使用现有 preload；像其他 UI 一样禁止 `will-navigate` 与 window.open。网页 view 仍只允许 `Tab.WEB`，禁止 `file:` 和内部 scheme；不向网页注入 bridge，不为内部文档注册可访问协议。IPC 调用须来自本窗口这个恢复 view，不能仅依赖任意 UI 发送者；网页及其他窗口不可调用。UI view 无外网资源和外链。

## IPC 合同增量

```ts
// TabState.error 替换为：
error: { code: number; description: string; url: string;
  kind: 'network' | 'gate' | 'certificate'; generation: number } | null;
// ShellState 增加：仅当前活动标签的可显示恢复数据，无证书指纹
recovery: { tabId: number; generation: number; kind: 'network' | 'gate' | 'certificate' | 'crash';
  displayUrl: string; canRetry: boolean } | null;
// CaveCalls 增加：
retryTab(id: number, generation: number): void;
backFromError(id: number, generation: number): void;
continueCertificate(id: number, generation: number): void;
// CALLS 增加上述三个 true；Handlers 对应实现。
// CaveEvents/EVENTS、SurfaceName 无增量；复用 state、status。
```

各 handler 在主进程重新验证 sender 精确等于窗口的恢复 view、id 为该窗口当前活动 web 标签、generation 等于当前恢复状态且动作适用于其 kind；不接受 renderer 传入 URL、证书或主机。重复点击及陈旧调用无操作，等待开始/排队时禁用按钮。现有 `TabState.error` 本就广播给同窗口 UI；其中 `url` 和 `description` 供现有状态兼容，不放证书内容、堆栈或凭据进新恢复数据；清理显示 URL 的认证信息。生成安全单调代次，崩溃也分配代次。IPC state 仅广播到本窗口的 UI，绝不广播到 webContents。

## 状态、证书与恢复

1. 主框架开始新导航递增代次并记录目标；重定向更新当前目标，旧 URL 的失败忽略。Electron 的失败事件不带导航 ID，单靠 URL 不能区分同 URL 重叠请求：串行化 Cave 发起的重试，先 stop/取消上次且仅接受当前活动 attempt；对无法可靠关联的迟到失败保守忽略，不能承诺任意同 URL 竞态可由 URL 解决。旧证书回调必须检查 webContents、主框架、URL、代次及仍存活状态，过期即拒绝。
2. `certificate-error` 调用 `preventDefault()`，对不属于 web 主框架、非 HTTPS、非法 URL 或过期挑战一律 `callback(false)`。从 `certificate.data` 的 DER 计算 SHA-256 叶证书指纹，hostname 用 `new URL(url).hostname` 的规范化值；主进程私有保存，不能使用 renderer 提供的值。未获授权的挑战先拒绝并记录当前标签代次，匹配后续主框架失败时显示证书页；先记录后拒绝以避免事件先后竞态。子资源证书失败不出现整页警告，也不能创建授权。证书无法解析或指纹不可得时仍显示警告但不允许继续。
3. “继续前往”校验挑战仍属当前代次，把该 host + 指纹放入纯内存集合，消耗挑战并按原 URL 经 Navigator 重试。后续 `certificate-error` 仅当 host 和叶指纹完全匹配时调用 `callback(true)`；其他请求按默认拒绝。`callback(true)` 仅对本次由网络服务发出的请求，不改代理设置、不使用全局忽略证书开关。异常、关闭、切换导航和 reset 都拒绝未完成回调。此机制适用于主框架；子资源始终遵循 Chromium 默认验证，不继承例外。
4. Electron 网络服务可能缓存证书验证/连接状态；不能把清空 JS Map 或 `clearData()` 当成撤销证明。reset 在清空集合之前立即令新挑战拒绝，等待 `browserSession().closeAllConnections()`、清理数据、重建标签后才返回；以真实 TLS 测试验证同一 host/证书在 reset 和重启后必须重新警告，包括复用连接和缓存。若 Electron 45 仍接受缓存，停止交付该继续功能并报告阻塞，不以猜测性的缓存清理或修改网络核心冒充达标。参考 [Electron session 文档](https://www.electronjs.org/docs/latest/api/session#sessetcertificateverifyprocproc) 对验证结果缓存的说明。
5. 重试网络/证书错误使用保存的失败 URL；崩溃使用最后一次主框架目标（不得取内部 URL），均走 `host.load`。闸门关闭时维持恢复页并显示现有 status，队列自动放行时才清页；重复重试替换同一队列项。返回先 `forget` 排队项，再按当前 webContents 的 `navigationHistory.canGoBack()` 返回；无历史加载 `about:blank`。浏览历史远程后退涉及 Chromium 导航，须在 gate 关闭时延后到 gate 打开，不能调用 `goBack()` 发出请求；打开时执行一次并校验标签仍有效。工具栏和快捷键同规则，reloadHard 在恢复页与重试同目标，不绕过 gate。
6. 证书/普通失败产生时保存失败目标，地址栏与标签显示该目标而非 `chrome-error:`；历史只记录成功的网页。取消、stop、切标签、关闭窗口、reset 或后续导航均使旧动作失效；后台失败只更新状态。保留现有站点原始地址用于导航，不把 URL 查询、凭据或证书写入日志。

## 文案

以下 key 在 `zh.ts`、`en.ts` 成对加入；现有标签可复用 `command_page_back`，所有动态内容文本转义。

| key | 中文 | English |
| --- | --- | --- |
| `error_title` | 无法打开此页面 | This page could not be opened |
| `error_gate` | 网络尚未放行 | Network access is not available |
| `error_crashed` | 页面崩溃了 | Page crashed |
| `error_certificate` | 连接不安全 | Connection is not secure |
| `error_retry` | 重试 | Retry |
| `error_reload` | 重新加载 | Reload |
| `error_back` | 返回 | Back |
| `error_status` | 网络状态 | Network status |
| `error_advanced` | 高级 | Advanced |
| `error_risk` | 继续访问可能泄露你发送的信息。 | Continuing may expose information you send. |
| `error_continue` | 继续前往 | Continue to site |

证书高级区使用原生按钮和 `aria-expanded`，错误标题用 `h1`；可用 focus ring、键盘和屏幕阅读器。URL 用可换行文本，长内容不撑破窗口。状态浮层仍由 `overlay.tsx` 的现有 status Surface 管理；恢复页本身是页区域，不是浮层。

## 存储和平台

无 prefs、SQLite、迁移或持久化数据变化。macOS 使用现有 Cmd 快捷键与 traffic lights；Windows/Linux 使用 Ctrl 快捷键与 titlebar overlay；恢复页只占 `pageBounds()`，不得遮住原生标题控件。三平台行为一致；平台证书验证和缓存差异必须分别记录，不得声称未经验证的平台通过。

## 测试

- `test/unit/error-pages.test.ts`：`classifies gate snapshot without claiming cause`、`ignores aborted and stale failures`、`certificate host and fingerprint scope`、`stale recovery actions are rejected`、`redacts displayed URL`、`reset invalidates exception and challenge`；覆盖 redirects、同 URL 重入、证书缺失、子框架、崩溃优先、关闭标签与两个窗口。使用可注入的纯协调逻辑和 fake callbacks 断言每个 callback 恰好一次。
- `test/e2e/app.test.mjs`：扩展 `startWorld({ extra: ['--remote-debugging-port=0'] })` 的本地 fixture，使用 `devtoolsPort(w.log)`、`evaluate`、`click`、`waitFor`，`t.after(() => w.stop())`。新增 `network failure retry and gate queue`（服务器断开、闸门暂停、重复重试、恢复后仅最终目标，验证 SOCKS 请求及无直连）、`crashed tab reload and isolation`（CDP 触发目标网页 renderer 崩溃，断言其他标签可用且焦点正确）、`certificate warning scoped to host and fingerprint`（本地自签 TLS、拒绝、展开、继续、同 host 同证书、另一个 host/证书、子资源）、`certificate exceptions cleared on reset and quit`（相同证书与连接复用，reset 后以及同 profile 重启后再警告）、`internal page inaccessible and stale actions ignored`（网页尝试 file/内部地址与 IPC，切标签/导航后旧调用无效）、`recovery keyboard and back`（Tab、Enter、Escape、无历史和有历史，后台失败不抢焦点）。扩展 harness 支持可控 TLS 和保留 profile 重启并在结束清理；本地 SOCKS 映射 `.test`，不访问公网。CDP click 只证明页面内命中。
- 运行 `env -u ELECTRON_RUN_AS_NODE npm test` 与 `env -u ELECTRON_RUN_AS_NODE npm run test:e2e`。macOS 真实点击和键盘验证三种错误、浮层关闭、两种布局；Windows/Linux 分别验证标题控件、焦点、TLS reset 与快捷键，记录未验证项。

## 验收清单

- [ ] 三类失败与崩溃显示正确，键盘、焦点、地址栏、后退和重试符合约定。
- [ ] 内部文档仅受控视图可达，调用限定发送者、窗口、活动标签及代次，陈旧结果无法覆盖新页。
- [ ] 所有远程请求仍经既有代理；闸门关闭排队，不通过错误页绕行。
- [ ] 证书例外严格限 host/指纹/本次应用会话，reset 和重启后的真实 TLS 测试通过；无法证明则不交付继续功能。
- [ ] 自动测试通过，三平台人工结果及未验证项记录。

## 范围外与合并

不实现证书查看器、永久信任、按站点设置、额外网络探测或故障归因；不改 gate、gatekeeper、network、proxy、core、fingerprint。与 B1–B5 共享 IPC、窗口、i18n 和测试，需串行合并并重跑测试；不提交或改变 git 状态。

## 待定（已按保守默认写）

无。证书例外范围、退出及 reset 清除已由主人决定；无法验证 Electron 缓存撤销时按上述阻塞处理，不改变该决定。

## 共享测试 TLS 接口

B3 拥有本地 TLS fixture；B4 依赖 B3 §共享测试 TLS 接口；若尚未合入，按此精确接口构建：`startWorld({ profile, wrap, extra, tls = false })` 保留原参数；`tls: true` 同时启动 HTTP fixture 和本地 HTTPS fixture，返回的 world 增加 `httpsUrl: string`（`https://secure.cave.test/`）及 `fixture`、`socks`、`dir`、`child`、`log()`、`stop()` 原有成员。SOCKS 的 `map(host, port)` 把 `secure.cave.test:443` 映射到 HTTPS fixture 端口，其他 `.test` 保持原 HTTP 映射；所有非测试目标拒绝。测试专用静态证书含 `secure.cave.test` SAN，harness 为该证书公钥添加 Chromium `--ignore-certificate-errors-spki-list=<fixture SPKI base64>`，只在 `tls: true` 的测试进程启用，不使用全局 `--ignore-certificate-errors`；其他证书仍走正常验证。B3 的证书错误测试使用另一个未 pin 的证书。`stop()` 关闭两个 fixture 和 SOCKS 并清理 profile；如测试重启需要保留 profile，由 B3 扩展同一 harness 并在最终清理。

## 共享多窗口测试接口

B1 拥有多窗口 CDP helper；B2b、B3、B4、B5 依赖 B1 §共享多窗口测试接口；若尚未合入，按此精确接口构建：`listTargets(port)` 返回 `Promise<Array<{ id: string; type: string; url: string }>>`；`withTarget`、`evaluate`、`click`、`screenshot` 的第二参数接受原 URL 谓词或 `{ targetId: string }`，按 id 精确匹配，不存在或关闭时报错，旧调用兼容。用创建窗口前后 target id 差集及唯一 fixture URL 和各 shell 的 `cave.getState()` 关联窗口；overlay 用逐个打开 status 并核对对应 shell 状态关联，不唯一则失败，不依赖列表顺序。
