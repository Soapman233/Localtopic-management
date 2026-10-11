# 本地运行版（local）

> **一句话**：在你自己的电脑上，双击一下就能用的题库组卷工具。只监听本机 `127.0.0.1`，不上网、无登录。

---

## 一、适用场景

- 一名老师在自己的电脑上备课、组卷、导出。
- 数据只存在本机，不对外暴露。
- 不需要任何账号、密码或服务器。

## 二、环境要求

| 项 | 要求 | 说明 |
|---|---|---|
| 操作系统 | Windows 10/11 | 导出依赖 Windows 专有服务 |
| Python | 3.11+ | 启动脚本会自动找解释器 |
| `editor_sdk` | 需在运行 | 公式渲染与 DOCX/PDF 导出的前置服务（端口 39099） |
| Office | Microsoft Word 或 WPS | 导出 PDF 时需要 |

> 缺少 `editor_sdk` 或 Office 时，程序**不会崩**，但会**明确提示降级**：
> 检索、组卷、预览仍可用，导出能力受限。

## 三、首次使用（三步）

```bat
:: 1) 安装依赖（只需一次）
python -m pip install -r requirements.txt

:: 2) 初始化并导入题库（只需一次；若已拿到现成的 bank.db 可跳过）
python -m bank.cli init
python -m bank.cli import <阶段1产物目录>

:: 3) 构建前端（只需一次）
cd frontend && npm install && npm run build && cd ..
```

> 若你拿到的是**已建好的 `outputs/bank.db`**，把它放进 `outputs/` 即可，第 2 步可跳过。

## 四、日常启动

**双击 `启动题库.bat`**（本目录内）即可。脚本会：

1. 自动选择 Python 解释器（优先级：`BANK_PY` 环境变量 → 项目内 `.venv` → PATH 上的 `python`）；
2. 检查依赖是否齐全，缺失时给出安装命令；
3. 以**本地版**（`QB_EDITION=local`）启动服务；
4. 自动打开浏览器 `http://127.0.0.1:8720`。

关闭那个命令行窗口即退出。

### 为什么这个启动脚本是可移植的？

旧版脚本把 Python 路径**写死**成某一台机器的路径，换台电脑就会回落到裸 `python` 而报「缺依赖」。
现在改为按 `BANK_PY` → `.venv` → `python` 的**优先级自动探测**，并**先检查依赖**再启动，
报错信息直接告诉你缺什么、怎么装。

## 五、设置

可编辑 `outputs/webui/settings.json`（首次运行后生成），或参考 `settings.example.json`。
也可以在界面的「设置」页里改（题库路径、导出目录、默认模板、KaTeX 偏好、主题）。

## 六、排障

| 现象 | 原因 | 处理 |
|---|---|---|
| 提示「缺少依赖」 | 未装 `requirements.txt` | 按提示执行 `pip install -r requirements.txt` |
| 提示「未找到前端构建产物」 | 未构建前端 | `cd frontend && npm run build` |
| 提示「未检测到 editor_sdk」 | 导出前置服务未启动 | 先启动 `editor_sdk`，再启动本程序 |
| 浏览器打不开 | 端口被占用 | `python -m webui --port 8721` 换端口 |
| 导出无反应 | 缺 Word/WPS | 安装 Microsoft Word 或 WPS |

## 七、与线上版的区别

| | 本地版 | 线上版 |
|---|---|---|
| 监听 | `127.0.0.1` | `0.0.0.0` |
| 鉴权 | 无 | 有（nginx Basic Auth） |
| 启动 | 双击本目录 `启动题库.bat` | 见 `../online/README.md` |

**数据格式完全一致**，`outputs/bank.db` 可在两版之间直接搬运。
