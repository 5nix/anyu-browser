# Anyu 开发与内部说明

本文档保留项目工程背景、配置格式、网络隔离实现、内置代理内核许可及构建测试说明，供开发者与贡献者参考。用户向介绍见 [README.md](../README.md)。

- 公开项目名：`anyu-browser`
- 当前状态：0.1.0 预发布（安装包暂无代码签名与自动更新）
- 相关文档：
  - [架构设计](ARCHITECTURE.md)
  - [连接方式（出口）设计](egress-modes.md)
  - [真机手工测试清单（macOS / Windows）](MANUAL_TESTS.md)
  - [Windows 真机验收记录（2026-11-13）](windows-validation-2026-11-13.md)

## 构建、测试与打包

需要 Node 24：

```bash
npm ci
node scripts/fetch-core.mjs      # 下载并校验固定版本的代理内核
npm start                        # 编译并启动 Electron 应用
```

常用测试与打包命令：

```bash
npm test                         # TypeScript 类型检查与单元测试（profile、内核配置、订阅、闸门、UA/UA-CH、地址栏等）
npm run dist                     # 在当前平台生成安装包（需先运行 scripts/fetch-core.mjs）
```

自动测试只访问本机测试服务器，主机名使用 `*.cave.test`，由测试用 SOCKS 节点映射到本机，不连接任何外部网站。

### Linux 打包说明

Linux `.deb` 构建目标为 `Anyu-<版本>-linux-amd64.deb`（当前不作为预发布主交付平台）：

```bash
sudo apt install ./Anyu-<版本>-linux-amd64.deb
```

安装脚本会配置 Chromium 沙箱（在 Ubuntu 24.04 上同时装入 AppArmor 配置），应用始终在沙箱内运行。

## 网络隔离与闸门实现

- **Chromium 启动参数与会话代理**（[`src/main/network.ts`](../src/main/network.ts)）：启动时固定使用 `socks5://127.0.0.1:<随机端口>`，设置 `proxy-bypass-list=<-loopback>`（不绕过回环地址），禁用本地 DNS 解析（`MAP * ~NOTFOUND , EXCLUDE 127.0.0.1`）并将主机名交给远端 SOCKS 解析。关闭 QUIC（`--disable-quic`）、IPv6（`--disable-ipv6`），WebRTC 策略设为 `disable_non_proxied_udp`，同时关闭后台网络、组件更新、崩溃上报、Domain Reliability、DoH 升级和拼写字典下载。
- **内置内核运行配置与闸门**（[`src/main/proxy/config.ts`](../src/main/proxy/config.ts)、[`src/main/gate.ts`](../src/main/gate.ts)、[`src/main/gatekeeper.ts`](../src/main/gatekeeper.ts)）：
  - 闸门状态写入 `runtime.yaml`。关闭时，浏览器入站只剩 `MATCH,REJECT`，已打开的页面也无法发出流量；出口核对使用仅限探测的本机入站（`IN-NAME,probe,PROXY`）。
  - 放行时，回环和链路本地地址被 `REJECT`，除非开启 `allowPrivateNetwork` 否则私网段同样被 `REJECT`；其余流量全部经选中节点出去（`MATCH,PROXY`），DNS 通过节点使用 DoH（`https://1.1.1.1/dns-query#PROXY`）解析。运行配置中不出现 `DIRECT`。
  - 启动后自动核对出口国家，运行期间每 5 分钟复测一次；任何会影响出口的操作（切节点、改国家、内核退出、暂停/恢复、重检）都会递增代际并立即作废旧结果，回到关闭状态并断开现有连接。
- **订阅拉取例外**：在用户主动点击拉取订阅且“更新方式”为 **直连**（默认）时，主进程直接通过系统网络请求该订阅 URL 一次，不经过浏览器会话；网页流量仍然只走内核。
- **非 TUN 随机端口与进程绑定**（[`src/main/proxy/tied.ts`](../src/main/proxy/tied.ts)）：内核禁用 TUN，仅监听 `127.0.0.1` 上的随机端口（避开 `7890`–`7893`、`7897`、`9090`、`9097`），控制器带随机密钥。无论 Anyu 如何退出（包括崩溃或被强制结束），内核进程都会随之退出，不会残留；它可以与宿主机上的 TUN 客户端共存。如果内核上游连接被宿主机 TUN 接管，出口核对测量的是最终出口，国家不符时闸门关闭。
- 不使用系统防火墙规则，也不在请求层用拦截器替代网络层隔离。

## 订阅、测速与节点切换

- **订阅解析**（[`src/main/proxy/subscription.ts`](../src/main/proxy/subscription.ts)）：仅读取 Clash YAML 中 `proxies:` 列表里的有效代理节点。订阅附带的 `rules`、`dns`、`tun`、`port`、`mode` 等全部丢弃；`DIRECT`、`REJECT`、`GLOBAL`、`COMPATIBLE` 等保留名、直连类节点及 `dialer-proxy` 链式出站都会被剔除。
- **订阅拉取**：请求时 `User-Agent` 为 `clash.meta`，使按客户端区分格式的订阅服务返回 Clash YAML。支持“直连”和“经代理”（经当前已放行节点）两种方式，也可从本地文件导入或直接粘贴（不发网络请求）。
- **测速与切换**：只有用户主动选择的节点会被使用。“测速”通过控制器对各节点访问固定健康检查端点。已有选中节点时再切换节点，会弹出确认对话框，写明从哪个节点换到哪个、当前连接都会断开、出口 IP 会变，并标注已核对的出口国家变化或提示切换后重新核对。

## 界面、状态图标与设置

- **状态图标与导航**：工具栏右侧（侧边标签布局时位于侧栏顶部）的盾牌图标带圆点指示当前状态：绿色为已放行、琥珀色为正在核对、红色为已关闭、灰色为已暂停。点击弹出状态卡片显示节点、出口国家与 IP 或关闭原因，以及“打开设置”。外网未放行时在地址栏打开网址会保留待加载目标并弹出状态卡片，放行后自动加载。
- **设置页与快捷键**：设置是一个独立标签页（`Ctrl/⌘+,`，`Ctrl/⌘+Shift+K` 直接打开“状态与检查”）：
  - **状态与检查**：手动暂停/恢复外网（暂停会停掉内核）、重新核对（重启内核并重新测量出口）、重新开始设置向导，以及 **关键检查 13 项**（代理核心、只走本机端口、不做本地 DNS、时区、语言、代理不可用时失败、QUIC、IPv6、WebRTC、没有直连且私网拒绝、出口国家、UA 与客户端提示一致、呈现的平台与本机一致），支持一键“复制报告”。
  - **代理**：连接方式（默认模式 `system`、备选模式 `independent`、高级模式 `external`）、监控网址列表、订阅与节点管理。
  - **环境配置**：出口国家、时区、地理坐标、语言、网站首选语言与呈现平台。
  - **隐私与网站数据**：是否允许访问局域网地址（`allowPrivateNetwork`）、是否允许网站请求通知（`notifications`）、已保存的站点权限（相机、麦克风、位置、通知、读取剪贴板），以及仅在用户主动确认后执行的数据清理：
    - **清除此网站数据**：清除最近浏览标签页所属站点的 Cookie（按整个可注册站点含子域名）、本地存储、IndexedDB、缓存和 Service Worker，并重新加载该站点的标签页。
    - **重置整个环境**：清空全部网站数据并关闭所有标签页，只保留一个空白页；环境配置、订阅和节点选择均保留。
  - **下载 / 外观 / 高级**：下载记录、明暗主题与强调色、顶部或侧边标签布局、界面语言、搜索引擎（预设 DuckDuckGo / Google / Bing 或含 `{query}` 的自定义 HTTPS 模板）以及打开配置文件夹。
- 明暗外观默认跟随系统；macOS 上标签栏与红绿灯在同一行，Windows 上右上角使用系统窗口控制按钮。

## 配置目录与 `profile.json`

配置目录可整体拷贝到另一台机器使用（注意 Cookie 加密依赖操作系统钥匙串 / DPAPI，跨系统拷贝时登录态可能失效）：

- 默认位置：
  - macOS：`~/Library/Application Support/Cave/profile`
  - Windows：`%APPDATA%\Cave\profile`
  - Linux：`~/.config/Cave/profile`
- 自定义位置：设置环境变量 `CAVE_PROFILE=/path/to/dir`

目录内容：

- `profile.json`：环境与代理配置
- `cave.sqlite`：浏览历史、书签、下载记录、站点权限与界面偏好
- `browser/`：Chromium 用户数据（Cookie、缓存、存储等）
- `runtime.yaml`：每次启动生成的内核运行配置（勿手改）
- `logs/core.log`：代理内核日志
- `downloads/`：默认下载目录

（旧版 `subscription.yaml` 和 `ui.json` 会在打开时自动迁移并清理。）

`profile.json` 字段示例（[`src/shared/profile.ts`](../src/shared/profile.ts)）：

```jsonc
{
  "version": 1,
  "setup": {
    "started": true,
    "identityHandled": true,
    "personaliseHandled": true,
    "dismissed": false,
    "finished": true
  },
  "locale": "en",                       // 网站语言与 Intl 地区
  "acceptLanguages": ["en"],            // navigator.languages 与 Accept-Language，locale 始终排第一
  "timezone": "UTC",                    // IANA 时区
  "geolocation": null,                  // 或 {"latitude": 1, "longitude": 2, "accuracy": 50}
  "egressCountry": "",                  // 两位出口国家代码；为空时闸门保持关闭
  "platform": "host",                   // host | macos | windows
  "allowPrivateNetwork": false,         // true 时允许经节点访问 RFC1918/100.64/fc00 私网段（回环始终拒绝）
  "connectionMode": "system",           // system | independent | external
  "externalProxy": {
    "protocol": "socks5",
    "host": "127.0.0.1",
    "port": 0,
    "username": "",
    "password": ""
  },
  "monitorUrls": [],                    // 最多 10 条 HTTPS trace 地址，与内置端点一并核对
  "notifications": false,
  "proxy": { "sources": [], "selected": null }
}
```

- `geolocation` 仅使用配置文件中填写的数值，Anyu 不探测本机真实位置；未设置时定位请求直接被拒绝。
- USB / HID / 串口 / 蓝牙、屏幕捕获、空闲检测、文件系统和本地字体访问等权限一律拒绝；相机、麦克风、定位（已配置坐标时）、通知（开关打开时）和读取剪贴板（`clipboard-read`）由用户在权限浮层中决定。
- 修改 `locale`、`acceptLanguages`、`timezone`、`geolocation`、`platform` 或 `notifications` 后需重启 Anyu 才会生效，设置页顶部会提示立即重启。
- **`platform` 说明**：`host`（默认）如实呈现本机系统，UA、UA-CH、`navigator.platform`、字体与 GPU 完全匹配。选择 `macos` 或 `windows` 时，页面 UA、UA-CH 的 `platform` / `platformVersion` 及主线程 `navigator.platform` 会统一为该平台常见值，但 Worker 内 `navigator.platform`、字体与 WebGL 仍暴露真实宿主机，自检第 13 项会标出与本机不一致。

### 宿主机 TUN 嗅探与 Reality 节点说明

当宿主机 TUN 开启 TLS 嗅探且启用目标地址覆盖（`override-destination: true`）时，若 Anyu 运行在默认模式（`system`），内核发往 Reality 节点的握手连接会被宿主 TUN 识别并按伪装 SNI（如 `www.bing.com`）替换节点 IP，导致连接失败。

- 在 Windows 上，可切到设置中的 **备选模式（仅 Windows）**（`independent`），让内置内核出站套接字绑定系统物理上行网卡以绕过宿主 TUN。
- 如需保持默认模式经宿主 TUN 串联，应在宿主代理客户端中为节点目标 IP 配置嗅探排除（如 mihomo 的 `sniffer.skip-dst-address`）并通过宿主的持久配置覆盖保存；不要通过添加 `DIRECT` 规则或关闭出口核对来解决。

## 已知限制的技术原因

- **字体（尚未实现白名单隔离）**：Chromium 156 没有内置字体白名单开关，字体枚举位于 Blink `FontCache`（macOS 走 CoreText，Windows 走 DirectWrite 系统字体集合），会包含用户额外安装的字体。出于“不向页面注入可被检测的 JS 垫片”的原则，Anyu 仅拒绝了 Local Font Access API，不通过 JS 覆盖测量接口；干净的解法是给 Electron 维护 Blink `FontCache` 层的平台白名单补丁（已列入后续计划）。
- **固定平台时的 Worker 差异**：Dedicated Worker 和 Service Worker 的 `navigator.platform` 在 Chromium 中为编译期常量，CDP `Emulation.setUserAgentOverride` 无法修改，因此只有主线程一致；字体、WebGL/GPU 渲染器、emoji 字形、滚动条/控件样式和系统颜色也均来自真实操作系统。
- **SharedWorker 附着时机**：Chromium 不会自动将调试器附着到 `SharedWorker`。Anyu 通过 `Target.setDiscoverTargets` 在 `SharedWorker` 创建时主动附着并下发覆盖设置（[`src/main/fingerprint.ts`](../src/main/fingerprint.ts)），在极端启动竞争时序下，其第一行代码仍可能以会话默认 UA 执行。
- **`window.chrome`**：仅包含 Electron 自带部分，与 Google Chrome 存在差异（例如缺少 `chrome.app` 和 `chrome.runtime`）。

## 代理内核与许可说明

- [`package.json`](../package.json) 中声明 `"license": "MIT"`，[docs/ARCHITECTURE.md §14](ARCHITECTURE.md#14-许可) 也说明 Anyu 自有代码按 MIT 许可（仓库根目录目前尚未添加独立 `LICENSE` 文件，待发布前由维护者确认补充）。
- 安装包随附未经修改的 [MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo) v1.19.34（GPL-3.0 许可）。因上游要求非 MetaCubeX 下游项目名称不得包含 `mihomo`，分发二进制重命名为 `cave-core`（Windows 下为 `cave-core.exe`），由 Anyu 作为独立子进程运行并通过命令行参数和本机 HTTP 控制器通信。
- 许可全文、版权声明与对应源码地址随包放在 `proxy-core/LICENSE` 与 `proxy-core/NOTICE`（仓库中位于 [`resources/proxy-core/`](../resources/proxy-core/)）；下载与构建时依据 [`resources/proxy-core/SHA256SUMS`](../resources/proxy-core/SHA256SUMS) 校验文件哈希。
