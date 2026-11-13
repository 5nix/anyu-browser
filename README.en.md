<img src="design/logo/anyu-icon.svg" alt="Anyu" width="64">

[中文](README.md)

# Anyu

Anyu is a desktop browser whose network traffic only goes through a bundled proxy core, with no direct connection under any failure. Unlike a normal browser pointed at a proxy, browsing stays closed until Anyu verifies that the exit country in use right now matches your configuration, and it presents a consistent time zone, language, and optional location matching that exit to websites.

## Download and install

Download pre-release builds from the repository's [Releases page](https://github.com/5nix/anyu-browser/releases).

The builds are not code-signed yet, so both macOS and Windows block the first launch.

### macOS

- **Apple silicon**: `Anyu-<version>-mac-arm64.dmg` (or `Anyu-<version>-mac-arm64.zip`)
- **Intel Mac**: `Anyu-<version>-mac-x64.dmg` (or `Anyu-<version>-mac-x64.zip`)

To install and open:

1. Open the `.dmg` and drag `Anyu` to Applications (or extract the `.zip` and move `Anyu.app` to `/Applications`).
2. Because the app is not notarised, opening it the first time is blocked; dismiss the prompt, open **System Settings → Privacy & Security**, and click **Open Anyway**.
3. Alternatively, clear the quarantine attribute in Terminal before opening:

```bash
xattr -dr com.apple.quarantine /Applications/Anyu.app
```

### Windows (x64)

- **Installer**: `Anyu-<version>-win-x64.exe`
- **Portable archive**: `Anyu-<version>-win-x64.zip` (extract and run `Anyu.exe`)

When SmartScreen shows **"Windows protected your PC"**, click **More info** → **Run anyway**.

## First run

On first launch, Anyu opens the setup guide in this order:

1. **Welcome**: Choose the interface language (`中文` / `English`) and click **Get started**.
2. **Connect**: Choose how to connect:
   - **A subscription link or node configuration**: Enter a Clash subscription URL and click **Get nodes** (this fetch visits the URL once directly from this computer, not through a proxy), choose a local Clash YAML file, or paste Clash configuration text.
   - **Proxy software already running on this computer**: Choose `SOCKS5` or `HTTP`, enter the loopback address (such as `127.0.0.1`) and port (commonly `7890` or `10808`), plus optional username and password.
3. **Node and exit country**: If using a subscription or configuration, select a node (you can click **Test speed**), choose the expected **Exit country or region**, and click **Check exit**.
4. **Check exit**: Anyu checks the proxy core, node or local port, and the current exit country. Browsing opens only after the exit matches and shows **Internet allowed**; otherwise it stays closed so you can switch nodes or change the configured country.
5. **Identity**: Based on the verified exit country, Anyu proposes a matching **Time zone**, **Languages for websites** (without changing Anyu's own interface language), and **Location** (deny location requests, or report near the measured city centre within about 5 km). Accept them, click **Adjust**, or keep your current values.
6. **Personalise**: Choose appearance (follow system, light, or dark), tab position (top or side), search engine (DuckDuckGo, Google, Bing, or a custom HTTPS template), and optionally import HTML bookmarks, then click **Start browsing** (Anyu restarts automatically if time zone, language, or location changed).

You can run the setup guide again at any time from **Settings → Status and checks → Start setup guide** without losing your settings or nodes.

## Connection modes

You can switch between the three connection modes in **Settings → Proxy → Connection**. Exit checks and the gate apply in all three modes:

| Mode (Settings label) | Traffic path | When to choose it |
| --- | --- | --- |
| Default mode (`system`) | Built-in core dials the selected node following the system network route | When importing a Clash subscription or YAML directly, or alongside host TUN software that does not rewrite destinations (such as Loon) |
| Alternative mode (`independent`, Windows only) | Built-in core binds outbound sockets to the OS-selected physical uplink adapter, bypassing host TUN | On Windows when another proxy client's TUN with destination-overriding TLS sniffing (such as FlClash) breaks Reality or similar nodes in default mode; stays closed if no usable uplink is found |
| Advanced mode (`external`) | Built-in core forwards all traffic to an HTTP/SOCKS5 port on this computer (`127.0.0.1` / `localhost` / `::1`) | When you want your own local proxy software to manage nodes and protocols |

An honest caveat for **Advanced mode** (`external`): Anyu hands traffic to your own proxy software, so routing rules in that software decide where traffic actually goes. Anyu cannot inspect those rules; it verifies the exit via its built-in trace endpoint and up to 10 HTTPS URLs you add to the **Monitor URL list**, closing if any fails or mismatches, but domains routed directly outside that list are not visible to Anyu.

## Known limitations

- **Pre-release**: Version 0.1.0 is a pre-release; expect rough edges. Installers are unsigned and have no automatic updater. Unsigned macOS builds cannot use platform biometric or keychain passkeys.
- **Partial fingerprint consistency**:
  - Inside Web Workers (Dedicated Workers and Service Workers), `navigator.platform` when spoofing a non-host OS, fonts, and WebGL/GPU information still reflect the real machine.
  - Screen colour depth (`screen.colorDepth`), screen dimensions, hardware concurrency, and device memory are not overridden and reflect the real machine.
  - The Local Font Access API (`queryLocalFonts`) is denied, but websites can still detect installed fonts—including newly installed fonts—by measuring rendered text or checking `document.fonts`.
  - `window.chrome` only includes what Electron ships and differs from Google Chrome.
  - Under an extreme startup race, a `SharedWorker` can execute initial code before debugger overrides attach.
- **Host TUN sniffing and Reality nodes**: In default mode alongside host TUN clients that enable TLS sniffing with `override-destination` (such as FlClash), Reality node handshakes can fail unless you switch to Alternative mode on Windows or add the node IP to `sniffer.skip-dst-address` in the host client.
- **Subscriptions and exit check**: Subscriptions only parse Clash YAML `proxies:` lists (share links and `proxy-providers` are not supported). Exit checks depend on reaching the built-in trace endpoint (and configured monitor URLs); if unreachable, browsing stays closed. If a node uses a hostname instead of an IP, the core resolves it via `1.1.1.1` / `https://1.1.1.1/dns-query` before connecting.
- **Sessions and profiles**: All tabs share one browser session (per-tab container isolation is not implemented yet). Cookies are encrypted with the OS keychain or DPAPI, so copying a profile folder across different operating systems may not keep signed-in sessions. Extensions and account sync are not supported. Changing time zone, language, geolocation, platform, or notifications requires restarting Anyu.

## Build from source and contribute

Requires Node 24:

```bash
npm ci
node scripts/fetch-core.mjs
npm start
```

Engineering and internal documentation lives under `docs/`:

- [Development and internals](docs/DEVELOPMENT.md) (tests and packaging, network isolation and gate internals, `profile.json` format, proxy core and licensing notes)
- [Architecture](docs/ARCHITECTURE.md)
- [Connection (egress) modes design](docs/egress-modes.md)
- [Manual test checklist](docs/MANUAL_TESTS.md)
- [Windows validation record (2026-11-13)](docs/windows-validation-2026-11-13.md)
