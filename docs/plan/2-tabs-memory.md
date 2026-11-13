# 2. 标签与记忆期

## 待定

- 会话恢复建议默认关闭，崩溃后提供一次恢复；搜索服务见索引。主人确认后再固定默认值。
- 下载记录保留期限建议不限，用户可清除；favicon 缓存建议 30 天且限 20 MiB。

## 概览与依赖图

基础期合入后提供完整的标签管理和本地记忆。M1、M2、M4、M5、M6、M8 逻辑上可并行；同一 checkout 因共享 `ipc.ts`、`window.ts`、renderer 注册表和迁移文件必须串行合入。M3 依赖 M2；M7 依赖 M4–M6；M5/M6 回接 B2。每任务遵守 [总约定](README.md)，不得修改 gate、core config、fingerprint；所有窗口调用按发送者限定，所有本地 UI 通过 Preact 和唯一 overlay。

```text
基础 → M1   基础 → M2 → M3
     → M4   基础 → M5 ─┐
     → M6 ─────────────┼→ M7
     → M8 ─────────────┴→ D1
```

## M1 网站图标与声音

- 行为：标签显示安全缓存的 favicon、播放声音指示和静音状态；静音/取消静音只影响目标标签，新标签、崩溃、导航、缺失图标均安全回退。图标获取使用页面会话、闸门和现有请求路径，不由主进程直连或发凭据到别处；限制尺寸和格式，拒绝脚本/SVG 活动内容。
- 文件：`src/main/shell/{tab,window}.ts`, `src/main/store/{migrations,index}.ts`、新增 `store/favicons.ts`, `src/shared/ipc.ts`, 标签组件与 i18n。迁移执行 `CREATE TABLE favicons (url TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL, updated INTEGER NOT NULL);`，按更新时间清理和总量裁剪。
- 契约：`TabState` 加 `favicon: string | null`（仅受控 data URL）、`muted: boolean`；`CaveCalls.setTabMuted(id: number, muted: boolean): void`；无新事件/浮层。命令 `tab.mute` 静音标签页 / Mute Tab，无快捷键，当前标签切换状态。
- 测试：单元测图标输入约束、裁剪和状态；e2e 验证缓存重启、音频静音、闸门关闭无图标请求。人工测图标和辅助标签。验收：坏图标不会影响 UI，也不引入网络旁路。


### 实施补充：接口与交互

`Tab.state` 当前通过 `wc.isCurrentlyAudible()` 计算 audible；监听图标与音频事件，必须验证响应大小和 MIME，禁止主进程以直连 fetch 补取图标。 用户打开入口后应能看清当前目标；使用 Tab/Shift+Tab 到达控件、方向键在列表中移动、Enter 执行、Escape 取消并回到原焦点。空数据提供简短空状态；失败保留可重试入口，不把异常堆栈、凭据或完整私人数据放进 UI。正在编辑时广播不能覆盖输入；同一操作重复提交应幂等或禁用，关闭窗口、标签或切换导航时取消或忽略旧结果。所有 URL 再由主进程校验，发起远程加载仍经过 `Navigator.load` 和闸门，关闭或暂停时不得额外发请求。

```ts
// CaveCalls 增量；具体返回类型见本节契约
setTabMuted(id: number, muted: boolean): void
// CaveEvents 无新增；ShellState / TabState 增量按上文契约。
// SurfaceName 增量：无
```

**i18n：**在 `src/shared/i18n/zh.ts` 与 `en.ts` 成对加入 `tab_mute: '静音标签页' / 'Mute Tab'`；设置页专用字符串放对应 settings 词典。其余可见动作、错误、空状态和无障碍名称也需成对翻译，复用已有 `command_*` key；不要以英文或中文硬编码动态反馈。命令 id 与快捷键以本节上方列出的为准；新增命令按 `CommandSpec` 使用 `key`、必要时 `macKey`，无快捷键则省略两字段。未列新命令时无增量。

**浮层与持久化：**本节指定的浮层通过 `src/renderer/overlay.tsx` 的 `surfaces` 注册并以 `Surfaces.open/close` 管理；无新增时沿用现有视图。使用 `Surface` 定位，菜单用 `Menu`，选项列表用 `List`，确认使用 `Dialog`；这些组件按需要组合，不为本任务新造平行 overlay。数据库按上文仓库和迁移执行；未列新表或列即不迁移。所有仓库变更必须测试旧库升级和事务回滚。

**边界和验证：**检查两个窗口同时操作、目标标签中途关闭或导航、闸门关闭/暂停、私人信息不进入日志与无关窗口、顶部与侧栏布局，以及 macOS 和 Windows/Linux。单元测试放 `test/unit/`，覆盖本节的状态转换、非法参数、竞态与存储；运行 `npm test`。e2e 使用 `startWorld({ extra: ['--remote-debugging-port=0'] })`，以 `devtoolsPort(w.log)` 获取端口，`evaluate`/`click`/`waitFor` 针对 shell、overlay 与本地 fixture 断言；需要新服务器行为时扩展 `test/server.mjs`，并在结束调用 `w.stop()`。`click` 仅检查单个页面的命中，不证明原生窗口层级。macOS 人工实际点击入口、键盘操作、取消、切换标签与窗口，在顶部和侧栏各重做；记录结果与未验证的 Windows/Linux 项。

**验收与并行：**功能、空/错误状态、焦点、权限边界和上述测试均通过才完成；报告人工结果及限制。除 D2 审阅批准后的范围外，禁止改 gate、网络核心、fingerprint；L0 的字符串例外与本任务无关。与其他任务共享 `src/shared/ipc.ts`、`src/main/index.ts`、`shell/window.ts`、`overlay.tsx`、i18n 和迁移文件时使用隔离 worktree，按本文依赖顺序合并；后合入者重新协调类型、迁移版本并重跑测试，不以并行开发代替串行合并。
## M2 标签操作

- 行为：顶部/侧栏拖动排序，固定标签排在普通标签前且保留顺序；拖出形成新窗口，拖入另一窗口合并，保留活的 WebContents、会话、导航历史和音频；取消拖拽回原位。右键固定、复制、关闭、重新打开；重复标签以同一 URL 新建，不复制 POST 内容。最后窗口关闭仍退出。
- 文件：`src/main/shell/{browser,window,tab,context-menu,commands}.ts`, `src/shared/{ipc,commands}.ts`、标签组件、菜单注册、i18n。拖拽跨原生窗口由主进程管理所有权和清理，不能同时挂在两个 contentView。
- 契约：`TabState.pinned: boolean`；`CaveCalls.moveTab(id: number, index: number): void; pinTab(id: number, pinned: boolean): void; transferTab(id: number, targetWindowId: number | null, index: number): void; duplicateTab(id: number): void`；`ShellState.windowId: number`；无新事件。严格验证源窗口、目标窗口、标签所有权及索引；null 创建新窗口；设置页不可转移。浮层复用 B1 的 `contextMenu`；暂不访问数据库，M3 负责闭页记录。
- 命令：`tab.duplicate` 复制标签页 / Duplicate Tab，无快捷键；`tab.pin` 固定标签页 / Pin Tab，无快捷键；`tab.reopen` 重新打开关闭的标签页 / Reopen Closed Tab，macOS Cmd+Shift+T，Windows/Linux Ctrl+Shift+T（M3 接线）。
- 测试：单元测顺序、固定区边界和所有权；e2e 测跨窗口转移、无重复和原标签关闭；真实 macOS/Windows 拖拽、合并及边缘取消手测。验收：转移保留状态，销毁窗口时不误销毁已转移标签。


### 实施补充：接口与交互

`Tab.host` 可变，`ShellWindow.closed(tab)` 在销毁时依赖当前 host；转移先脱离旧 contentView、再改 host、再附着，回滚不得让 Tab 同时属于两个窗口。 用户打开入口后应能看清当前目标；使用 Tab/Shift+Tab 到达控件、方向键在列表中移动、Enter 执行、Escape 取消并回到原焦点。空数据提供简短空状态；失败保留可重试入口，不把异常堆栈、凭据或完整私人数据放进 UI。正在编辑时广播不能覆盖输入；同一操作重复提交应幂等或禁用，关闭窗口、标签或切换导航时取消或忽略旧结果。所有 URL 再由主进程校验，发起远程加载仍经过 `Navigator.load` 和闸门，关闭或暂停时不得额外发请求。

```ts
// CaveCalls 增量；具体返回类型见本节契约
moveTab(id: number, index: number): void; pinTab(id: number, pinned: boolean): void; transferTab(id: number, targetWindowId: number | null, index: number): void; duplicateTab(id: number): void
// CaveEvents 无新增；ShellState / TabState 增量按上文契约。
// SurfaceName 增量：无新增（复用 contextMenu）
```

**i18n：**在 `src/shared/i18n/zh.ts` 与 `en.ts` 成对加入 `tab_duplicate: '复制标签页' / 'Duplicate Tab'`；设置页专用字符串放对应 settings 词典。其余可见动作、错误、空状态和无障碍名称也需成对翻译，复用已有 `command_*` key；不要以英文或中文硬编码动态反馈。命令 id 与快捷键以本节上方列出的为准；新增命令按 `CommandSpec` 使用 `key`、必要时 `macKey`，无快捷键则省略两字段。未列新命令时无增量。

**浮层与持久化：**本节指定的浮层通过 `src/renderer/overlay.tsx` 的 `surfaces` 注册并以 `Surfaces.open/close` 管理；无新增时沿用现有视图。使用 `Surface` 定位，菜单用 `Menu`，选项列表用 `List`，确认使用 `Dialog`；这些组件按需要组合，不为本任务新造平行 overlay。数据库按上文仓库和迁移执行；未列新表或列即不迁移。所有仓库变更必须测试旧库升级和事务回滚。

**边界和验证：**检查两个窗口同时操作、目标标签中途关闭或导航、闸门关闭/暂停、私人信息不进入日志与无关窗口、顶部与侧栏布局，以及 macOS 和 Windows/Linux。单元测试放 `test/unit/`，覆盖本节的状态转换、非法参数、竞态与存储；运行 `npm test`。e2e 使用 `startWorld({ extra: ['--remote-debugging-port=0'] })`，以 `devtoolsPort(w.log)` 获取端口，`evaluate`/`click`/`waitFor` 针对 shell、overlay 与本地 fixture 断言；需要新服务器行为时扩展 `test/server.mjs`，并在结束调用 `w.stop()`。`click` 仅检查单个页面的命中，不证明原生窗口层级。macOS 人工实际点击入口、键盘操作、取消、切换标签与窗口，在顶部和侧栏各重做；记录结果与未验证的 Windows/Linux 项。

**验收与并行：**功能、空/错误状态、焦点、权限边界和上述测试均通过才完成；报告人工结果及限制。除 D2 审阅批准后的范围外，禁止改 gate、网络核心、fingerprint；L0 的字符串例外与本任务无关。与其他任务共享 `src/shared/ipc.ts`、`src/main/index.ts`、`shell/window.ts`、`overlay.tsx`、i18n 和迁移文件时使用隔离 worktree，按本文依赖顺序合并；后合入者重新协调类型、迁移版本并重跑测试，不以并行开发代替串行合并。
## M3 会话与关闭的标签

- 行为：定期 5 秒及标签结构改变后防抖保存所有窗口、标签 URL、顺序、固定状态和活动标签；不保存 POST 数据、密码或内部临时页。启动按设置恢复；崩溃恢复提示可接受或丢弃；正常退出留住最后非空快照，不被关闭过程的空列表覆盖。重新打开闭页恢复 URL 和位置，失效容器回退提示而不跨容器加载。
- 文件：`src/main/index.ts`, `shell/{browser,window,tab,commands}.ts`, `store/{sessions,prefs}.ts`, `shared/ipc.ts`、设置页与 overlay 恢复提示、i18n。`Sessions.save/latest/pushClosed/popClosed` 操作 `sessions`/`closed_tabs`；`Prefs` 的 `restoreSession: boolean` 默认 false。JSON 加版本与验证，WAL 事务写入，损坏快照跳过并保留上一份；限制 5 个快照与 25 个闭页。
- 契约：`ShellState.restoreAvailable: boolean`；`CaveCalls.restoreSession(): void; discardSession(): void; setRestoreSession(enabled: boolean): void; reopenClosedTab(): void`；`SurfaceName` 加 `'restoreSession'`；无新事件。命令 M2 `tab.reopen`；无其他快捷键。
- 测试：单元测版本、损坏、边界和正常关闭快照；e2e 杀进程重启、恢复多窗口、闭页、设置关闭；人工验收跨窗口恢复。验收：异常退出最多丢失一个保存周期，启动恢复仍经闸门。


### 实施补充：接口与交互

`Sessions.save(data: unknown)`、`latest<T = unknown>()`、`pushClosed(data: unknown)`、`popClosed<T = unknown>()` 已存在；当前 JSON 损坏会抛错，需逐条跳过损坏记录而不是把异常变成空会话。 用户打开入口后应能看清当前目标；使用 Tab/Shift+Tab 到达控件、方向键在列表中移动、Enter 执行、Escape 取消并回到原焦点。空数据提供简短空状态；失败保留可重试入口，不把异常堆栈、凭据或完整私人数据放进 UI。正在编辑时广播不能覆盖输入；同一操作重复提交应幂等或禁用，关闭窗口、标签或切换导航时取消或忽略旧结果。所有 URL 再由主进程校验，发起远程加载仍经过 `Navigator.load` 和闸门，关闭或暂停时不得额外发请求。

```ts
// CaveCalls 增量；具体返回类型见本节契约
restoreSession(): void; discardSession(): void; setRestoreSession(enabled: boolean): void; reopenClosedTab(): void
// CaveEvents 无新增；ShellState / TabState 增量按上文契约。
// SurfaceName 增量：restoreSession
```

**i18n：**在 `src/shared/i18n/zh.ts` 与 `en.ts` 成对加入 `session_restore: '恢复会话' / 'Restore session'`；设置页专用字符串放对应 settings 词典。其余可见动作、错误、空状态和无障碍名称也需成对翻译，复用已有 `command_*` key；不要以英文或中文硬编码动态反馈。命令 id 与快捷键以本节上方列出的为准；新增命令按 `CommandSpec` 使用 `key`、必要时 `macKey`，无快捷键则省略两字段。未列新命令时无增量。

**浮层与持久化：**本节指定的浮层通过 `src/renderer/overlay.tsx` 的 `surfaces` 注册并以 `Surfaces.open/close` 管理；无新增时沿用现有视图。使用 `Surface` 定位，菜单用 `Menu`，选项列表用 `List`，确认使用 `Dialog`；这些组件按需要组合，不为本任务新造平行 overlay。数据库按上文仓库和迁移执行；未列新表或列即不迁移。所有仓库变更必须测试旧库升级和事务回滚。

**边界和验证：**检查两个窗口同时操作、目标标签中途关闭或导航、闸门关闭/暂停、私人信息不进入日志与无关窗口、顶部与侧栏布局，以及 macOS 和 Windows/Linux。单元测试放 `test/unit/`，覆盖本节的状态转换、非法参数、竞态与存储；运行 `npm test`。e2e 使用 `startWorld({ extra: ['--remote-debugging-port=0'] })`，以 `devtoolsPort(w.log)` 获取端口，`evaluate`/`click`/`waitFor` 针对 shell、overlay 与本地 fixture 断言；需要新服务器行为时扩展 `test/server.mjs`，并在结束调用 `w.stop()`。`click` 仅检查单个页面的命中，不证明原生窗口层级。macOS 人工实际点击入口、键盘操作、取消、切换标签与窗口，在顶部和侧栏各重做；记录结果与未验证的 Windows/Linux 项。

**验收与并行：**功能、空/错误状态、焦点、权限边界和上述测试均通过才完成；报告人工结果及限制。除 D2 审阅批准后的范围外，禁止改 gate、网络核心、fingerprint；L0 的字符串例外与本任务无关。与其他任务共享 `src/shared/ipc.ts`、`src/main/index.ts`、`shell/window.ts`、`overlay.tsx`、i18n 和迁移文件时使用隔离 worktree，按本文依赖顺序合并；后合入者重新协调类型、迁移版本并重跑测试，不以并行开发代替串行合并。
## M4 下载

- 行为：下载按钮打开进度气泡，显示名称、进度、暂停/继续、取消、完成后打开和在文件管理器中显示；持久下载列表可清记录，不删文件。退出中断后显示 interrupted，不伪装成可恢复；文件不存在时禁用打开并说明。下载由真实用户操作启动，危险文件遵守系统行为。
- 文件：`src/main/shell/{downloads,browser,window,commands}.ts`, `src/main/store/downloads.ts`, `src/main/index.ts`, `src/shared/{ipc,commands}.ts`、新增 `src/renderer/surfaces/downloads.tsx`、下载列表页及 i18n。`downloads.insert/update/list/remove`，启动时把未完成记录改为 interrupted；运行中 item 映射到持久 id，限制节流写入。
- 契约：`DownloadState` 加 `paused: boolean; started: number; ended: number | null; exists: boolean`；`CaveCalls.downloadAction(id: number, action: 'pause'|'resume'|'cancel'|'open'|'reveal'|'remove'): void; listDownloads(): DownloadState[]`；`SurfaceName` 加 `'downloads'`；无新事件（`state` 广播进度）。不接受 renderer 任意路径；打开/显示只用已登记记录。
- 命令 `downloads.open` 下载内容 / Downloads，macOS Cmd+Shift+J，Windows/Linux Ctrl+J。测试：单元测生命周期、重启和路径权限；e2e 本地 fixture 流式下载、暂停取消、持久记录和多窗口同步；人工验收系统打开/显示。验收：进度准确，文件缺失和重复取消不崩溃。


### 实施补充：接口与交互

现有 `Downloads.list` 仅保留 20 项，`track()` 的更新会写数据库；完整历史应从 `DownloadRepository.list(limit)` 分页或扩展查询，不能仅依赖该数组。 用户打开入口后应能看清当前目标；使用 Tab/Shift+Tab 到达控件、方向键在列表中移动、Enter 执行、Escape 取消并回到原焦点。空数据提供简短空状态；失败保留可重试入口，不把异常堆栈、凭据或完整私人数据放进 UI。正在编辑时广播不能覆盖输入；同一操作重复提交应幂等或禁用，关闭窗口、标签或切换导航时取消或忽略旧结果。所有 URL 再由主进程校验，发起远程加载仍经过 `Navigator.load` 和闸门，关闭或暂停时不得额外发请求。

```ts
// CaveCalls 增量；具体返回类型见本节契约
downloadAction(id: number, action: 'pause' | 'resume' | 'cancel' | 'open' | 'reveal' | 'remove'): void; listDownloads(): DownloadState[]
// CaveEvents 无新增；ShellState / TabState 增量按上文契约。
// SurfaceName 增量：downloads
```

**i18n：**在 `src/shared/i18n/zh.ts` 与 `en.ts` 成对加入 `downloads_empty: '没有下载记录' / 'No downloads'`；设置页专用字符串放对应 settings 词典。其余可见动作、错误、空状态和无障碍名称也需成对翻译，复用已有 `command_*` key；不要以英文或中文硬编码动态反馈。命令 id 与快捷键以本节上方列出的为准；新增命令按 `CommandSpec` 使用 `key`、必要时 `macKey`，无快捷键则省略两字段。未列新命令时无增量。

**浮层与持久化：**本节指定的浮层通过 `src/renderer/overlay.tsx` 的 `surfaces` 注册并以 `Surfaces.open/close` 管理；无新增时沿用现有视图。使用 `Surface` 定位，菜单用 `Menu`，选项列表用 `List`，确认使用 `Dialog`；这些组件按需要组合，不为本任务新造平行 overlay。数据库按上文仓库和迁移执行；未列新表或列即不迁移。所有仓库变更必须测试旧库升级和事务回滚。

**边界和验证：**检查两个窗口同时操作、目标标签中途关闭或导航、闸门关闭/暂停、私人信息不进入日志与无关窗口、顶部与侧栏布局，以及 macOS 和 Windows/Linux。单元测试放 `test/unit/`，覆盖本节的状态转换、非法参数、竞态与存储；运行 `npm test`。e2e 使用 `startWorld({ extra: ['--remote-debugging-port=0'] })`，以 `devtoolsPort(w.log)` 获取端口，`evaluate`/`click`/`waitFor` 针对 shell、overlay 与本地 fixture 断言；需要新服务器行为时扩展 `test/server.mjs`，并在结束调用 `w.stop()`。`click` 仅检查单个页面的命中，不证明原生窗口层级。macOS 人工实际点击入口、键盘操作、取消、切换标签与窗口，在顶部和侧栏各重做；记录结果与未验证的 Windows/Linux 项。

**验收与并行：**功能、空/错误状态、焦点、权限边界和上述测试均通过才完成；报告人工结果及限制。除 D2 审阅批准后的范围外，禁止改 gate、网络核心、fingerprint；L0 的字符串例外与本任务无关。与其他任务共享 `src/shared/ipc.ts`、`src/main/index.ts`、`shell/window.ts`、`overlay.tsx`、i18n 和迁移文件时使用隔离 worktree，按本文依赖顺序合并；后合入者重新协调类型、迁移版本并重跑测试，不以并行开发代替串行合并。
## M5 历史与清除数据

- 行为：历史页按时间展示、搜索、删除单项与时间范围；仅记录成功提交的 http/https 顶层访问，不记录内部页、失败、子框架；重定向记录最终地址，同文档导航去重，标题稍后更新。清除浏览数据可选择时间范围和历史、Cookie/站点数据、缓存、下载记录；明确不会删除下载文件与书签。
- 文件：`src/main/shell/{tab,browser,window,commands}.ts`, `src/main/store/{history,migrations,index}.ts`, `src/main/index.ts`, `src/shared/{ipc,commands}.ts`、新增 `src/renderer/history.tsx`、设置清理界面、i18n。迁移执行以下 SQL（迁移版本顺延，不重写 version 1），并在事务中接管现有 `visit`、删除和 FTS 聚合：

```sql
CREATE TABLE history_visits (id INTEGER PRIMARY KEY, url TEXT NOT NULL, visited INTEGER NOT NULL, typed INTEGER NOT NULL DEFAULT 0);
CREATE INDEX history_visits_time ON history_visits(visited);
CREATE INDEX history_visits_url ON history_visits(url);
INSERT INTO history_visits(url, visited, typed) SELECT url, last_visit, CASE WHEN typed > 0 THEN 1 ELSE 0 END FROM history;
```

事务维护 `history` 聚合与 FTS5，按范围删除 visit 后重算聚合，旧库只能把既有 `last_visit` 迁移为一个近似访问。清 Cookie 等必须使用 Electron 支持的时间范围；不支持精确范围的类型明确只提供“全部时间”，不得误称精确清除。
- 契约：`HistoryRow = { url: string; title: string; lastVisit: number; visits: number }`；`CaveCalls.historyList(query: string, before: number | null, limit: number): HistoryRow[]; historyDelete(urls: string[]): void; clearData(options: { from: number; to: number; history: boolean; siteData: boolean; cache: boolean; downloads: boolean }): void`；`TabState.kind` 加 `'history'`；无新增事件/浮层。输入限长、分页，站点数据清除后通知相关标签。
- 命令 `history.open` 历史记录 / History，macOS Cmd+Y，Windows/Linux Ctrl+H。测试：单元测多次访问的范围删除、FTS 同步与迁移；e2e 测记录规则、搜索、精确删除及清理后重启。验收：范围内删除不会丢掉范围外访问，网页记录不含内部 URL。


### 实施补充：接口与交互

`History.visit(url, title, typed, at = Date.now())` 目前只维护聚合；`removeRange(from,to)` 依 last_visit 删整条，因此精确区间必须迁移明细并重算。 用户打开入口后应能看清当前目标；使用 Tab/Shift+Tab 到达控件、方向键在列表中移动、Enter 执行、Escape 取消并回到原焦点。空数据提供简短空状态；失败保留可重试入口，不把异常堆栈、凭据或完整私人数据放进 UI。正在编辑时广播不能覆盖输入；同一操作重复提交应幂等或禁用，关闭窗口、标签或切换导航时取消或忽略旧结果。所有 URL 再由主进程校验，发起远程加载仍经过 `Navigator.load` 和闸门，关闭或暂停时不得额外发请求。

```ts
// CaveCalls 增量；具体返回类型见本节契约
historyList(query: string, before: number | null, limit: number): HistoryRow[]; historyDelete(urls: string[]): void; clearData(options: ClearDataOptions): void
// CaveEvents 无新增；ShellState / TabState 增量按上文契约。
// SurfaceName 增量：无
```

**i18n：**在 `src/shared/i18n/zh.ts` 与 `en.ts` 成对加入 `history_empty: '没有历史记录' / 'No history'`；设置页专用字符串放对应 settings 词典。其余可见动作、错误、空状态和无障碍名称也需成对翻译，复用已有 `command_*` key；不要以英文或中文硬编码动态反馈。命令 id 与快捷键以本节上方列出的为准；新增命令按 `CommandSpec` 使用 `key`、必要时 `macKey`，无快捷键则省略两字段。未列新命令时无增量。

**浮层与持久化：**本节指定的浮层通过 `src/renderer/overlay.tsx` 的 `surfaces` 注册并以 `Surfaces.open/close` 管理；无新增时沿用现有视图。使用 `Surface` 定位，菜单用 `Menu`，选项列表用 `List`，确认使用 `Dialog`；这些组件按需要组合，不为本任务新造平行 overlay。数据库按上文仓库和迁移执行；未列新表或列即不迁移。所有仓库变更必须测试旧库升级和事务回滚。

**边界和验证：**检查两个窗口同时操作、目标标签中途关闭或导航、闸门关闭/暂停、私人信息不进入日志与无关窗口、顶部与侧栏布局，以及 macOS 和 Windows/Linux。单元测试放 `test/unit/`，覆盖本节的状态转换、非法参数、竞态与存储；运行 `npm test`。e2e 使用 `startWorld({ extra: ['--remote-debugging-port=0'] })`，以 `devtoolsPort(w.log)` 获取端口，`evaluate`/`click`/`waitFor` 针对 shell、overlay 与本地 fixture 断言；需要新服务器行为时扩展 `test/server.mjs`，并在结束调用 `w.stop()`。`click` 仅检查单个页面的命中，不证明原生窗口层级。macOS 人工实际点击入口、键盘操作、取消、切换标签与窗口，在顶部和侧栏各重做；记录结果与未验证的 Windows/Linux 项。

**验收与并行：**功能、空/错误状态、焦点、权限边界和上述测试均通过才完成；报告人工结果及限制。除 D2 审阅批准后的范围外，禁止改 gate、网络核心、fingerprint；L0 的字符串例外与本任务无关。与其他任务共享 `src/shared/ipc.ts`、`src/main/index.ts`、`shell/window.ts`、`overlay.tsx`、i18n 和迁移文件时使用隔离 worktree，按本文依赖顺序合并；后合入者重新协调类型、迁移版本并重跑测试，不以并行开发代替串行合并。
## M6 书签

- 行为：地址栏星标添加/删除当前 URL；书签栏可开关，支持文件夹和排序；管理页增删改移动，导入书签导出 HTML，经系统文件选择器读取，不访问浏览器私有数据库。导入保留层次、去除不安全协议，显示数量及失败；重复 URL 允许存在，星标删除前明确处理所有匹配。
- 文件：`src/main/shell/{browser,window,commands}.ts`, `src/main/store/bookmarks.ts`, `src/shared/{ipc,commands}.ts`、新增 `src/main/shell/bookmark-import.ts`, `src/renderer/bookmarks.tsx` 和书签栏、编辑浮层、i18n。使用 `bookmarks` 的 `children/find/search/add/update/move/remove`；导入在事务中限文件大小、节点深度和数量，拒绝循环及 `javascript:`/`file:`。
- 契约：`Bookmark = { id: number; parent: number | null; position: number; kind: 'folder'|'link'; title: string; url: string | null }`；`CaveCalls.bookmarkChildren(parent: number | null): Bookmark[]; bookmarkAdd(parent: number | null, kind: 'folder'|'link', title: string, url: string | null): number; bookmarkUpdate(id: number, title: string, url: string | null): void; bookmarkMove(id: number, parent: number | null, position: number): void; bookmarkRemove(id: number): void; importBookmarks(): { added: number; skipped: number }`；`ShellState.bookmarked: boolean; bookmarkBar: boolean`；`SurfaceName` 加 `'bookmarkEdit'`；无新事件。路径不得由 renderer 指定。
- 命令 `bookmark.toggle` 添加或移除书签 / Bookmark This Page，Cmd/Ctrl+D；`bookmarks.open` 书签管理器 / Bookmark Manager，macOS Cmd+Option+B，Windows/Linux Ctrl+Shift+O；`bookmarks.bar` 显示书签栏 / Show Bookmarks Bar，Cmd/Ctrl+Shift+B。测试：单元测导入嵌套、恶意 URL、循环和事务；e2e 测星标、移动、重启与导入；人工测文件选择器。验收：多窗口同步，书签不会因清历史消失。


### 实施补充：接口与交互

现有 `Bookmarks.add(input: NewBookmark)`、`update(id, patch)`、`move(id,parent,position)` 已校验父目录及循环；调用者不要伪造不存在的位置参数或把 IPC 签名直接当仓库签名。 用户打开入口后应能看清当前目标；使用 Tab/Shift+Tab 到达控件、方向键在列表中移动、Enter 执行、Escape 取消并回到原焦点。空数据提供简短空状态；失败保留可重试入口，不把异常堆栈、凭据或完整私人数据放进 UI。正在编辑时广播不能覆盖输入；同一操作重复提交应幂等或禁用，关闭窗口、标签或切换导航时取消或忽略旧结果。所有 URL 再由主进程校验，发起远程加载仍经过 `Navigator.load` 和闸门，关闭或暂停时不得额外发请求。

```ts
// CaveCalls 增量；具体返回类型见本节契约
bookmarkChildren(parent: number | null): Bookmark[]; bookmarkAdd(parent: number | null, kind: Bookmark["kind"], title: string, url: string | null): number; bookmarkUpdate(id: number, title: string, url: string | null): void; bookmarkMove(id: number, parent: number | null, position: number): void; bookmarkRemove(id: number): void; importBookmarks(): { added: number; skipped: number }
// CaveEvents 无新增；ShellState / TabState 增量按上文契约。
// SurfaceName 增量：bookmarkEdit
```

**i18n：**在 `src/shared/i18n/zh.ts` 与 `en.ts` 成对加入 `bookmarks_empty: '没有书签' / 'No bookmarks'`；设置页专用字符串放对应 settings 词典。其余可见动作、错误、空状态和无障碍名称也需成对翻译，复用已有 `command_*` key；不要以英文或中文硬编码动态反馈。命令 id 与快捷键以本节上方列出的为准；新增命令按 `CommandSpec` 使用 `key`、必要时 `macKey`，无快捷键则省略两字段。未列新命令时无增量。

**浮层与持久化：**本节指定的浮层通过 `src/renderer/overlay.tsx` 的 `surfaces` 注册并以 `Surfaces.open/close` 管理；无新增时沿用现有视图。使用 `Surface` 定位，菜单用 `Menu`，选项列表用 `List`，确认使用 `Dialog`；这些组件按需要组合，不为本任务新造平行 overlay。数据库按上文仓库和迁移执行；未列新表或列即不迁移。所有仓库变更必须测试旧库升级和事务回滚。

**边界和验证：**检查两个窗口同时操作、目标标签中途关闭或导航、闸门关闭/暂停、私人信息不进入日志与无关窗口、顶部与侧栏布局，以及 macOS 和 Windows/Linux。单元测试放 `test/unit/`，覆盖本节的状态转换、非法参数、竞态与存储；运行 `npm test`。e2e 使用 `startWorld({ extra: ['--remote-debugging-port=0'] })`，以 `devtoolsPort(w.log)` 获取端口，`evaluate`/`click`/`waitFor` 针对 shell、overlay 与本地 fixture 断言；需要新服务器行为时扩展 `test/server.mjs`，并在结束调用 `w.stop()`。`click` 仅检查单个页面的命中，不证明原生窗口层级。macOS 人工实际点击入口、键盘操作、取消、切换标签与窗口，在顶部和侧栏各重做；记录结果与未验证的 Windows/Linux 项。

**验收与并行：**功能、空/错误状态、焦点、权限边界和上述测试均通过才完成；报告人工结果及限制。除 D2 审阅批准后的范围外，禁止改 gate、网络核心、fingerprint；L0 的字符串例外与本任务无关。与其他任务共享 `src/shared/ipc.ts`、`src/main/index.ts`、`shell/window.ts`、`overlay.tsx`、i18n 和迁移文件时使用隔离 worktree，按本文依赖顺序合并；后合入者重新协调类型、迁移版本并重跑测试，不以并行开发代替串行合并。
## M7 命令面板

- 行为：键入本地筛选命令、标签、历史与书签；支持键盘选择、Escape、结果为空及当前窗口作用域，选择标签可切窗口；不发远程建议。命令可用性与菜单一致。
- 文件：`src/main/shell/{browser,commands}.ts`, `src/shared/{ipc,commands}.ts`、新增 `src/renderer/surfaces/command-palette.tsx`、overlay 注册表和 i18n。依赖 B2、M4–M6，查询 `History.search`、`Bookmarks.search` 和内存标签。
- 契约：`PaletteItem = { kind: 'command'|'tab'|'history'|'bookmark'; id: string; title: string; detail?: string }`；`CaveCalls.paletteSearch(query: string): PaletteItem[]; paletteSelect(kind: PaletteItem['kind'], id: string): void`；`SurfaceName` 加 `'commandPalette'`；无新事件或状态字段。服务端重查并验证 id；限制数量、过滤过期结果。
- 命令 `palette.open` 命令面板 / Command Palette，Cmd/Ctrl+Shift+P。测试：单元测排序和无效 id；e2e 测搜索、执行、Escape 与焦点；人工测两个布局。验收：无鼠标可完成常用动作，关面板恢复焦点。


### 实施补充：接口与交互

`Browser.run(id, win)` 先关闭浮层再执行；仅由主进程从当前命令表和仓库重查结果，命令禁用状态与菜单一致，不能执行 renderer 伪造 id。 用户打开入口后应能看清当前目标；使用 Tab/Shift+Tab 到达控件、方向键在列表中移动、Enter 执行、Escape 取消并回到原焦点。空数据提供简短空状态；失败保留可重试入口，不把异常堆栈、凭据或完整私人数据放进 UI。正在编辑时广播不能覆盖输入；同一操作重复提交应幂等或禁用，关闭窗口、标签或切换导航时取消或忽略旧结果。所有 URL 再由主进程校验，发起远程加载仍经过 `Navigator.load` 和闸门，关闭或暂停时不得额外发请求。

```ts
// CaveCalls 增量；具体返回类型见本节契约
paletteSearch(query: string): PaletteItem[]; paletteSelect(kind: PaletteItem['kind'], id: string): void
// CaveEvents 无新增；ShellState / TabState 增量按上文契约。
// SurfaceName 增量：commandPalette
```

**i18n：**在 `src/shared/i18n/zh.ts` 与 `en.ts` 成对加入 `palette_empty: '没有结果' / 'No results'`；设置页专用字符串放对应 settings 词典。其余可见动作、错误、空状态和无障碍名称也需成对翻译，复用已有 `command_*` key；不要以英文或中文硬编码动态反馈。命令 id 与快捷键以本节上方列出的为准；新增命令按 `CommandSpec` 使用 `key`、必要时 `macKey`，无快捷键则省略两字段。未列新命令时无增量。

**浮层与持久化：**本节指定的浮层通过 `src/renderer/overlay.tsx` 的 `surfaces` 注册并以 `Surfaces.open/close` 管理；无新增时沿用现有视图。使用 `Surface` 定位，菜单用 `Menu`，选项列表用 `List`，确认使用 `Dialog`；这些组件按需要组合，不为本任务新造平行 overlay。数据库按上文仓库和迁移执行；未列新表或列即不迁移。所有仓库变更必须测试旧库升级和事务回滚。

**边界和验证：**检查两个窗口同时操作、目标标签中途关闭或导航、闸门关闭/暂停、私人信息不进入日志与无关窗口、顶部与侧栏布局，以及 macOS 和 Windows/Linux。单元测试放 `test/unit/`，覆盖本节的状态转换、非法参数、竞态与存储；运行 `npm test`。e2e 使用 `startWorld({ extra: ['--remote-debugging-port=0'] })`，以 `devtoolsPort(w.log)` 获取端口，`evaluate`/`click`/`waitFor` 针对 shell、overlay 与本地 fixture 断言；需要新服务器行为时扩展 `test/server.mjs`，并在结束调用 `w.stop()`。`click` 仅检查单个页面的命中，不证明原生窗口层级。macOS 人工实际点击入口、键盘操作、取消、切换标签与窗口，在顶部和侧栏各重做；记录结果与未验证的 Windows/Linux 项。

**验收与并行：**功能、空/错误状态、焦点、权限边界和上述测试均通过才完成；报告人工结果及限制。除 D2 审阅批准后的范围外，禁止改 gate、网络核心、fingerprint；L0 的字符串例外与本任务无关。与其他任务共享 `src/shared/ipc.ts`、`src/main/index.ts`、`shell/window.ts`、`overlay.tsx`、i18n 和迁移文件时使用隔离 worktree，按本文依赖顺序合并；后合入者重新协调类型、迁移版本并重跑测试，不以并行开发代替串行合并。
## M8 每站点设置

- 行为：按 origin 保存缩放与 B4 权限；设置页可查看、重置权限和缩放，清除此站点 Cookie、存储、缓存后重载关联标签；显示清除范围并确认。区分 scheme/port 的权限与 zoom，Cookie 的域范围按引擎能力说明，不能误删其他环境。
- 文件：`src/main/shell/{browser,window,tab,commands}.ts`, `src/main/permissions.ts`, `src/main/store/site-settings.ts`, `src/shared/ipc.ts`、设置页、i18n。`site_settings` key `zoom` 为有限范围数值，权限沿用 B4；调用 `all(origin: string)`、`delete(origin: string, key: string)`、`clearOrigin(origin: string)`。清理经现有会话 API，不改变网络。
- 契约：`SiteSettingsView = { origin: string; zoom: number; permissions: Partial<Record<Permission, 'allow'|'deny'>> }`；`CaveCalls.siteSettings(origin: string): SiteSettingsView; resetSiteSetting(origin: string, key: string): void; clearSiteData(origin: string): void`；`ShellState` 无新增，复用 `clearSite` 或替换时同步所有调用；无新事件、命令或浮层。主进程只允许当前窗口最近 web 标签的 origin，清理前确认。
- 测试：单元测 origin 隔离、非法 key、缩放边界；e2e 测重启持久、权限重置及两站点清除隔离。验收：缩放在同 origin 标签一致，站点数据清除不清书签/历史。

### 实施补充：接口与交互

`SiteSettings.get<T>(origin,key,fallback)`、`set(origin,key,value)`、`delete(origin,key)`、`all(origin)`、`clearOrigin(origin)` 已实现。现有 `clearSite(url)` 直接取 origin，应核验调用窗口归属。 用户打开入口后应能看清当前目标；使用 Tab/Shift+Tab 到达控件、方向键在列表中移动、Enter 执行、Escape 取消并回到原焦点。空数据提供简短空状态；失败保留可重试入口，不把异常堆栈、凭据或完整私人数据放进 UI。正在编辑时广播不能覆盖输入；同一操作重复提交应幂等或禁用，关闭窗口、标签或切换导航时取消或忽略旧结果。所有 URL 再由主进程校验，发起远程加载仍经过 `Navigator.load` 和闸门，关闭或暂停时不得额外发请求。

```ts
// CaveCalls 增量；具体返回类型见本节契约
siteSettings(origin: string): SiteSettingsView; resetSiteSetting(origin: string, key: string): void; clearSiteData(origin: string): void
// CaveEvents 无新增；ShellState / TabState 增量按上文契约。
// SurfaceName 增量：无
```

**i18n：**在 `src/shared/i18n/zh.ts` 与 `en.ts` 成对加入 `site_reset: '重置' / 'Reset'`；设置页专用字符串放对应 settings 词典。其余可见动作、错误、空状态和无障碍名称也需成对翻译，复用已有 `command_*` key；不要以英文或中文硬编码动态反馈。命令 id 与快捷键以本节上方列出的为准；新增命令按 `CommandSpec` 使用 `key`、必要时 `macKey`，无快捷键则省略两字段。未列新命令时无增量。

**浮层与持久化：**本节指定的浮层通过 `src/renderer/overlay.tsx` 的 `surfaces` 注册并以 `Surfaces.open/close` 管理；无新增时沿用现有视图。使用 `Surface` 定位，菜单用 `Menu`，选项列表用 `List`，确认使用 `Dialog`；这些组件按需要组合，不为本任务新造平行 overlay。数据库按上文仓库和迁移执行；未列新表或列即不迁移。所有仓库变更必须测试旧库升级和事务回滚。

**边界和验证：**检查两个窗口同时操作、目标标签中途关闭或导航、闸门关闭/暂停、私人信息不进入日志与无关窗口、顶部与侧栏布局，以及 macOS 和 Windows/Linux。单元测试放 `test/unit/`，覆盖本节的状态转换、非法参数、竞态与存储；运行 `npm test`。e2e 使用 `startWorld({ extra: ['--remote-debugging-port=0'] })`，以 `devtoolsPort(w.log)` 获取端口，`evaluate`/`click`/`waitFor` 针对 shell、overlay 与本地 fixture 断言；需要新服务器行为时扩展 `test/server.mjs`，并在结束调用 `w.stop()`。`click` 仅检查单个页面的命中，不证明原生窗口层级。macOS 人工实际点击入口、键盘操作、取消、切换标签与窗口，在顶部和侧栏各重做；记录结果与未验证的 Windows/Linux 项。

**验收与并行：**功能、空/错误状态、焦点、权限边界和上述测试均通过才完成；报告人工结果及限制。除 D2 审阅批准后的范围外，禁止改 gate、网络核心、fingerprint；L0 的字符串例外与本任务无关。与其他任务共享 `src/shared/ipc.ts`、`src/main/index.ts`、`shell/window.ts`、`overlay.tsx`、i18n 和迁移文件时使用隔离 worktree，按本文依赖顺序合并；后合入者重新协调类型、迁移版本并重跑测试，不以并行开发代替串行合并。
