@echo off
setlocal
rem ===========================================================================
rem  线上部署版 · Windows 宿主启动脚本（推荐方式）
rem  位置：editions/online/start-server.bat
rem  说明：以 online 版启动，监听 0.0.0.0；浏览器访问请置于 nginx 之后
rem  注意：本文件必须为 CRLF 换行（见 .gitattributes）
rem ===========================================================================

cd /d "%~dp0\..\.."

rem ---- 默认值（可被同目录 .env 覆盖）----
set "QB_EDITION=online"
set "QB_HOST=0.0.0.0"
set "QB_PORT=8720"

rem ---- 加载 .env（若存在）：仅支持 KEY=VALUE 行，# 开头为注释 ----
if exist "editions\online\.env" (
    for /f "usebackq eol=# tokens=1,* delims==" %%a in ("editions\online\.env") do set "%%a=%%b"
)

rem ---- 选择解释器：BANK_PY > .venv > PATH ----
set "PY=%BANK_PY%"
if not defined PY if exist ".venv\Scripts\python.exe" set "PY=%CD%\.venv\Scripts\python.exe"
if not defined PY set "PY=python"

echo [QB] 版本：线上部署版（online）
echo [QB] 监听：%QB_HOST%:%QB_PORT%
if defined QB_AUTH_TOKEN (echo [QB] API 令牌：已启用) else (echo [QB] API 令牌：未启用)
echo [QB] 提醒：浏览器访问请置于 nginx 之后，并开启 Basic Auth。
echo.

"%PY%" -c "import fastapi, uvicorn" 2>nul
if errorlevel 1 (
    echo [QB] 缺少运行依赖。请先执行：
    echo        "%PY%" -m pip install -r requirements.txt
    echo.
    pause >nul
    exit /b 1
)

"%PY%" -m webui

echo.
echo [QB] 服务已停止。按任意键关闭。
pause >nul
