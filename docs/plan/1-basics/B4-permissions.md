# B4 网站权限

## 目标

在现有指纹 profile 的上限内，由当前网站所属窗口处理权限和 HTTP 认证。每次判断先执行硬限制，再查询站点决定，最后才可能询问；保存的允许永远不能覆盖硬限制。本文同时明确当前代码与本任务引入的行为差异。

## 当前实现与策略

`src/main/index.ts` 的 `start()` 在打开数据库前对 `browserSession()` 调用 `applyPermissions(browserSession(), profile)`。`src/main/permissions.ts` 的两个 handler 每次都调用同一 `allowPermission(permission, profile())`，并不检查来源、窗口、frame、手势或保存的选择：`clipboard-sanitized-write`、`fullscreen`、`pointerLock`、`keyboardLock` 恒为 true；`geolocation` 在当前 profile 的 `geolocation !== null` 时为 true；`notifications` 等于当前 profile 的 `notifications`；其他名称一律 false。`setDevicePermissionHandler` 总返回 false。profile 是函数，每次读取当前值；并非 handler 捕获启动时的快照。与此同时 `src/main/fingerprint.ts` 的 `emulationCommands(startupProfile, identity)` 只在启动时按 profile 设置 CDP 地理坐标；设置界面已有重启提示。因此不得在启动时无坐标而运行中新增坐标后让定位通过，否则可能暴露真实位置。定位只有启动时及当前 profile 均有坐标、且坐标相同才可进入站点判断；坐标更改须重启才能重新允许。禁止读取或回退 OS 定位。

| Electron 权限 | 本任务策略 |
| --- | --- |
| `clipboard-sanitized-write`, `fullscreen`, `pointerLock`, `keyboardLock` | 保留现有恒允许，不引入站点提示；不得扩展为其他权限。 |
| `geolocation` | 上述启动和当前坐标条件不满足时硬拒绝；满足后才可提示。`geolocation-approximate` 未在旧实现允许，仍拒绝。 |
| `notifications` | 当前 profile 为 false 时硬拒绝；true 时才可提示。 |
| `media` 的 video/audio | 当前是默认拒绝而非 profile 字段控制；本任务有意把可识别的相机/麦克风请求改为可提示，这是对旧默认的明确产品变更，不是原有授权。 |
| `clipboard-read` | 当前默认拒绝，本任务有意改为可提示。`deprecated-sync-clipboard-read` 仍拒绝。 |
| 其他包括 `display-capture`、未知及 USB/HID/serial/Bluetooth 设备 | 继续硬拒绝；设备 handler 保持总 false。 |

以下安全条件对所有可提示类型、保存的允许及一次允许都适用：只接受所属浏览器窗口的活动 web 标签主框架，`details.isMainFrame === true`，请求 URL、media 的 `securityOrigin`（有值时）和该标签当前主框架 origin 精确一致；只接受规范化的 `https:` origin（含非默认端口），无用户名、密码或 opaque origin。拒绝子框架、后台标签、service worker、null/销毁的 webContents、来源缺失或不一致、HTTP（包括 localhost 和测试用 insecure-as-secure）、非浏览器 UI。查询 handler 的 `requestingOrigin`、`details.requestingUrl`、`details.securityOrigin` 可用时均须一致；缺少必要主框架证据时返回 false。不可借 Chromium 的安全上下文例外放宽此规则。

不要求用户手势证据；上述条件成立时，提示本身即用户同意的入口。不得注入脚本或修改 fingerprint。

## 用户可见行为

权限提示在上述条件成立且尚无适用持久决定时出现：展示规范 origin 及本次请求的相机、麦克风、定位、通知或读取剪贴板；按钮依次为“允许一次”“始终允许”“拒绝”。组合 media 请求同时显示两项，任何一项硬拒绝或已有 deny 则整个 Electron callback 为 false；只有全部获准才 true。一次允许只覆盖该次已合并请求的回调，不写库、不用于后续 check；始终允许和拒绝按 origin 与每个 permission 保存。明确选择拒绝为持久拒绝；Esc、点击浮层外、失焦、切换标签、导航、关闭窗口或退出均取消本次且不持久化。无权限请求时不显示空浮层；存储失败时保留提示，显示简短错误并可重试或取消，不调用成功回调，也不更新其他窗口。无额外快捷键。

拒绝或取消后，同一 tab 的同一 origin + permission 在下一次该 tab 主框架导航开始之前不再提示，直接拒绝；包括同文档导航。导航导致取消时先记录抑制再清除此 tab 的抑制，确保该次导航后可再次提示。该抑制只在内存中，和持久 deny 独立；组合请求中任一项被抑制则整个请求拒绝。持久 deny 仍须清除站点数据才能再次询问。

每窗口一个队列，FIFO；同一窗口、同一活动 tab、同一导航代次、origin 与完全相同权限集合的请求合并并各自完成一次；不同集合不合并。其他窗口独立提示，绝不将请求或凭据广播给其他窗口。打开提示不自动切换标签或激活窗口。profile 改变、站点数据清除、重置、标签销毁、主框架非同文档导航开始、渲染进程崩溃时取消相关待处理项；提交前再次检查 profile、归属、origin、代次和活动标签。原生权限请求已完成后 OS 仍可能拒绝相机/麦克风或通知，Cave 不宣称设备一定可用。

HTTP 认证与网站权限共用每窗口 FIFO 和 overlay，互不合并。监听 Electron `app` 的 `login` 并 `event.preventDefault()`；仅接受属于 web 标签的 HTTP 或 HTTPS 主框架导航 challenge，且 `authenticationResponseDetails.url` 的 host/port 与 `authInfo.host/port` 一致。代理、子资源、来源不明或不匹配的 challenge 空 callback 取消。活动标签显示提示；后台标签的 challenge 排队，不切换或抢焦点，激活该标签后才可显示；切离时隐藏并保留，返回后继续。每窗口至多一个可见提示，按入队顺序选择当前活动标签可显示的最早项；后台认证不阻塞活动标签的可显示项。标签销毁、后续跨文档导航、崩溃、窗口关闭时取消相关项，callback 至多一次；产生 challenge 的那次导航不取消其自身请求。权限请求后台直接拒绝，不进入队列。

显示规范 origin、截断的 realm、用户名和密码；HTTP 时额外显示可见警告“连接不安全 — 密码将以明文发送”。realm 去除控制字符、最多 256 字符，仅作纯文本；空 realm 不显示。初始输入为空，密码为 `type=password`，默认聚焦用户名，Enter 提交，Escape、外点或取消以空 callback 结束；窗口失焦保留认证。用户名和密码只通过所属 overlay 一次性 IPC 送至回调，不进 ShellState、日志、数据库、URL 或其他窗口；清空草稿，各限 1024 字符，非法提交保留输入并显示错误。新 challenge 使用空表单，不复用凭据。清站点数据调用 `clearAuthCache()`（清整个 session 认证缓存），重置亦清除；连接仍走代理和闸门。

## 文件清单

- 修改 `src/main/permissions.ts`：保留 `allowPermission` 的既有行为回归测试，并新增明确的纯映射/安全策略及请求协调器；`applyPermissions` 接收启动 profile、实时 profile、站点仓库和窗口路由依赖，安装 request/check/device handlers。严禁将 `allowPermission` 的 false 简单当作所有类型不可提示，也不能把它的 true 当作最终站点允许。
- 修改 `src/main/index.ts`：数据库打开并构造 `new SiteSettings(database)`、Browser 创建后安装协调器；在创建任何 web 标签之前完成注册。注册 app `login` 并在退出清理。清站点时同时 `SiteSettings.clearOrigin(origin)`、取消相关队列、清认证缓存；重置时在 `clearBrowsingData` 前取消全部队列。存储失败处理见下。
- 修改 `src/main/shell/browser.ts`、`window.ts`、`tab.ts`、`surfaces.ts`：按 webContents 找所属窗口及活动标签，维护导航代次和每窗口提示队列，生命周期取消；状态只发送所属窗口。统一 surface 关闭路径，确保窗口 blur、切标签、命令、`closeSurface`、外点、Escape 都通知协调器按类型取消或隐藏，避免现有 `Surfaces.close()` 留下未完成 callback。不得对网页暴露 bridge。
- 修改 `src/main/store/site-settings.ts`：复用现有 `get/set/delete/clearOrigin`，增加对多权限原子写入的方法，以 `store.db` 的事务包住全部 key；异常回滚并向调用者抛出。修改 `src/main/store/index.ts` 仅在需要导出新增类型时。无 schema 修改：`site_settings(origin,key,value)` 已在版本 1 建立。
- 修改 `src/shared/ipc.ts`、`src/renderer/overlay.tsx`、`src/renderer/ui/` 必要样式与焦点；新增 `src/renderer/surfaces/permission.tsx`、`src/renderer/surfaces/http-auth.tsx`；修改 `src/shared/i18n/zh.ts`、`en.ts`。图标如需要从 lucide 内联到 `src/renderer/icons.ts`。UI 用 Preact。
- 修改 `test/unit/store.test.ts`、新增 `test/unit/permissions.test.ts`，修改 `test/e2e/cdp.mjs`、`harness.mjs`、`app.test.mjs` 与 `test/server.mjs` 的本地 fixture。

## IPC 合同增量

```ts
export type Permission = 'media-camera' | 'media-microphone' | 'geolocation' | 'notifications' | 'clipboard-read';
export type PermissionDecision = 'once' | 'allow' | 'deny';
// SurfaceName 追加：'permission' | 'httpAuth'
// ShellState 追加：
permissionPrompt: { id: string; origin: string; permissions: Permission[]; error: boolean } | null;
httpAuthPrompt: { id: string; origin: string; realm: string; error: boolean } | null;
// CaveCalls 追加：
respondPermission(id: string, decision: PermissionDecision): void;
respondHttpAuth(id: string, credentials: { username: string; password: string } | null): void;
// CALLS 各追加同名 true；Handlers 实现以上方法。
// CaveEvents、EVENTS、TabState、命令表均无增量。
```

每个 id 为随机不可预测的一次性 token；主进程校验调用者是**该窗口 overlay**（现有通用 `windowOf` 还允许 chrome/settings，须为这两个调用加 sender 校验）、当前可显示队首、类型、token、枚举、生命周期及 payload。重复、过期、跨窗口或伪造响应无效；callback 在删除记录后恰调用一次。`closeSurface`、`toggleSurface` 和 `setAnchors` 不得伪造/关闭后重新打开待处理提示以绕过取消；权限和认证 surface 只能由主进程队列打开，不接受 renderer 的 `toggleSurface`。普通 surface 打开时提示先关闭它；提示期间阻止其他 surface 覆盖，用户命令导致关闭时按对应类型的取消或隐藏规则处理。

## 决策与存储

规范 origin 使用 `new URL(url).origin`，仅 HTTPS 且验证来源后使用。`site-settings.ts` 每条 key 为 `permission:<Permission>`，JSON 值仅 `'allow'` 或 `'deny'`，缺失、损坏、其他值均视为未决定；不会把未知值当允许。request 的 `mediaTypes` 非空且全部为 `video`/`audio` 才映射为有序去重集合；不存在、空、未知则拒绝。check 的 `mediaType` 必须明确为 `video` 或 `audio`，unknown/缺失拒绝。对于合法且已通过硬限制的 request：任一 deny 立即 false；全部 allow 立即 true；其余提示整个集合，选择持久决定原子写入所有项。check 同步、无副作用、不提示：只在合法归属及 profile 硬限制均成立且所有对应项存在 `'allow'` 时返回 true；未决定时返回 false，不能读取一次允许或消耗 callback。务必以真实 Electron 调用顺序验证未决定请求实际进入 request handler 并显示提示；不得将 check 的 true 当作用户已同意或绕过 request 的授权。若某 API 的调用顺序阻止显示，须调整实现并用真实 e2e 证明，不能以单测替身代替。

持久化失败不得留下部分条目，提示 error=true；取消仍可执行。当前 `index.ts` 数据库打开失败会回退内存库：向协调器传入该状态，持久选择不允许写成看似永久的成功，提示保存失败；一次允许仍可按条件完成。正常旧库无需迁移；`clearBrowsingData` 已删除 `site_settings`，单站清理目前尚未清该表，需接线。所有窗口下一次判断直接读仓库，已有提示在清理时取消。

## 浮层、键盘和平台

`overlay.tsx` 的 `surfaces` 注册两种 surface，使用现有 `Surface`/`Popover` 和 `List` 组合；使用下述居中模态模式，限制在窗口内容区，顶部/侧边布局及窄窗口均不遮挡窗口控件。`Surface` 原有固定 `aria-labelledby="title"`，每次只渲染一个带 `id="title"` 的标题。权限列表选择默认焦点“拒绝”；箭头移动、Enter/Space 执行，Tab/Shift+Tab 可到达并循环于可操作项。认证表单初始焦点用户名，Tab 到密码、提交、取消并循环；密码不放在 DOM 以外持久状态。surface 显示时 overlay 持有键盘；关闭后 `Surfaces` 恢复之前仍存活且属于当前活动标签的焦点，否则聚焦当前页面，窗口失焦时不得抢回焦点。焦点恢复、外点、Esc 在所有关闭路径只执行一次。背景不允许操作，辅助技术读出标题、origin、错误；文本折行且防溢出。

macOS 与 Windows/Linux 使用相同应用浮层和快捷键；系统相机/麦克风授权仍由操作系统决定。macOS 签名/打包需要相机和麦克风用途声明时单独核对打包配置；未提供声明或 OS 拒绝时不得假报成功。Windows/Linux 按各自系统设备权限和窗口管理器验证，无平台专用绕过。无 OS 定位请求。浅色、深色均可读。

## i18n 词条

所有新可见字符串通过 `t()`，变量为文本插值：

| key | zh | en |
| --- | --- | --- |
| `permission_title` | 网站权限 | Site permissions |
| `permission_camera` | 相机 | Camera |
| `permission_microphone` | 麦克风 | Microphone |
| `permission_location` | 定位 | Location |
| `permission_notifications` | 通知 | Notifications |
| `permission_clipboard_read` | 读取剪贴板 | Read clipboard |
| `permission_allow_once` | 允许一次 | Allow once |
| `permission_allow` | 始终允许 | Always allow |
| `permission_deny` | 拒绝 | Deny |
| `permission_choices` | 权限选择 | Permission choices |
| `permission_save_failed` | 保存失败，请重试 | Could not save. Try again. |
| `auth_title` | 网站登录 | Site sign-in |
| `auth_realm` | 认证范围：{realm} | Authentication realm: {realm} |
| `auth_username` | 用户名 | Username |
| `auth_password` | 密码 | Password |
| `auth_submit` | 登录 | Sign in |
| `auth_cancel` | 取消 | Cancel |
| `auth_insecure` | 连接不安全 — 密码将以明文发送 | Connection not secure — password sent in clear |
| `auth_invalid` | 输入过长，请修改 | Input is too long. Edit and retry. |

realm 为空时不显示该行；origin 直接显示规范化值，不作为翻译 key。不得翻译或信任站点提供的 realm。

## 测试与验收

- `test/unit/permissions.test.ts`：覆盖旧策略回归、启动/当前坐标硬限制、通知 profile、主框架和 origin 校验、后台/子框架/设备拒绝、media 映射；对真实无手势字段的请求覆盖 FIFO、合并、一次/持久、拒绝与取消抑制至下次主框架导航、写失败、过期 token、跨窗口和 callback 恰一次。认证覆盖 HTTP/HTTPS 主导航、HTTP 警告、realm 纯文本截断、后台排队和切换、代理/子资源取消、host 不匹配、失效、限长与凭据不缓存。
- `test/unit/store.test.ts`：旧版本 1 库无迁移可读写；多 key 事务失败无部分写入、损坏 JSON 回退、清单站与全清、重启后的 allow/deny。
- `test/e2e/app.test.mjs`：使用 `startWorld({extra:['--remote-debugging-port=0']})`、`devtoolsPort(w.log)`、`evaluate`、`waitFor` 和 `t.after(() => w.stop())`。当前 harness 的 fixture 仅 HTTP，SOCKS 将所有 `.test` 映射到同一 `fixture.port`，且 `--unsafely-treat-insecure-origin-as-secure=http://fp.cave.test` 不能满足产品 HTTPS 校验。依赖 B3 §共享测试 TLS 接口，启动 HTTPS fixture 并按该接口仅 pin 测试证书公钥、路由 SOCKS，不使用全局忽略证书错误。导航到 HTTPS fixture，实际请求定位（使用默认 profile 坐标）并断言提示出现、允许一次完成、取消后抑制及主框架导航后再次出现；另验证持久拒绝跨导航仍生效、清除站点数据后可再提示；使用 notifications=true profile 测通知，模拟设备限制的 media/clipboard 由单测补充。断言 HTTP、后台、子框架不提示；不得以测试替身声称 e2e 提示可达。两个窗口分别测试 HTTPS 和 HTTP Basic challenge、警告、realm、后台排队、切换、提交/取消、跨窗口 token 和关闭清理。测试无公网请求，CDP 点击仅证明页面内命中。
- 运行 `env -u ELECTRON_RUN_AS_NODE npm test` 与 `env -u ELECTRON_RUN_AS_NODE npm run test:e2e`。人工在 macOS 操作权限、认证、焦点和两窗口；Windows/Linux 记录实测或未验证及 OS 设备权限限制。

验收：

- [ ] 合格请求实际显示提示；硬限制、拒绝或取消后的防打扰、profile 坐标与一次性回调均正确。
- [ ] HTTP 认证隔离、取消、密码不落盘及队列清理正确；代理请求仍经原有路径。
- [ ] 中英文、两布局、焦点和错误态可用，测试通过并记录各平台人工结果及限制。

## 范围与依赖

本任务不做站点权限管理页、撤销单项授权 UI、密码管理器、代理认证、屏幕共享、设备选择或修改指纹；单站清除可删除决定。禁止改 `src/main/gate.ts`、`gatekeeper.ts`、`network.ts`、`src/main/proxy/**`、core 或 fingerprint；每个请求继续走代理。与 B1–B5 共享 IPC、窗口、overlay 和词典，同 checkout 串行合入，合并后重跑测试。


## 共享模态接口

B4 拥有模态基础；B5 依赖 B4 §共享模态接口；若尚未合入，按此精确接口构建：`Surface` 接受 `placement?: 'anchor' | 'center'`，默认 `anchor`；`center` 在窗口内容区居中、限制可视边界并保留现有 `name`、`anchor` 和 children。`ShellState.surface` 仍为 `{ name: SurfaceName; anchor: Rect } | null`；每窗口最多一个交互 surface。B4 拥有每窗口提示 FIFO；B5 的非交互提示不占 FIFO，不抢焦点、不遮挡交互 surface。

## 共享多窗口测试接口

B1 拥有多窗口 CDP helper；B2b、B3、B4、B5 依赖 B1 §共享多窗口测试接口；若尚未合入，按此精确接口构建：`listTargets(port)` 返回 `Promise<Array<{ id: string; type: string; url: string }>>`；`withTarget`、`evaluate`、`click`、`screenshot` 的第二参数接受原 URL 谓词或 `{ targetId: string }`，按 id 精确匹配，不存在或关闭时报错，旧调用兼容。用创建窗口前后 target id 差集及唯一 fixture URL 和各 shell 的 `cave.getState()` 关联窗口；overlay 用逐个打开 status 并核对对应 shell 状态关联，不唯一则失败，不依赖列表顺序。

## 共享测试 TLS 接口

B3 拥有本地 TLS fixture；B4 依赖 B3 §共享测试 TLS 接口；若尚未合入，按此精确接口构建：`startWorld({ profile, wrap, extra, tls = false })` 保留原参数；`tls: true` 同时启动 HTTP fixture 和本地 HTTPS fixture，返回的 world 增加 `httpsUrl: string`（`https://secure.cave.test/`）及 `fixture`、`socks`、`dir`、`child`、`log()`、`stop()` 原有成员。SOCKS 的 `map(host, port)` 把 `secure.cave.test:443` 映射到 HTTPS fixture 端口，其他 `.test` 保持原 HTTP 映射；所有非测试目标拒绝。测试专用静态证书含 `secure.cave.test` SAN，harness 为该证书公钥添加 Chromium `--ignore-certificate-errors-spki-list=<fixture SPKI base64>`，只在 `tls: true` 的测试进程启用，不使用全局 `--ignore-certificate-errors`；其他证书仍走正常验证。B3 的证书错误测试使用另一个未 pin 的证书。`stop()` 关闭两个 fixture 和 SOCKS 并清理 profile；如测试重启需要保留 profile，由 B3 扩展同一 harness 并在最终清理。
