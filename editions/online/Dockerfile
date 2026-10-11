# =============================================================================
#  线上部署版 · Dockerfile（可选路径）
#  ⚠️ 重要限制：本镜像基于 Linux，**导出功能不可用**
#     （缺 editor_sdk 与 Microsoft Word/WPS 的 COM 自动化）。
#     仅提供：题库浏览、检索、组卷、结构预览。
#     需要完整导出能力请用 Windows 宿主部署（见 README 方式 A）。
# =============================================================================
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    QB_EDITION=online \
    QB_HOST=0.0.0.0 \
    QB_PORT=8720 \
    QB_DB_PATH=/data/bank.db \
    QB_EXPORT_DIR=/data/export

WORKDIR /app

# 依赖（跨平台子集）
COPY editions/online/requirements.linux.txt /app/requirements.linux.txt
RUN pip install --no-cache-dir -r /app/requirements.linux.txt

# 代码
COPY . /app

# 数据卷：题库与导出件
VOLUME ["/data"]
EXPOSE 8720

# 健康检查（/api/health 豁免鉴权）
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8720/api/health',timeout=4).status==200 else 1)"

CMD ["python", "-m", "webui"]
