---
title: "R复核公式分类交接"
description: "145条当前源只读分类、13条件候选与人工路径证据。"
keywords: ["公式", "交接"]
author: "待补充"
created: "2026-10-10T15:05:41.936071+08:00"
modified: "2026-10-10T15:06:56.081346+08:00"
version: "0.1.0"
category: ["交付报告"]
---

# 交接：剩余145条复核公式分类 / R

研究日期：2026-10-10。阶段只做只读调查、隔离探针与证据输出；未修改实现、交付库、源DOCX或预处理产物。

## 我做了什么

1. 从只读SQLite连接重新取得全部145条未处理记录；逐条读取当前源DOCX中的OLE和关联WMF。145份记录的源文件SHA256与入库指纹一致，当前XML中的ProgID、part、preview关联也145/145一致。证据与原始SQL在 `outputs/formula-rdt-20261010/inventory.json`。
2. 枚举145个OLE全部流、长度、前64字节及Equation Native完整hex；检查头长、声明长度、真实MTEF版本，并保存逐条原生流。没有把v3直接交给无保护解析器。
3. 在每次最多4秒、可杀子进程内记录18条v5与2条v3代表的当前解析日志、异常、节点和读指针；随后仅在研究子进程内按公开规范作最小反证，确认nudge、FONT_STYLE_DEF、单边括号三处原因。**这不是生产补丁。**
4. 首轮Pillow WMF转换虽145/145成功，却出现字距重叠，不能作为正确性证据。改用Word 16.0原样读当前源包取出的18条v5 WMF，生成4页PDF并逐页检查，逐字及上下标核对候选。没有用历史导出替代本轮源图。
5. 完成145条机器可读分类、13条条件候选；阶段结束全量测试311项（310通过、1 skip），30.864秒；交付库完整SHA256仍为 `2d1b3694aadae3355256bc7849f5b634ff1a7e78e873e5509d2536e250259601`。主控记录的165个实现文件逐一SHA256比较，变更0个，见 `R-implementation-audit.json`。

## 分类结论

这里的“可自动修复”是**有确定性解码/兼容修复路径的候选**，不是已经修复或已经批准写库。D/T仍必须完成新产物渲染、内容核对、双端编辑准入；不通过的条目留在复核队列。

| 分类 | 数量 | 构成及准入边界 |
|---|---:|---|
| 可自动修复候选 | 13 | KSEE3完整v5 4条；短nudge误读5条；FONT_STYLE_DEF误读2条；合法单边括号2条。源图语义已核对；D需实现与验证，尤其4条KSEE3已有导出上下标风险 |
| 需人工或后续专门兼容 | 131 | 真实v3 127条（KSEE3 119、Equation.3 8）；原生流与源预览冲突3条；rq90含裸`&`/EF00标记1条 |
| 建议放弃自动转换 | 1 | rq85原生内容与Word源预览均空。仅放弃自动转换，不自动删除、不自动resolved，由教研判断 |
| 合计 | **145** | 13 + 131 + 1 |

候选rq_id：`57,62,64,68,73,86,87,91,92,93,94,143,161`。逐条formula_id、question_id、fid、源路径、流/预览指纹、候选LaTeX、原因与源图页码见 `classification.json/csv`、`candidates.json`。

### 真实版本分布与OLE结构（实测）

```sql
SELECT status,progid,COUNT(*) FROM review_queue
WHERE resolved=0 GROUP BY status,progid;
-- EMPTY/DSMT4 7; FAIL/DSMT4 4; UNSUPPORTED/Equation.3 11; UNSUPPORTED/KSEE3 123
```

| 数据库类别 | 真实v3 | 真实v5 | 合计 |
|---|---:|---:|---:|
| KSEE3 / UNSUPPORTED | 119 | 4 | 123 |
| Equation.3 / UNSUPPORTED | 8 | 3 | 11 |
| DSMT4 / EMPTY | 0 | 7 | 7 |
| DSMT4 / FAIL | 0 | 4 | 4 |

**145条Equation Native均非空、头长28、offset8的声明长度等于实际长度减28。** 没有证据支持“EMPTY七条流为空”。

126个容器包含 `\x01CompObj / \x01Ole / \x03ObjInfo / Equation Native`；19个没有 `\x01Ole`，另三流仍完整。全部CompObj流长105；126个Ole流长20，仅两种hex：`0100000208000000000000000000000000000000`（118）与 `0100000200000000000000000000000000000000`（8）。未发现OlePres、Ole10Native或其他内容流。

Microsoft的[OLEStream规范](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-oleds/e0dc105e-77f1-4072-a938-9aa516dc43e9)与[CompObjStream规范](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-oleds/142e0420-2f74-4ed9-829b-0b3d5a684d01)说明这些流分别描述对象状态/链接及显示名/剪贴板格式。因此本批短Ole/CompObj不能替代Equation Native恢复公式。

### KSEE3与Equation.3能否解析

**KSEE3不是一种与MTEF完全无关的新二进制格式。** 当前123条都使用同类OLE容器和Equation Native头，119条payload首字节03、4条05；Equation.3同样为8条03、3条05。二者在存储格式家族上同源；不能仅凭ProgID断言具体写入器或数学内容相同。

实例rq5 / KSEE3：原生流54字节，完整hex：

```text
1c0000000200e6c21a0000000000000030e860002c235f0000000000
030101031e0a01030e0000011283550000011283520000000000
```

rq77 / Equation.3：原生流84字节，payload起始 `03010103010a01030e000001128355...`。两者都是v3五字节头；v3记录把选项与类型放在同一个字节的高/低四位。项目当前v5读取器 `pipeline/vendor/mtef_py/mtef.py:47` 假定应用名字符串与独立option字节，**不能复用来解析这些v3**。隔离测试rq5、rq77均迅速返回空，说明“每条KSEE3都会挂死”也不是事实；安全预判/进程硬超时仍不可移除。

[Wiris v5官方规范](https://docs.wiris.com/en_US/mathtype-mtef-v5-mathtype-40-and-later)区分v3/v5；其v5页并不完整描述v3。公开一手开源实现存在：

- [LibreOffice MathType importer](https://github.com/LibreOffice/core/blob/master/starmath/source/mathtype.cxx)：`Parse`读五字节头且拒绝版本>3；`HandleRecords`按tag低四位读取，含深度保护。结果为StarMath，需要另处理LaTeX/OMML转换与内容验证。
- [jure/mathtype v3记录定义](https://github.com/jure/mathtype/blob/master/lib/records3/mtef.rb)与[版本分派](https://github.com/jure/mathtype/blob/master/lib/mathtype.rb)：独立v3/v5分支，输出XML；[MIT许可证](https://github.com/jure/mathtype/blob/master/LICENSE.txt)。[MathML扩展](https://github.com/jure/mathtype_to_mathml)另有转换步骤。

**结论：v3在技术上可解码，有可参考实现；本项目当前没有经本批数据验证的v3转换链路。** 本轮不把“网上有实现”当成127条已可自动修复。建议另开有范围的v3兼容研究，覆盖分式、根式、上下标、中文、字体与恶意/截断输入，再决定扩展，不要把v3强行走v5。

### 预览和其他内容途径

KSEE3 **123/123可取得非空原生流及源包WMF预览**，XML关联和源文件指纹全部一致，故都有保留的原始信息；其中4个v5已由Word保真渲染逐字核对。119个v3本轮未逐字人工审图，**不能声称119张都已经通过可辨读验收**。同理145/145 Pillow成功只证明转换成功。

全量检查WMF：119个KSEE3 v3和8个Equation.3 v3均未发现`AppsMFCC`或`MathTypeUU`注释标识；三个源流冲突的Equation.3 v5也没有这些标识。4个KSEE3 v5的WMF中含完整且与OLE payload逐字节相同的MTEF，因此不是额外独立内容证据。11个DSMT4预览有`AppsMFCC`（部分为分块），本轮未移植重组器；不能据标识假设可无损重新抽出不同内容。原始扫描结果见 `wmf-metadata.json`。[上游WMF读取器](https://github.com/jure/mathtype/blob/master/lib/file_parser/wmf.rb)明确拒绝跨多个comment的公式，不能直接用于本批全部对象。

现有`GET /api/review/{rq_id}/preview`调用 `bank/media.py:98` 的Pillow/GDI转换；145条所需原始数据都存在，但部分输出重叠、字距失真。**能返回PNG不等于可靠人工核对图**，本轮未调用HTTP逐条验收，未修改此API。D若仅提供“源图入口已存在”必须说明该限制；需要保真路径或保留原始WMF/Word对照，不能据失真图判错或批准。

### EMPTY七条（实测而非旧结论）

| rq / formula | 原生长度 | 当前offset28结果 | 原因与重新抽取可行性 |
|---|---:|---|---|
|85 / 1365|245|`$  $`，Valid=True|只有定义、偏好、FULL、END，无CHAR/LINE/TMPL；Word预览空。源对象本身无可见内容，重抽同样为空 |
|86 / 1397|525|分式子节点越界|短nudge坐标错位；offset0空结果掩盖异常。源包有完整公式，可修读取器 |
|87 / 4464|459|空，Valid=False，FUTURE RECORD:27|FONT_STYLE_DEF读取错位；源包完整，可修读取器 |
|90 / 5461|387|空，Valid=False，FUTURE RECORD:27|同上；修正后另有EF00映射的裸`&`，本轮仍列人工 |
|91 / 6439|518|分式子节点越界|短nudge错位；offset0空结果掩盖异常。源包完整，可修读取器 |
|93 / 6901|510|空，Valid=False，FUTURE RECORD:27|FONT_STYLE_DEF读取错位；源包完整，可修读取器 |
|94 / 7492|727|分式子节点越界|短nudge错位；offset0空结果掩盖异常。源包完整，可修读取器 |

`pipeline/mtef_conv.py:82` 的兼容回退试offset28及0，原错误被吞掉；因此数据库EMPTY并不等价于源内容为空。完整baseline的两个偏移结果在 `parser-traces.json`。

### FAIL四条的确切失败原因

| rq / formula | 触发数据与失败位置 | 反证结果 |
|---|---|---|
|73 / 561|native offset305 `80e0`短nudge；`makeLatex:898 denAST=ast.children[1]`，IndexError|仅改研究实例的nudge读取后得到源图 `I'=U_0'/R_0=5V/10Ω=0.5A` |
|92 / 6440|native offset319 `80e0`短nudge；同上分式IndexError|得到源图 `h_2=V_水'/S_容=1500cm³/150cm²=10cm` |
|143 / 9864|native offset261 `03 00 01 01 00`，PAREN selector1 variation1，仅main与左括号；`makeLatex:717 rightAST=children[2]`，IndexError|按可选右括号处理得到源图 `L(U_额=2.5V`，**不补可见右括号** |
|161 / 10039|与rq143原生流相同；同一IndexError|同上 |

规范的nudge短形式只占2字节，`80e0`表示dx=0/dy=96；当前 `readNudge:383`每坐标读2字节，额外吞掉后续typeface/字符字节。rq86位置299；rq91/94位置283、340。研究仅修正这一个读取点，5条均从异常得到与保真源图一致的非空结果；没有靠删异常节点硬凑。

FONT_STYLE_DEF的char_style应为单字节；当前 `readRecord:135`误读nul字符串。rq87 native offset309、rq90/93 offset258的 `08 02 02 02 04 7f c1 03 72 03 00 1b...` 被吞到下个TMPL的零字节，后面的selector27被误当record27。研究只把该字段按一字节读，原来的FUTURE RECORD:27消失。rq87恢复 `V_水=m_水/ρ_水=50g/(1g/cm³)=50cm³`，rq93恢复完整压强表达式。rq90源图没有可见`&`，研究输出仍带裸`&`，故剔除。

单边括号由源图和原始AST同时证明，属于合法数据；官方ParBoxClass左右fence是可选项。研究只处理该特定存在main+left、variation1的情形验证假设，不泛化缺孩子节点为“都能补空”。

### 主动反例及候选准入

- rq74/75/76：三个OLE都解为`R_x`且Valid=True，Word原始WMF分别为`1/R`、`1/R_1`、`1/R_2`。因此版本/长度/Valid/非空均不足以批准写库；源数据内部冲突，需要原卷上下文与人工定稿。
- rq90：最初错位修正后仍不满足展示约束。不得将EF00或`&`静默删掉，也不得用“成功解析”批准。
- rq85：不能把空对象补成猜测的公式，也不能为清零自动resolve。
- rq57/62/64/68：本轮源图确认U为主体、L/R为下标、2为U的上标。现解码结果的LaTeX语义正确，但过去桥接曾输出错误上下标；**D必须在当前新导出逐式核对OMML/渲染并双端编辑**。若需要改冻结`bank/export.py`，必须回主控取得该文件明确授权；R未授权此变更。

## 产出物

- `outputs/formula-rdt-20261010/inventory.json`、`inventory-summary.json`：全量SQL、来源指纹、XML关联、OLE流、完整hex。
- `classification.json/csv`：145条逐项分类与证据路径；`candidates.json`：13条候选及预期LaTeX（**不是可直接apply的已批准清单**）。
- `parser-traces.json`、`nudge-spec-traces.json`、`font-nudge-traces.json`、`all-spec-traces.json`：当前代码与最小反证的完整日志/异常/节点；`wmf-metadata.json`：预览注释探测。
- `word-source-previews.docx/pdf`、`word-source-previews-1.png`至`-4.png`：本轮当前源WMF经Word保真渲染；所有18条v5已查看。首轮 `v5-current-source.png`及Pillow `preview/`仅留作失真反证，不得用作批准依据。
- `.qa_formula_rdt_20261010/R/`：研究探针、逐条native流；`.qa_formula_rdt_20261010/R-tests.log`：阶段回归原始日志；`R-summary.json`：分类与交付库哈希。

## 验收标准（给D及主控）

1. `PYTHONUTF8=1`，使用项目Python运行 `.qa_formula_rdt_20261010/R/inventory.py`：总数145，源hash/关联145一致，版本分布必须复现。不运行stage1，不写库。
2. 反证命令：`python .qa_formula_rdt_20261010/R/parse_probe.py 73 28 baseline` 与 `... 73 28 nudge-spec`；`... 87 28 baseline` 与 `... 87 28 font-style-spec`；`... 143 28 baseline` 与 `... 143 28 all-spec`。**每条直接命令外层仍必须用subprocess.run(timeout=4)调用，不能取消隔离；默认无参数批处理已自带4秒保护。**
3. D按实际需要在允许文件实现规范兼容；可只给专用修复路径，避免无证据改动所有已OK公式。13条逐条KaTeX严格渲染、新导出内容逐字/上下标核对、Word/WPS改内部字符→保存→重开→比对。允许集合仅是本报告13个rq_id，任一失败保留待复核并明确说明。
4. 修改库前备份并`verify_backup(original, backup)`；先副本演练；`formula_repair.apply_verified`只接收真正通过全套证据的子集。检查幂等、事务回滚、留版；纸卷锁定快照逐字节不变；对其他OK公式做有意义的回归和差异核实。
5. 131+1条不批量resolve。现有源预览入口的转换/保真限制如实呈现。T须独立重新读取当前源、构造反例并新导出，不照抄本探针结论。
6. 当前阶段测试：`Ran 311 tests in 30.864s / OK (skipped=1)`，库SHA256如开头完全未变。

## 我没做/做不到的

- 未移植公开v3解析器、未逐字审阅127个v3预览，未证明其能在本项目自动生成LaTeX/OMML。可解析的技术方向不等于本批已经验证成功。
- 未修生产代码、未调用修复API、未写任何业务数据库、未变更冻结契约。
- 未做13条新导出与双端公式编辑；这是D/T必须提供的后续证据，当前候选不具备写库资格。
- 未解决rq90标记展示与三个源流冲突；未恢复rq85不存在的内容。
- Word保真探针是当前源WMF的展示层，不是激活OLE检查原生编辑内容。与OLE冲突的条目仍然保持人工分类。

## 遗留风险与给D建议

建议先实现nudge与FONT_STYLE_DEF的严格读取及可选单边括号，难度分别低、低、中；必须对短/长/截断nudge、style0/非0、单边/双边/真实缺损括号构造反方向样本，不能用“索引不存在则补空”掩盖截断流。nudge/FONT修复会改变过去被读错的输入，若全局接入需核查已OK公式，不能只跑本13条。

4条KSEE3导出上下标是已知高风险，应独立验证当前桥接兼容写法；不能修改语义以迎合桥接。v3移植工作量中至高，涉及格式、字体、模板语义与结果验证，建议本轮保留清晰人工路径，后续专项验证。现有Pillow源预览有保真问题；不要把状态为200或PNG存在当作满足老师核对需求。
