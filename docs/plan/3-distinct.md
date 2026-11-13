# 3. 特色期

## 待定

- 容器路由架构须主人审阅：建议每容器独立内核进程、本机 SOCKS 入口、控制器、闸门和持久 session；不要在进程级 `--proxy-server` 上假设 session 代理能安全覆盖。必须先验证 Electron 启动参数与 session 代理优先级和所有流量路径，不能证明失败关闭就不实现。
- 容器删除建议默认保留数据并要求明确二次确认才清除；主人确认具体交互。

## 概览与依赖图

```text
B4 + M8 + gate 状态 → D1 站点信息
M2 + M3 + M8 + D1 → 主人审阅设计和泄漏测试 → D2 容器
```

D1 和 D2 不在同一 checkout 并行：均改会话、窗口和 IPC。D1 不修改网络核心；D2 是整个计划唯一允许修改 `gate.ts`、core config、fingerprint 的任务，但**编码前须主人明确审阅并批准完整设计与测试计划**。每项也遵守 [总约定](README.md)。

## D1 站点信息

- 行为：地址栏安全指示打开站点信息 panel，显示当前 origin、连接安全状态、此站点实际使用的已核对出口节点及国家、Cookie/存储摘要、B4 权限及 M8 清除数据。HTTP 标为不安全；TLS 信息不可确认时显示未知；闸门关闭或尚未核对时不得沿用旧国家冒充当前状态。内部页不显示网站信息。
- 文件：`src/main/shell/{browser,window,tab,surfaces}.ts`, `src/main/store/site-settings.ts`, `src/shared/ipc.ts`、新增 `src/renderer/surfaces/site-info.tsx`、overlay 注册表和 i18n。只读当前已存在 gate view、当前 session 的 cookie/storage 能力和 `SiteSettings.all`；不发网络探测，不更改 `gate.ts`、proxy config 或 fingerprint。
- 契约：`SiteInfo = { origin: string; security: 'secure'|'insecure'|'unknown'; node: string | null; country: string | null; gate: 'open'|'closed'|'checking'|'paused'; cookieCount: number | null; storageKnown: boolean; permissions: Partial<Record<Permission, 'allow'|'deny'>> }`；`CaveCalls.siteInfo(): SiteInfo`；`SurfaceName` 加 `'siteInfo'`；`ShellState` 和 `CaveEvents` 无新增。清除复用 M8，服务端绑定当前标签 origin；查询结果用导航代次防止切页后显示旧数据。无新命令/快捷键。
- 测试：单元测安全状态、未知出口和旧响应；e2e 测 HTTP/HTTPS、闸门关闭、跨标签及清除隔离。macOS 手测定位和焦点。验收：出口只在真实核对有效时展示，不能通过 panel 改变闸门或泄露另一站点信息。


### 实施补充：接口与交互

`ShellState.site` 是最近显示过的网页 origin，不一定是当前活动网页；打开 panel 必须重新绑定活动 tab、origin 与导航代次，不能把设置页的旧 site 当当前网站。 用户打开入口后应能看清当前目标；使用 Tab/Shift+Tab 到达控件、方向键在列表中移动、Enter 执行、Escape 取消并回到原焦点。空数据提供简短空状态；失败保留可重试入口，不把异常堆栈、凭据或完整私人数据放进 UI。正在编辑时广播不能覆盖输入；同一操作重复提交应幂等或禁用，关闭窗口、标签或切换导航时取消或忽略旧结果。所有 URL 再由主进程校验，发起远程加载仍经过 `Navigator.load` 和闸门，关闭或暂停时不得额外发请求。

```ts
// CaveCalls 增量；具体返回类型见本节契约
siteInfo(): SiteInfo
// CaveEvents 无新增；ShellState / TabState 增量按上文契约。
// SurfaceName 增量：siteInfo
```

**i18n：**在 `src/shared/i18n/zh.ts` 与 `en.ts` 成对加入 `site_security_unknown: '连接状态未知' / 'Connection status unknown'`；设置页专用字符串放对应 settings 词典。其余可见动作、错误、空状态和无障碍名称也需成对翻译，复用已有 `command_*` key；不要以英文或中文硬编码动态反馈。命令 id 与快捷键以本节上方列出的为准；新增命令按 `CommandSpec` 使用 `key`、必要时 `macKey`，无快捷键则省略两字段。未列新命令时无增量。

**浮层与持久化：**本节指定的浮层通过 `src/renderer/overlay.tsx` 的 `surfaces` 注册并以 `Surfaces.open/close` 管理；无新增时沿用现有视图。使用 `Surface` 定位，菜单用 `Menu`，选项列表用 `List`，确认使用 `Dialog`；这些组件按需要组合，不为本任务新造平行 overlay。数据库按上文仓库和迁移执行；未列新表或列即不迁移。所有仓库变更必须测试旧库升级和事务回滚。

**边界和验证：**检查两个窗口同时操作、目标标签中途关闭或导航、闸门关闭/暂停、私人信息不进入日志与无关窗口、顶部与侧栏布局，以及 macOS 和 Windows/Linux。单元测试放 `test/unit/`，覆盖本节的状态转换、非法参数、竞态与存储；运行 `npm test`。e2e 使用 `startWorld({ extra: ['--remote-debugging-port=0'] })`，以 `devtoolsPort(w.log)` 获取端口，`evaluate`/`click`/`waitFor` 针对 shell、overlay 与本地 fixture 断言；需要新服务器行为时扩展 `test/server.mjs`，并在结束调用 `w.stop()`。`click` 仅检查单个页面的命中，不证明原生窗口层级。macOS 人工实际点击入口、键盘操作、取消、切换标签与窗口，在顶部和侧栏各重做；记录结果与未验证的 Windows/Linux 项。

**验收与并行：**功能、空/错误状态、焦点、权限边界和上述测试均通过才完成；报告人工结果及限制。除 D2 审阅批准后的范围外，禁止改 gate、网络核心、fingerprint；L0 的字符串例外与本任务无关。与其他任务共享 `src/shared/ipc.ts`、`src/main/index.ts`、`shell/window.ts`、`overlay.tsx`、i18n 和迁移文件时使用隔离 worktree，按本文依赖顺序合并；后合入者重新协调类型、迁移版本并重跑测试，不以并行开发代替串行合并。
## D2 多环境容器（先审阅，再编码）

- 行为：创建、命名、着色、选择和删除容器；每个容器是独立持久 partition、profile/指纹配置、节点及闸门。标签显示容器色，打开/复制/恢复始终保留容器；跨容器打开必须明确选择。相同站点的 Cookie、storage、权限、缩放、历史、缓存与服务工作线程不得串通；暂停或某容器失败只关闭该容器，其他容器不受影响。删除活动容器先关闭关联标签并确认数据处理；禁止最后容器消失。
- 审阅交付：先写可执行的设计补充到本文件：每层代理优先级、进程和端口所有权、启动/退出、崩溃、节点轮换、迁移/回滚、证据与残余风险；明确 Electron 是否允许逐 session 可靠代理、DNS 与 WebRTC 行为。主人批准后才改代码；不可证明隔离就停止并报告，不用直接连接兜底。
- 文件：`src/main/{index,network,gate,fingerprint,permissions,profile}.ts`, `src/main/proxy/{config,process,controller}.ts`, `src/main/shell/{browser,window,tab,navigation}.ts`, `src/main/store/{migrations,site-settings,history,sessions}.ts`, `src/shared/{ipc,profile}.ts`、设置、标签组件、容器选择浮层和 i18n。新增 `src/main/containers.ts` 管理生命周期。设计审批时提交逐版本 SQL；容器表至少为 `CREATE TABLE containers (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, profile TEXT NOT NULL, partition TEXT NOT NULL UNIQUE);`。`site_settings` 的复合主键、历史 URL 唯一约束及 FTS 需要重建而非简单加列；favicon、会话也需按最终已合入 schema 给出完整建表、复制、索引和原子替换 SQL，审阅批准前不得假定迁移已定；原数据事务迁到默认容器，旧 profile、partition 和节点保留，迁移前备份，可回滚。
- 网络方案：每个容器在创建任何页面前建立专属随机 loopback SOCKS 和验证入口；关闭态配置仅 REJECT，独立进程和控制器随机密钥；先为该 partition 配好强制代理、禁本地 DNS/QUIC/非代理 UDP、权限和 fingerprint，再允许创建 webContents。节点变更先关闸、断旧连接、替换路由、经该容器专用验证入口核对国家，成功才放行。任何启动/验证/内核退出/控制器故障都原子关闭对应入口，清理所有待导航和连接；不能在新旧身份之间短暂沿用旧放行。DNS、Service Worker、WebSocket、下载、认证、更新和预连接都必须明确归属；应用更新仍经明确选定的已放行路线，不复用一个不可信网页的网络上下文。禁止 DIRECT 和 session 默认回退。
- 契约：`Container = { id: string; name: string; color: string; partition: string; gate: GateView }`；`TabState.containerId: string`；`ShellState.containers: Container[]; activeContainerId: string`；`CaveCalls.createContainer(name: string, color: string): string; updateContainer(id: string, patch: { name?: string; color?: string }): void; deleteContainer(id: string, clearData: boolean): void; newTabInContainer(id: string, url?: string): void; selectContainerNode(id: string, node: string): void`；`SurfaceName` 加 `'containerPicker'`；无新事件，容器状态通过 `state` 广播。所有 id 主进程验证；partition 不能由 renderer 指定；不暴露 secret。命令 `container.new` 新建环境 / New Container，无快捷键；`container.choose` 选择环境 / Choose Container，无快捷键。
- 泄漏测试：单元覆盖每容器 gate 状态机、配置无 DIRECT、身份绑定及迁移中断；e2e 用两个独立本地 SOCKS 节点和不同 trace，捕获每个目标及 DNS，分别测试同 origin Cookie/IndexedDB/Service Worker、指纹、下载和权限隔离；同时杀掉一个内核、国家不符、暂停/恢复、切节点、启动竞态、重启恢复和更新请求，断言该容器零外发、另一容器仍走自己的节点。用现有 Linux strace 及 macOS/Windows 实机网络抓包核对 TCP/UDP/DNS、IPv6、WebRTC、进程崩溃/强杀和宿主 TUN；CDP 测试不足以证明没有泄漏。
- 验收：主人先批准设计；自动测试与两平台抓包均通过，失败关闭可复现，迁移/回滚保留原数据；无法证明任何一项时不交付。无其他任务可并行修改网络、session 或存储迁移。

### 实施补充：接口与交互

`browserSession()` 目前是共享会话，`Tab.web(prepare, adopt?)` 固定使用它；仅修改标签颜色不能实现隔离。先形成可审阅设计，主人明确批准后才能编码。 用户打开入口后应能看清当前目标；使用 Tab/Shift+Tab 到达控件、方向键在列表中移动、Enter 执行、Escape 取消并回到原焦点。空数据提供简短空状态；失败保留可重试入口，不把异常堆栈、凭据或完整私人数据放进 UI。正在编辑时广播不能覆盖输入；同一操作重复提交应幂等或禁用，关闭窗口、标签或切换导航时取消或忽略旧结果。所有 URL 再由主进程校验，发起远程加载仍经过 `Navigator.load` 和闸门，关闭或暂停时不得额外发请求。

```ts
// CaveCalls 增量；具体返回类型见本节契约
createContainer(name: string, color: string): string; updateContainer(id: string, patch: { name?: string; color?: string }): void; deleteContainer(id: string, clearData: boolean): void; newTabInContainer(id: string, url?: string): void; selectContainerNode(id: string, node: string): void
// CaveEvents 无新增；ShellState / TabState 增量按上文契约。
// SurfaceName 增量：containerPicker
```

**i18n：**在 `src/shared/i18n/zh.ts` 与 `en.ts` 成对加入 `container_new: '新建环境' / 'New Container'`；设置页专用字符串放对应 settings 词典。其余可见动作、错误、空状态和无障碍名称也需成对翻译，复用已有 `command_*` key；不要以英文或中文硬编码动态反馈。命令 id 与快捷键以本节上方列出的为准；新增命令按 `CommandSpec` 使用 `key`、必要时 `macKey`，无快捷键则省略两字段。未列新命令时无增量。

**浮层与持久化：**本节指定的浮层通过 `src/renderer/overlay.tsx` 的 `surfaces` 注册并以 `Surfaces.open/close` 管理；无新增时沿用现有视图。使用 `Surface` 定位，菜单用 `Menu`，选项列表用 `List`，确认使用 `Dialog`；这些组件按需要组合，不为本任务新造平行 overlay。数据库按上文仓库和迁移执行；未列新表或列即不迁移。所有仓库变更必须测试旧库升级和事务回滚。

**边界和验证：**检查两个窗口同时操作、目标标签中途关闭或导航、闸门关闭/暂停、私人信息不进入日志与无关窗口、顶部与侧栏布局，以及 macOS 和 Windows/Linux。单元测试放 `test/unit/`，覆盖本节的状态转换、非法参数、竞态与存储；运行 `npm test`。e2e 使用 `startWorld({ extra: ['--remote-debugging-port=0'] })`，以 `devtoolsPort(w.log)` 获取端口，`evaluate`/`click`/`waitFor` 针对 shell、overlay 与本地 fixture 断言；需要新服务器行为时扩展 `test/server.mjs`，并在结束调用 `w.stop()`。`click` 仅检查单个页面的命中，不证明原生窗口层级。macOS 人工实际点击入口、键盘操作、取消、切换标签与窗口，在顶部和侧栏各重做；记录结果与未验证的 Windows/Linux 项。

**验收与并行：**功能、空/错误状态、焦点、权限边界和上述测试均通过才完成；报告人工结果及限制。除 D2 审阅批准后的范围外，禁止改 gate、网络核心、fingerprint；L0 的字符串例外与本任务无关。与其他任务共享 `src/shared/ipc.ts`、`src/main/index.ts`、`shell/window.ts`、`overlay.tsx`、i18n 和迁移文件时使用隔离 worktree，按本文依赖顺序合并；后合入者重新协调类型、迁移版本并重跑测试，不以并行开发代替串行合并。
