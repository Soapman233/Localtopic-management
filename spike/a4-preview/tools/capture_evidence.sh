#!/usr/bin/env bash
# 证据截图脚本：用无头 Chrome 抓取探针页面的分页效果。
#
# 用法：先 `npm run build`，再执行本脚本（会临时起一个静态服务器）。
# 依赖：本机 Chrome（自动探测常见路径），python（起 http.server）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"          # spike/a4-preview
DIST="$ROOT/dist"
OUT="$ROOT/.evidence"
PORT=8778

CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
if [ ! -f "$CHROME" ]; then
  CHROME="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
fi

mkdir -p "$OUT"
echo "[capture] 启动静态服务器 :$PORT"
python -m http.server "$PORT" --directory "$DIST" >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 1

shoot() {
  local name="$1" w="$2" h="$3" url="$4"
  echo "[capture] $name  ${w}x${h}"
  "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
    --force-device-scale-factor=1 \
    --virtual-time-budget=8000 \
    --window-size="${w},${h}" \
    --screenshot="$OUT/$name.png" \
    "http://127.0.0.1:$PORT/$url" >/dev/null 2>&1 || true
}

# 1) 学生版 · A4 · 路线B · 全卷总览（缩放 0.62）
shoot "01_student_A4_full" 1000 7000 \
  "?panel=0&mode=student&pageSize=A4&route=B&scale=0.62&debug=1"

# 2) 学生版 · Letter · 路线B · 全卷总览（对照真实导出纸张）
shoot "02_student_Letter_full" 1000 7000 \
  "?panel=0&mode=student&pageSize=Letter&route=B&scale=0.62&debug=1"

# 3) 答案解析版 · A4 · 路线B · 全卷总览
shoot "03_answer_A4_full" 1000 7000 \
  "?panel=0&mode=answer&pageSize=A4&route=B&scale=0.62&debug=1"

# 4) 学生版 · A4 · 首屏细节（1:1）
shoot "04_detail_page1" 980 1250 \
  "?panel=0&mode=student&pageSize=A4&route=B&scale=1&debug=1"

# 5) 路线 A（CSS 分栏）对比
shoot "05_routeA_css" 1400 1100 \
  "?panel=0&mode=student&pageSize=A4&route=A&scale=1&debug=1"

echo "[capture] 自动裁剪空白"
PY="${BANK_PY:-C:/Users/SOAP/.workbuddy-ai/binaries/python/envs/kb/Scripts/python.exe}"
"$PY" "$ROOT/tools/crop_png.py" "$OUT" 2>/dev/null || echo "[capture] 裁剪跳过（Pillow 不可用）"

echo "[capture] 完成 -> $OUT"
