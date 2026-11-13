# B2a 搜索引擎与地址解析

## 目标

地址栏默认使用 `example.com` 占位模板（不提供真实搜索，需配置自定义服务）；设置页可选择占位示例或自定义 HTTPS 模板。此文件可单独完成；建议列表属于 B2b，不在此任务实现。

## 用户可见行为

1. 新安装或首启旧库时，地址栏输入 `example.com` 并 Enter，导航至 `https://example.com`；输入 `red fox` 并 Enter，打开 `https://example.com/?q=red%20fox` 占位地址。空白输入按 Escape 或 Enter 都不导航，Escape 恢复当前地址并将键盘交给页面。地址栏获得焦点时全选。
2. 打开设置 → 外观 → 搜索引擎，选择占位示例，立即保存并同步所有窗口。选择自定义后输入完整 HTTPS 模板，必须恰有一个字面 `{query}`；点保存后生效。非法模板保留编辑内容、显示错误，仍使用上一次有效设置。设置控件有显式 label，Tab/Shift+Tab、Enter 可操作，不加多余解释文案。
3. 两种标签布局、两个窗口中行为一致；正在输入的地址或自定义模板不能因其他窗口广播而被覆盖。关闭设置后回到页面；导航成功或排队后 `focusPage()`。设置读写失败时界面提示保存失败，保留上一次设置；损坏或不合法的已存设置启动时回退占位搜索示例（example.com），不自动请求网络。
4. 地址解析只生成 URL；实际加载仍走 `ShellWindow.navigate` → `WindowHost.load` → `Navigator.load`，闸门关闭时照旧排队。保留现有 `http`、`https`、`about`、`data`、`blob` 行为和 scheme 拒绝边界，不打开 `file:` 或 `javascript:`。

## 文件清单

- 修改 `src/shared/url.ts`：当前 `export function toUrl(input: string): string`；新增模板验证和搜索设置类型、默认值，以可选参数扩展 `toUrl(input: string, search?: SearchEngine): string`。不改变现有非搜索 URL 判别；主进程的空输入提前返回，避免现有空值 `about:blank` 导航。
- 修改 `src/shared/ipc.ts`：按下方登记合同；`ShellState` 是每窗口广播的全局搜索设置，`CaveApi` 自动把返回值包装成 Promise。
- 修改 `src/main/index.ts`：`async function start(): Promise<void>` 中 `const prefs = new Prefs(database)` 后读取并验证；`const handlers = (win: ShellWindow): Handlers => ({ ... })` 加 handler，失败返回 false 而不广播成功。
- 修改 `src/main/shell/browser.ts`：`BrowserOptions` 接受初始值和持久化回调；`Browser` 保存有效值，公开 `setSearchEngine`，通过 `broadcast(): void` 广播；`WindowHost.shared()` 包含搜索设置。
- 修改 `src/main/shell/window.ts`：当前 `navigate(input: string): void` 用当前有效设置调用 `toUrl`，空输入直接 `focusPage()`；`WindowHost.shared(): Pick<ShellState, 'gate' | 'downloads' | 'notice' | 'locale' | 'localePreference'>` 扩展 `searchEngine`。
- 修改 `src/renderer/settings/view.tsx`、`src/renderer/settings.css`：在 `AppearanceSection` 加表单与错误；草稿在本地 state 保存，失焦或广播不覆盖编辑中草稿。
- 修改 `src/renderer/shell.tsx`：地址输入 focus 时 select，Escape 恢复当前 tab URL 并 `cave.focusPage()`；空提交不调用 `navigate`，回焦页面。编辑期间不覆盖输入。
- 修改 `src/shared/i18n/settings.zh.ts`、`settings.en.ts`；修改 `test/unit/url.test.ts`，新增 `test/unit/search-engine.test.ts`，扩展 `test/e2e/app.test.mjs`。

## IPC 合同增量

以下是并入 `src/shared/ipc.ts` 的完整增量，类型只含可序列化值；并在 `Handlers` 对象实现同名方法。

```ts
export type SearchEngine =
  | { kind: 'default' }
  | { kind: 'custom'; template: string };
// interface ShellState 增加：
searchEngine: SearchEngine;
// interface CaveCalls 增加：
setSearchEngine(engine: SearchEngine): boolean;
// CALLS 对象增加：
setSearchEngine: true,
// CaveEvents、EVENTS、TabState、SurfaceName：无增量。
```

虽然 TS 调用端有类型，handler 仍须对 `unknown` 运行时验证：对象只允许已知 kind；custom 限长 2048、恰一个 `{query}`、替换为 `test` 后 `new URL()` 成功、协议严格 `https:`、无 username/password、无第二个占位符。验证失败返回 false；保存抛错时返回 false，不改变内存与其他窗口。成功先写 prefs，再替换内存并广播。

## 命令表增量

无。沿用 `src/shared/commands.ts` 的 `'address.focus': { label: 'command_address_focus', key: 'CmdOrCtrl+L' }`（macOS Cmd+L，Windows/Linux Ctrl+L）；不新增快捷键。

## i18n 词条

在 settings 字典成对新增，复用现有 `set.env.save` 作保存按钮；不硬编码可见反馈。

| Key | zh | en |
| --- | --- | --- |
| `set.search.title` | 搜索引擎 | Search engine |
| `set.search.default` | example.com | example.com |
| `set.search.custom` | 自定义 | Custom |
| `set.search.template` | 搜索网址模板 | Search URL template |
| `set.search.invalid` | 请输入包含一个 {query} 的 HTTPS 网址 | Enter an HTTPS URL containing one {query} |
| `set.search.failed` | 保存失败，请重试 | Could not save. Try again. |

`{query}` 在错误文案中应按字面显示：`t('set.search.invalid', { query: '{query}' })`。

## 存储

复用 `src/main/store/prefs.ts` 的 `get<T>(key: string, fallback: T): T` 与 `set(key: string, value: unknown): void`；key 为 `searchEngine`，存整个 `SearchEngine`。默认 `{ kind: 'default' }`；旧库没有该 key 即自然回退，无 schema 变更、无迁移 SQL。默认模板为 `https://example.com/?q={query}`（仅占位；实际搜索需配置自定义服务）；用 `encodeURIComponent` 替换唯一占位符。不要让用户输入模板或搜索词进入日志。

## 浮层/组件

无需新 surface、Menu、Popover、List、Dialog，也不注册 overlay。沿用 `settings/view.tsx` 的 AppearanceSection、`.group`/`.card`/`.row`。示意：

```tsx
<label class="row"><span>{t('set.search.title')}</span>
  <select value={draftKind} onChange={onKindChange}>
    <option value="default">{t('set.search.default')}</option>
    <option value="custom">{t('set.search.custom')}</option>
  </select>
</label>
{draftKind === 'custom' && <form onSubmit={save}>
  <label>{t('set.search.template')}<input value={draftTemplate} onInput={onTemplateInput} /></label>
  <button type="submit">{t('set.env.save')}</button>
  {error && <p role="alert">{error}</p>}
</form>}
```

## 边界情况

编码空格、Unicode、`&`、`#`、百分号；拒绝无占位符、多个占位符、HTTP、带凭据和格式错误的模板；保留旧值。地址空白不导航；导航进行中输入不被 state 覆盖。两个窗口相互更改时，表单失焦后呈现最后成功提交值。设置标签激活时无 web current，提交应按现有 `navigate` 建 web 标签。偏好无效时安全回退。所有远程加载仍经 Navigator，不能绕过闸门。

## 禁止触碰

不改 `src/main/gate.ts`、`src/main/gatekeeper.ts`、`src/main/network.ts`、`src/main/proxy/**` 或 fingerprint 相关文件。

## 测试

- `test/unit/url.test.ts`：默认占位示例、自定义编码、空输入保留纯函数原行为、hostname 和允许 scheme 回归、javascript 不执行。
- `test/unit/search-engine.test.ts`：非法模板与损坏 prefs 回退、仅成功写入后变更、占位符与协议校验。
- `test/e2e/app.test.mjs`：新增 `search engine settings persist and synchronize`、`address empty and escape restore focus`、`closed gate queues search`。使用现有 `startWorld({ extra: ['--remote-debugging-port=0'] })`、`devtoolsPort(w.log)`、`evaluate`、`click`、`waitFor`，`t.after(() => w.stop())`。断言 state 与两个窗口、prefs 重启后的选择、无效输入错误、空输入 URL 不变、`focus` 回到 `page`、闸门关闭时 fixture 未收到搜索请求。若现有 harness 不支持保留 profile 的重启，为测试扩展其选项并清理临时目录；不访问公网。`CAVE_LANG=zh-CN` 是 harness 默认值，但 `...process.env` 在它之后，运行时须确保外部 `CAVE_LANG` 未覆盖。运行 `env -u ELECTRON_RUN_AS_NODE npm test` 和 `env -u ELECTRON_RUN_AS_NODE npm run test:e2e`。CDP 的 `click` 只证明页面内命中。
- macOS computer-use：真实点击地址栏，全选输入、Escape 和 Enter；设置里切换占位示例与自定义选项，输入非法/有效模板；打开第二窗口验证同步；切顶部/侧边各重复，暂停外网后提交搜索并检查无直接访问。记录实际结果，不能以 CDP 替代原生点击。

## 验收清单

- [ ] 默认与持久设置正确，失败不覆盖旧值；两种语言和布局可用。
- [ ] 键盘、焦点、多窗口、无效/空值和闸门关闭行为符合上述步骤。
- [ ] 单元及 e2e 通过；人工结果和未验证平台已记录。

## 依赖、冲突与合并顺序

无功能前置。可与 B1、B3–B5 在独立 worktree 并行，但 `ipc.ts`、`index.ts`、`browser.ts`、`window.ts`、i18n 和测试共享；同 checkout 不并行编辑，合并时协调合同并重跑测试。B2a 先于 B2b（建议列表）。不改变 git 状态或替使用者提交。

## 共享地址解析接口

B2a 拥有地址解析；B2b 依赖 B2a §共享地址解析接口；若尚未合入，按此精确接口构建：`type SearchEngine = { kind: 'default' } | { kind: 'custom'; template: string }`；`toUrl(input: string, search?: SearchEngine): string`；`ShellState.searchEngine: SearchEngine`；`setSearchEngine(engine: SearchEngine): boolean`。空白输入不导航；实际加载通过 `ShellWindow.navigate` → `WindowHost.load` → `Navigator.load`。
