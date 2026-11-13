# Cave 架构说明

日期：2026-11-11。本文是实现前的架构决定，不含应用代码。版本基线以当天公开发布为准：Electron **45.3.0**（Chromium 156.0.8078.96，Node.js 24.22.2），上游代理内核 **v1.19.34**。实现时钉死这两个版本，不跟着浮动主版本走。

## 1. 结论

用 **Electron 45** 做单个桌面应用。标签页是 `WebContentsView`。所有网页流量从进程启动起就指向本机 SOCKS5，主机名解析被关掉，因此不存在“直连”这条路。代理引擎是未修改的上游内核，以独立进程运行，只听随机的本机端口，不启用 TUN。

第一版采用现成的 Electron，不维护独立浏览器分支。理由在第 3 节。

网站侧的目标是：看起来像这一版普通 Chrome，各项信号彼此一致，不留下脚本改写的痕迹。不把 Mac 伪装成 Windows，也不去模仿某一台具体的假设备。跨电脑保持一致的是用户写进配置文件的时区、语言和地理坐标，不是显卡和字体。

## 2. 产品是什么，不是什么

Cave 是 macOS 与 Windows 上的隐私隔离浏览器壳，Linux 能构建、能跑自动测试，但不作为第一版的交付平台。没有移动端。

主人用它登录自己合法拥有的网站账号，包括 AI 网页应用。它要做的是两件事：少把真实机器的细节暴露给网页，以及让家里和办公室用同一份配置。它不是用来绕过服务商的风控、滥用检测或地区限制的。配置里的国家，应当是主人实际居住、实际使用该服务的地区。软件不核对此事，只按配置执行。

已经定下的产品约束：

- 打开就能用。没有扩展，不依赖用户自己改浏览器标志。以前用 Chrome 扩展做过，效果不好，保护全部做在壳里。
- 它是一个完整的现代浏览器：多标签、导航、下载、上传、粘贴、媒体播放、PDF、平台通行密钥（passkey）、用户打开通知后的通知。
- 地理位置只是配置文件里的纬度、经度、精度。软件不读取、不推断、不核对本机的真实位置，设置这项时也不再加一道确认或门槛。
- 地理坐标没填时，网页的定位请求直接拒绝，不能退回到操作系统定位。
- 出口国家是另一项配置，和地理坐标无关。软件不把 IP 地理位置和经纬度做比较。
- 网络闸门保持失败关闭：指定的代理没连上，或出口国家不是配置的那个，请求就不能出去。做得简单。
- 浏览器被代理内核整个包住，没有 DIRECT。默认配置里不出现直连规则。私网和局域网默认拒绝，用户可以单独打开。
- DNS 在远端解析。Chromium 不使用系统解析器，也不自己做 DoH。
- 更新检查、出口国家核对，要么走代理，要么不做。内核是纯全局的：没有分流规则，没有规则列表。
- 宿主机上可以同时跑着系统级 TUN 客户端。Cave 不把“宿主机 TUN 是通的”当成“自己的代理是通的”。
- 网站看到的是普通 Chrome：UA、客户端提示（Client Hints）、`navigator`、时区、语言、`Accept-Language`、屏幕和窗口彼此一致。不用会留下 `toString` 异常、原型不一致、主线程和 Worker 不一致的脚本注入。
- 机房 IP 的信誉、线路延迟这类信号，写进已知限度，不针对任何一家服务去消除。

自检面板的信息层级是：闸门状态、关键检查、可复制报告、暂停和重新检查。Cave 不是虚拟机，不实现虚拟机出站、共享目录、宿主管理接口那几项。

## 3. 栈选择

Electron 自带固定版本的 Chromium，各平台共享引擎版本；字体和 GPU 仍取决于宿主系统。代理、DNS 和页面环境通过引擎及 CDP 接口配置，避免向页面注入脚本。

系统 WebView 的引擎随操作系统更新，各平台对代理、QUIC、WebRTC 和字体的控制面不同，不能提供同一套跨平台保证，因此第一版不采用。固定时区、裁剪字体或给画布加噪声的浏览器分支，也不符合用户选择时区并保持引擎原始行为的目标。

自行维护 Chromium 补丁可以更深入地控制字体和 WebGL，但每个安全更新都需要合并、构建和验证。只有现有引擎的已知限制被证明不可接受时，才单独立项，不提前承担发布成本。

Electron 的缺口也写在这里，避免把推荐说满：

- `session.setUserAgent` 管传统 UA 字符串，不管 `Sec-CH-UA-*`。客户端提示要用 CDP `Emulation.setUserAgentOverride` 的 `userAgentMetadata`。两处写入同一份值。
- 时区、语言环境、地理坐标、硬件并发数没有 `session.*` 封装，引擎级入口是 CDP Emulation。`navigator.deviceMemory` 在当前 Emulation 域里没有对应命令。
- 调试器附着本身可能被页面看成自动化痕迹。只发送 Emulation 命令，不启用 Runtime、Console、Network 域，也不传 `--enable-automation`。无头测试断言 `navigator.webdriver === false`。如果附着本身留下可见痕迹，下一步是在 Electron 里加一个很小的补丁，从浏览器进程设置这些覆盖，而不是改页面脚本。
- 画布、WebGL、音频、系统字体没有“既不注入脚本、又不和真实机器矛盾”的开关。第一版保持引擎原值。

## 4. 总体结构

一个进程族，两条边界。

```text
壳窗口（本地页面）
  标签栏（顶部或侧栏）、地址栏、状态卡片、设置页
  preload 只暴露第 12 节的 IPC

每个标签 = 一个 WebContentsView
  独立会话 persist:cave
  沙箱、contextIsolation、无 Node

Chromium 网络栈
  从启动起 socks5://127.0.0.1:<随机端口>
  主机名无法在本地解析

代理核心（独立进程，未修改的上游二进制）
  只绑定 127.0.0.1
  上游只连选中的节点；节点域名的引导解析见第 8 节
```

壳的本地页面不加载远程文档。地址栏的导航只交给标签的 `WebContentsView`。`window.open` 收成同一会话里的新标签。拒绝 `<webview>`。

配置目录是一份可以整个拷走的文件夹，默认在应用数据目录下，也可用菜单或 `CAVE_PROFILE` 换到别的路径。同一份文件夹不要在两台机器上同时开着。

```text
<profile>/
  profile.json          用户配置，可手改
  browser/              Chromium 用户数据（cookie、历史、缓存）
  downloads/
  runtime.yaml          每次启动生成的内核配置，不手改
  logs/
```

拷走整个文件夹，另一台电脑就得到同一份时区、语言、地理坐标、国家码、书签式的设置，以及登录态。内核监听端口和控制器密钥不写进 `profile.json`，每次启动重新生成。

## 5. 配置文件

`profile.json` 是唯一的用户配置。地理坐标缺任何一项，就视为没设置。

```json
{
  "version": 1,
  "locale": "en",
  "acceptLanguages": ["en"],
  "timezone": "UTC",
  "geolocation": null,
  "egressCountry": "",
  "allowPrivateNetwork": false,
  "notifications": false,
  "proxy": {
    "subscriptionName": "",
    "selectedNode": ""
  }
}
```

地理坐标一旦设置，形状是 `{ "latitude": 1, "longitude": 2, "accuracy": 1000 }`。三项都要有。精度由用户给定，软件不把它改精确，也不检查这个点是否落在 `egressCountry` 里面。用户有责任让这个点位于自己使用服务的地区；软件不加第二道门。

第一次启动，如果文件夹里没有 `profile.json`，用当时这台机器的时区和语言环境生成一份，地理坐标为 `null`，`egressCountry` 为空字符串，两个布尔都是 `false`。之后不再读操作系统的时区。办公室那台机器只认这份文件。空的 `egressCountry` 表示闸门保持关闭，直到用户填上国家码。这是一个文本字段，ISO 3166-1 alpha-2，不是定位。

壳的界面语言是简体中文。网页看到的语言只来自 `locale` 和 `acceptLanguages`。两者分开。

订阅正文不放进 `profile.json`。导入的 Clash YAML 原样放在配置目录，节点选择只存节点名字。

## 6. 网站看到的浏览器

原则：能用引擎接口写成“这就是 Chrome”的，写成 Chrome；写不成而不撒谎的，保持原样。不注入页面脚本，不用 preload 改 `navigator`、`WebGLRenderingContext`、`HTMLCanvasElement`、`AudioContext` 或 `Function.prototype.toString`。

### 6.1 做成普通 Chrome 的部分

UA 字符串使用 Chromium 的精简形式，主版本取 `process.versions.chrome`，平台取本机，不写 Electron：

- Windows：`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36`
- macOS：`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36`

`navigator.platform` 与之对应：`Win32` 或 `MacIntel`。Linux 构建用 `X11; Linux x86_64` 和 `Linux x86_64`，不在第一版承诺。

`Sec-CH-UA*` 和 `navigator.userAgentData` 通过 `Emulation.setUserAgentOverride` 的 `userAgentMetadata` 设置。品牌列表以本构建 Chromium 自己的列表为起点，删掉任何 `Electron`，并保留 `Chromium` 与 `Google Chrome`（主版本相同）。GREASE 品牌和顺序沿用引擎自己的算法，不手写一套，免得和同版本 Chrome 错位。`mobile` 为 false，`model` 为空。高熵字段里的架构与本机一致（arm64 硬件是 arm，不写成 x86）。

传统 UA 同时用 `session.setUserAgent(ua, acceptLanguages)` 写一次，保证没有 CDP 的内部请求也是同一字符串。两处的输入是同一个函数的返回值。

时区：每个标签在导航前调用 `Emulation.setTimezoneOverride`，参数是配置里的 IANA 时区。新建的 `webContents`（含 `window.open`）走同一条路径。

语言：`Emulation.setLocaleOverride` 使用 ICU 形式（`en_US`），`Accept-Language` 和 `navigator.languages` 使用配置里的 BCP 47 形式（`en-US`）。启动参数带 `--lang`。页面里的 `Intl` 和请求头因此是同一语言的两种拼写，而不是两套语言。

地理坐标：配置里有完整的三点时，`Emulation.setGeolocationOverride` 传入纬度、经度和精度，权限处理对 `geolocation` 返回允许。没有三点时不调用覆盖，权限处理返回拒绝。两条路都不调用操作系统的定位 API。

权限默认拒绝，用 `setPermissionRequestHandler` 和 `setPermissionCheckHandler` 一起做（Electron 要求两个都实现，只写一个会漏）。设备类再用 `setDevicePermissionHandler` 拒绝。拒绝的类型：`media`、`display-capture`、`geolocation`（未配置时）、`clipboard-read`、`notifications`（配置未打开时）、`idle-detection`、`hid`、`serial`、`usb`、`bluetooth`、`fileSystem`、`local-fonts`、传感器和 MIDI。

允许的类型：`clipboard-sanitized-write`、全屏、以及配置打开后的 `notifications`。键盘粘贴走的是用户手势下的粘贴事件，不依赖 `clipboard-read`，所以默认拒绝读剪贴板不会弄坏粘贴；页面在后台调用 `navigator.clipboard.read()` 则被拒绝。

`local-fonts` 拒绝的是 Local Font Access API。这挡不住画布和 `document.fonts` 看到已安装字体，见第 6.3 节。

WebRTC 使用启动参数 `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`，不在页面里改 `RTCPeerConnection`。QUIC 用 `--disable-quic`。IPv6 用 `--disable-ipv6`，内核侧再关一次，见第 8 节。

不传 `--enable-automation`，不调用 `Emulation.setAutomationOverride`（该命令的 `enabled` 是把自动化标成打开）。不启动 `crashReporter`。

### 6.2 故意不改的部分

| 表面 | 处理 | 原因 |
| --- | --- | --- |
| 画布、WebGL 渲染器、WebGPU、音频指纹 | 保持引擎原值 | 脚本改写有痕迹；改成另一块 GPU 的字符串会和本机平台矛盾 |
| 系统字体 | 不枚举、不替换。只拒绝 Local Font Access | Mac 与 Windows 的字体集本来不同。伪造一份共同列表会和画布测量矛盾 |
| `screen`、`devicePixelRatio`、窗口外框 | 不调用 `Emulation.setDeviceMetricsOverride` | 那是开发工具的设备模拟，视口和真实窗口会对不上 |
| `hardwareConcurrency`、`deviceMemory` | 不覆盖 | 后者没有 CDP 命令。只改前者会让两项彼此不配 |
| 媒体设备数量 | 不启用虚假设备 | `--use-fake-device-for-media-stream` 是自动化特征。未授权时标签为空，数量仍可能露出，接受 |
| 电池 API | 不处理 | Chromium 156 已不再向普通网页提供 Battery Status API |
| 平台 | UA 跟本机操作系统走 | 在 Mac 上声称 Windows，会和 GPU、字体、平台提示矛盾，等于伪装一台假设备 |

窗口大小是普通的界面偏好，可以记住，但不把它写成 `screen.width`。

家里是 Mac、办公室是 Windows 时，两台机器的 UA 平台、GPU 和字体不相同。配置文件对齐的是时区、语言、地理坐标和期望的出口国家。这是有意的：一致，是指用户选定的环境一致，不是两台电脑伪装成同一台假电脑。

### 6.3 网站仍然可能推断的东西

这些不是缺陷清单里要补的洞，是这个设计接受的限度：

- 出口 IP 的信誉、是否机房、ASN、以及到网站的延迟。自检面板可以让用户看到，软件不为此换节点、不为此改指纹。
- 本机 GPU 的 WebGL 非屏蔽渲染器，以及本机已安装字体。这是 Mac 与 Windows 之间最大的差异。
- `screen` 的尺寸和缩放。
- `hardwareConcurrency` 与 `deviceMemory` 的真实分桶值。熵不高，但两台电脑可能不同。
- 如果调试器附着被某页检测出来。处理方式见第 3 节，不是注入脚本盖住。
- Electron 与同版本 Chrome 在 `window.chrome` 形状上的差异。第一版不填一个假的 `window.chrome`。手工测试时和同主版本的 Chrome 对比，有明显差异再考虑引擎补丁。

第三方检查页（第 11 节）用来看上面这些是否和预期一致，不用来追逐分数。

## 7. 出口只有一条路

保证方式只有一个：Chromium 从进程启动起就不能直接连出去，唯一的代理是本机端口；这个端口背后不是我们的内核时，连接失败。不加系统防火墙，不用 `webRequest` 再拦一层，也不做第二套包过滤。那些是同一结论的重复实现。

### 7.1 进程启动参数

端口在 `app.ready` 之前就选好。下面全部用 `app.commandLine.appendSwitch`，发生在任何网络请求之前。

- `--proxy-server=socks5://127.0.0.1:<mixed端口>`
- `--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1`
- `--disable-quic`
- `--disable-ipv6`
- `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`
- `--disable-background-networking`
- `--disable-component-update`
- `--disable-domain-reliability`
- `--disable-breakpad`
- `--disable-features=DnsOverHttpsUpgrade`

`ready` 之后立刻调用：

```js
app.configureHostResolver({
  secureDnsMode: 'off',
  enableBuiltInResolver: false
})
```

然后对默认会话和 `persist:cave` 都执行：

```js
await ses.setProxy({
  proxyRules: 'socks5://127.0.0.1:<mixed端口>',
  proxyBypassRules: '<-loopback>'
})
```

`<-loopback>` 是必须的。Electron 默认让回环绕过代理；这个标记把该例外去掉。空字符串做不到这一点。

为什么解析规则和代理要写在一起：Chromium 的 `socks5://` 在解析成功时会把 IP 交给代理，DNS 就发生在本机。`MAP * ~NOTFOUND` 让除了 `127.0.0.1` 以外的名字无法解析，SOCKS5 于是把主机名交给代理，由内核在远端解析。去掉这条规则，代理设置本身并不关闭本地 DNS。这是同一条路径的两个参数，不是两道闸。

IP 字面量的请求不经过解析器，但因为没有绕过规则，仍然进 SOCKS。内核收到 IP 后按第 8 节的规则走代理或拒绝，不在本地放行。

`ready` 之后、第一次 `setProxy` 之前，不创建会发请求的窗口。启动参数里的 `--proxy-server` 覆盖这个空窗，包括组件更新和崩溃上报那些子系统；对应功能同时被上面的开关关掉，避免它们另找出口。

应用自己的 HTTP 只用被设置过代理的会话上的 `net.fetch`。主进程不使用 `node:https`、`node:http` 和 `node:dns`。这条写进代码评审约定，并由第 15 节的测试兜住。

### 7.2 闸门状态

闸门是界面状态，不是第二套过滤器。代理端口始终指向内核；内核没起来时，浏览器的连接被拒绝，这就是失败关闭。

```text
closed --核心在听，且配置了国家码--> checking
checking --出口国家一致--> open
checking --失败或国家不一致--> closed
open --进程退出、用户暂停、复查失败--> closed
open --到点或用户要求复查--> checking
```

- 启动是 `closed`。本地壳可以操作，标签不加载远程 URL。
- `checking` 只发一个请求：经代理的会话访问 `src/main/network.ts` 中的固定核对端点，读取 `loc=`。等于 `egressCountry` 才进入 `open`。这个端点会看到出口 IP，这是它的用途。不设第二个端点，免得静默换一家、也免得在多家留下查询。
- 端点故障和“国家不对”在界面上分开写。两者都回到 `closed`。不因为核对站点宕了就放行。
- `open` 期间每 5 分钟复查一次，换节点、内核重启、用户点重新检查时也复查。一次失败就关闭。
- 进入 `closed` 时调用 `ses.closeAllConnections()`，并向内核 `DELETE /connections`，停掉已经建立的连接。
- 用户暂停：结束内核进程，再 `closeAllConnections()`。节点选择留在 `profile.json`。恢复时重新拉起内核并进入 `checking`。暂停不是“还在转发，只是界面变红”。
- 内核进程一旦退出，立刻进入 `closed`，不等下一个 5 分钟。

地理坐标不参与这些转移。填不填、填哪里，都不影响闸门。

壳在 `closed` 和 `checking` 时不把远程 URL 交给标签。这是界面行为。真正使数据包出不去的，仍然是第 7.1 节：即使界面写错，目标也只是一个没人听的本机端口。

### 7.3 内核停止时没有别的路

宿主机的 TUN 是通的，也不改变第 7.1 节。浏览器不会退回到系统代理，也不会因为默认路由可用就直接发。第 9 节说明为什么宿主机 TUN 不会被误当成 Cave 自己的代理。

## 8. 代理核心

上游是 MetaCubeX 发布的内核 v1.19.34（仓库 `MetaCubeX/mihomo`，GPL-3.0），独立进程，二进制不修改。产品名、仓库名、我们发布的可执行文件名都不包含 `mihomo`。许可细节在第 14 节。

### 8.1 生命周期

1. 在 `127.0.0.1:0` 上试绑两次，得到混合端口和控制器端口，立即关闭试绑。绑定失败就换端口。不使用 7890、9090 或其他固定端口。
2. 生成 32 字节的控制器密钥。
3. 把 `runtime.yaml` 写进配置目录。
4. 启动内核：`-d <profile> -f <profile>/runtime.yaml`。工作目录里没有用户原来的订阅文件当配置用。
5. 轮询 `GET http://127.0.0.1:<控制器>/version`，带 `Authorization: Bearer <密钥>`。超时则闸门保持 `closed`，界面显示拉起失败。
6. 进程退出后按 1s、2s、4s 退避重启，上限 30s，全程保持 `closed`，直到一次出口核对成功。应用退出时先 SIGTERM，超时再 SIGKILL。
7. `app.requestSingleInstanceLock()`，避免两套随机端口和同一份配置目录打架。

控制器只绑定在回环地址上，并且带密钥。页面连不到它：回环流量也进代理，随后被规则拒绝。

### 8.2 运行配置

订阅文件只贡献代理服务器定义。其中的 `rules`、`tun`、`dns`、`port`、`mode`、`allow-lan` 全部丢弃。用户的订阅里即使写了 `mode: direct` 或 `TUN: enable`，也不会被执行。名字为 `DIRECT`、`REJECT`、`GLOBAL`、`COMPATIBLE` 的条目不导入。

生成的配置是下面这个形状。

```yaml
mixed-port: 38471
bind-address: 127.0.0.1
allow-lan: false
ipv6: false
mode: rule
find-process-mode: off
log-level: warning
geo-auto-update: false
external-controller: 127.0.0.1:41923
secret: "<每次启动随机>"

tun:
  enable: false

dns:
  enable: true
  ipv6: false
  enhanced-mode: normal
  use-hosts: false
  use-system-hosts: false
  prefer-h3: false
  respect-rules: true
  default-nameserver:
    - 1.1.1.1
  proxy-server-nameserver:
    - https://1.1.1.1/dns-query
  nameserver:
    - https://1.1.1.1/dns-query#PROXY

proxies:
  # 只来自订阅里的代理服务器定义

proxy-groups:
  - name: PROXY
    type: select
    proxies:
      - "<节点名>"
    empty-fallback: REJECT

rules:
  - IP-CIDR,0.0.0.0/8,REJECT,no-resolve
  - IP-CIDR,10.0.0.0/8,REJECT,no-resolve
  - IP-CIDR,100.64.0.0/10,REJECT,no-resolve
  - IP-CIDR,127.0.0.0/8,REJECT,no-resolve
  - IP-CIDR,169.254.0.0/16,REJECT,no-resolve
  - IP-CIDR,172.16.0.0/12,REJECT,no-resolve
  - IP-CIDR,192.168.0.0/16,REJECT,no-resolve
  - IP-CIDR6,::1/128,REJECT,no-resolve
  - IP-CIDR6,fc00::/7,REJECT,no-resolve
  - IP-CIDR6,fe80::/10,REJECT,no-resolve
  - MATCH,PROXY
```

`allowPrivateNetwork` 为 true 时，去掉 RFC1918 和 `100.64.0.0/10` 那几条，回环和链路本地仍然拒绝。页面永远不能访问本机的控制器端口，也不能访问宿主机上另一个客户端的控制器。

不使用上游的 `mode: global`。那个模式会忽略规则，内置的 GLOBAL 组在没有显式覆盖时还有直连行为。上面这份 `mode: rule` 的效果是全局走代理：私网拒绝，其余 `MATCH,PROXY`，组为空时 `empty-fallback: REJECT`（v1.19.27 起的字段，v1.19.34 可用）。配置里不出现策略名 `DIRECT`，也不出现 `MATCH,DIRECT`。

`enhanced-mode: normal`，不用 fake-ip。fake-ip 是给 TUN 劫持准备的，会和宿主机 TUN 的假地址段缠在一起。`use-system-hosts: false`，不读系统 hosts，避免吃到宿主机客户端写进去的假 IP。

业务 DNS 是 `nameserver` 上的 `#PROXY`：DoH 查询经选中的节点出去，不落到系统解析器。`proxy-server-nameserver` 只负责解析节点自己的域名，这是上游要求的引导，不走规则，否则节点域名无法在隧道建立之前穿过隧道。它使用 IP 字面量 `1.1.1.1`，所以引导本身不再依赖一次 DNS。`prefer-h3: false`，引导不用 QUIC。不配置 `fallback` 和 `direct-nameserver`，节点挂了就不会改走别的解析器。

因此内核进程被允许的外连只有两类：到 `1.1.1.1:443` 的引导，以及到选中节点的连接。节点地址本身是 IP 时，引导查询不发生。测试按这个允许列表检查，多一个目的地址就算失败。

`geo-auto-update: false`，并且规则里不用 `GEOIP`、`GEOSITE`、`IP-ASN`，避免内核自行下载地理数据库。

健康检查是控制器的 `GET /proxies/<节点名>/delay?timeout=5000&url=<固定健康检查端点>`。这是给用户看延迟和不通的节点，不自动切换。自动切换留给以后，第一版由用户点选。

### 8.3 订阅导入

第一版只接受 Clash YAML，并且只读其中的代理服务器列表。不解析 vmess、vless、ss 等分享链接，也不跟着订阅里的 `proxy-providers` 再去下载。需要链接格式时，让订阅源给出 Clash YAML。这是有意缩小解析面。

导入有三种：本地文件、粘贴正文（都不发网络请求），以及“拉取订阅”。拉取的路线是 `profile.json` 里的 `proxy.subscriptionVia`，面板上叫“订阅拉取”：

- `direct`（默认）：主进程用 Node 的 `fetch` 经系统网络请求这一个 URL，只在用户点击时发一次，不经过任何浏览器会话。没有节点时只能这样拿到第一份订阅。这是整个应用里唯一不经内核的请求，浏览器和所有网页流量仍然没有直连。
- `proxy`：经出口核对用的那个本机入口，也就是当前选中的节点。还没有节点时直接报错，提示切到直连。

两条路线的 User-Agent 都是 `clash.meta`。拉到的正文仍然只抽取代理服务器列表，再重新生成 `runtime.yaml` 并热加载。失败就继续用上一份。

## 9. 和宿主机 TUN 共存

宿主机上的透明代理可以继续跑。Cave 的设计是不和它抢网卡，也不信它。

- 内核 `tun.enable: false`。Cave 的上游连接可以被宿主机 TUN 接走，这是允许的串联；Cave 自己不再做一层 TUN，否则会把宿主机的上游又抓回来，形成环路。
- 只绑定 `127.0.0.1` 的随机端口，`allow-lan: false`。不占用 7890 或 9090，控制器密钥也不是空的，所以不会和已经在跑的内核控制器冲突，别的本机进程也驱动不了 Cave 的内核。
- 浏览器只连接 Cave 的本机端口。到 `127.0.0.1` 的连接不进入 TUN。宿主机 TUN 是否工作，浏览器都到不了它的端口。
- 内核的上游如果被宿主机 TUN 接走，出口会再套一层。界面不把这种情况显示成“直接连到节点”。出口国家核对看到的是最终出去的国家；和国家码不符就关闭。串联是可以的，串联到另一个国家则闸门关闭。
- 不用 fake-ip，不读系统 hosts，浏览器不做本地 DNS。宿主机 TUN 常见的 `198.18.0.0/16` 假地址不会进 Chromium 的套接字。
- 闸门的存活探测是 Cave 自己的控制器和 Cave 自己的出口核对。宿主机客户端在听，不算数。

自动测试里用第二个内核进程占用 7890 和 9090，并准备一个会回答 `198.18.0.0/16` 的 DNS。断言 Cave 的浏览器进程不连接 7890，也不向那个 DNS 发查询。真实 TUN 网卡的共存放进第 15.3 节的手工测试，因为 CI 里没有那块网卡。

## 10. 浏览器壳

`Browser` 管理多个 `ShellWindow`；每个窗口持有自己的标签和焦点。最后一个窗口关闭时，所有平台都退出应用。标签是 `WebContentsView`（Electron 30 起的接口，不用已废弃的 `BrowserView`）。

标签的 `webPreferences`：`sandbox: true`，`contextIsolation: true`，`nodeIntegration: false`，`nodeIntegrationInSubFrames: false`，`webviewTag: false`，`plugins: true`（PDFium，用来看 PDF），`session` 为 `persist:cave`。

壳的 chrome、设置和 overlay 是本地页面，各自是沙箱化的 `WebContentsView`；preload 只挂第 12 节的类型化接口。网页标签不能导航到这些文件。每个窗口有一个覆盖整个窗口的透明 overlay，`Surfaces` 只在浮层打开时把它放到最上面，记录锚点和原焦点，关闭后恢复焦点。

`ShellState.focus` 区分 `chrome`、`page` 和 `overlay`。标签使用 `focusOnNavigation: false`，导航不会暗中抢走地址栏焦点；用户完成导航或取消编辑时由 `focusPage()` 明确把键盘交回页面。命令统一在 `shared/commands.ts` 声明、在 `shell/commands.ts` 绑定，应用菜单和壳内菜单共用。

第一版就有的浏览器行为：

- 多标签：已有新建、关闭、切换、前进后退、刷新和地址栏；拖动排序尚未实现。
- 下载：`session` 的 `will-download`，默认目录是配置目录下的 `downloads`，当前没有选择保存位置的界面。
- 上传：引擎自己的文件选择框。不授予持久的文件系统权限。
- 剪贴板：页面可以写，默认不能在后台读。用户的复制和粘贴可用。
- 媒体播放：引擎默认能力，不改音频上下文。
- PDF：内置查看器。
- 通行密钥：保留 WebAuthn。macOS 上调用 Electron 43 加入的 `app.configureWebAuthn()`，启用平台生物识别验证器。Windows 使用 Chromium 自带的平台验证器路径。USB 安全密钥属于 HID，默认拒绝。第一版要在真机上确认平台验证器的界面会弹出并完成；这是已知需要手工验证的平台差异，不把 API 关掉当退路。
- 通知：`notifications` 为 true 时允许站点请求，否则拒绝。
- SQLite 已接入偏好、历史访问和下载记录；书签、会话及站点设置仓库已实现，用户界面尚未接入。不做账号同步。
- 查找和缩放做基本的即可。

不做的：扩展商店、主题、账号同步、阅读模式、侧边栏应用、开发工具以外的实验功能。用户自己打开开发工具可以，开发工具依附同一会话，不另给它一条直连。

零配置的含义是：没有扩展要装，没有标志要改，时区和语言已经按第一次的机器填好。唯一必须由用户提供的是代理节点，软件编造不了。没有节点时窗口照常打开，并打开设置标签页的“节点与订阅”，网络保持关闭。导入本地 YAML、填写国家码、点一个节点，核对通过后地址栏可用。不设多步向导。

## 11. 自检面板

自检是设置标签页里的“状态与检查”（壳的本地页面，不盖在网页上）；工具栏的状态图标只弹出一张一行状态的小卡片。按闸门状态、关键检查和操作排列，只显示当前软件能验证的事实。

顶部是状态，三态之一：外网已关闭、正在核对、外网已放行。一句说明当前原因（核心没启动、还没有节点、国家码为空、国家不符、核对请求失败、用户暂停）。

关键检查共 11 项。能在本地读运行配置和进程的，不发外网请求。

| # | 检查 | 怎样判定 |
| --- | --- | --- |
| 1 | 代理核心在听 | 本进程拉起的内核仍在，且控制器 `/version` 成功。不是“某端口有人听” |
| 2 | 浏览器只走这个端口 | 会话的代理规则等于该 SOCKS 端口，且绕过规则是 `<-loopback>` |
| 3 | 浏览器不做本地 DNS | 启动参数含 `MAP * ~NOTFOUND`，`secureDnsMode` 为 `off` |
| 4 | 时区等于配置 | 本地探测页读取 `Intl`，与 `profile.timezone` 比较。探测页不访问网络 |
| 5 | 语言等于配置 | 同一探测页读取 `navigator.languages` |
| 6 | 代理不可用就会失败 | 第 2 项成立即视为已武装。真正拔掉进程的证明在自动测试和手工测试里做，面板不为了显示这一项去杀掉内核 |
| 7 | QUIC 已关 | 进程参数含 `--disable-quic` |
| 8 | IPv6 已关 | 进程参数含 `--disable-ipv6`，且运行配置 `ipv6: false` |
| 9 | WebRTC 不走裸 UDP | 进程参数含 `disable_non_proxied_udp` |
| 10 | 没有直连，私网被拒绝 | 生成的 YAML 里没有 `DIRECT`，有 `MATCH,PROXY`，回环规则是 `REJECT` |
| 11 | 出口国家等于配置 | 最近一次 trace 的 `loc` 等于 `egressCountry`。没做过核对就是不通过 |

每一项一行：通过或未通过，加一句原因。顶部显示通过数。提供“复制报告”，只复制这 11 项、闸门状态、时间、配置里的时区、语言和国家码，以及最近一次看到的出口国家。不复制画布哈希，不复制第三方网站的分数。

地理坐标不在这 11 项里。面板不显示“真实位置”，也没有核对坐标的按钮。

不预设第三方观察网站。用户可在放行后自行导航到观察页；这些普通网页不参与闸门判断。

这些页面的文案会讨论风险分和地区检测。Cave 不读取分数，不实现“怎样把分数做低”，也不为了这些页面调整指纹。用户用它们确认：时区和语言是自己配置的、没有 Electron 标记、DNS 和 WebRTC 没有把本机地址漏出去，以及第 6.3 节那些仍然可见的信号是否在自己的接受范围内。

底部两个按钮：暂停外网；暂停并重检。前者进入 `closed` 并停掉内核。后者停掉、拉起、再跑第 11 项。

### 11.1 换节点和清除数据

- 换节点：已经选过节点时，设置页里的确认框（`<dialog>`）写明从哪个节点换到哪个、连接会断开、出口 IP 会变。出口国家取本次运行里经那个节点核对到的值：已知且变化时标警告，和配置不符时说明外网会保持关闭，未知时说明会重新核对。单选框只显示内核当前的选择，点击本身不改变它。
- 网站数据只在用户点击并确认后清除，从不自动。“清除此网站数据”对当前标签页的源调用 `session.clearData({ origins })`：存储、缓存、Service Worker 按源清除，Cookie 按可注册域名清除；该源的标签页随后重新加载。“重置整个环境”对浏览会话调用不带过滤的 `clearData()` 和 `clearAuthCache()`，并用一个空白标签页替换所有标签页。`profile.json`、订阅和节点选择不在会话里，不受影响。

## 12. 代码布局

单包，不拆 monorepo。TypeScript；构建用 esbuild。界面正在迁移到 Preact，本地页面通过同一个 preload 与主进程通信。

```text
src/main/index.ts              启动、网络及 IPC 连接
src/main/profile.ts            profile.json
src/main/gate.ts               闸门状态机
src/main/network.ts            启动参数和会话代理
src/main/fingerprint.ts        UA 与 CDP Emulation
src/main/permissions.ts        网站权限
src/main/platform.ts            原生标题栏与平台判断
src/main/shell/browser.ts      多窗口、共享状态和命令分发
src/main/shell/window.ts       单窗口、视图、焦点和 TabHost
src/main/shell/tab.ts          标签及状态
src/main/shell/navigation.ts   闸门前的导航与待放行请求
src/main/shell/downloads.ts    下载生命周期
src/main/shell/surfaces.ts     overlay、锚点和焦点恢复
src/main/shell/commands.ts     命令绑定与应用菜单
src/main/shell/context-menu.ts 页面右键菜单
src/main/store/                node:sqlite 迁移、prefs、history/FTS5、bookmarks、sessions/closed_tabs、site_settings、downloads
src/main/proxy/                内核配置、进程与本机控制器
src/shared/ipc.ts              状态、调用和事件的唯一类型契约
src/shared/commands.ts         命令 id、标签和快捷键
src/shared/layout.ts, url.ts   布局与地址处理
src/preload.ts                 由契约构造桥接
src/renderer/                  chrome、设置和 overlay 本地页面
test/                          第 15 节
```

模块边界：

- `proxy/config.ts` 和 `gate.ts` 不引用 Electron，单元测试直接跑。只有 `network.ts` 调用 `setProxy` 和 `configureHostResolver`；只有 `controller.ts` 和 `process.ts` 连接内核，目标必须是 `127.0.0.1`；只有 `fingerprint.ts` 附着调试器并发送 Emulation 命令。
- `CaveCalls`、`CaveEvents`、`ShellState` 与运行时 `CALLS` / `EVENTS` 同在 `shared/ipc.ts`；preload 按表暴露方法，主进程实现 `Handlers`。IPC 根据发送者定位窗口，调用作用于发送者自己的窗口；应用菜单作用于最近聚焦窗口。没有通用 `fetch`，网页不能调用壳的桥接。
- `src/main/store/` 使用同步 SQLite、WAL、迁移和损坏库隔离恢复；`index.ts` 在 profile 中打开 `cave.sqlite`，迁移旧 `ui.json` 的布局偏好，并连接 `Prefs`、`History` 和下载仓库；失败时使用内存库并提示。其他仓库仍待功能接入。配置仍由 profile 管理。`updateProfile` 不接受“当前真实位置”。
- 本地 chrome、settings、overlay 均由 Preact 渲染；`useCave()` 订阅状态，`Icon`、`Surface` 和 `place()` 提供共享 UI，overlay 使用单一注册表。`Menu`、`Popover`、`List` 已实现但尚无页面使用；设置页使用 `Dialog`。
- `src/shared/i18n/` 提供类型化中英文词典和 `t()`；界面语言偏好保存在 SQLite，不等于网页 profile 的语言。`Browser` 在系统语言模式下使用 `CAVE_LANG || app.getLocale()`，e2e harness 默认设置 `CAVE_LANG=zh-CN`（环境已有值可覆盖）。
- 测试用 Node 自带测试运行器；端到端测试使用本地 fixture 和 SOCKS 节点，不接外网。

## 13. 构建、签名与更新

钉死 Electron 45.3.0 和内核 v1.19.34。内核二进制不提交进 git。仓库里放 `resources/proxy-core/SHA256SUMS`，CI 从上游该 tag 的发布文件下载，校验后再打进安装包。校验失败就失败构建。GPL 要求的源码以该 tag 的上游地址和随包的 LICENSE 文本满足，不在 CI 里编译 Go。

三个 GitHub Actions 任务：

- `test`：`ubuntu-latest`。单元测试，加上第 15.2 节的 Electron 出站测试。
- `build-macos`：`macos-latest`，`CSC_IDENTITY_AUTO_DISCOVERY=false`，产出未签名的 zip。
- `build-windows`：`windows-latest`，未签名的 zip。不购买证书之前不做安装器签名。

产物是 Actions 的构建产物，不是自动更新源。

可复现：`npm ci`、锁文件、钉死的 Electron 版本、钉死的内核校验和。构建脚本不从浮动的 `latest` 取文件。

自动更新先不做。未签名的 `electron-updater` 比没有更新更差。签名就绪之后的做法：macOS 用 Developer ID 和公证，Windows 用 Authenticode，更新元数据的下载走第 7.1 节的代理会话，闸门关闭时不检查更新。在那之前，用户自己替换安装包。崩溃上报保持关闭，不准备以后再打开一条直连的上报通道；如果要做，也走代理。

Linux 包可以在 `test` 之外另加一个不阻塞发布的构建，不作为第一版的用户下载。

## 14. 许可

Cave 自己的代码用 MPL-2.0。

内核是独立的 GPL-3.0 程序。Cave 通过命令行参数和本机 HTTP 与它通信，不把 Go 代码链进 Electron，也不修改二进制。按臂长原则，Cave 的 MPL-2.0 不因此变成 GPL。如果以后有人把内核编译进同一进程，这个结论就不再成立，所以不要那样做。

随包附带内核的 LICENSE、版权声明，以及 v1.19.34 的源码地址。

`MetaCubeX/mihomo` 的 README 自 2025-02-08 起还有一句额外要求：非 MetaCubeX 的下游项目，名称中不得包含 `mihomo`。这句话不在 LICENSE 正文里，GPL 对额外限制另有规定；我们仍然遵守，因为它不花钱，也没有好处去争。产品叫 Cave。本文只在指明上游仓库时写出这个词，不是给我们的程序起名。

## 15. 测试

自动测试不访问用户真正使用的网站，也不把社区检查页当测试目标。需要一个“网站名字”的地方用 `example.com`，但连接停在测试自己的本地服务器上，不完成到公网的握手。其余用本地 HTTP 服务器。

### 15.1 单元测试

- 配置校验：缺了精度的地理坐标保存为 `null`；国家码大小写规范化；没有“真实位置”字段。
- YAML 生成：任意订阅输入下，输出都不含 `DIRECT`、不含 `tun.enable: true`、不含 `fake-ip`、`ipv6` 为 false、`bind-address` 是 `127.0.0.1`、`MATCH,PROXY` 存在、回环是 `REJECT`、`nameserver` 含 `#PROXY`、`use-system-hosts` 为 false、`empty-fallback` 为 `REJECT`。订阅里自带的规则和 TUN 段不出现在输出中。
- 端口：连续生成不使用 7890 和 9090。
- 状态机：第 7.2 节的每条转移，包括进程退出立刻到 `closed`，以及地理坐标的变化不引起转移。
- UA：结果不含 `Electron`；品牌含 `Chromium` 和 `Google Chrome`，不含 `Electron`；Windows 与 macOS 字符串不混用。

### 15.2 Linux 上的进程测试

这是那一个出站测试，分成观察者和被测进程，而不是多层产品代码。

1. 测试进程在 `127.0.0.1` 上启动一个只记录目标、不向外连接的 SOCKS5。
2. 拉起 Electron，启动参数按第 7.1 节指向这个端口。不拉起真实内核，这样“端口背后没有可用上游”和“有上游”可以分开看。
3. 用 `strace -f -e trace=connect,sendto,sendmsg` 跟踪 Electron 进程树。
4. 导航到 `http://example.com` 和一个 `https://example.com`。本地 SOCKS 不把连接转出去，所以页面加载失败是预期。SOCKS 记录里应当出现主机名 `example.com`。`strace` 里 Electron 进程树的所有外连目标都是 `127.0.0.1` 的该端口。没有其他 IPv4 或 IPv6 目的地址，没有 UDP DNS。
5. 关掉 SOCKS，再导航一次。页面失败。`strace` 仍然只有到 `127.0.0.1` 的尝试。
6. 另起一个占用 7890 的监听，和一个会回答 `198.18.0.1` 的 DNS。重复第 4 步。Electron 不连接 7890，不向该 DNS 发包。
7. 再跑一轮带真实内核的测试：内核的上游配成本地的一个静态节点（测试里的 TCP 服务，不出去）。Electron 进程树仍然只能连接本机端口。内核进程的允许列表是这个本地节点，以及节点写成域名时才会出现的 `1.1.1.1:443`。任何一个进程出现允许列表之外的目的地址，测试失败。然后杀掉内核，重复第 5 步的断言。

指纹无头测试，页面是本地文件，结果发回 `127.0.0.1`：

- 时区、`navigator.languages` 与配置一致。
- UA 和 `userAgentData.brands` 不含 `Electron`，`webdriver` 为 false。
- 配置了地理坐标时，定位回调返回该纬度和经度。
- 没配置时，定位请求被拒绝。
- 本地页创建 `RTCPeerConnection`，候选里没有私网主机地址。

这些测试在 Linux CI 上跑。它们证明的是进程的连接目标和引擎报告的配置值。它们代替不了 Mac 与 Windows 上字体、GPU、通行密钥和真实 TUN 的观察。

### 15.3 真机手工测试

每一项在 Mac 和 Windows 上各做一次。预期写在后面。

1. 全新配置启动。窗口打开，状态是外网已关闭，地址栏输入 `https://example.com` 不会发出页面。预期：没有远程内容，报告里第 1 项未通过。
2. 导入一份本地 Clash YAML，填写与节点相符的国家码，选中节点。预期：状态变为外网已放行，`https://example.com` 打开。
3. 结束内核进程。预期：正在加载的页面失败，状态立即变为关闭。同时用抓包工具或 `pktmon` 看 Cave 的进程，没有新的外网连接。
4. 把操作系统时区改成和 `profile.json` 不同的值，完全退出后重开。预期：自检第 4 项通过，本地探测页仍是配置文件里的时区，而不是刚改的系统时区。
5. 在系统设置里打开定位服务的情况下访问一个请求定位的本地页面。配置为空时预期拒绝，并且操作系统没有弹出定位提示。填入坐标后预期返回该坐标，仍然没有操作系统定位提示。
6. 打开一个本地页面打印 UA、`navigator.userAgentData`、`navigator.platform`、`webdriver`。预期：没有 Electron 字样，品牌里有 Google Chrome，平台和本机一致，`webdriver` 为 false。再和本机安装的同主版本 Chrome 看一眼 `window.chrome`，把差异记进问题，不在页面里补。
7. 宿主机打开系统级 TUN 客户端，并确认它自己的系统代理是通的。启动 Cave 并放行。预期：Cave 的控制器端口不是 9090，宿主机客户端仍然可用；Cave 内看到的出口国家是 Cave 配置的国家。若串联导致国家不符，预期 Cave 关闭而宿主机 TUN 保持原样。然后只结束 Cave 的内核、留下宿主机 TUN。预期：Cave 关闭，不因为宿主机仍通着就继续加载。
8. 在 Cave 里打开一个由你选择的浏览器信号观察页。预期：它只是普通标签；自检报告的通过数不因页面内容而改变。不根据页面上的分数做任何设置。确认页面上没有本机私网 IP，时区和语言与配置一致。WebGL 和字体显示本机真实值，这是预期，不是失败。
9. 各做一次：下载一个小文件、在 `example.com` 或本地页上传一个文件、复制粘贴、打开一个本地 PDF、播放一个本地或 `example.com` 上的媒体。预期：都完成。再在一个网页里触发平台通行密钥。预期：macOS 出现平台生物识别验证器，Windows 出现系统平台验证器。USB 密钥不会被网页静默打开。
10. 点暂停，再点暂停并重检。预期：暂停后远程导航失败；重检在节点健康且国家相符时回到放行，否则保持关闭并写明原因。

## 16. 实现顺序

实现不在本次变更里。建议的顺序：

1. `profile`、`gate`、`proxy/config` 和它们的单元测试。
2. 内核进程和控制器，然后第 15.2 节的出站测试。出站测试没绿之前不做界面。
3. 会话、权限、UA 和 CDP 覆盖，加上本地指纹测试。
4. 标签、下载、地址栏。
5. 自检面板和设置。社区检查只是两个链接。
6. CI 的 macOS 与 Windows 未签名包。

签名和自动更新放在真机手工测试之后。引擎补丁只有在第 6.3 节的某项被判定为不能接受时才单独立项。

## 17. 已知限度

- Mac 与 Windows 的字体、GPU、屏幕、硬件并发数不会变成同一份。这是第 6 节的决定，不是未做完的事项。
- 出口 IP 的信誉和延迟可见。
- 出口核对依赖 `src/main/network.ts` 中的单一固定端点。它不可达时，代理即使是好的，闸门也关闭。不自动换备用站点。
- 节点域名的引导会让内核连接 `1.1.1.1:443`。这是建立隧道之前唯一的非隧道连接。节点若写成 IP，则没有这一跳。
- 调试器附着和 `window.chrome` 是否与同版本 Chrome 有可见差异，要靠第 15.3 节第 6 项确认。确认前不预写补丁。
- 平台通行密钥的系统界面要靠第 15.3 节第 9 项确认。
- 订阅只接受 Clash YAML。
- 未签名，没有自动更新。
- Linux 能跑测试，不作为第一版要交付的桌面。

## 18. 已经定下的决定

这些不需要再确认才能开始实现。

- 栈是 Electron 45，不维护独立浏览器引擎分支。
- 失败关闭由“启动即固定的本机 SOCKS + 不能本地解析”实现，不加防火墙和 `webRequest` 拦截层。
- 不跨操作系统伪造 UA，不注入指纹脚本，不覆盖画布、WebGL、字体和屏幕。
- 地理坐标只是配置，不探测真实位置，不设额外门槛，不参与闸门。
- 出口国家是另一字段，用一次经代理的 trace 核对。
- 内核非 TUN、随机端口、规则模式等价于全局代理，没有 DIRECT，DNS 走 `#PROXY`。
- 与宿主机 TUN 串联可以，冒充不可以。
- 内核纯全局：闸门打开时 `MATCH,PROXY`，关闭时 `MATCH,REJECT`，没有分流规则。
- 自检面板按状态和检查分层，不提供虚拟机管理功能。第三方页面不参与闸门，软件不读取它们的分数。
- Cave 自己的代码用 MPL-2.0。内核按未修改的 GPL-3.0 独立程序随包提供。
- 第一版不签名、不自动更新。

## 19. 参考

版本均按 2026-11-11 可公开核对的页面。

- Electron 发布页：45.3.0，Chromium 156.0.8078.96，Node.js 24.22.2。同日还有 44.11.1（Chromium 152）。采用 45。
- Electron `session.setProxy`、`closeAllConnections`、`setPermissionRequestHandler`、`setPermissionCheckHandler`、`setDevicePermissionHandler`、`setUserAgent`。
- Electron `ProxyConfig`：`proxyBypassRules` 中的 `<-loopback>` 用来取消默认的回环绕过。
- Electron `app.configureHostResolver`：`secureDnsMode` 取 `off`、`automatic` 或 `secure`。
- Electron 命令行开关文档中的 `--host-resolver-rules`。`--disable-quic` 定义于 Chromium `network_session_configurator`；`--disable-ipv6`、`--disable-background-networking`、`--disable-component-update`、`--disable-domain-reliability`、`--disable-breakpad`、`--force-webrtc-ip-handling-policy` 定义于 Chromium 的开关列表。
- CDP `Emulation`：`setUserAgentOverride`（含 `userAgentMetadata`）、`setTimezoneOverride`、`setLocaleOverride`、`setGeolocationOverride`、`setHardwareConcurrencyOverride`。没有 `deviceMemory` 的覆盖命令。`setDeviceMetricsOverride` 是设备模拟，本设计不使用。
- `app.configureWebAuthn()`：Electron 43 起提供，用于 macOS 平台生物识别验证器。
- 上游内核是 `MetaCubeX/mihomo` v1.19.34，发布于 2026-11-11。DNS 的 `#PROXY`、`proxy-server-nameserver`、`respect-rules`、`empty-fallback` 见其配置文档。`empty-fallback` 自 v1.19.27 起。
- 该仓库 Meta 分支 README 的 GPL-3.0 声明，以及 2025-02-08 起的下游命名要求。
