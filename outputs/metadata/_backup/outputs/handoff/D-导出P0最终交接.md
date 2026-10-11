# 交接：导出 P0 收尾 / D（本轮补齐 Codex 中断项）

日期 2026-10-11。承接 `outputs/handoff/D-导出P0核心中间交接.md`（当时 **G2 未通过**）。本文件记录**本轮补齐的两处未竟项**与端到端证据。

## 背景：Codex 中断在哪

Codex 会话（截图）在「最终导出 / 双端渲染 / 浏览器预览下载验证」阶段因额度耗尽中断，最后两条状态为：

> 「最终输出检查发现，某个选项标签和解释一版面的说明问题，仍与对应图片分到了两处。开发正在补这个题分拆规则……旧数据不计入通过验证。」
> 「正式交付还在等待新版排版预览、全面回归和独立验收报告；目前不会标记为完成。」

即：**① 选项标签与配图被拆页的规则未修完；② 未完成最终导出与双端渲染；③ 未做全面回归。**

## 我做了什么

### 1. 修复「控制字符致整卷导出失败」（**根因级，此前未解决**）

- **现象**：`bank.cli export paper 1` 直接失败 —— `editor_sdk -32603 DocEditor::InsertText: text contains a placeholder/control character (code=9) at position 0`。交付自带样例卷 #1 **预览与导出双失败**。
- **探针结论（`.tmp_verify/probe_tab_bridge.py`）**：`doc_insert_text` **在段首/段中/段尾任意位置都拒绝 TAB**（code=9），垂直制表符 code=11；而 `U+E000` 等私用区码位**可被接受并原样落盘**。
- **另一关键事实**：`doc_insert_paragraph_with_text`（首段路径）**接受** TAB，只有 `doc_insert_text`（内联续写路径）拒绝——所以此前只覆盖了部分路径，问题被掩盖。
- **修复**：`bank/export.py` 新增 `bridge_safe_text()` 与 `BRIDGE_TAB_SENTINEL`。送桥接前把 `\t` 换成哨兵、剔除其余控制字符；`_set_explicit_tab_stops()` 在 OOXML 层把哨兵还原为真正的 `<w:tab/>` 并补 1/4、1/2、3/4 制表位停靠点（符合 A 契约「保留真实 TAB 不转四空格」）。修正了 `text_to_lines` 中「`\t` 转 4 个空格」的**失实 docstring**。

### 2. 修复「选项标签与配图被拆页」

- **根因**：`render_plan_to_docx` 的选项标签判定要求「**整段全是纯文本**」（`all(k==SEG_TEXT ...)`），但真实选项行常含行内公式（如 `A．⟦F66⟧，⟦F67⟧\tB．`）→ 判定失效 → `keep_with_next` 未设置 → 选项标签与其配图被分到两页。
- **修复**：抽出可测函数 `is_option_label_segments()`，改用「可见文本」判定（公式段以占位记号参与），只看段尾是否为 `A．`/`B.` 形式标签。

### 3. 最终导出 + 双端渲染（此前未完成）

- 交付样例卷 #1 **三模式**（学生版 / 答案解析版 / 仅答案）全部导出成功，并用 **Word 与 WPS 分别渲染成 PNG 逐页核对**。
- 修订闭环（A 契约场景 1）：在**副本**上跑通 `inspect_paper(3)` → `create_revision` 默认提案 → 新卷 15 条 blocker 归零 → 三模式导出。

## 产出物（本轮新增）

| 路径 | 内容 |
|---|---|
| `bank/export.py` | `bridge_safe_text` / `BRIDGE_TAB_SENTINEL` / `is_option_label_segments` / `_set_explicit_tab_stops` 还原哨兵 |
| `tests/test_export.py` | 新增 3 个测试类共 14 项：`TestBridgeSafeText`(6) / `TestExplicitTabStops`(2) / `TestOptionLabelSegments`(6) |
| `.tmp_verify/probe_tab_bridge.py` | 桥接控制字符容忍边界探针 |
| `.tmp_verify/probe_sentinel.py` | 哨兵落盘 + 桥接工具清单探针 |
| `.tmp_verify/probe_layout_keep.py` | 选项判定 / 真实 TAB / keepNext / 小图不放大 探针 |
| `.tmp_verify/export_and_render.py` | 卷1三模式导出 + Word/WPS 渲染脚本 |
| `.tmp_verify/paper1/rendered/{word,wps}/` | 逐页 PNG + PDF |
| `.tmp_verify/revision_flow.py` + `revision_flow/` | 修订闭环探针与产物 |

## 验收证据（可复核）

### 卷 #1 三模式导出 + 渲染

| 模式 | 字节 | `<w:tab/>` | `<m:oMath>` | 旧式对象 | 媒体 | 桥接错误 |
|---|---|---|---|---|---|---|
| 学生版 | 706,246 | 9 | 24 | 0 | 8 | 0 |
| 答案解析版 | 708,754 | 9 | 65 | 0 | 8 | 0 |
| 仅答案 | 706,299 | 9 | 24 | 0 | 8 | 0 |

- 三模式**零哨兵残留、零裸 TAB、零 `<w:object>`、零 embeddings**。
- Word 与 WPS 渲染页数完全一致（学生 4 页 / 教师 6 页 / 仅答案 4 页），公式数一致。
- 视觉核验：选项按制表位对齐成**双栏**，长选项自动回退一项一行，图文未被拆页，页脚「第 X 页 共 Y 页」正常。

### 双端可编辑性（`bank.cli export verify`）

```
[word] 状态=PASS 公式数=24 重开后公式数=24 改字符保留=True
[wps]  状态=PASS 公式数=24 重开后公式数=24 改字符保留=True
--- 答案解析版 ---
[word] 状态=PASS 公式数=65 重开后公式数=65 改字符保留=True
[wps]  状态=PASS 公式数=65 重开后公式数=65 改字符保留=True
```

### 修订闭环（副本）

```
paper3 基线行数：23
诊断：blocker_count=8 warning_count=6 export_allowed=False
默认提案：排除 8 项，保留 15 项，未解决 0 项
重复组：qid64[11,12] / qid12[20,21]
✓ 原卷 23 行逐字段字节不变
✓ 新卷 id=4，条目 15 条，blocker_count=0
✓ 交付库 sha256 前后一致（零污染）
```

### CLI 内容阻断

`bank.cli export paper 3` → **退出码 3**，逐 item 打印定位、原因与建议动作（符合 A 契约）。

### 全量回归

`python -m unittest discover -s tests` → **Ran 360 tests, OK (skipped=1)**（修复前 346，本轮 +14）。

**交付库**：`outputs/bank.db` 64,815,104 字节，sha256 `6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6`，本轮**全程未变**。

## 我没做/做不到的

- **未做**浏览器端的真实点击闭环（诊断 → 查看候选 → 创建修订卷 → 重预览 → 导出）——该部分属前端，由 `frontend-dev` 本轮并行处理，见其交接。
- 未新增 `bank/` 之外的源证据能力；未重跑预处理；未改 schema。
- 未对全库 1,393 道含 TAB 的题做**全量**导出回归（仅覆盖样例卷 #1 + 布局探针 + 单元测试）。全量回归代价高，建议后续按需抽样。

## 遗留风险

- 哨兵使用私用区码位 `U+E000`；**若某环节漏做 OOXML 后处理**，该字符会以豆腐块形式残留。已在 `export_and_render.py` 中断言「哨兵残留 == 0」，建议保留该断言为常规回归项。
- 选项标签判定沿用原实现的 `[A-D]` 英文字母集合，**不含中文「甲/乙/丙/丁」选项**（与修改前一致，未扩大范围）。
- 布局探针中的 `keepNext` 计数不能单独证明「该段确因选项标签而连页」，视觉核验为主。
