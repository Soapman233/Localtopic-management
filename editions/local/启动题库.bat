@echo off
setlocal
rem ===========================================================================
rem  本地运行版 · 一键启动器
rem  位置：editions/local/启动题库.bat
rem  说明：本脚本只负责「找解释器 -> 检查依赖 -> 以 local 版启动」，业务逻辑在 webui/
rem  注意：本文件必须为 CRLF 换行（LF 会导致 cmd 解析失败，见 .gitattributes）
rem ===========================================================================

rem 切到项目根目录（本文件的上上级）
cd /d "%~dp0\..\.."

rem ---- 1) 选择 Python 解释器：BANK_PY > 项目内 .venv > PATH 上的 python ----
set "PY=%BANK_PY%"
if not defined PY if exist ".venv\Scripts\python.exe" set "PY=%CD%\.venv\Scripts\python.exe"
if not defined PY set "PY=python"

echo [QB] 版本：本地运行版（local）
echo [QB] 解释器：%PY%
echo.

rem ---- 2) 依赖自检：缺失时明确告知如何安装，不静默失败 ----
"%PY%" -c "import fastapi, uvicorn" 2>nul
if errorlevel 1 (
    echo [QB] 缺少运行依赖。请先执行：
    echo        "%PY%" -m pip install -r requirements.txt
    echo.
    echo [QB] 按任意键关闭。
    pause >nul
    exit /b 1
)

rem ---- 3) 以本地版启动（仅监听 127.0.0.1，无鉴权）----
set "QB_EDITION=local"
"%PY%" -m webui

echo.
echo [QB] 服务已停止。按任意键关闭。
pause >nul
