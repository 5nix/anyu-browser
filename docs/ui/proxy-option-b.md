# Proxy page against option B

Side-by-side comparison of the approved mockup (option B, scenes B-1 and B-4) with the page as merged in 98533a5. Each line says what B does, what the page did, and what happens to it.

## 代理 page (B-1)

| # | Option B | Page as merged | Action |
|---|---|---|---|
| 1 | Header line: hint on the left, then **测速** and **＋ 添加订阅…** as bordered buttons | Only 测速 | Add 添加订阅…, which opens the subscription form |
| 2 | Hint: "点按一行切换节点。切换前会先确认，并断开当前所有连接。" | "切换节点前会先确认；切换会断开当前所有连接。" | Use B's copy (zh and en) |
| 3 | Source card header: an icon for the kind of source (RSS for a link, a file for an import), the source name in semibold, then "N 个节点 · host · 直连更新" | Generic network icon, the word "订阅", "N 个节点" | Icon and subtitle follow the real source: the link's host and its update route, or "手动导入 · 不发网络请求" when there is no link |
| 4 | Header actions: accent text button **更新** (or **重新导入** for a file) and a **⋯** icon button | Bordered "更新订阅" button | Text button plus ⋯ menu (edit link, import from file, paste) |
| 5 | No disclosure: management lives in ⋯ and 添加订阅… | `<details>` "管理订阅与导入" with the default triangle at the bottom of the card | Removed; the form opens inside the card, under its header, from ⋯ or 添加订阅… |
| 6 | Nodes in two columns filled top to bottom (column-major), separated by a 28 px gutter | Row-major grid | Column-major order |
| 7 | Hairlines only between rows of a column, starting after the check column (24 px in), none under the last row | Hairline under every row, including the last, full width | B's hairlines |
| 8 | A few nodes still read as a list | One node took half a row, the other half empty | Fewer than four nodes use one full-width column; four or more use B's two columns |
| 9 | Row: 38 px; check column 14 px; name (13 px); protocol (12 px, secondary); latency right-aligned in a fixed 48 px column | Same parts, but 8 px inner padding so the text is not aligned with the header, latency 52 px min | B's metrics; text aligns with the card's 16 px inset |
| 10 | Selected row: a soft accent pill that overhangs the column by 8 px on each side (inset 3 px), name in medium weight, Lucide check icon | Flat 8 % tint inside the row, a text "✓" glyph, regular weight | B's pill, weight and icon |
| 11 | Hover (mockup row idiom): the same pill shape in the neutral hover colour | Rectangular hover across the row | Same pill shape as selected |
| 12 | Exit country of a checked node reads "出口国家 A" (country name) | "出口 QM" (code) | Country name through `Intl.DisplayNames` |
| 13 | A timed-out node shows "超时" in red, untested shows "—" | "—" for both | Not possible: the controller reports a timeout and "never tested" the same way (`delay: null`); left as "—" |
| 14 | Two sources (示例订阅 by link, backup.yaml by file), each its own card | One card | Not possible without a source list in the profile and a merging import in `gatekeeper.ts`, which this change may not touch; one card for the one source there is |
| 15 | Footnote under the cards: "出口国家在切换并核对后才知道；核对过的节点会显示'出口国家 A'。" | None | Add, with the configured country's name |
| 16 | Card frame: 1 px hairline, radius 10, header 56 px with 16 px left / 10 px right padding | 16 px both sides | B's padding |
| 17 | Empty state: not drawn | Text row inside the card | Card says there are no nodes yet and opens the form |

## 状态与检查 (B-3) leftovers

| # | Option B | Page as merged | Action |
|---|---|---|---|
| 18 | Mismatch row subtitle: "实际是国家 B（198.51.100.23），环境配置要求国家 A" in red | "国家 A · 203.0.113.7" in red, then the same sentence again in the fix panel | B's sentence in the row; the panel no longer repeats it |
| 19 | Fix panel: "换成本次核对为国家 A 出口的节点：" with each node and a 切换 button (first one primary) | Inline text, a 更换节点 button and candidates on one line | B's layout; with no verified node, a 更换节点… button |
| 20 | "或者，如果你本来就想用国家 B：把环境配置改成 QN" | Missing | Add. It uses the existing `updateProfile({ egressCountry })` call, after a confirmation; the gate re-checks on its own |

## Toolbar status card (B-4) leftovers

| # | Option B | Page as merged | Action |
|---|---|---|---|
| 21 | Paused: 代理核心 "在运行", 节点 "节点 02" | 代理核心 and 节点 both "未知" | Pausing stops the core (`gatekeeper.pause`), so B's "在运行" would be false: the core row reads "暂停时停止" (neutral, no red mark, also on the status page), and the node row shows the selected node from the profile (`panelData`) |
| 22 | Paused: exit row reads "暂停时不核对" | "尚未核对" | B's copy |

## Not changed

- The settings navigation (B fills the current item with the accent) is shared by every settings page.
- The page title weight and the 640 px column of the mockup frame: the settings frame is shared by every page.

## Result (screenshots in a local scratch folder)

Done: 1–12 and 15–22. Left as they are:

- **13 超时**: the controller reports a timed-out node and an untested one the same way (`delay: null`); telling them apart needs a change in `src/main/proxy/controller.ts`.
- **14 Two source cards**: the profile holds one subscription link and every import replaces the node list (`gatekeeper.install`). A source list is a model change in files this work may not touch. The page draws one card for the one source; with a source list each would get its own card unchanged.
- **⋯ 移除**: there is no call that clears the node list, so the menu offers edit link, import from file and paste only.
- **Source name**: B shows a name ("示例订阅"); the profile keeps only the link, so the title is its host (or "导入的节点").
- **Latency in the screenshots** is "—": 测速 goes to the fixed health-check endpoint, which the test world's local SOCKS node refuses.
- **More than one form**: B never draws the subscription form; it opens inside the card in the sunken style of B's inline fixes.

历史截图中包含具体国家或城市的版本已移除；布局决定以本文为准。
