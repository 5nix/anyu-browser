# B1 菜单与右键

## 目标

工具栏、网页和标签右键使用同一个窗口的 overlay 菜单，目标明确、键盘可操作；原生应用菜单及其快捷键保留。先实现此执行单，再做 B2；本文限定地址栏右键不在本次范围。

## 用户可见行为

工具栏新增 ⋯ 按钮，名称为「菜单」；在顶部和侧边两种标签布局中均紧挨闸门状态按钮右侧放置；点击或键盘激活后在按钮下方打开菜单，再次激活或 Escape 关闭。顺序如下；横线表示分组分隔，禁用项仍可见但不可选择。命令文案和快捷键显示复用 `COMMANDS`，未列快捷键不新增。

1. 新建标签页、新建窗口；分隔。
2. 历史、书签（均禁用，等待 M5/M6）、下载（打开现有设置的下载页，即使列表为空也可打开）；分隔。
3. 缩小、实际大小、放大（无活动 web 标签时禁用；每次执行关闭菜单）；分隔。
4. 打印（无活动 web 标签时禁用）、设置。

右键网页按以下顺序组合独立组，不显示空组或首尾/相邻分隔线。多个条件同时成立时全部按此顺序显示；不把网址、选区或图片内容显示在菜单或日志里。

- 链接：在新标签页中打开链接、复制链接地址。打开只允许符合 `WEB` 的 URL，且由 `newTab(url, undefined, false)` → `WindowHost.load` → `Navigator.load` 执行；不支持的协议禁用打开，复制仍可用。后台打开不切换标签。
- 图片：在新标签页中打开图片、复制图片、图片另存为…。打开同上；复制调用原目标 `wc.copyImageAt(p.x, p.y)`。保存沿用 `wc.downloadURL(p.srcURL)` 和现有 `Downloads`，仅允许 HTTP(S) 且闸门已放行时启用，执行时再次检查；其浏览会话仍走既有代理。禁用时不发请求、不排队。非 HTTP(S) 图片保存禁用；无需新建保存对话框，沿用现有自动下载目录与命名。
- 可编辑：撤销、重做；分隔；剪切、复制、粘贴、全选。根据 `p.editFlags` 的 `canUndo/canRedo/canCut/canCopy/canPaste/canSelectAll` 分别启用，执行于产生右键事件的 WebContents。否则有非空选区时仅显示复制，依据 `canCopy` 启用。
- 页面：后退、前进、重新加载；分隔；检查。后退/前进使用目标的 `navigationHistory.canGoBack/canGoForward`，执行前重新检查；重新加载调用目标 `wc.reload()`；检查调用 `wc.inspectElement(p.x, p.y)`。网页右键只接受当前可见 web 标签发出的事件，不激活其他标签。

右键任意标签（包括设置标签）不激活它，显示「重新加载」「关闭标签页」；重新加载仅 web 标签启用且作用于该标签，关闭作用于被右键的标签，包括设置标签；最后一个标签关闭沿用 `ShellWindow.closed` 自动创建空白标签。此处的关闭不能调用作用于当前标签的 `tab.close`。不提前实现固定、复制、关闭其他等 M2 操作。

菜单至少有页面组或标签组，因此没有空状态；菜单创建失败时不打开浮层、不执行任何动作，原焦点保持，重新右键可重试，不暴露堆栈。操作若因目标销毁、状态变化或权限不足而无效则安全关闭，可再次打开获取新状态。图片下载失败由现有下载列表显示中断，不创建新错误 UI。

## 文件清单

- 改 `src/main/shell/context-menu.ts`：移除网页 `Menu.buildFromTemplate`/`popup`；新增纯菜单组合与动作白名单、分隔线归一化及 URL 校验，保留上述现有行为。持有原始 `ContextMenuParams` 的一次性上下文由窗口拥有，绝不发给 renderer。
- 改 `src/main/shell/window.ts`、`tab.ts`：分别处理网页和指定标签的菜单、目标生存期和窗口坐标；在主框架任何导航开始（包括同文档导航）、目标销毁、标签切换时失效。`TabHost` 增加明确的导航失效通知；不依赖 `changed()` 推断导航。标签菜单以目标 id 操作，不先 `activate`。
- 改 `src/main/shell/surfaces.ts`：支持主进程设置一次性锚点、打开相同 surface 时刷新、关闭回调和安全焦点恢复；关闭、替换及窗口失焦均通知窗口清除上下文。既有 status 行为保持。
- 改 `src/main/index.ts`、`src/shared/ipc.ts`：登记下述合同和 handler；限制来源。改 `src/main/shell/browser.ts`：向 `WindowHost` 提供闸门读取和当前窗口命令执行入口；工具栏动作复用 `browser.run(id, win)`，下载打开 `win.openSettings('downloads')`。不要以全局 front 代替调用者窗口。
- 改 `src/renderer/shell.tsx`、`shell.css`：加入 ⋯ lucide 按钮与锚点、标签右键及 ContextMenu/Shift+F10 键盘入口；标签元素可键盘聚焦。仅在菜单请求时读取被点标签 id 和坐标，不触发其 click。图标在 `src/renderer/icons.ts` 使用已有图标或内联 lucide `ellipsis`。
- 改 `src/renderer/overlay.tsx`，新增 `src/renderer/surfaces/context-menu.tsx`：注册 `menu`、`contextMenu`，用 `Surface` 和 `src/renderer/ui/menu.tsx` 的 `Menu` 呈现，映射主进程条目到组件的 `label`、`disabled` 和 action，不将任意字符串视作命令。工具栏菜单亦通过同一一次性 action 路径执行。
- 改 `src/renderer/ui/index.tsx`、`menu.tsx`、`ui.css`、`place.ts`：修复菜单的无障碍语义、聚焦与 Tab 关闭，支持点位右下优先、边缘翻转、菜单最大高度滚动；其他 surface 行为不变。改两种语言字典及下述测试。

## IPC 合同增量

在 `src/shared/ipc.ts` 明确增加，`CALLS` 同步登记；`CaveApi` 自动包装 Promise。已有 `toggleSurface` 只允许 `status` 和 `menu`，`contextMenu` 只能经受限入口打开；不得信任 renderer 自报网页参数。

```ts
export type MenuEntry =
  | { separator: true }
  | { id: string; label: string; enabled: boolean; checked?: boolean; shortcut?: string };
// SurfaceName 原有 'status' 加：
// | 'menu' | 'contextMenu'
// ShellState 加：
contextMenu: { token: string; items: MenuEntry[] } | null;
// CaveCalls 加：
openTabMenu(tabId: number, anchor: Rect): void;
contextAction(token: string, id: string): void;
// CALLS 增加 openTabMenu: true, contextAction: true。
// CaveEvents、EVENTS、TabState 无增量。
```

`ShellState.contextMenu` 对两类菜单均有效，关闭时为 null；条目标签由主进程 `t()`/`label()` 生成，语言切换时关闭菜单，重开得到当前语言。快捷键由 `accelerator(id, mac)` 生成并按 `Menu` 的现有平台格式显示。无可见 URL、selectionText、图片数据或文件路径。token 使用不可预测的 `randomUUID()`，每窗口最多一个；主进程保存 token、类别、目标 tab id/WebContents、导航代次、原始参数、允许项及启用状态。调用只接受本窗口 overlay 的 sender、当前 token、当前展示且启用的 id；先原子消费 token 和关闭菜单，再复核目标仍属于窗口、未销毁、页面仍活动且导航代次相同，复核动作权限后执行。未知、重复、过期、跨窗口或禁用请求均无效果。工具栏菜单打开也创建 token，命令 id 仅由主进程预设表映射；`contextAction` 不接受客户端网址。

`openTabMenu` 只允许本窗口 chrome sender，运行时校验有限数值、整数 tabId 属于本窗口、Rect 四个有限数、宽高非负并限制在当前 content bounds；忽略不存在/离屏标签和非法输入。右键以指针位置的零尺寸 Rect 定位，键盘以标签可见矩形定位；锚点不作为安全权限。`toggleSurface('menu')` 只允许 chrome sender；阻止 settings/overlay 伪造打开。`contextAction` 只允许 overlay sender；现有 `browser.windowOf` 仅验证 UI 归属，还须在 `ipcMain.handle` 分派前按 `e.sender === win.chrome.webContents` / `win.overlay.webContents` 分别验证，不依赖 handler 签名识别 sender。拒绝 renderer 设置 `contextMenu` 锚点或直接打开该 surface。`closeSurface` 对当前 surface 生效且清 token；所有输入运行时检查。页面右键使用 Electron 原生 `context-menu` 事件，不增加网页 IPC。

## 浮层、坐标和焦点

网页 `p.x/y` 是对应 WebContentsView 内的 DIP 坐标，加上该 tab view 的 `getBounds().x/y` 得到 content 坐标，限制在窗口可见范围；不乘设备像素比。标签右键使用 chrome 的 `clientX/clientY`，键盘触发使用标签矩形；工具栏使用 `data-anchor="menu"` 和现有 `reportAnchors`。主进程单独设置 contextMenu 锚点，防止 `setAnchors` 更新覆盖；大小或布局变化时关闭 contextMenu，工具栏菜单跟随锚点重新定位。点位菜单先在指针右下出现，右/下空间不足翻至左/上，最后在 8px 边距内夹取；窄小窗口内菜单 `max-height: calc(100vh - 16px)`，内部可滚动，焦点项滚入可视区。

overlay 打开时持有键盘，首个启用项聚焦；上下箭头循环跳过分隔线/禁用项，Home/End 到首尾，Enter/Space 执行，现有 type-ahead 保留；Escape 和 Tab/Shift+Tab 关闭并恢复焦点，不向底层透传。菜单使用 `role=menu`、`menuitem`、可访问名称；扩展 `Surface` 允许菜单使用正确的 label，避免现在无 `#title` 的 `aria-labelledby`。禁用项不进入键盘焦点。外部点击只关闭并消费此次点击，第二次才与底层交互。窗口失焦时关闭但不抢回其他窗口焦点；普通取消返回打开前的 WebContents 及其原元素，若元素/标签已销毁则聚焦当前页面或工具栏按钮。动作执行时不要让旧焦点恢复覆盖新建标签、设置或检查动作的焦点；先关闭并恢复，再执行动作。菜单组件卸载时不能自行聚焦 overlay 内已销毁元素；与 `Surfaces` 的跨 WebContents 恢复协调。浏览器命令若自身调用 `focusPage/focusAddress`，其最终焦点优先。

保留 macOS 原生应用菜单、系统编辑角色及其快捷键；Windows/Linux 隐藏应用菜单栏但保留注册的加速键和现有标题栏控制。网页、标签及 ⋯ 菜单在三平台均为 overlay。输入法组合时不将组合键当菜单 type-ahead；系统保留快捷键以平台实际行为为准。深浅色、顶部/侧边布局及高 DPI 均使用现有主题和 DIP。

## 命令、翻译和存储

不新增共享命令或快捷键。工具栏历史、书签是禁用占位；下载使用现有设置页，不假设 M4–M6 已合入。动作复用现有 `command_*`、`downloads`、`openLink`、`copyLink`、`openImage`、`copyImage`、`saveImage`、`undo`、`redo`、`cut`、`copy`、`paste`、`selectAll`、`inspect`。在 `src/shared/i18n/zh.ts`、`en.ts` 成对新增：

| Key | zh | en |
| --- | --- | --- |
| `menu` | 菜单 | Menu |
| `menuHistory` | 历史 | History |
| `menuBookmarks` | 书签 | Bookmarks |
| `tabMenu` | 标签页菜单 | Tab menu |
| `pageMenu` | 页面菜单 | Page menu |

所有新可见及无障碍字符串通过 `t()`；不添加多余说明。无 store、prefs、数据库或迁移变化，不查询历史或书签仓库。

## 边界与安全

导航开始即失效，包括重定向、同文档导航；关闭、切换标签、窗口失焦/关闭、surface 替换、重新右键、布局和尺寸改变也清除 token。旧 token 在这些事件后永不可重用；迟到的调用不影响新菜单。右键事件只处理当前活动标签，即便后台 WebContents 合成事件也不响应。标签菜单目标关闭时失效；设置标签复用 WebContents 时也以 tab 成员身份验证。编辑命令基于 Electron `editFlags`，焦点回到原 WebContents 后才调用 `undo/redo/cut/copy/paste/selectAll`；不得用 `executeJavaScript` 读取选区或操作 DOM。密码字段遵守 Electron 提供的 flags，不记录敏感内容。

`WEB` 校验前还需 `URL.canParse` 和长度上限 8192，拒绝非字符串及 `file:`、`javascript:` 等；复制链接可复制 Electron 提供的原始 linkURL，绝不执行。图片复制不触发网络；保存只在 gate 打开且目标仍有效时进行，下载错误按现有机制处理。所有远程请求仍经过原有代理；不改 `src/main/gate.ts`、`gatekeeper.ts`、`network.ts`、`src/main/proxy/**`、核心进程或 fingerprint。不可因菜单绕过 Navigator 或改变网络策略。

## 测试

- 新增 `test/unit/context-menu.test.ts`：纯组合覆盖普通页面、链接+图片+选区、editable 各 flag、空组分隔符、无效协议、页面导航状态、闸门关闭保存禁用、标签类型；模拟 token 管理覆盖重复、伪造、跨窗口、导航/关闭/替换失效，以及动作执行前权限重检。
- 扩展 `test/unit/ui-logic.test.ts` 与 `test/unit` 的定位测试：上下/Home/End 跳过禁用、全禁用不崩溃，点位四角翻转、窗口过小可滚动；验证 status 原定位回归。中英 key 类型与文案检查放现有 `test/unit/i18n.test.ts`。
- 扩展 `test/e2e/app.test.mjs`：`toolbar menu commands and disabled entries`、`page context link image selection and edit`、`tab context targets inactive tab`、`menu escape and stale token`、`menu gate and windows`。使用 `startWorld({ extra: ['--remote-debugging-port=0'] })`、`t.after(() => w.stop())`、`devtoolsPort(w.log)`、`evaluate`、`click`、`waitFor`；本地 fixture 加链接、图片、可选文字和输入框。扩展 `test/e2e/cdp.mjs` 导出经现有 `withTarget` 的右键坐标和按键 helper，用 CDP `Input.dispatchMouseEvent`/`Input.dispatchKeyEvent` 产生真实 Chromium context-menu，不用 DOM 合成事件代替 Electron 事件。分别断言组合、禁用和 edit 后内容、后台链接标签、非活动标签关闭不误关当前、Escape/外点焦点、边缘坐标、旧 token/跨窗口无效、两个窗口互不干扰。暂停闸门后点击链接打开：fixture 无请求，恢复后通过既有 Navigator 释放；保存图片处于禁用且不产生请求。所有 fixture 走本地测试代理，不访问公网。
- 运行 `env -u ELECTRON_RUN_AS_NODE npm test` 和 `env -u ELECTRON_RUN_AS_NODE npm run test:e2e`。CDP 页面内点击不能证明原生视图命中。
- macOS 真实窗口手测两种布局：工具栏、网页链接/图片/选区/编辑、非活动标签，鼠标与键盘、四边定位、失焦、Escape 和焦点；暂停后验证无额外请求。Windows/Linux 同样手测并记录机器、缩放和未验证项；检查原生应用菜单/快捷键与窗口控制。

## 验收清单

- [ ] 各菜单顺序、组合、禁用、目标与动作符合本文，两种语言和布局可用。
- [ ] 键盘、屏幕阅读器、边缘定位、取消/操作后焦点及多窗口安全可用；过期调用无效果。
- [ ] 原生应用菜单保留；远程加载和下载保持代理/闸门约束；无存储迁移。
- [ ] 单元、e2e 通过，真实平台结果及未验证项已记录。

## 范围与合并

不实现地址栏或设置页右键、历史/书签功能、M2 标签操作、下载管理扩展、嵌套菜单和新快捷键。此任务作为一个交付单元串行实现；与 B2–B5 共享 IPC、窗口、overlay、i18n 和测试，在独立分支开发时按 `docs/plan/README.md` 顺序合并并重跑检查，不顺手修改其他任务。

## 待定（已按保守默认写）

- 历史和书签入口在功能落地前禁用；下载直接打开现有设置下载页。
- 图片保存沿用现有自动下载目录，闸门关闭或非 HTTP(S) 时禁用，不提供另存对话框。
- 标签菜单本次仅重新加载和关闭；地址栏右键留给 B2。

## 共享菜单接口

B1 拥有菜单基础；B2b 依赖 B1 §共享菜单接口；若尚未合入，按此精确接口构建：`MenuEntry = { separator: true } | { id: string; label: string; enabled: boolean; checked?: boolean; shortcut?: string }`；`ShellState.contextMenu: { token: string; items: MenuEntry[] } | null`；`contextAction(token: string, id: string): void` 仅接受本窗口 overlay 和当前一次性 token。B2b 自行扩展主进程菜单上下文以支持地址栏，不新增或改写此 IPC；动作必须重新验证编辑会话或菜单 token。

## 共享多窗口测试接口

B1 拥有多窗口 CDP helper；B2b、B3、B4、B5 依赖 B1 §共享多窗口测试接口；若尚未合入，按此精确接口构建：`listTargets(port)` 返回 `Promise<Array<{ id: string; type: string; url: string }>>`；`withTarget`、`evaluate`、`click`、`screenshot` 的第二参数接受原 URL 谓词或 `{ targetId: string }`，按 id 精确匹配，不存在或关闭时报错，旧调用兼容。用创建窗口前后 target id 差集及唯一 fixture URL 和各 shell 的 `cave.getState()` 关联窗口；overlay 用逐个打开 status 并核对对应 shell 状态关联，不唯一则失败，不依赖列表顺序。
