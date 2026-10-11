# T-本轮独立验收（导出修复 + 前端修复重构）

日期 2026-10-11 · 独立验收员（T/V）· 项目 `D:/Open-source project/Localtopic-management`

> 原则：**不复用实现者思路与数字**，自建探针从源头复算并主动证伪。只读为主；写入类验证全部用副本/临时目录。
> 生产代码（`bank/`、`webui/`、`frontend/src/`）**未修改**；探针写在 `.tmp_verify/T_*.py` 与 `.tmp_verify/T_out/`。
> Python：`C:/Users/SOAP/.workbuddy-ai/binaries/python/envs/kb/Scripts/python.exe`，`PYTHONUTF8=1`。

---

## 一、我做了什么（具体到命令）

| 步骤 | 命令 / 探针 |
|---|---|
| A1 复算控制字符题数 | `.tmp_verify/T_probe_a1c_controlchar.py`（只读 SQL + 自写切段逻辑）；旁证 SQL `LIKE '%⟧'||char(9)||'%'` |
| A2 端到端导出 | `python -m bank.cli export paper 1 --answer-mode 学生版 --out .tmp_verify/T_out/paper1_student.docx`；`--answer-mode 答案解析版` |
| A2 解压核对 | `.tmp_verify/T_probe_a2_docx.py`（自写 zip 解析，统计 `<w:tab/>`/哨兵/`<w:object>`/embeddings/`<m:oMath>`/裸控制字符） |
| A3 反证 | `.tmp_verify/T_probe_a3b_bridge_boundary.py`（直连桥接 SDK 测两条写入路径）＋ `.tmp_verify/T_probe_a3_extreme.py`（极端文本走 `build_document_plan`+`render_plan_to_docx`） |
| A4 双端验证 | `python -m bank.cli export verify .tmp_verify/T_out/paper1_student.docx` |
| A5 库未污染 | `sha256sum outputs/bank.db`（验证前后各一次） |
| B1/B2/B3/B4 | `grep` + 通读 `exportGateShared.ts` / `useExportGate.ts` / `PaperBuilderPage.tsx` / `PaperPanel.tsx` / `ConfirmDialog.tsx` / `SourcesPage.tsx` / `KatexFormula.tsx` / `settingsStore.ts` / `main.tsx` |
| B5 真实数字 | `npx tsc --noEmit`、`npm test`、`npm run build` |
| B6 反证 | barrel 运行期加载脚本（`node` 直载 `src/api/types.ts`）＋ 重复导出名/默认导出扫描 |

---

## 二、断言逐条结论表

### A 组（导出）

| 断言 | 结论 | 我的证据 |
|---|---|---|
| **A1** 自行复现原故障 | **通过** | 独立统计：全库 **7,945** 题；含 TAB **1,393** 题；「文本段以控制字符(含TAB)开头」**89** 题（与实现者数字巧合一致，但方法独立）。样例卷#1 有 **2** 题命中：`qid 3761`（段 `\tB．\tD．`）、`qid 3767`（段 `\tB．\tC．\tD．`）。**关键机理**：行首 TAB 会被 `line.strip()` 去掉；真正致故障的是「占位符 `⟧` 后紧跟 TAB」——切段后文本段以 TAB 开头，经 `doc_insert_text` 被拒 |
| **A2** 端到端导出 | **通过** | 学生版成功（706,254 字节）：`<w:tab/>`=**9**、`<w:tabs>`块=7、**哨兵 U+E000=0**、`<w:object>`=**0**、**embeddings=0**、`<m:oMath>`=**24**、**裸控制字符=[]**、媒体 8 张。答案解析版：tab=9、oMath=65、哨兵=0、object=0、裸控制字符=[] |
| **A3** 反证（核心） | **通过** | ① 直连桥接：`doc_insert_paragraph_with_text` **接受** TAB/VT/NUL；`doc_insert_text` **拒绝** TAB(`code=9`)/VT(`code=11`)/NUL(`code=0`)，段首位置报 `code=9 at position 0`——与故障签名**逐字一致**。② 用含「段中TAB / VT`\x0b` / NUL`\x00` / 占位符后TAB」的极端文本走真实渲染：**渲染成功**，产物 `<w:tab>`=8、`<m:oMath>`=2、**哨兵残留=0、裸控制字符=[]** |
| **A4** 双端可编辑 | **通过** | `[word] 状态=PASS 公式数=24 重开后=24 改字符保留=True`；`[wps] 状态=PASS 公式数=24 重开后=24 改字符保留=True`（对我自己导出的文件） |
| **A5** 交付库未污染 | **通过** | `outputs/bank.db` sha256 全程 `6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6`（验证前后一致） |

### B 组（前端）

| 断言 | 结论 | 我的证据 |
|---|---|---|
| **B1** 门禁唯一实现 | **通过** | `grep -rn detectEnvFailure src/` 仅 `exportGateShared.ts:17` 一处实现 + `useExportGate.ts:30` re-export + 其内部调用点；`ExportPage.tsx:40/57`、`ExportDrawer.tsx:43/71` **都**经 `useExportGate`；两文件内无残留旧布尔判定（仅注释提及历史） |
| **B2** 删卷/删大题先确认 | **通过** | 删卷：`setConfirmDeletePaper(...)`（`PaperBuilderPage.tsx:612`）→ `ConfirmDialog.onConfirm` → `deleteMut.mutate`（:640）为**唯一**删除调用点。删大题：`setConfirmSection(...)`（`PaperPanel.tsx:280`）→ onConfirm → `actions.deleteSection`（:438）唯一调用点。`ConfirmDialog` 的 `onClose→onCancel`（默认不执行）、无 `autoFocus`、无 Enter 绑定。搜 `onKeyDown/onKeyUp/keydown/Delete/Backspace` 于两文件**无命中**。**未找到绕过路径** |
| **B3** 切换 sourceId 表单重置 | **通过** | `<SourceDetailDialog key={activeId ?? 'none'} sourceId={activeId}/>`（`SourcesPage.tsx:398-400`）按 sourceId **强制重挂载**（state 全量重置）；回填改在 `useEffect`（:88-94），非渲染期 setState；数据来自 `useQuery(['source', sourceId])` |
| **B4** KaTeX 从设置读取 | **通过** | `KatexFormula.tsx:62-63` 从 `useSettingsStore` 读 `throwOnError/strict` 并传入 `renderToString`；`syncFrom` 由 `main.tsx:24-26` 的 `useEffect` 驱动（`SettingsPage` 用同 `['settings']` 键并在保存后 `setQueryData+invalidate`）；`default_template` 被 `PaperBuilderPage.tsx:237`、`SearchPage.tsx:111` 真实消费 |
| **B5** tsc / test / build | **通过** | `npx tsc --noEmit` → **exit 0**；`npm test` → **26 pass / 0 fail**；`npm run build` → **exit 0**，`index-BB__392v.js 1,058.54 kB │ gzip 331.15 kB` |
| **B6** 反证：找回归 | **未发现真实回归** | ① barrel：三文件**无重复导出名、无 default 导出**；`node` 运行期直载 `src/api/types.ts` 得 `{DIFFICULTIES, REVIEW_STATUSES, TEMPLATES}`，全部有定义；全仓从 `api/types` 的**运行期**导入仅 `DIFFICULTIES`/`TEMPLATES`，均存在 → 无「导出遗漏致 undefined」。② 响应式：1366×768 命中 `(max-width:1439px)`→右栏收抽屉、侧栏常驻（`down('md')` 在 1366 为 false），结果区全宽；paperId 为空时「试卷面板」按钮禁用，但「试卷列表」抽屉（新建/选择）仍可经 `PaperSwitcher.onOpenList` 打开，**非死路**。③ 门禁抽取后语义由原有 17 项 `uiStore` 门禁测试（全绿）+ 源码阅读覆盖 |

---

## 三、我构造的反例与结果

1. **极端控制字符反例**（`.tmp_verify/T_probe_a3_extreme.py`）：文本 `段中TAB + \x0b + \x00 + 占位符后TAB`，真实渲染 → **不报 code=9/11**，产物哨兵残留 0、裸控制字符 0、真实 `<w:tab/>` 生成。
2. **桥接边界反例**（`.tmp_verify/T_probe_a3b_bridge_boundary.py`）：绕过 `bridge_safe_text` 直连 SDK，**复现** `code=9/11/0` 拒绝（`doc_insert_text`），并证实 `doc_insert_paragraph_with_text` 不拒绝 → 坐实「修复前整卷失败」根因与「首段路径掩盖问题」的判断。
3. **barrel 运行期反例**：`node` 直载 barrel，验证运行期键与值——未发现遗漏。

---

## 四、发现的真实缺陷 / 疑点

1. **构建产物与实现者报告不一致（非功能缺陷，但需说明）**：我重跑 `npm run build` 得 `index-BB__392v.js`（1,074,382 B），实现者报告为 `index-7mXAGSFw.js`（1,074,114 B，mtime 10:45）。`frontend/src/pages/SettingsPage.tsx` mtime 为 10:45，**晚于/接近**实现者构建时间 → 实现者验证的构建**并非**当前源码构建。当前源码 tsc/test/build 全绿，功能无碍，但「验证过的产物」与「当前源码」存在一次未说明的漂移，建议以当前源码构建为准。
2. **`validateLatex()` 仍硬编码**（`KatexFormula.tsx:42` `throwOnError:true, strict:false`）：属「编辑保存前校验」语义（校验应严格），与 P0-2 的**显示路径**不同，判定为**可接受**，仅记录。
3. **窄屏拖拽弱化**：`<1440px` 右栏收进抽屉，抽屉默认关闭且开时覆盖 92vw，库→卷的**拖拽**路径在窄屏不实用；「加入」按钮路径仍在 → 非硬回归，属 UX 取舍。
4. `webui/static/assets/` 内**累积多个历史 `index-*.js`**（Vite 未清空 outDir）；本次 build 又新增一个。属既有卫生问题。

---

## 五、我没做 / 做不到的

- **未做浏览器实机验收**（本环境无 GUI）：P1-1 响应式像素、P1-2 Tab 键盘走查、P1-3 防抖/批量手感**仅源码级 + 构建验证**。
- **未做全库 1,393 题全量导出**：仅覆盖样例卷#1 三模式 + 极端反例 + 单元测试（与实现者边界一致）。
- **未对 89 题逐一导出**：抽样 + 反例证明机制。
- **未做前后端代码 diff**（无 git / 无旧代码留存）：门禁「语义等价」依赖原有 17 项 uiStore 测试 + 源码阅读，非逐行等价证明。
- **未人工肉眼核对 Word/WPS 渲染版式**：`export verify` 为本机 Office 程序化结果（PASS），版式美观度未像素级复核。

---

## 六、遗留风险

1. **哨兵 U+E000 依赖 OOXML 后处理还原**：任一环节漏做 `_set_explicit_tab_stops` 会残留豆腐块。已由探针断言残留=0，建议将其固化为常规回归项。
2. **选项标签判定仍限 `[A-D]` 英文**（沿用原实现），不含「甲/乙/丙/丁」。
3. **窄屏 DnD 与抽屉覆盖**：建议人工在 1366×768 确认组卷可用性。
4. **构建漂移**：建议以当前源码重新构建并替换交付产物，保留单一权威 hash。

---

## 七、总体结论

**有条件通过**。A 组 5 项、B 组 6 项断言**全部通过**，核心反证（A3）已用直连桥接 + 真实渲染双重坐实，交付库零污染。唯一需跟进的是**构建产物漂移**（源码在实现者构建后有 1 次 `SettingsPage.tsx` 改动）——建议以当前源码重建产物；其余为既有/低风险项。
