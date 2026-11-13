# 后续实现计划

## 已定

- 搜索引擎默认占位搜索示例（example.com）；设置中可选择占位示例，或包含 `{query}` 的自定义 HTTPS 模板；保存在 store prefs。
- 证书错误页提供“高级 → 继续前往”；例外仅在当前应用会话内、按主机与证书指纹保存在内存中，退出或重置环境时清除。返回和重试是主要操作。
- 第二阶段会话恢复默认关闭。

## 待定

- 无上述三项决策待定。

## 概览

本计划从 Preact、i18n、SQLite store 与平台抽象的基础工作合入之后开始。每个任务是一名编码 agent 的交付单元；依赖未合入时不要假定接口已经存在。当前 `index.ts` 已打开 `cave.sqlite`，接入 `Prefs`、`History` 和下载仓库；其他仓库已实现但尚未用于对应功能。任务内的接口是目标契约，合入前以类型检查协调命名，不得静默删去行为。

## 基础体验执行单进度

- [B2a 搜索引擎与地址解析](1-basics/B2a-search-engine.md)：可先独立实现；先合入，再实现 B2 地址栏建议。
- L0、P0、B1、B2 其余部分、B3、B4、B5 仍在 [基础体验草案](1-basics.md)，尚未成为完整执行单，不应按草案直接派工。

## 依赖图与并行

```text
基础合入 → L0 剩余文案 → B1 菜单 → B2 地址栏
          ├→ P0 平台验证     M5 历史 + M6 书签 → B2 回接
          ├→ B3 错误页    ├→ M1 图标音频 ─┐
          ├→ B4 权限      ├→ M2 标签操作 → M3 会话
          └→ B5 对话全屏  ├→ M4 下载       ├→ M7 命令面板
                           └→ M8 站点设置 → D1 站点信息
                                           → D2 容器（主人审阅后）
全部功能稳定 → R1 安装器 → R2 签名 → R3 更新 → R4 CI/发布
```

这是依赖图，不是可同时改同一文件的许可。B1–B5 多数会改 `ipc.ts`、`window.ts`、renderer 注册表；M1–M8 同样共享这些文件。**在同一 checkout 中串行合入这些任务**；只有各自完全不修改相同文件的测试、文案或设计准备可以并行。不同隔离分支可并行开发，必须按图合并并重跑测试；后合入者解决契约与注册表冲突。R1 的打包调研与功能开发可并行，修改 package、构建脚本或工作流时串行。D2 不与任何网络或会话相关任务并行。

## 所有任务的约定

- 先读现有实现和本任务依赖。只实现任务范围；不改 `src/main/gate.ts`、`src/main/proxy/config.ts`、`src/main/fingerprint.ts` 或网络核心，例外是 L0 仅修改可见字符串、不改逻辑，以及经主人审阅的 D2。不能通过绕过闸门完成任何功能。
- 使用 TypeScript、现有代码风格及 Preact；`useCave()` 消费 typed bridge，`<Icon>` 使用 `src/renderer/icons.ts` 内联 lucide；窗口级浮层在唯一 overlay 页，通过 `overlay.tsx` 的 `surfaces` 注册表注册；`Surface`、`Menu`、`Popover`、`List` 是可组合组件，设置页现有 `Dialog` 是页内确认框。Menu/Popover/List 当前尚未用于任何页面。界面尽量不用多余说明。键盘、焦点、屏幕阅读器、深浅色和顶部/侧边布局均须可用。
- 新调用在 `src/shared/ipc.ts` 的 `CaveCalls`、`CALLS` 和主进程 `Handlers` 全部登记；新事件同理登记 `CaveEvents` / `EVENTS`。验证参数、发送者、窗口与对象归属；不把文件路径、认证信息或通用 Electron 能力暴露给网页。所有调用作用于发送者窗口。广播全局变化到所有窗口；异步结果携带身份并丢弃过期响应。
- 无参数动作统一登记 `src/shared/commands.ts` 和 `src/main/shell/commands.ts`，菜单与快捷键共用。中文源字符串和英文翻译放 `src/shared/i18n`，通过 `t()` 使用；不要硬编码新文案。未列快捷键的动作不设快捷键，避免冲突。
- SQLite 在 profile 中打开一次，迁移必须有版本、事务、外键和旧库升级测试；不要存明文密码。UI 不能假设进程内 id 跨重启稳定。清理、损坏恢复、窗口关闭和应用退出都要处理。
- 测试：`npm test` 必须通过；涉及窗口/交互运行 `npm run test:e2e`。使用 `test/e2e/harness.mjs` 的 `startWorld` 与 `test/e2e/cdp.mjs`；fixture 仅本地，不触及公网。CDP 点击只证明页面内命中，不证明原生视图接收鼠标；macOS 真实点击、拖拽、窗口控件由人工或 computer use 验收。每项列的单元和 e2e 是最低要求。
- 不提交到 main，除非 `npm test` 全绿；不自行提交、发布或改变 git 状态。各任务验收需包含测试结果、已知限制、迁移和人工验收结果。

任务清单：[基础体验](1-basics.md) · [标签与记忆](2-tabs-memory.md) · [特色](3-distinct.md) · [发布](4-release.md)。每项的文件范围包含共享契约和其依赖，不允许跨任务顺手实现。
