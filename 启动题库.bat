@echo off
cd /d "%~dp0"

rem ---- pick a Python interpreter: BANK_PY > bundled kb env > python on PATH ----
set "PY=%BANK_PY%"
if not defined PY set "PY=C:\Users\SOAP\.workbuddy-ai\binaries\python\envs\kb\Scripts\python.exe"
if not exist "%PY%" set "PY=python"

echo [QB] interpreter: %PY%
echo.

"%PY%" -m webui

echo.
echo [QB] service stopped. Press any key to close.
pause >nul
