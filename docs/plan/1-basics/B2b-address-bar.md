# B2b 地址栏与本地建议

## 目标与依赖

实现 B2 地址栏中除搜索引擎设置和地址解析之外的体验。先合入 [B2a](B2a-search-engine.md)，沿用其 `toUrl`、搜索设置、空输入和 `ShellWindow.navigate`；本单不重复实现搜索引擎。B1 先合入，地址栏右键由 B2b 扩展 B1 菜单基础，按 §共享菜单接口 接线。本单是一个交付单元，共享 IPC、窗口和 renderer 文件，按顺序一次完成，不与其他改动同文件的任务在同一 checkout 并行。

## 用户可见行为

- 点击地址栏或 Cmd+L（macOS）/Ctrl+L（Windows、Linux）进入编辑，显示完整原始地址并全选；设置页或新标签为空。输入期间标签状态、标题、语言或其他窗口广播不能覆盖草稿。普通复制、粘贴、选区、光标移动、撤销和输入法组合遵循系统输入框行为；组合输入期间不查询、不处理 Enter 或方向键，compositionend 后查询一次。
- 空白输入不查询、不显示列表或空状态；Enter 不导航并回到页面。非空输入立即显示浮层，最多十项：开放标签、书签、历史，最后一个为本地生成的“搜索或打开”项。没有本地匹配也显示最后一项。查询失败仍可直接提交，显示简短错误，后续输入自动重试；不显示异常、URL 凭据或堆栈。列表不请求远程建议，任何情况下均不得发起远程建议、预取、DNS、图标或连接请求。
- ArrowDown 从无选中到第一项，继续下移，末项后回到无选中；ArrowUp 从无选中到末项，首项后回到无选中。选中项可滚动至可见，但不改变输入内容。Enter 选中项时执行它，否则提交当前输入；鼠标点击执行对应项。标签项激活所属窗口和标签，不导航；其他项通过 B2a 的 `navigate`。重复 Enter 或点击只执行一次。Tab/Shift+Tab 关闭浮层并正常移动焦点；Escape 丢弃草稿，恢复当前活动标签的最新地址，关闭浮层并 `focusPage()`。窗口失焦、切换/关闭标签、打开其他 surface、窗口关闭时取消编辑和未完成查询；点浮层外取消编辑但不把这次点击转发给底层视图，第二次点击才操作底层。
- 内联补全只针对第一个符合条件的历史或书签 URL：用户刚在末尾插入文字且无选区，输入至少两个字符，以不区分 ASCII 大小写的方式前缀匹配完整 URL 或去掉 `https://` 的 URL；不补全标签、搜索词、路径中间匹配或含凭据 URL。保留用户原样前缀，追加匹配后缀并选中后缀；右箭头或 End 接受补全，Enter 在无列表选中时提交补全后的完整值。Backspace/Delete、粘贴、IME、光标不在末尾、已有选区时不补全；后续查询用用户实际输入前缀而非选中后缀。延迟响应仅在输入、选区和编辑代次仍匹配时应用，绝不覆盖新输入。
- 未编辑时 HTTP(S) 隐去协议和单独的末尾 `/`，保留完整主机（包括非默认端口）、路径、查询和片段，主机突出、其余弱化；过长时右侧省略，主机始终可见，窄到容不下主机时省略主机左侧并保留结尾。IDN 显示 `URL.hostname` 的 ASCII/Punycode，避免同形欺骗；IPv6 保留方括号。不得显示用户名和密码；聚焦编辑时使用未经省略的当前 URL，但先去除 username/password，复制显示的地址也不包含凭据。非 HTTP(S) 原样显示去除凭据后的值；`about:blank`/新标签为空，设置页显示现有 `caveSettings`。导航或页面更新后更新显示，编辑中只更新取消时恢复的目标。
- 指示器只表达可证明的信息：成功提交且无主框架错误、加载结束的 HTTPS 页面为“HTTPS”（传输协议，非安全保证）；HTTP 为“不安全”；设置和 `about:` 为“内部页面”；空、新建、`data:`、`blob:`、加载中、失败或崩溃为“连接状态未知”。使用不同 lucide 图标和可访问名称，不用锁或“安全”暗示证书已独立核验；D1 前为非交互图标，不伪装成可点击按钮。D1 后接站点信息。
- 地址栏右键菜单提供“粘贴并转到”，无快捷键。仅用户明确选择时在主进程读系统剪贴板一次，将文本 trim 后交给 B2a `navigate`；空白或读失败不导航，关闭菜单并回到页面。多行文本按原样交 B2a 解析，不自动逐行打开；不得记录剪贴板。普通粘贴只编辑，不触发导航。

## 文件清单

- 修改 `src/shared/ipc.ts`：加入下列类型、调用、事件和 state；`CALLS`/`EVENTS` 同步登记，`Handlers`/`CaveApi` 由映射类型生成。所有输入做运行时校验。
- 修改 `src/main/index.ts`：用现有 database 实例化 `Bookmarks` 并传入 `Browser`；在 `handlers(win)` 加下列方法。保留现有 `browser.windowOf(e.sender)` 校验，并额外按调用限制 chrome/overlay 来源；网页不能访问 bridge。剪贴板只由地址栏菜单显式动作触发。
- 修改 `src/main/shell/browser.ts`：通过 `BrowserOptions` 注入现有 `History` 与 `Bookmarks`，提供跨窗口仅供主进程使用的标签快照与激活方法；校验窗口及标签仍属于本 Browser。每个窗口的查询结果只发送给该窗口，不通过 `broadcast()` 广播给其他窗口。
- 新增 `src/main/shell/suggestions.ts`：查询、规范化、排序、去重、限额、URL 安全过滤和一次性结果表；不接入网络。异常分别隔离 history 和 bookmarks。为可测性将排序和过滤写成纯函数。
- 修改 `src/main/shell/window.ts`：管理每窗口编辑 token、结果表和失效；配合 `Surfaces` 在打开时捕获当前活动标签身份，关闭时清理；从 `Browser` 获取其他窗口标签，安全激活。提交仍走 B2a `navigate` → `WindowHost.load` → `Navigator.load`，不直接 `loadURL`。处理窗口失焦、标签变化、重置、关闭和导航代次变化。
- 修改 `src/main/shell/surfaces.ts`：支持 suggestions 以 overlay 获得焦点，关闭时由调用方指定恢复页面、chrome 或不恢复，避免先恢复旧焦点再抢焦点；保留 status 既有行为。每次关闭只执行一次清理。
- 修改 `src/renderer/shell.tsx`、`shell.css`：地址栏成为展示和编辑入口，报告 `data-anchor="suggestions"` 的地址栏矩形；隐藏编辑期间被 overlay 覆盖的原输入，提供指示器、截断、无障碍名称；保留其他工具栏与布局。`focusAddress` 事件通过相同入口启动编辑。
- 修改 `src/renderer/overlay.tsx`、`overlay.css`，新增 `src/renderer/surfaces/suggestions.tsx`：注册 suggestions。overlay 在地址栏锚点原位画可编辑输入，其下方画列表，使当前持有键盘的同一 WebContents 接收输入及列表操作；外部点击、Escape、焦点交接由本任务处理，避免通用关闭逻辑重复执行。锚点改变、resize、布局变化时重新定位，列表向下展开，空间不足向上翻转，限制高度并滚动，始终保持输入覆盖锚点。修改 `src/renderer/ui/list.tsx` 与 `index.tsx` 的 `Surface`/`src/renderer/ui/place.ts`：增加受控 active、无焦点抢占及可配置 role/label 的兼容选项，保留现有默认行为；使用现有 `List`、`Surface`/`Popover`，不新造平行浮层。跨 WebContents 无法用 `aria-activedescendant` 引用，因此输入和 listbox 都在 overlay；输入 `role=combobox`、`aria-expanded`、`aria-controls`、`aria-activedescendant` 指向同文档的稳定 option id。
- 修改 `src/shared/commands.ts`、`src/main/shell/commands.ts` 和 B1 的菜单实现：添加无快捷键的 `address.pasteAndGo`，菜单只对地址栏提供此动作；主进程还须验证当前窗口的地址编辑会话或本任务扩展的地址栏菜单 token，不能仅凭任意 `run` 调用读取剪贴板。命令表使用现有 `CommandSpec`，该 token 在一次执行或取消后失效。
- 修改 `src/renderer/icons.ts`（仅缺少时内联 lucide 图标）、`src/shared/i18n/zh.ts`、`en.ts`；添加下列测试。不得改 gate、gatekeeper、network、proxy、fingerprint 或 core 逻辑。

## IPC 合同增量

在 `src/shared/ipc.ts` 中定义以下可序列化合同；这是相对 B2a/B1 合并后的增量，不删除其字段：

```ts
export interface AddressSuggestion {
  id: string; // 当前查询的一次性、不透明标识
  kind: 'tab' | 'bookmark' | 'history' | 'search';
  title: string;
  url: string; // 仅供显示，已去除凭据；search 项为空
}
export interface AddressQueryResult {
  session: string;
  sequence: number;
  items: AddressSuggestion[];
  unavailable: boolean;
}
// SurfaceName 增加 'suggestions'。
// ShellState 增加：
address: { session: string; initial: string } | null;
// CaveCalls 增加：
beginAddress(): void;
suggestAddress(session: string, sequence: number, input: string): AddressQueryResult;
chooseAddress(session: string, sequence: number, id: string): boolean;
submitAddress(session: string, input: string): boolean;
cancelAddress(session: string, focus: 'page' | 'chrome' | 'none'): void;
// CaveEvents 增加：
addressStarted: { session: string; initial: string };
// CALLS 加 beginAddress、suggestAddress、chooseAddress、submitAddress、cancelAddress；
// EVENTS 加 addressStarted。TabState 无增量。
```

`beginAddress` 仅 chrome 可调用，须在主进程为该窗口新建随机不可预测 session，捕获当前标签 id 和导航代次、初始清理后 URL，打开 surface，向 overlay 发送 `addressStarted`；overlay 也从 `ShellState.address` 初始化，处理事件先于加载完成或 state 乱序，以 session 去重，确保只全选一次。空输入仍打开含输入框的 surface，列表隐藏。`suggestAddress` 仅当前 overlay、当前 session 可调用；sequence 为从 1 递增的安全整数，input 为至多 2048 UTF-16 单元的字符串，超过限额返回空结果且 unavailable，不截断提交。结果携带原 session/sequence，renderer 只采用最新请求及当前文本/组合状态的响应。主进程仅保存最新 sequence 的结果映射；较旧查询完成时不得替换它。`chooseAddress` 只接受同一 session、最新 sequence 和映射中 id；服务端取原始目标，绝不信任 renderer 的 URL、窗口或标签 id。消费 session 后复核目标仍存在且 URL/导航代次未变，失效返回 false、关闭浮层并回到页面，不执行其他动作。`submitAddress` 同样限制来源/session、长度并一次性消费，空白不导航；返回 false 表示无效或过期，不暴露错误详情。`cancelAddress` 仅当前 overlay 的 session 有效；传入 focus 只允许上述枚举，窗口失焦时用 none，用户 Escape 用 page，Tab 用 chrome 后由 chrome 恢复相邻控件焦点。所有 session 在关闭、切换、导航代次变化、重置、替换 surface、窗口关闭时作废，迟到调用无效；销毁窗口后不发送结果。

`addressStarted` 与 state 的 initial 不含 credentials；不得把建议、剪贴板或输入写日志、持久化到新表或发给其他窗口。`ShellState.address` 只表示当前窗口的编辑状态，不包含查询结果。`setAnchors` 校验有限、非负的窗口内矩形；缺失/不可见锚点不打开或取消编辑。安全指示从现有 `TabState` 的 URL、loading、error、crashed 计算，无新增安全状态 IPC，不能凭 URL 声称已验证证书。

## 建议算法和存储

非空输入 trim 后用于匹配，调用 `History.search(text, 10)`（现有 FTS5 将 Unicode 字母数字转安全前缀 token，按 typed/visits/recency 排序）和 `Bookmarks.search(text, 10)`；仅 bookmark `kind === 'link'` 且 URL 非空。开放标签从所有窗口的 web 标签取快照，跳过当前活动标签、空 URL、settings，title 或去凭据 URL 包含输入即匹配（Unicode `toLocaleLowerCase`，不读取其他窗口页面内容）。标签按本窗口优先、窗口创建顺序、标签顺序；书签按仓库顺序、历史按仓库顺序；同 URL 精确去重，优先标签、书签、历史，重复开放标签保留第一个。URL 使用 `new URL` 序列化，清除凭据，去除默认端口；只允许 `http:`/`https:` 的本地建议。保留片段作为 URL 一部分；排除解析失败、超长 URL（2048）或标题（显示截至 256 字符）。前九项依序截断，第十项固定为 search，其标题用用户输入（纯文本渲染），执行时交给 B2a 解析而不是强制搜索。未满九项时 search 紧随其后。查询失败时保留其他来源及 search 并设 unavailable；空白不查库。

既有 v1 schema、FTS 触发器与 `History` 均已存在；无 schema 修改、迁移、prefs 或历史数据重写。现有 `historyVisit` 的 typed 标记逻辑保持不变，排序使用库当前数值；不为本单补记 typed。书签仓库是现有表，不实现书签管理 UI。数据库不可用时仍保留标签及提交能力。限制输入长度前先检查类型，不能将敏感值写日志。

## i18n 与命令

在 `src/shared/i18n/zh.ts` 和 `en.ts` 成对新增，全部经 `t()`；复用 `addressPlaceholder`、`caveSettings` 和已有 command key。

| key | 中文 | English |
| --- | --- | --- |
| `addressSuggestions` | 地址建议 | Address suggestions |
| `addressSearchOrGo` | 搜索或打开 {input} | Search or open {input} |
| `addressTab` | 切换标签页 | Switch to tab |
| `addressBookmark` | 书签 | Bookmark |
| `addressHistory` | 历史记录 | History |
| `addressUnavailable` | 部分建议不可用 | Some suggestions unavailable |
| `addressHttps` | HTTPS 连接 | HTTPS connection |
| `addressInsecure` | 不安全的 HTTP 连接 | Insecure HTTP connection |
| `addressInternal` | 内部页面 | Internal page |
| `addressUnknown` | 连接状态未知 | Connection status unknown |
| `command_address_pasteAndGo` | 粘贴并转到 | Paste and Go |

`address.pasteAndGo` 的 `label` 为 `command_address_pasteAndGo`，不设置 accelerator；继续使用已有 `address.focus`。搜索项和来源类型名称仅用于辅助技术或需要消歧的标签，避免多余说明。所有建议标题和 URL 用文本节点，不能作为 HTML 插入。

## 平台与边界

macOS 使用 Cmd+L 和系统剪贴板；Windows/Linux 使用 Ctrl+L 和系统剪贴板，Linux 读取常规 clipboard，不读 PRIMARY selection。窗口标题栏、安全区域、系统缩放和顶部/侧边布局均以实际 anchor 窗口 CSS 坐标定位，避开原生窗口控件，不改变 `platform.ts` 标题栏策略。窗口失焦不强制抢回焦点。剪贴板抛错和不可读按空值处理；无网络、闸门暂停、关闭和排队时建议仍可用，提交完全遵循 B2a 与 Navigator。设置页提交按 B2a 建立 web 标签；切换到其他窗口的标签先校验存活，再激活标签、恢复/显示并 focus 其窗口；目标销毁则安全失败。导航中的失败地址、重定向、同文档跳转、崩溃及标签关闭均不能让旧结果操作新目标。搜索、历史和书签的长文本、Unicode、HTML 字符、重复 URL、畸形或带凭据 URL 均按以上规则处理。退出、重置、焦点转移不留下 overlay 或有效 token。

## 测试

- 新增 `test/unit/address-suggestions.test.ts`：`local suggestions rank and deduplicate` 构造跨窗口标签、书签和历史，断言顺序、十项上限和 search 末项；`invalid and credential URLs` 断言协议过滤、去凭据和不注入 HTML；`store failure leaves navigation available` 分别令两个仓库抛错，断言另一来源与 search 仍在；`stale session and result cannot execute` 测序号乱序、重复消费、标签关闭及导航变化。以真实内存 `openStore(':memory:')` 测 FTS 的 Unicode、标点和触发器。
- 新增 `test/unit/address-display.test.ts`：HTTP(S)、端口、IPv6、Punycode、凭据、路径/查询/片段、空及内部 URL、失败/加载/崩溃对应指示；测试补全前缀、选区、删除、粘贴、IME 与迟到结果。扩展 `test/unit/ui-logic.test.ts` 验证受控 List 上下循环、无选中及原有默认行为。
- 扩展 `test/e2e/app.test.mjs`：使用 `startWorld({ extra: ['--remote-debugging-port=0'] })`、`devtoolsPort(w.log)`、`evaluate`、`click`、`waitFor` 和 `t.after(() => w.stop())`，按现有 CDP 方式找 shell/overlay、本地 fixture；需要键盘事件时使用 `test/e2e/cdp.mjs` 的连接发送 CDP `Input.dispatchKeyEvent`，复用 B1 §测试 的 CDP 按键 helper；若尚未合入，按 B1 §测试 使用 `Input.dispatchKeyEvent` 实现。新增 `address local suggestions and keyboard`：访问本地 fixture 建历史，打开多个标签和窗口，输入匹配词，断言排序、去重、箭头、Enter 及跨窗口激活；`address edit cancellation and races`：断言全选、IME、补全、反序结果、Escape、切换标签、外点和窗口失焦后的焦点/状态；`address paste and go`：由测试进程使用受控剪贴板或仅测试构建注入的明确动作，断言空值、普通粘贴及菜单执行各一次；`address closed gate and no remote suggestions`：关闸后输入不同文本并等待本地查询完成，断言 SOCKS/fixture 没新增建议请求，提交后只产生既有排队状态；`address display and security`：本地 HTTP、内部、加载及失败分别断言展示和可访问名称。若 harness 缺少观测请求或受控剪贴板能力，仅为测试增加最小 helper，清理所有临时状态，不访问公网。确保外部 `CAVE_LANG` 不覆盖 harness 的中文默认。
- 运行 `env -u ELECTRON_RUN_AS_NODE npm test` 和 `env -u ELECTRON_RUN_AS_NODE npm run test:e2e`。CDP 点击只证明页面内部命中；macOS 真机在顶部/侧边布局逐一实际点击地址栏、列表、外部、右键粘贴、快捷键、输入法和跨窗口激活，并记录结果。Windows/Linux 真机重复快捷键、剪贴板、焦点、缩放与两种布局；不可验证时明确报告未验证，不能把 CDP 作为原生点击证明。

## 验收清单

- [ ] B2a 解析与闸门不变；查询和输入全程没有任何远程建议或预取请求。
- [ ] 本地结果排序、去重、限额、错误退化、跨窗口激活和过期操作均符合规则。
- [ ] 鼠标、键盘、IME、内联补全、无障碍、焦点恢复和 overlay 在两种布局可用。
- [ ] URL 与指示器不泄露凭据或夸大安全性；两种语言与三平台差异已覆盖。
- [ ] 单元、e2e 通过，人工结果和未验证平台已记录；无数据库迁移。

## 范围外

远程建议、预取、图标抓取、书签管理、历史管理、搜索引擎设置、证书详情、D1 站点信息和新的网络策略均不实现。不得修改 gate、gatekeeper、network、proxy 或 core；所有实际请求仍走现有代理和闸门。

## 待定（已按保守默认写）

- 建议排序与上限、空输入不显示最近记录：按标签 → 书签 → 历史，最多九条加一条本地搜索或打开。
- 内联补全只对 URL 前缀且满足明确输入条件启用；不根据搜索词或开放标签补全。
- HTTPS 指示只描述协议，不声称连接安全；D1 前不提供点击动作。
- 点浮层外的首次点击仅关闭浮层；粘贴并转到的多行内容作为单次输入解析。

## 共享菜单接口

B1 拥有菜单基础；B2b 依赖 B1 §共享菜单接口；若尚未合入，按此精确接口构建：`MenuEntry = { separator: true } | { id: string; label: string; enabled: boolean; checked?: boolean; shortcut?: string }`；`ShellState.contextMenu: { token: string; items: MenuEntry[] } | null`；`contextAction(token: string, id: string): void` 仅接受本窗口 overlay 和当前一次性 token。B2b 自行扩展主进程菜单上下文以支持地址栏，不新增或改写此 IPC；动作必须重新验证编辑会话或菜单 token。

## 共享多窗口测试接口

B1 拥有多窗口 CDP helper；B2b、B3、B4、B5 依赖 B1 §共享多窗口测试接口；若尚未合入，按此精确接口构建：`listTargets(port)` 返回 `Promise<Array<{ id: string; type: string; url: string }>>`；`withTarget`、`evaluate`、`click`、`screenshot` 的第二参数接受原 URL 谓词或 `{ targetId: string }`，按 id 精确匹配，不存在或关闭时报错，旧调用兼容。用创建窗口前后 target id 差集及唯一 fixture URL 和各 shell 的 `cave.getState()` 关联窗口；overlay 用逐个打开 status 并核对对应 shell 状态关联，不唯一则失败，不依赖列表顺序。

## 共享地址解析接口

B2a 拥有地址解析；B2b 依赖 B2a §共享地址解析接口；若尚未合入，按此精确接口构建：`type SearchEngine = { kind: 'default' } | { kind: 'custom'; template: string }`；`toUrl(input: string, search?: SearchEngine): string`；`ShellState.searchEngine: SearchEngine`；`setSearchEngine(engine: SearchEngine): boolean`。空白输入不导航；实际加载通过 `ShellWindow.navigate` → `WindowHost.load` → `Navigator.load`。
