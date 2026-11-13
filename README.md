# Anyu

公开项目名：`anyu-browser`。

Anyu 是一个隔离的桌面浏览器，用来登录你自己在各个网站上的账号。它的出网路线只有一条：随包附带的代理内核。

- **零配置**：不用装扩展，也不用改标志。时区和语言在第一次启动时按本机填好，之后固定在配置文件里。
- **失败即关闭**：内核没在跑、没有节点、出口国家和配置不符，或者你手动暂停时，浏览器不会发出任何网页请求。
- **引擎层面的一致性**：时区、语言、Accept-Language、UA 和 UA-CH 都通过 Chromium 自己的接口设置，主线程和 Worker 里的值相同，页面里没有注入脚本。
- **完整的浏览器**：多标签、地址栏、前进后退、下载、上传、剪贴板、PDF、媒体播放和页内查找。

> 状态：MVP（0.1.0）。安装包没有开发者签名，也没有自动更新。设计依据见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，真机验收清单见 [docs/MANUAL_TESTS.md](docs/MANUAL_TESTS.md)。

## 安装

到 GitHub Actions 里最新一次成功的 CI 运行页面下载构建产物：

| 系统 | 文件 | 说明 |
| --- | --- | --- |
| macOS（arm64 / x64） | `Anyu-<版本>-mac-arm64.dmg` / `-mac-x64.dmg`，也有 zip 版 | 包只有 ad-hoc 签名，没有平台开发者证书。第一次打开会被拦下：到“系统设置 → 隐私与安全性”里点“仍要打开”；或者在终端运行 `xattr -dr com.apple.quarantine /Applications/Anyu.app` 后再打开。 |
| Windows x64 | `Anyu-<版本>-win-x64.exe`（安装器）或 zip 便携版 | 包没有签名，系统安全检查拦截时点“更多信息 → 仍要运行”。 |
| Linux x64（Debian / Ubuntu） | `Anyu-<版本>-linux-amd64.deb` | 用 `sudo apt install ./Anyu-<版本>-linux-amd64.deb` 安装。安装脚本会配置 Chromium 沙箱（Ubuntu 24.04 上同时装入 AppArmor 配置），应用始终在沙箱里运行。 |

从源码运行需要 Node 24：

```bash
npm ci
node scripts/fetch-core.mjs      # 下载并校验固定版本的代理内核
npm start
```

地址栏搜索默认使用 `https://example.com/?q={query}` 占位示例。实际搜索需在 **设置 → 外观 → 搜索引擎** 选择“自定义”，填写含一个 `{query}` 的 HTTPS 模板。

## 第一次运行

1. 打开 Anyu。还没有节点时，窗口会直接打开 **设置 → 节点与订阅**；工具栏右侧的状态图标是红点，点开显示 **外网已关闭 · 还没有导入节点**。这时任何网页都不会被请求。
2. 在 **节点与订阅** 里点“从文件导入…”，选一份 Clash YAML 订阅文件；也可以点“粘贴内容…”。第一次导入只读你本地的内容，不发网络请求。
3. 在 **环境配置** 里填写节点对应的 **出口国家**（两位国家代码），点“保存更改”。
4. 在节点列表里点一个节点。Anyu 会通过这个节点请求一次固定出口核对端点，读出出口国家。国家和配置一致时，状态会变成 **外网已放行**，这时地址栏就可以用了。

之后每次启动都会自动重复第 4 步的核对；运行期间每 5 分钟也会再核对一次。

### 订阅

- 只支持 Clash YAML 格式，也就是含 `proxies:` 列表的文件。订阅里的规则、DNS、TUN、端口和模式都会被丢掉，只留下节点。`DIRECT` 和 `dialer-proxy` 链式出站会被剔除。
- 也可以填订阅链接，点“拉取订阅”。旁边的“订阅拉取”选择路线，记在配置里：
  - **直连**（默认）：只在你点击时，由 Anyu 主进程经系统网络单独请求这一个地址（宿主机开着 TUN 时就经过它），不经过浏览器会话。这是 Anyu 唯一一个不经内核的请求；网页流量照旧只走节点。第一次导入用这个。
  - **经代理**：经当前选中的节点拉取，需要已经有节点。
  - 请求的 User-Agent 是 `clash.meta`，按客户端选格式的订阅服务会返回 Clash YAML。
- 只有你自己选的节点会被使用。“测速”通过各个节点访问固定健康检查端点。
- 已经选过节点以后，再换节点会先弹确认：写明从哪个节点换到哪个，当前连接都会断开、出口 IP 会变；出口国家会变（或和配置不符）时会标出来，还没核对过的节点会说明切换后重新核对。第一次选节点不需要确认。

### 状态图标与设置

工具栏最右（侧边标签布局时在侧栏顶部）的盾牌图标带一个小圆点：绿色已放行、琥珀色正在核对、红色已关闭、灰色已暂停。点它弹出一个小卡片，只写当前状态和一行说明（节点、出口国家和 IP，或关闭的原因），下面是“打开设置”。外网没放行时在地址栏打开网址，也只会弹出这张卡片，写明放行后会自动打开哪个网站。

设置是一个单独的标签页（`Ctrl/⌘+,`；`Ctrl/⌘+Shift+K` 直接打开“状态与检查”），左侧分类，右侧内容：

- **状态与检查**：暂停外网（会停掉内核）、重新核对（重启内核，再核对一次出口）。
- **关键检查 13 项**：内核、只走本机端口、不做本地 DNS、时区、语言、内核停掉时连接会失败、QUIC、IPv6、WebRTC、没有直连、出口国家、UA 与 UA-CH 一致、呈现的平台。可以一键“复制报告”。
- **隐私与网站数据**：是否允许访问局域网地址、是否允许网站请求通知；网站数据只在你点按钮时清除，从不自动清除，两者都先确认。
  - **清除此网站数据**：最近浏览的那个标签页所在网站的 Cookie（按整个站点，含子域名）、本地存储、IndexedDB、缓存和 Service Worker。打开这个网站的标签页会重新加载。
  - **重置整个环境**：清空所有网站的数据并关闭全部标签页，只留一个空白页。环境配置、订阅和节点选择都保留。
- 其余分类：节点与订阅、环境配置、下载、外观（顶部标签或侧边竖排标签，记在配置文件夹的 `ui.json`）、高级（打开配置文件夹）。
- 明暗跟随系统。macOS 上标签栏和红绿灯在同一行；Windows 上右上角是系统窗口按钮。

## 配置文件（profile.json）

配置目录是“便携”的：把整个目录拷到另一台机器，就能带走同一份身份和登录状态。

- 默认位置：macOS `~/Library/Application Support/Cave/profile`；Windows `%APPDATA%\Cave\profile`；Linux `~/.config/Cave/profile`
- 指定位置：设置环境变量 `CAVE_PROFILE=/path/to/dir`

```jsonc
{
  "version": 1,
  "locale": "en",                       // 界面和 Intl 的语言
  "acceptLanguages": ["en"],             // navigator.languages 和 Accept-Language，locale 永远排第一
  "timezone": "UTC",                    // IANA 时区
  "geolocation": null,                  // 或 {"latitude": 1, "longitude": 2, "accuracy": 50}
  "egressCountry": "",                  // 出口国家码；为空时闸门保持关闭
  "platform": "host",                   // host | macos | windows，见下方说明
  "allowPrivateNetwork": false,         // true 时允许经节点访问 10/8、172.16/12、192.168/16 等私网段（回环地址始终拒绝）
  "notifications": false,               // 是否允许网站请求通知权限
  "proxy": { "subscriptionUrl": "", "selectedNode": "" }
}
```

- `geolocation` 只是你配置的一个值。Anyu 从不探测真实位置；没有配置时，定位请求直接被拒绝。
- 摄像头、麦克风、USB/HID/串口/蓝牙、后台读剪贴板、本地字体访问等权限一律拒绝。
- 修改时区、语言、地理坐标、平台或通知以后，要重启 Anyu 才会生效，设置页顶部会给出提示。

宿主 TUN 开启 TLS 嗅探并覆盖目标地址时，要避免把代理节点本身的连接当成网页连接改写。例如 Reality 节点的 `server` 是节点 IP，`servername` 是伪装网站；外层 TUN 如果用伪装 SNI 替换节点 IP，内层 Reality 握手就无法到达节点。此时应在**宿主代理客户端**中对节点目标 IP 设置嗅探排除（mihomo 的 `sniffer.skip-dst-address`），并通过宿主支持的配置覆盖机制持久保存。它只保留节点连接的原目标，不是 DIRECT 规则；流量仍可由宿主 TUN 的原有规则和代理节点转发。Anyu 的出口核对仍需通过才放行。不要通过关闭出口核对或自动直连解决这一冲突。
- 目录里另外几项：`browser/` 是 Chromium 的用户数据（Cookie、历史等）；`subscription.yaml` 是导入的节点；`runtime.yaml` 是每次生成的内核配置；`logs/core.log` 是内核日志；`downloads/` 是下载目录。

### platform

- `host`（默认）：如实呈现本机系统。UA、UA-CH、`navigator.platform`、字体、GPU 全都对得上，这是最一致的选择。
- `macos` / `windows`：页面上的 UA、UA-CH 的 platform 和 platformVersion，以及主线程的 `navigator.platform` 会统一成该系统的常见值。**它做不到的部分见下方“已知限制”**，自检第 13 项会如实标出“与本机不一致”。

## 网络是怎样关住的

- Chromium 启动时就固定使用 `socks5://127.0.0.1:<随机端口>`，不绕过回环地址，本地 DNS 解析被禁用（`MAP * ~NOTFOUND`），主机名交给远端解析。QUIC 和 IPv6 关闭，WebRTC 策略是 `disable_non_proxied_udp`。后台网络、组件更新、崩溃上报、Domain Reliability、DoH 升级和拼写字典下载都已关闭。
- 闸门本身写在内核配置里：关闭时，浏览器入口只剩 `MATCH,REJECT`，已经打开的页面也出不去；出口核对走另一个只给它用的本机入口。放行时，回环和私网地址被 REJECT，其余流量全部经节点出去，DNS 也通过节点用 DoH 解析。配置里没有 DIRECT。唯一的例外是你选“直连”时点下的那一次订阅拉取（见上文“订阅”），它在主进程里发出，跟浏览器无关。
- 内核是非 TUN 模式，只监听 127.0.0.1 上的随机端口，控制器带随机密钥。Anyu 不管怎么退出（包括崩溃或被强制结束），内核都跟着结束，不会残留。它和宿主机上的 TUN 客户端可以同时运行，不会抢 7890 或 9090 端口。如果内核的上游连接被宿主机 TUN 接管，出口核对看到的是最终出口；国家不符时闸门会关上。
- 不用系统防火墙规则，也不在请求层做拦截。

## 代理内核与许可

- Anyu 自己的代码使用 MIT 许可（见 [docs/ARCHITECTURE.md §14](docs/ARCHITECTURE.md)）。
- 安装包里附带未经修改的 [MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo) v1.19.34，许可是 GPL-3.0。文件名改成了 `cave-core`，因为上游要求下游产品名里不能含 mihomo。它作为独立进程运行，Anyu 通过命令行和本机 HTTP 跟它通信。许可全文和源码地址见包内的 `proxy-core/LICENSE` 和 `proxy-core/NOTICE`。构建时按 `resources/proxy-core/SHA256SUMS` 校验下载的文件。

## 已知限制（如实说明）

**字体（尚未做到）。** 你要求页面只看到当前呈现平台的一组固定标准字体，不能看到中文系统或用户另外装的字体。这一点在现成的 Electron/Chromium 里没有能干净实现的开关：

- Chromium 156 没有字体白名单开关或特性。字体枚举在 Blink 的 `FontCache` 里，macOS 走 CoreText，Windows 走 DirectWrite 的系统字体集合，会包括用户自己装的字体。
- 用 JS 改写字体检测属于可以被识别的垫片，这和设计原则冲突，所以没有这样做。
- 干净的实现方法是给 Electron 打一个小的 Blink 补丁：一个启动参数，加上每个平台一份字体白名单，在 `FontCache` 查询这一层过滤。主线程和 Worker 共用同一个 `FontCache`，所以天然一致。代价是要自己构建和维护每个 Electron 版本的补丁版。这一项已经列为下一步。
- 现在的状态：本地字体访问 API（`queryLocalFonts`）是拒绝的，但通过测量渲染宽度来探测字体的方法仍然能看到本机装的字体。

**平台固定成非本机系统时的不一致：**

- 专用 Worker 和 Service Worker 里的 `navigator.platform` 在 Chromium 里是编译期写死的本机值，CDP 改不到，所以只有主线程是一致的。
- 字体、WebGL/GPU 渲染器字符串、emoji 字形、滚动条和表单控件样式、系统颜色这些都来自真实系统。
- 所以“固定平台”只适合确有需要的场合；默认的 `host` 才是完全一致的。

**其他：**

- WebGL 和 GPU 的渲染器字符串、屏幕尺寸、硬件并发数和内存都是真实值，按设计不做篡改，所以不同机器会有差异。emoji 和字体的渲染也跟随本机。
- `window.chrome` 只有 Electron 自带的部分，和 Google Chrome 不完全一样（比如缺 `chrome.app` 和 `chrome.runtime`）。
- 共享 Worker（SharedWorker）不会被 Chromium 自动附加调试器。Anyu 会在它出现时补发覆盖设置；测试里的值是一致的，但在极端的启动时序下，它可能先用会话 UA 运行了第一行代码。时区覆盖是按渲染进程生效的。
- 通行密钥：未签名的 macOS 包不能使用平台生物识别和钥匙串通行密钥，需要签名和权限声明。Windows 的平台验证器应该可用，有待真机确认。
- 摄像头和麦克风现在一律拒绝，所以网站里的语音输入不能用。
- 出口 IP 的信誉和延迟是看得见的。出口核对依赖固定出口核对端点，它不可达时闸门保持关闭。
- 订阅只支持 Clash YAML。没有书签同步和扩展。
- 安装包没有开发者签名，也没有自动更新。

## 开发

```bash
npm test             # 类型检查和单元测试（profile、内核配置、订阅、闸门、UA/UA-CH、地址栏）
npm run test:e2e     # Linux + Xvfb：真实窗口、本地 SOCKS 节点和本地测试页；需要 strace
npm run dist         # 在当前平台出安装包（先运行 fetch-core）
```

自动测试只访问本机的测试服务器，主机名都是 `*.cave.test`，由测试用的 SOCKS 节点映射到本机，不连接任何外部网站。
