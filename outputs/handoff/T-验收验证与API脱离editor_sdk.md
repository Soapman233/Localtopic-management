# 交接：验收验证 + Web API 脱离 editor_sdk

> 日期：2026-10-12
> 角色：**T 测试（独立验证）** + **D1 修复**
> 上游：`outputs/handoff/D1-导出引擎切换.md`
> 结论：**Web API 导出路径已彻底摆脱 `editor_sdk`**（原先并未摆脱——见第一节）

---

## 一、🔴 关键发现：库级改动**没有覆盖到 Web API**

上一轮我把 `bank.export.export_paper_docx` 的默认引擎切到 native，**以为 API 也一起切了**。验收时发现**并没有**：

| 位置 | 改动前 |
|---|---|
| `webui/services/preview.py::_generate_docx` | 仍 `EditorBridge()` + `render_plan_to_docx` + `postprocess_bridge_docx` |
| `webui/services/export_svc.py` | `_ensure_editor_sdk()  # DOCX 生成依赖 editor_sdk；缺失即失败` |

**即：便携客户端通过 Web 界面导出时，仍然会因为没有 `editor_sdk` 而失败。**

### 一个差点导致误判的陷阱（**必须记录**）

我第一次做 API 验收时，看到产物里 `<w:tabs>` 有 7 个、无哨兵、无 `&Delta;` 实体，
**据此判断"API 已是 native"**——**这个判断是错的**。

真相：那些"干净特征"来自 `postprocess_bridge_docx` 的后处理
（`_set_explicit_tab_stops` 补 `<w:tabs>`、`_resolve_math_entities` 修实体、哨兵还原），
**不是 native 引擎的产物**。

**教训**：判断"某条链路是否已切换"时，**不能只看产物表面特征**——
桥接后处理会掩盖缺陷，使两种引擎的产物在若干指标上趋同。
**可靠判据是"在依赖缺失时是否仍能工作"**（见第二节的反证设计），
以及**产物的部件构成**（native 14 部件 / 桥接后处理 25 部件）。

---

## 二、修复内容

### 1. `webui/services/preview.py::_generate_docx`
改为**引擎感知**：由 `resolve_export_engine()` 决定。
* `native`（默认）→ `bank.docx_writer.write_plan(plan, docx_path(key))`，
  **无需桥接后处理**，返回 `(written, None)`；
* `bridge` → 原逻辑（含一次重试）；
* `auto` → native 失败回退 bridge 并写入 `plan["warnings"]`。

### 2. `webui/services/export_svc.py`
```python
# 仅当显式选择 bridge 引擎时才强制要求 editor_sdk
if _export.resolve_export_engine() == "bridge":
    _ensure_editor_sdk()
```

### 3. 调用方容错
`bridge` 在 native 路径下为 `None`，故统一改用
`getattr(bridge, "warnings", [])` / `getattr(bridge, "errors", [])`，
并兼容 `written` 的两种键名（`formulas`/`formulas_written`）。

---

## 三、验收设计（含反证）

**只证明"能跑通"是不够的**——必须证明"**在依赖缺失时仍能跑通**"。
故把 `editor_sdk_port` 指向死端口 `39999`，再做真实 API 导出：

| 步骤 | 期望 | 实测 |
|---|---|---|
| 1 **反证**：editor_sdk 可达性 | `False` | ✅ `False` |
| 2 `/api/health` | 200 | ✅ 200 |
| 3 `POST /api/papers/1/export` | 200 + `job_id` | ✅ 200 |
| 4 作业状态 | `done` | ✅ `done` |
| 5 产物引擎判定 | native（14 部件） | ✅ **14 部件，无桥接后处理痕迹** |
| 6 无哨兵残留 | — | ✅ |
| 7 公式为原生 OMML | 24 条 | ✅ |

**若 API 仍依赖 editor_sdk，步骤 3/4 必然失败**——所以这个验证是决定性的。

### 产物对比（同一份试卷、同一模式）

| | 部件数 | 体积 | `<w:tabs>` | 哨兵 | `&Delta;` 实体 |
|---|---|---|---|---|---|
| 修复前（桥接+后处理） | 25 | 706,254 | 7（后处理补） | 0（后处理修） | 0（后处理修） |
| **修复后（native）** | **14** | **700,259** | 7（原生） | 0 | 0 |

### 双端可编辑（API 产物，独立副本）
```
[word] 页4 OMaths=24 图=8 | 'F甲' -> 'Z甲' | 改动保留: True
[wps]  页4 OMaths=24 图=8 | 'F甲' -> 'Z甲' | 改动保留: True
```

### CLI 侧独立性（另一条链路，同一套反证）
`spike/acceptance/verify_native_independence.py`：死端口下 bridge 如预期失败（`ExportError`）、
native 成功、双端可编辑、端口恢复后 bridge 恢复可用 —— **5/5 PASS**。

### 全量回归
```
Ran 482 tests in 244.021s
FAILED (failures=2, skipped=1)
```
⚠️ 2 个失败为既有问题（`test_edition.TestAuthMiddleware`），**无回归**。

---

## 四、一个必须知道的运维陷阱：预览缓存

**修复后第一次复测仍然"失败"**——产物还是 25 部件 / 706,254 字节。

**原因**：`_preview.render()` 命中**旧缓存**（`is_cached(key)` 直接返回）。
缓存 key 由**内容摘要**决定（`b08db3cf...`），**与引擎无关**——
所以引擎换了，缓存 key 不变，**旧产物被直接复用**。

**处置**：清除缓存后复测即通过。

| 缓存位置 | 大小 |
|---|---|
| `<worktree>/outputs/webui/preview_cache` | 2.2 MB |
| `<主仓库>/outputs/webui/preview_cache` | 97 MB |

> **运维提醒**：**切换导出引擎后必须清缓存**，否则会继续复用旧引擎的产物，
> 且从文件名/大小上看不出差别。这是"缓存 key 不含引擎维度"带来的**隐性风险**。

---

## 五、验收标准（**可执行**）

```bash
PY=C:/Users/SOAP/.workbuddy-ai/binaries/python/envs/kb/Scripts/python.exe
# CLI 侧独立性（期望 5/5 PASS）
$PY spike/acceptance/verify_native_independence.py
# API 侧独立性（期望 全 PASS）—— 注意先清缓存
rm -rf outputs/webui/preview_cache "D:/Open-source project/Localtopic-management/outputs/webui/preview_cache"
$PY spike/acceptance/verify_api_native.py
```

---

## 六、遗留风险

| 风险 | 说明 | 建议 |
|---|---|---|
| **缓存 key 不含引擎维度** | 换引擎后旧产物被复用（见第四节） | 在 key 中并入引擎标识，或切引擎时强制失效 |
| **`auto` 掩盖 native 缺陷** | 静默回退 bridge | 生产显式用 `native` |
| **PDF 预览仍依赖 Office** | `export_pdf` 未变；无 Office 时降级为"仅 DOCX" | 便携版需明确告知用户 |
| **`bridge` 路径未回归** | 仅死端口反证过一次 | 若长期保留需补 |
| **仅 1 份试卷验证** | 样本偏小 | Phase 3 前扩大 |

---

## 七、给下游的输入摘要

**导出与预览两条链路现均默认走自研引擎，不需要 `editor_sdk`。**
CLI 与 Web API 在 `editor_sdk` 完全不可达时都能成功导出，
产物在 Word/WPS 双端为原生可编辑公式。
**切换引擎后务必清 `outputs/webui/preview_cache`。**
