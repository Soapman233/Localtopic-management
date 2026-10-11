---
title: "导出 P0 阶段收口索引"
description: "R/P/A/D/T/V 阶段文档索引、本轮补齐项、关键证据位置与当前状态。"
keywords: ["导出", "索引", "阶段"]
author: "待补充"
created: "2026-10-11T10:38:35.832263+08:00"
modified: "2026-10-11T10:38:35.832263+08:00"
version: "0.1.0"
category: ["交付报告"]
---

# 导出 P0 升级 · 阶段收口索引

> 日期：2026-10-11 ｜ 工作流：R → P → A → D → T → V
> 目标：让导出结果在**内容正确性**与**关键版式**上接近组卷网/学科网的成品试卷，同时**不缩小字号、不阻断全卷**来掩盖内容问题。

## 一、阶段文档

| 文档 | 内容 |
|---|---|
| `outputs/handoff/R-导出P0实施事实.md` | 只读调查：源 SHA/扫描坐标/q7942 分支锚点等事实 |
| `outputs/handoff/P-导出P0需求与验收.md` | 需求与可执行验收（5 个教师场景、正反例） |
| `outputs/handoff/A-导出P0契约冻结.md` | **G1 契约**：字段/端点/错误码/缓存与布局 revision |
| `outputs/handoff/D-导出P0核心中间交接.md` | D 中段交接（当时 **G2 未通过**） |
| **`outputs/handoff/D-导出P0最终交接.md`** | **本轮补齐 Codex 中断项后的最终交接（含端到端证据）** |
| `outputs/export-upgrade-20261010/testing/T-验收矩阵.md` | T 独立验收矩阵（准备态） |
| `outputs/export-upgrade-20261010/review/V-阶段审查记录.md` | V 独立审查：6 类可复现缺陷与处置 |

## 二、本轮（2026-10-11）补齐了什么

Codex 会话在「最终导出 / 双端渲染 / 全面回归」阶段因额度耗尽中断。本轮补齐：

1. **控制字符致整卷导出失败（🔴 阻断，此前未解决）**
   `doc_insert_text` 拒绝 TAB（`code=9`），交付样例卷 #1 预览与导出双失败。
   修复：`bank/export.py::bridge_safe_text()` + `BRIDGE_TAB_SENTINEL`，
   `_set_explicit_tab_stops()` 在 OOXML 层还原为真正的 `<w:tab/>`。
2. **选项标签与其配图被拆页（🟠）**
   原判定要求「整段全是纯文本」，含行内公式的选项行判定失效。
   修复：抽出 `is_option_label_segments()`，改用「可见文本」判定。
3. **最终导出 + 双端渲染**：卷 #1 三模式导出成功，Word/WPS 逐页渲染核对。
4. **全面回归**：后端 360 项（359 通过 / 1 skip）。

## 三、关键证据位置

| 证据 | 路径 |
|---|---|
| 桥接控制字符容忍边界探针 | `.tmp_verify/probe_tab_bridge.py` |
| 哨兵落盘 + 桥接工具清单 | `.tmp_verify/probe_sentinel.py` |
| 选项判定 / 真实 TAB / keepNext / 小图不放大 | `.tmp_verify/probe_layout_keep.py` |
| 卷1 三模式导出 + Word/WPS 渲染 | `.tmp_verify/export_and_render.py` → `.tmp_verify/paper1/rendered/{word,wps}/` |
| 修订闭环（副本，原卷字节不变） | `.tmp_verify/revision_flow.py` → `.tmp_verify/revision_flow/` |
| Web HTTP 端到端（含 409/40904） | `.tmp_verify/web_flow.py` → `.tmp_verify/web_flow.json` |
| D 阶段历史控制件与渲染 | `outputs/export-upgrade-20261010/development/` |
| V 独立审查探针 | `.qa_export_upgrade_20261010/V/` |

## 四、当前状态

| 项 | 值 |
|---|---|
| 后端测试 | **360 项（359 通过 / 1 skip）** |
| 交付库 | `outputs/bank.db`，64,815,104 字节，sha256 `6905955734953c6cdffa4c65b1dd6950bb575dd1fb0e68dbd4b013ae8e6602c6`（**本轮未变**） |
| content_guard_revision | `export-content-p0-v5` |
| layout_revision | `export-layout-p0-v4` |
| 卷1 三模式导出 | ✅ 学生 706,246B / 教师 708,754B / 仅答案 706,299B |
| 双端可编辑 | ✅ Word/WPS 均 PASS（学生 24 式、教师 65 式，改字符保留=True） |
| 卷3 内容守卫 | ✅ 8 blocker / 6 warning，HTTP 409 / code 40904，CLI 退出 3 |
| 修订闭环 | ✅ 副本内新卷 15 条 blocker 归零，原卷 23 行字节不变 |

## 五、仍未完成 / 局限

- **浏览器端真实点击闭环**（诊断 → 查看候选 → 创建修订卷 → 重预览 → 导出）：由前端负责，见 `outputs/handoff/D-前端修复与重构.md`。
- 未对全库 **1,393 道含 TAB** 的题做全量导出回归（覆盖：样例卷 #1 + 布局探针 + 14 项单测）。
- 哨兵使用私用区 `U+E000`，任何漏做 OOXML 后处理的环节都会残留豆腐块 → 回归脚本已断言「哨兵残留 == 0」。
- 选项标签判定沿用 `[A-D]`，不含中文「甲/乙/丙/丁」。
- 未做 LibreOffice 对照（环境未提供），用原生 Word/WPS 导 PDF 逐页核验替代，**不宣称 LibreOffice 通过**。
