# 4. 发布期

## 待定

- 更新源和签名密钥托管：建议专用 HTTPS 发布域、离线保管代码签名私钥、CI 短期凭据；主人确定域名、证书与密钥管理后实施。
- 崩溃报告：建议默认不上传，提供用户主动导出并审阅的本地诊断；主人确认是否需要自托管、明确同意的可选上报。
- CI 三平台矩阵已决定延期到功能稳定后的 R4；平台 runner 和预算由主人确定。

## 概览与依赖图

```text
功能稳定 → R1 安装器 → R2 签名与公证 → R3 闸门内更新 → R4 CI 矩阵与发布
```

签名和自动更新最后做；R1 可与功能开发并行调研，但共享 package/build 文件串行。R2–R4 串行；证书及发布凭据只在授权环境使用，不写入仓库。每任务遵守 [总约定](README.md)，不能修改 gate、核心配置或 fingerprint；如果证明更新无法安全经 gate，停止并报告，不能增加直连例外。发布、签名服务和生产凭据须按实际授权执行。

## R1 三平台安装器

- 行为：macOS arm64/x64 DMG 和 zip，Windows x64 NSIS 和 zip，Linux x64 AppImage 和 tar.gz；安装、卸载、升级保留 profile，启动正常，包附带正确架构内核、LICENSE 和 NOTICE。Linux 支持运行与打包，不承诺平台专属体验。
- 文件：`package.json`, `scripts/build.mjs`, `scripts/fetch-core.mjs`、新增 `scripts/verify-package.mjs`、打包资源和 `docs/MANUAL_TESTS.md`；不改功能 UI。复用现有固定版本、SHA256 校验。IPC、事件、ShellState、数据库、命令、浮层均无新增。
- 测试：单元测包内容/架构和缺失内核失败；e2e 对包设置 `CAVE_APP` 用 `startWorld`/CDP 本地 fixture 验证启动和闸门；人工在 macOS、Windows 安装/升级/卸载，Linux 启动。验收：产物可复现地包含许可及正确二进制，卸载不静默删除 profile。


### 实施补充：接口与交互

`package.json` 已配置 electron-builder 三平台目标和架构资源；检查实际产物而非假定现有打包脚本尚不存在。 用户打开入口后应能看清当前目标；使用 Tab/Shift+Tab 到达控件、方向键在列表中移动、Enter 执行、Escape 取消并回到原焦点。空数据提供简短空状态；失败保留可重试入口，不把异常堆栈、凭据或完整私人数据放进 UI。正在编辑时广播不能覆盖输入；同一操作重复提交应幂等或禁用，关闭窗口、标签或切换导航时取消或忽略旧结果。所有 URL 再由主进程校验，发起远程加载仍经过 `Navigator.load` 和闸门，关闭或暂停时不得额外发请求。

```ts
// 无新增 CaveCalls、CaveEvents、ShellState、TabState 或 SurfaceName。
```

**i18n：**在 `src/shared/i18n/zh.ts` 与 `en.ts` 成对加入 `installer_error: '安装包校验失败' / 'Package verification failed'`；设置页专用字符串放对应 settings 词典。其余可见动作、错误、空状态和无障碍名称也需成对翻译，复用已有 `command_*` key；不要以英文或中文硬编码动态反馈。命令 id 与快捷键以本节上方列出的为准；新增命令按 `CommandSpec` 使用 `key`、必要时 `macKey`，无快捷键则省略两字段。未列新命令时无增量。

**浮层与持久化：**本节指定的浮层通过 `src/renderer/overlay.tsx` 的 `surfaces` 注册并以 `Surfaces.open/close` 管理；无新增时沿用现有视图。使用 `Surface` 定位，菜单用 `Menu`，选项列表用 `List`，确认使用 `Dialog`；这些组件按需要组合，不为本任务新造平行 overlay。数据库按上文仓库和迁移执行；未列新表或列即不迁移。所有仓库变更必须测试旧库升级和事务回滚。

**边界和验证：**检查两个窗口同时操作、目标标签中途关闭或导航、闸门关闭/暂停、私人信息不进入日志与无关窗口、顶部与侧栏布局，以及 macOS 和 Windows/Linux。单元测试放 `test/unit/`，覆盖本节的状态转换、非法参数、竞态与存储；运行 `npm test`。e2e 使用 `startWorld({ extra: ['--remote-debugging-port=0'] })`，以 `devtoolsPort(w.log)` 获取端口，`evaluate`/`click`/`waitFor` 针对 shell、overlay 与本地 fixture 断言；需要新服务器行为时扩展 `test/server.mjs`，并在结束调用 `w.stop()`。`click` 仅检查单个页面的命中，不证明原生窗口层级。macOS 人工实际点击入口、键盘操作、取消、切换标签与窗口，在顶部和侧栏各重做；记录结果与未验证的 Windows/Linux 项。

**验收与并行：**功能、空/错误状态、焦点、权限边界和上述测试均通过才完成；报告人工结果及限制。除 D2 审阅批准后的范围外，禁止改 gate、网络核心、fingerprint；L0 的字符串例外与本任务无关。与其他任务共享 `src/shared/ipc.ts`、`src/main/index.ts`、`shell/window.ts`、`overlay.tsx`、i18n 和迁移文件时使用隔离 worktree，按本文依赖顺序合并；后合入者重新协调类型、迁移版本并重跑测试，不以并行开发代替串行合并。
## R2 macOS 与 Windows 签名

- 行为：macOS Developer ID、hardened runtime、合适 entitlement、notarization 和 staple；验证内核子进程、WebAuthn、摄像头/麦克风所需权限仍有效。Windows 用受信代码签名证书及时间戳签署安装器和可执行文件；无证书时构建明确失败，不能把 ad-hoc 当正式签名。
- 文件：`package.json`, 新增 `build/entitlements.mac.plist`、`scripts/verify-signatures.mjs`，更新打包脚本和 `docs/MANUAL_TESTS.md`。IPC、事件、ShellState、数据库、命令、浮层均无新增；不改网络核心。
- 测试：单元测配置缺失及签名验证命令失败；对签名包用 `startWorld`/CDP 跑本地 e2e，macOS `codesign`/`spctl`/stapler 和 Windows 签名验证及干净机器安装、WebAuthn 手测。验收：每个嵌套可执行文件及安装器可验证，公证完成，秘钥不在日志或产物。


### 实施补充：接口与交互

当前 mac 配置 `identity: "-"` 且 `hardenedRuntime: false`；正式签名流程必须显式覆盖并验证嵌套 core，不能将开发包误标为发布包。 用户打开入口后应能看清当前目标；使用 Tab/Shift+Tab 到达控件、方向键在列表中移动、Enter 执行、Escape 取消并回到原焦点。空数据提供简短空状态；失败保留可重试入口，不把异常堆栈、凭据或完整私人数据放进 UI。正在编辑时广播不能覆盖输入；同一操作重复提交应幂等或禁用，关闭窗口、标签或切换导航时取消或忽略旧结果。所有 URL 再由主进程校验，发起远程加载仍经过 `Navigator.load` 和闸门，关闭或暂停时不得额外发请求。

```ts
// 无新增 CaveCalls、CaveEvents、ShellState、TabState 或 SurfaceName。
```

**i18n：**在 `src/shared/i18n/zh.ts` 与 `en.ts` 成对加入 `signing_error: '签名验证失败' / 'Signature verification failed'`；设置页专用字符串放对应 settings 词典。其余可见动作、错误、空状态和无障碍名称也需成对翻译，复用已有 `command_*` key；不要以英文或中文硬编码动态反馈。命令 id 与快捷键以本节上方列出的为准；新增命令按 `CommandSpec` 使用 `key`、必要时 `macKey`，无快捷键则省略两字段。未列新命令时无增量。

**浮层与持久化：**本节指定的浮层通过 `src/renderer/overlay.tsx` 的 `surfaces` 注册并以 `Surfaces.open/close` 管理；无新增时沿用现有视图。使用 `Surface` 定位，菜单用 `Menu`，选项列表用 `List`，确认使用 `Dialog`；这些组件按需要组合，不为本任务新造平行 overlay。数据库按上文仓库和迁移执行；未列新表或列即不迁移。所有仓库变更必须测试旧库升级和事务回滚。

**边界和验证：**检查两个窗口同时操作、目标标签中途关闭或导航、闸门关闭/暂停、私人信息不进入日志与无关窗口、顶部与侧栏布局，以及 macOS 和 Windows/Linux。单元测试放 `test/unit/`，覆盖本节的状态转换、非法参数、竞态与存储；运行 `npm test`。e2e 使用 `startWorld({ extra: ['--remote-debugging-port=0'] })`，以 `devtoolsPort(w.log)` 获取端口，`evaluate`/`click`/`waitFor` 针对 shell、overlay 与本地 fixture 断言；需要新服务器行为时扩展 `test/server.mjs`，并在结束调用 `w.stop()`。`click` 仅检查单个页面的命中，不证明原生窗口层级。macOS 人工实际点击入口、键盘操作、取消、切换标签与窗口，在顶部和侧栏各重做；记录结果与未验证的 Windows/Linux 项。

**验收与并行：**功能、空/错误状态、焦点、权限边界和上述测试均通过才完成；报告人工结果及限制。除 D2 审阅批准后的范围外，禁止改 gate、网络核心、fingerprint；L0 的字符串例外与本任务无关。与其他任务共享 `src/shared/ipc.ts`、`src/main/index.ts`、`shell/window.ts`、`overlay.tsx`、i18n 和迁移文件时使用隔离 worktree，按本文依赖顺序合并；后合入者重新协调类型、迁移版本并重跑测试，不以并行开发代替串行合并。
## R3 自动更新

- 行为：用户可检查更新，展示版本、下载进度、准备好后由用户选择重启；默认只检查稳定通道，允许稍后，不强制中断。闸门关闭不检查或下载，失败有可重试状态。更新元数据、重定向和所有包字节均经明确已放行的代理路线；验证签名和校验和，拒绝降级、跨域不受信重定向与损坏包；保留当前版本及 profile，失败可继续运行。
- 文件：新增 `src/main/update.ts`, `src/main/shell/update.ts`, `src/renderer/surfaces/update.tsx`；修改 `src/main/index.ts`, `src/shared/{ipc,commands}.ts`, overlay 注册表、设置页、i18n、`package.json` 和发布配置。可选 electron-updater，先证明其 HTTP 栈可强制指定代理且无法直连；否则实现使用受控 session/代理的等价下载，不以全局系统代理作为证明。验证安装器平台签名；无网络核心改动。`prefs` 存 `update.channel: 'stable'` 和最后用户选择，不存令牌。
- 契约：`UpdateState = { phase: 'idle'|'checking'|'available'|'downloading'|'ready'|'error'|'blocked'; version: string | null; received: number; total: number; error: string | null }`；`ShellState.update: UpdateState`；`CaveCalls.checkUpdate(): void; downloadUpdate(): void; installUpdate(): void`；`SurfaceName` 加 `'update'`；无新增事件（state 广播）。安装需要明确用户动作并处理 beforeunload；请求不能接受任意 URL。
- 命令 `update.check` 检查更新 / Check for Updates，无快捷键。单元测签名/校验、状态机、重定向和关闭态；e2e 本地 SOCKS/fixture 模拟更新元数据、字节、失败和 gate 关闭，检查目标列表及重启；macOS/Windows 签名版本实机升级/回滚。验收：抓包证明检查和下载均经节点，闸门关闭零外发，损坏或未签名包绝不安装。


### 实施补充：接口与交互

`BrowserOptions.canBrowse()` 反映 gate 当前状态；更新每一阶段都要重新验证，闸门中途关闭则停止传输并清理部分文件，不能使用直连作为退路。 用户打开入口后应能看清当前目标；使用 Tab/Shift+Tab 到达控件、方向键在列表中移动、Enter 执行、Escape 取消并回到原焦点。空数据提供简短空状态；失败保留可重试入口，不把异常堆栈、凭据或完整私人数据放进 UI。正在编辑时广播不能覆盖输入；同一操作重复提交应幂等或禁用，关闭窗口、标签或切换导航时取消或忽略旧结果。所有 URL 再由主进程校验，发起远程加载仍经过 `Navigator.load` 和闸门，关闭或暂停时不得额外发请求。

```ts
// CaveCalls 增量；具体返回类型见本节契约
checkUpdate(): void; downloadUpdate(): void; installUpdate(): void
// CaveEvents 无新增；ShellState / TabState 增量按上文契约。
// SurfaceName 增量：update
```

**i18n：**在 `src/shared/i18n/zh.ts` 与 `en.ts` 成对加入 `update_blocked: '网络未放行' / 'Network access blocked'`；设置页专用字符串放对应 settings 词典。其余可见动作、错误、空状态和无障碍名称也需成对翻译，复用已有 `command_*` key；不要以英文或中文硬编码动态反馈。命令 id 与快捷键以本节上方列出的为准；新增命令按 `CommandSpec` 使用 `key`、必要时 `macKey`，无快捷键则省略两字段。未列新命令时无增量。

**浮层与持久化：**本节指定的浮层通过 `src/renderer/overlay.tsx` 的 `surfaces` 注册并以 `Surfaces.open/close` 管理；无新增时沿用现有视图。使用 `Surface` 定位，菜单用 `Menu`，选项列表用 `List`，确认使用 `Dialog`；这些组件按需要组合，不为本任务新造平行 overlay。数据库按上文仓库和迁移执行；未列新表或列即不迁移。所有仓库变更必须测试旧库升级和事务回滚。

**边界和验证：**检查两个窗口同时操作、目标标签中途关闭或导航、闸门关闭/暂停、私人信息不进入日志与无关窗口、顶部与侧栏布局，以及 macOS 和 Windows/Linux。单元测试放 `test/unit/`，覆盖本节的状态转换、非法参数、竞态与存储；运行 `npm test`。e2e 使用 `startWorld({ extra: ['--remote-debugging-port=0'] })`，以 `devtoolsPort(w.log)` 获取端口，`evaluate`/`click`/`waitFor` 针对 shell、overlay 与本地 fixture 断言；需要新服务器行为时扩展 `test/server.mjs`，并在结束调用 `w.stop()`。`click` 仅检查单个页面的命中，不证明原生窗口层级。macOS 人工实际点击入口、键盘操作、取消、切换标签与窗口，在顶部和侧栏各重做；记录结果与未验证的 Windows/Linux 项。

**验收与并行：**功能、空/错误状态、焦点、权限边界和上述测试均通过才完成；报告人工结果及限制。除 D2 审阅批准后的范围外，禁止改 gate、网络核心、fingerprint；L0 的字符串例外与本任务无关。与其他任务共享 `src/shared/ipc.ts`、`src/main/index.ts`、`shell/window.ts`、`overlay.tsx`、i18n 和迁移文件时使用隔离 worktree，按本文依赖顺序合并；后合入者重新协调类型、迁移版本并重跑测试，不以并行开发代替串行合并。
## R4 CI、隐私与发布

- 行为：三平台 CI 构建、`npm test`、本地 fixture e2e、打包和许可证校验；平台不能自动验证的真实点击、签名及系统授权写为手工门槛。默认无崩溃上传；可选本地诊断不含 Cookie、认证、完整 URL、节点秘密或网页内容，用户查看后自行分享。
- 文件：新增 `.github/workflows/release.yml`，更新 `.github/workflows/` 既有 CI、`scripts/verify-package.mjs`, `docs/MANUAL_TESTS.md`, `README.md`；如启用本地导出，新增 `src/main/diagnostics.ts` 并在设置页接入。默认无自动网络上报，不改 `gate.ts`、core config、fingerprint。
- 契约：仅在本地诊断启用时增加 `CaveCalls.exportDiagnostics(): boolean`，主进程系统保存对话框选路径并脱敏；`CaveEvents`、`ShellState`、数据库、命令和浮层无新增。无后台上传或追踪标识。
- 测试：单元测脱敏和失败；三平台 `npm test` 与 `startWorld`/CDP e2e，签名产物 smoke；人工完成 macOS/Windows 点击、拖拽、授权、安装升级及更新抓包。验收清单：版本和变更记录已核对；锁定依赖与内核哈希；测试绿；签名/公证/时间戳有效；许可完整；干净机器安装升级、profile 保留、关闭最后窗口退出；闸门失效关闭及更新无直连；备份和回滚可用；诊断隐私已核对；由授权人员确认产物后才发布。

### 实施补充：接口与交互

`startWorld({ profile, wrap, extra })` 的返回值含 fixture、socks、dir、child、log 和 stop；它不会自动保留 profile 供重启，需要测试专门扩展。 用户打开入口后应能看清当前目标；使用 Tab/Shift+Tab 到达控件、方向键在列表中移动、Enter 执行、Escape 取消并回到原焦点。空数据提供简短空状态；失败保留可重试入口，不把异常堆栈、凭据或完整私人数据放进 UI。正在编辑时广播不能覆盖输入；同一操作重复提交应幂等或禁用，关闭窗口、标签或切换导航时取消或忽略旧结果。所有 URL 再由主进程校验，发起远程加载仍经过 `Navigator.load` 和闸门，关闭或暂停时不得额外发请求。

```ts
// CaveCalls 增量；具体返回类型见本节契约
exportDiagnostics(): boolean // 仅当主人批准本地导出时
// CaveEvents 无新增；ShellState / TabState 增量按上文契约。
// SurfaceName 增量：无
```

**i18n：**在 `src/shared/i18n/zh.ts` 与 `en.ts` 成对加入 `diagnostics_export: '导出诊断' / 'Export diagnostics'`；设置页专用字符串放对应 settings 词典。其余可见动作、错误、空状态和无障碍名称也需成对翻译，复用已有 `command_*` key；不要以英文或中文硬编码动态反馈。命令 id 与快捷键以本节上方列出的为准；新增命令按 `CommandSpec` 使用 `key`、必要时 `macKey`，无快捷键则省略两字段。未列新命令时无增量。

**浮层与持久化：**本节指定的浮层通过 `src/renderer/overlay.tsx` 的 `surfaces` 注册并以 `Surfaces.open/close` 管理；无新增时沿用现有视图。使用 `Surface` 定位，菜单用 `Menu`，选项列表用 `List`，确认使用 `Dialog`；这些组件按需要组合，不为本任务新造平行 overlay。数据库按上文仓库和迁移执行；未列新表或列即不迁移。所有仓库变更必须测试旧库升级和事务回滚。

**边界和验证：**检查两个窗口同时操作、目标标签中途关闭或导航、闸门关闭/暂停、私人信息不进入日志与无关窗口、顶部与侧栏布局，以及 macOS 和 Windows/Linux。单元测试放 `test/unit/`，覆盖本节的状态转换、非法参数、竞态与存储；运行 `npm test`。e2e 使用 `startWorld({ extra: ['--remote-debugging-port=0'] })`，以 `devtoolsPort(w.log)` 获取端口，`evaluate`/`click`/`waitFor` 针对 shell、overlay 与本地 fixture 断言；需要新服务器行为时扩展 `test/server.mjs`，并在结束调用 `w.stop()`。`click` 仅检查单个页面的命中，不证明原生窗口层级。macOS 人工实际点击入口、键盘操作、取消、切换标签与窗口，在顶部和侧栏各重做；记录结果与未验证的 Windows/Linux 项。

**验收与并行：**功能、空/错误状态、焦点、权限边界和上述测试均通过才完成；报告人工结果及限制。除 D2 审阅批准后的范围外，禁止改 gate、网络核心、fingerprint；L0 的字符串例外与本任务无关。与其他任务共享 `src/shared/ipc.ts`、`src/main/index.ts`、`shell/window.ts`、`overlay.tsx`、i18n 和迁移文件时使用隔离 worktree，按本文依赖顺序合并；后合入者重新协调类型、迁移版本并重跑测试，不以并行开发代替串行合并。
