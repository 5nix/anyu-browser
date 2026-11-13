# B5 全屏、对话、缩放与查找

## 目标与交付边界

网页 HTML 全屏隐藏浏览器壳；站点缩放按 origin 持久保存并可重置；补齐现有查找栏缺口。目标还包括网页 JavaScript 对话框与 beforeunload 的标签模态界面，但 Electron 45.3.0 安装的 `electron.d.ts` 没有 alert/confirm/prompt 拦截及异步回答 API，`will-prevent-unload` 也只有同步事件、没有延迟回答回调。不得通过注入或覆盖网页脚本模拟。因此这两项按下文保守降级，不能宣称已经实现标签模态；先用本地 fixture 验证引擎原生表现并记录实际结果。`prompt` 若引擎不支持，不承诺其可用。

## 用户可见行为

1. 活动网页通过 HTML Fullscreen API 进入全屏后，页面覆盖窗口内容区，隐藏顶部/侧边壳和原生标题栏控件；显示短暂的“按 Esc 退出全屏”提示 3 秒。提示不可抢焦点、不拦截点击。Esc 由 Chromium 退出 HTML 全屏；恢复原布局和页面焦点。网页自行退出、导航、崩溃、关闭标签、切换标签或关闭窗口也恢复；若进入前窗口已处于 F11/系统全屏，退出 HTML 全屏后保留原窗口全屏状态。普通窗口全屏命令仍按原行为，不将它误认为网页全屏。未激活标签的请求不得覆盖当前页面。
2. `alert`、`confirm`、`prompt`：不注入脚本，不伪造可拦截回调；保留 Electron/Chromium 默认行为，测试并记录各平台实际结果，含关闭和后台标签情况。`beforeunload`：`will-prevent-unload` 同步事件默认不调用 `preventDefault()`，尊重页面阻止离开；不使用异步 overlay 或自动放行。页面能否在当前 WebContentsView 生命周期下实际阻止标签/窗口关闭必须实测记录；不得声称已有询问 UI。此限制是未满足的产品目标，见待定。
3. 缩放只作用于活动网页，设置页和非 HTTP(S) 页禁用；按 origin（协议、规范化主机、有效端口）分开，默认 100%。固定档位 50、67、75、80、90、100、110、125、150、175、200、250、300%；现有 Cmd/Ctrl+=、-、0 分别上下移动一档与重置，不循环。到边界不变化。非 100% 时地址栏旁显示百分比按钮，点击即重置；按钮 title/无障碍名称说明重置，100% 不显示。更改后同 origin 所有已打开网页及窗口立即同步；不同 origin 不受影响，新开和重启后恢复。写入失败保留原值与界面，显示简短错误，不静默假装成功；损坏值回退 100%。清除站点数据或重置环境后相关页面立即回到 100%。
4. 现有查找已实现 Cmd/Ctrl+F、输入时搜索、Enter 下一项、Shift+Enter 上一项、计数事件、Escape/关闭及页面回焦。本任务只补：可点击上一项/下一项按钮和无障碍名称；空输入立即清空计数及高亮；新查询以 `findNext: false` 开始，同一查询的前后跳转用 `findNext: true`；只显示当前标签、当前查询、最新 requestId 的结果，包含最终 0/0；切标签、跨文档导航、关闭标签或切到设置时停止原搜索、隐藏栏并清空输入和计数，不对新标签误调用 stop；打开时选中已有输入，空查询不调用 `findInPage`。结果尚未返回时计数为空；无匹配显示 0/0。按钮在空查询时禁用。查找栏占原 chrome 区域，不新增浮层。

## 文件清单与职责

- `src/main/shell/tab.ts`：转发 webContents 的 HTML fullscreen、导航、崩溃和 found 事件（含 requestId、finalUpdate）到宿主；仅网页监听；记录对应 tab 身份。不要改网络 session。
- `src/main/shell/window.ts`：管理 HTML fullscreen 所属 tab、原窗口全屏状态、提示计时、查找请求身份及布局；`layout()` 在 HTML fullscreen 时页面填充内容区、半径为 0，移除 chrome 子 view 和系统窗口按钮，恢复时按原顺序重加并重排；清理所有计时及监听。为验证状态可把纯档位逻辑放新增 `src/shared/zoom.ts`。
- `src/main/shell/surfaces.ts`、`src/renderer/overlay.tsx`：增加非交互全屏提示层；与 B4 模态提示共存，提示不抢焦点、不遮挡模态控件。
- `src/main/index.ts`、`src/main/shell/browser.ts`：实例化已有 `SiteSettings`，通过 `BrowserOptions` / `WindowHost` 注入读写、按 origin 广播更新，清理站点数据和环境后同步重置。修改已有 find handlers 以调用所属 `ShellWindow`，并验证调用者及参数。
- `src/main/shell/commands.ts`：既有缩放命令调用窗口统一缩放方法；沿用命令表，无新快捷键。
- `src/main/store/site-settings.ts`：新增针对 zoom 的有限数值及档位验证辅助方法；复用现有 `get/set/delete`。`src/main/store/migrations.ts` 不改。
- `src/shared/ipc.ts`：按下列完整增量登记。`src/renderer/shell.tsx`、`src/renderer/shell.css`：查找按钮、计数与百分比按钮、保存错误；`src/renderer/overlay.css`：模态及全屏提示样式。新增图标一律从 `src/renderer/icons.ts` 内联 lucide，复用已有图标优先。`src/shared/i18n/zh.ts`、`en.ts` 成对加词条。所有新文案通过 `t()`。
- 新增 `test/unit/b5.test.ts`，扩展 `test/unit/store.test.ts`、`test/e2e/app.test.mjs`；必要时扩展 `test/server.mjs` 和 `test/e2e/harness.mjs` 的本地 fixture / 保留 profile 重启能力。

## IPC 合同增量

```ts
// ShellState 增加，均只描述发送者窗口当前活动标签：
htmlFullscreen: boolean;
fullscreenHint: boolean;
zoom: number; // 整数百分比；无适用网页时为 100
zoomError: boolean;
// CaveEvents 的 found 改为：
found: { tabId: number; requestId: number; active: number; total: number; final: boolean };
// EVENTS 名称不变；其余 calls 不变。
```

`find(text, forward)` 保持签名；主进程为当前 tab 和查询跟踪 `findInPage` 返回 requestId，新查询先清除旧高亮并 `findNext:false`，相同查询跳转 `findNext:true`。先登记 requestId，再发结果；只转发最后一个请求的结果；renderer 额外按 active tab 核验，切换即清空。`stopFind()` 只停当前已登记的搜索所属 tab。所有传入查找文本限制 4096 字符。`found` 的现有监听和发送处同步更新。

## 存储与同步

使用已有 `site_settings` 表，key `zoom`，值为上述整数百分比；`new URL(url).origin` 仅接受 `http:` / `https:` 且非 `null`。写入时先同步数据库成功再设置内存及所有匹配页面的 `setZoomFactor(percent / 100)` 并广播；100% 删除该 key，避免遗留默认值。读异常或非档位值使用 100%，不自动写回。导航提交后按最终 origin 应用；跨 origin 不沿用旧值。Electron 默认 zoom 按 host 传播可能跨协议/端口，必须对每个 webContents 用 `setZoomMode('isolated')` 并自行同步完整 origin；不要使用 session 默认 host 缩放作为存储。SQLite 已有表，无 schema 迁移；旧库无 key 即 100%，已有其他 site_settings 保留。写入异常设置当前窗口 `zoomError`，下一次成功或切换标签清除；清理失败保持旧状态。所有请求仍经原 Navigator / 代理路径。

## 浮层、焦点和平台

全屏提示使用 overlay surface 通道但不抢焦点：新增独立非交互提示层能力与现有 `Surfaces` 同一 overlay view 共享，不能调用会 focus overlay 的 `open()`；同时存在交互 surface 时提示不盖住控件。提示 timer 到期移除，页面继续接收 Esc。macOS 使用 `setWindowButtonVisibility(false/true)` 并恢复进入前状态，系统全屏切换异步，依据 enter/leave 事件协调；Windows/Linux 恢复 titleBarOverlay 和窗口控件，不能把 F11 窗口全屏混同网页全屏。不同平台均须实测；Linux 非首发平台。交互 surface 和全屏同时存在时保留各自状态；关闭标签时先清理 surface 再退出全屏。

## i18n 词条

以下新增于 `zh.ts` / `en.ts`，已有 `cancel`、`closeFind` 和 `findPlaceholder` 复用；动态网页文本不翻译。

| Key | zh | en |
| --- | --- | --- |
| `fullscreenExitHint` | 按 Esc 退出全屏 | Press Esc to exit full screen |
| `zoomReset` | 重置缩放（{percent}%） | Reset zoom ({percent}%) |
| `zoomSaveFailed` | 缩放保存失败 | Could not save zoom |
| `findPrevious` | 上一个匹配项 | Previous match |
| `findNext` | 下一个匹配项 | Next match |
| `findCount` | {active}/{total} | {active}/{total} |

## 测试与验收

- 单元 `b5.test.ts`：档位上下界、非档位/NaN 拒绝、origin 规范化和隔离；查找 requestId 过期和切标签忽略；全屏先前窗口状态及提示计时清理。`store.test.ts`：旧库缺 key、损坏 JSON、写入失败、重置删除、其他设置不变。
- e2e `html fullscreen restores layout and focus`：`startWorld({ extra: ['--remote-debugging-port=0'] })`，使用 `devtoolsPort(w.log)`、`evaluate`、`click`、`waitFor` 与本地 fixture 发起有用户手势的全屏；断言页面 bounds、state、提示、退出后焦点、切标签及已处于窗口全屏的恢复。按 harness `t.after(() => w.stop())` 清理。CDP 不是原生点击验证。
- e2e `site zoom persists and synchronizes`：两个不同 origin、同 origin 两标签和两个窗口，执行命令并检查百分比、页面 zoom、重置、关闭重启保持 profile、站点清理与异常写入；使用 SOCKS 映射本地 fixture，验证没有公网请求。为重启扩展 harness 可保留并最终删除临时 profile。
- e2e `find ignores stale tab and query results`：fixture 含多个和零个匹配项，验证输入、前后按钮、Enter/Shift+Enter、0/0、清空、切页、导航、Escape 和焦点；延迟/乱序结果由单元测试模拟。
- e2e `javascript dialogs and beforeunload baseline`：逐个以本地 fixture 触发 alert/confirm/prompt、用户激活后的 beforeunload 和关闭；记录实际可观测行为及平台差异，不把 CDP 自动处理对话当作产品 UI 验收，不以预期标签模态伪造通过。
- 运行 `env -u ELECTRON_RUN_AS_NODE npm test` 和 `env -u ELECTRON_RUN_AS_NODE npm run test:e2e`；确保环境未覆盖 harness 的 `CAVE_LANG=zh-CN`。macOS 人工在顶部/侧边实际点击、全屏 Esc、缩放和查找；Windows 同测，Linux 记录可用性。报告未测平台。CDP 不能证明原生视图命中。

- [ ] 全屏进入、退出和原窗口状态恢复正确，提示不抢键盘。
- [ ] 缩放隔离、持久化、同步、错误与清理均正确；查找无过期计数。
- [ ] 单元、e2e 与人工结果已记录；JS 对话与 beforeunload 的降级限制明确列出。

## 禁止触碰与范围外

不修改 `src/main/gate.ts`、`gatekeeper.ts`、`network.ts`、`src/main/proxy/**` 或核心进程逻辑（仅显示字符串例外）；请求始终走代理。无密码保存、站点权限设置、网页脚本注入或新快捷键。此任务共享 IPC、window、overlay 和测试文件，应与其他任务串行合并，合并后重跑测试。

## 待定（已按保守默认写）

- Electron 45 无公开的 JS 对话异步拦截合同及可延迟的 beforeunload 回答；默认保留引擎行为并尊重阻止离开，不能实现所要求的全部标签模态。是否接受此限制，或另立引擎/架构工作，由主人决定。
- 缩放按完整 origin 隔离、固定 50%–300% 档位；持久化失败不应用，百分比按钮直接重置。

## 共享模态接口

B4 拥有模态基础；B5 依赖 B4 §共享模态接口；若尚未合入，按此精确接口构建：`Surface` 接受 `placement?: 'anchor' | 'center'`，默认 `anchor`；`center` 在窗口内容区居中、限制可视边界并保留现有 `name`、`anchor` 和 children。`ShellState.surface` 仍为 `{ name: SurfaceName; anchor: Rect } | null`；每窗口最多一个交互 surface。B4 拥有每窗口提示 FIFO；B5 的非交互提示不占 FIFO，不抢焦点、不遮挡交互 surface。

## 共享多窗口测试接口

B1 拥有多窗口 CDP helper；B2b、B3、B4、B5 依赖 B1 §共享多窗口测试接口；若尚未合入，按此精确接口构建：`listTargets(port)` 返回 `Promise<Array<{ id: string; type: string; url: string }>>`；`withTarget`、`evaluate`、`click`、`screenshot` 的第二参数接受原 URL 谓词或 `{ targetId: string }`，按 id 精确匹配，不存在或关闭时报错，旧调用兼容。用创建窗口前后 target id 差集及唯一 fixture URL 和各 shell 的 `cave.getState()` 关联窗口；overlay 用逐个打开 status 并核对对应 shell 状态关联，不唯一则失败，不依赖列表顺序。
