# Stage 1 — 离线预处理管线

把真实试卷 DOCX 转成**结构化题目 + LaTeX 公式 + 图片 + 来源定位**，供后续题库、组卷、导出阶段直接消费。
**后续阶段不再需要解析 DOCX。**

## 为什么需要它

真实资料里公式有三种来源，必须分流处理：

| 来源 | 载体 | 处理方式 | 实测 |
|---|---|---|---|
| 原生公式 | `m:oMath`（OMML） | 直接转 LaTeX | 376/376 通过 |
| MathType | OLE 对象内的 `Equation Native` 流（MTEF 二进制） | 内置解析器精确解码 | 168/168 通过 |
| 扫描件 | PDF 位图 | 识别 + 人工校对（不在本阶段） | — |

**MathType 转换不需要安装 MathType，也不是 OCR** —— MTEF 是二进制格式，可以直接解码出结构。

## 目录结构

```
pipeline/
├── __init__.py
├── omml.py          # OMML -> LaTeX
├── mtef_conv.py     # MTEF -> LaTeX（带超时保护）
├── docx_scan.py     # 扫描 DOCX：正文 + 公式 + 图片 + 锚点
├── segment.py       # 按题号切分题目
├── stage1.py        # 命令行入口
└── vendor/
    ├── mtef_py/             # 内置 MTEF 解析器（Apache-2.0）
    ├── mtef_py_LICENSE.txt
    └── mtef_py_NOTICE.txt
```

## 用法

```bash
# 单个文件
python -m pipeline.stage1 "试卷.docx" --out outputs/preprocess

# 整个目录（限制数量）
python -m pipeline.stage1 "D:/资料目录" --limit 40 --timeout 8

# 安静模式（只输出汇总）
python -m pipeline.stage1 "D:/资料目录" --quiet
```

参数：

| 参数 | 默认 | 说明 |
|---|---|---|
| `--out` | `outputs/preprocess` | 输出目录 |
| `--limit` | 0（全部） | 每个输入最多处理多少文件 |
| `--timeout` | 10.0 | 单块解析超时（秒） |
| `--filter-table-numeric` | 关 | 额外剔除表格里的纯数值行（如实验数据 `0.30`） |
| `--quiet` | 关 | 只打印汇总 |

## 输出

每个文件产出两个 JSON，加一份总汇总：

| 文件 | 内容 |
|---|---|
| `<名>.scan.json` | 段落（公式位置替换为 `⟦Fn⟧` 占位符）、公式索引、图片、统计 |
| `<名>.questions.json` | 切分后的题目，每题带自己的公式 ID、图片、来源段号 |
| `_summary.json` | 全批次汇总与逐文件记录 |

### 公式索引示例

```json
"F12": {
  "id": "F12",
  "kind": "mathtype",          // omml | mathtype | unknown
  "status": "OK",              // OK | EMPTY | FAIL | TIMEOUT | NO_STREAM | PENDING
  "latex": "\\eta_{\\text{甲}} > \\eta_{\\text{乙}}",
  "progid": "Equation.DSMT4",
  "part": "embeddings/oleObject10.bin",
  "paragraph": 51,
  "needs_review": false
}
```

### 题目示例

```json
{
  "number": "3",
  "label": "编号",
  "start_paragraph": 24,
  "end_paragraph": 31,
  "text": "3．如图所示，用滑轮组把重720N的货物…（　　）\nA．…\nB．…",
  "formula_ids": ["F18", "F19"],
  "images": ["media/image12.png"],
  "section": "一、选择题",
  "sub_question_count": 0
}
```

## 设计要点

1. **公式统一成 LaTeX** —— 三种来源汇成一种表示，题库可检索、界面可渲染、导出可转 OMML。
2. **占位符保序** —— 正文里公式位置写 `⟦Fn⟧`，保证切分和重组时公式不会串位。
3. **子题不切分** —— `（1）（2）` 属于父题，随父题一起走。
4. **超时隔离** —— MTEF 解析器在极少数畸形公式上会死循环。整批在独立进程里跑并设截止时间；超时后二分定位，**把一条坏公式隔离成一条 TIMEOUT，而不是拖垮整份文件**。
5. **失败进队列** —— 任何非 `OK` 的公式都带 `needs_review`，进人工队列，**绝不静默丢弃**。
6. **只读源文件** —— 全程不修改输入。

## 切分缺陷修复（阶段2）

`segment.py` 修复了两类切分缺陷：

1. **文档标题被误判成题目**：标题常写成 `10.3探索更小的微粒`、`9.1.2固体压强的比较与计算`，
   半角点号 `.` 被当成题号分隔符，标题被切成「第 10 题」。现在规定：**半角点号作为分隔符、
   且整行以「章节号形状」（`数字.数字[.数字]`，末段后不再跟数字）开头时，视为小数/章节号而非题号**。
   全角句点 `．`、顿号 `、` 不参与判定，因此 `16．1910年…`、`9、2023年…`、`27.2018年5月13日…`
   这类「题号 + 数字开头正文」的真题不受影响。
2. **版头区块参与切分**：`学校:` `姓名` `班级` `考号` `密封线` `装订线` 等版头段落不再作为题目起点。

全量 209 份文件实测：题目数 9765 → 9730（-35，全部是章节号标题/版头误切），
19 份文件受影响，其余 190 份题目数完全不变。

可选（默认关闭）：`--filter-table-numeric` 会额外剔除表格里的纯数值行
（如实验数据表的 `0.30`、`0.28`），全量实测再少约 1865 个「假题目」，均为数值单元格。

## 已知限制

- **扫描 PDF 不在本阶段**：需要识别 + 人工校对，单独处理。
- **中文公式字符**：MTEF 把中文输出成 `[U+XXXX]`，转 OMML 时必须写成 `\text{字}` 形式（见根目录报告第 9 节）。
- **题目切分基于题号正则**：对编号不规范的资料需要人工校正；切分结果保留 `start_paragraph`/`end_paragraph` 便于回溯。
  少数「答案/解析」区块内以数字开头的行仍可能被切成独立条目（属题号正则的固有噪声，可开启 `--filter-table-numeric` 缓解）。
- **本阶段不产出可编辑 DOCX**：那是导出阶段（LaTeX → OMML）的职责。

## 依赖

- Python ≥ 3.9
- `olefile`（读取 OLE 复合文件）
- 内置 `vendor/mtef_py`（Apache-2.0，无需 pip 安装）
- 标准库 `xml.etree`、`zipfile`、`multiprocessing`

## 第三方组件

`pipeline/vendor/mtef_py` 来自 `mtef-py`（Apache-2.0），基于 `zhexiao/mtef-go`（Apache-2.0）。
许可证与 NOTICE 已随源码保留在 `vendor/` 下，**发布时请一并保留**。
