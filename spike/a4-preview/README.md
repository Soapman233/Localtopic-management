# 探针 · 前端 A4 近似排版 + 自动分页（E1 可行性验证）

> 这是**技术探针（spike）**，用于验证「前端能否用 HTML/CSS 做到近似 A4 排版 +
> 按页高自动分页 + 题目不被拦腰截断」，并给出实现成本判断。
>
> **独立运行，不接入 `frontend/`，不修改 `webui/`/`bank/`，不写 `outputs/bank.db`。**

## 快速开始

```bash
cd spike/a4-preview
npm install
npm run dev          # 打开 http://localhost:8777
```

或构建后以静态方式打开：

```bash
npm run build
npm run preview      # http://localhost:8777
```

## 数据来源（真实数据，非造）

- 由 `tools/dump_export_data.py` 从**只读连接**调用生产代码
  `bank.paper.build_export_payload(conn, 1)`，生成与 `GET /api/papers/1/export-data`
  **完全一致**的 JSON → `public/data/export_data.json`（含学生版 + 答案解析版）。
- 同时把题目引用的图片抽取到 `public/media/`，并记录**原始像素宽高**
  （供前端预置图片显示尺寸，消解「图片异步加载导致分页错乱」）。

重新生成数据（需 `bank` 依赖可导入）：

```bash
python tools/dump_export_data.py
```

演示卷：`#1 八年级物理·浮力与压强单元测验`，共 **10 题**（2 个大题），含 KaTeX 公式与 8 张图片。

## 界面能验证什么

左侧控制面板 + 右侧 A4 预览：

| 控件 | 验证的必验项 |
|---|---|
| 答案模式（学生版 / 答案解析版） | 内容量差异 → 分页自动重算（必验项 6） |
| 模板（考试 / 测验 / 作业） | 页边距/字号变化 → 分页自动重算（必验项 6） |
| 纸张（A4 / Letter） | 与真实导出（Letter）对照页数 |
| 题序编辑（上移/下移/删除） | 编辑后自动重算（防抖 200ms，必验项 5） |
| 跑基准（20 次） | 单次分页耗时（必验项 5） |
| 路线 A / B 切换 | 两条实现路线对比 |

- **路线 B（推荐）**：`src/usePagination.ts` —— JS 测量 + 手动分页。
- **路线 A（对比）**：`src/CssRouteView.tsx` —— 浏览器原生 `column` + `break-inside: avoid`。

## 文件结构

```
spike/a4-preview/
├── tools/dump_export_data.py   # 从只读 DB 导出真实数据 + 图片（+ 原始尺寸）
├── public/data/export_data.json
├── public/media/*.png
└── src/
    ├── spec.ts          # 版式常量/图片尺寸规则（镜像 bank/export.py）
    ├── blocks.tsx       # 块模型 + 渲染（整题 = 原子块）
    ├── usePagination.ts # 分页引擎（路线 B）
    ├── PageView.tsx     # 单页渲染
    ├── CssRouteView.tsx # 路线 A 对比
    └── App.tsx          # 演示界面
```

## 结论

见 `outputs/webui/E1-前端分页可行性验证.md`。
