# 交接：Phase 1 遗留关闭 / MathType 路径在打包版实证

> 日期：2026-10-12
> 角色：**T 测试（独立验证）**
> 关闭项：Phase 1 交接里标记的「🔴 MathType 路径未实证（最大未知数）」

---

## 一、为什么之前认为「无样例」

此前的结论是「本项目没有 MathType OLE 真实样例」，因此 `pipeline/mtef_conv.py` 的
**spawn 分支在冻结（打包）后从未跑过**——而源试卷约 **80% 含 MathType**，
这是上线前最大的未知数。

**这个结论是错的。** 实际扫描发现源素材里有 **21 份**含 `Equation.DSMT4` 的真实 DOCX：

```
扫描 400 份 DOCX，含 Equation.DSMT4（MathType）的：21 份
  11.5 机械效率（重难点专练）（原卷版）.docx      DSMT4×168
  11.5 机械效率（重难点专练）（答案版）.docx      DSMT4×23
  11.5 机械效率（重难点专练）（解析版）.docx      DSMT4×747
  15.1 电功（专题训练）【六大题型】（原卷版）.docx DSMT4×63
  ...
```

脚本：`spike/acceptance/find_mathtype_samples.py`

---

## 二、验证设计

分两层，先建基线再上打包版：

| 层 | 脚本 | 作用 |
|---|---|---|
| 源码 | `verify_mathtype_source.py` | 确认转换链路本身可用 |
| **打包** | `verify_mathtype_frozen.py` | **关键**：冻结 + `spawn` + `freeze_support()` 是否成立 |

打包版用 **`DETACHED_PROCESS` + 不给任何 std 句柄**启动（≈ 双击），走真实 HTTP。

---

## 三、实测证据

### 源码层
```
阶段1 状态: OK  耗时 0.2s
  题数=54 含公式=10 公式引用=23
  扫描: {"formulas": 23, "omml": 0, "mathtype": 23, "ok": 23, "needs_review": 0}
```

### 打包层（**11/11 PASS**）
```
[步骤1] DETACHED_PROCESS 启动（模拟双击，无 std 句柄）→ 1s 后就绪
[步骤2] 导入 11.5 机械效率（重难点专练）（答案版）.docx
        结果: status=OK 新增=25 待复核=0
        扫描: {"questions":54, "with_formulas":10, "total_formula_refs":23}
        题库 82 → 107（+25）
[步骤3] 待复核公式数: 0            ← spawn 未失败
[步骤4] 导出（答案解析版）: 公式=13 图=7
[步骤5] [word] 页7 OMaths=13 改字符重开保留=True
        [wps]  页7 OMaths=13 改字符重开保留=True

✅ 通过：打包版可处理 MathType 旧卷
```

**结论**：`freeze_support()` 生效，**冻结后的 MathType（spawn）路径可用**，
且导出公式在 Word/WPS 双端**原生可编辑**。

---

## 四、过程中的一次误判（**值得记录**）

第一版验证用**学生版**导出，得到 `公式=0`，我一度以为是产品缺陷，并往下追到了
`export_content.project_question` / `_inspect_snapshot` 的投影逻辑。

**真相**：这些题的 3 个 MathType 公式 `⟦F1⟧⟦F2⟧⟦F3⟧` **全部位于「解析」区**
（快照文本 334 字符中，位置 268/282/310），**题干只到 156 字符**。
**学生版正确地排除了解析内容**——内容守卫工作正常。

改用**答案解析版**后 13 个公式正常导出。

> **教训**：验证「公式可编辑」时必须先确认**公式在哪个分支**。
> 用错 `answer_mode` 会得到 `公式=0`，看起来像缺陷，实为**测试设计错误**。
> 这与本项目既有教训同源：**验证条件必须与真实使用条件一致**。

---

## 五、验收标准（**可执行**）

```bash
PY=C:/Users/SOAP/.workbuddy-ai/binaries/python/envs/kb/Scripts/python.exe
# 0) 找样例
$PY spike/acceptance/find_mathtype_samples.py 20
# 1) 源码层
$PY spike/acceptance/verify_mathtype_source.py
# 2) 打包层（期望 11/11 PASS）
$PY spike/acceptance/verify_mathtype_frozen.py
```

---

## 六、遗留

| 项 | 说明 |
|---|---|
| **仅 1 份样例跑通** | 用的是 23 公式的「答案版」；另有 168 / 747 公式的大文件未跑（耗时考虑） |
| **KSEE3（WPS 公式 3.0）** | 样例里 `15.1 电功（知识解读）` 含 KSEE3×7，**未单独验证**（按既有设计应跳过并标待复核） |
| **`Equation.3`** | 仍未找到样例 |
