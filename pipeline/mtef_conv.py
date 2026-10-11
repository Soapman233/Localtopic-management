"""MathType (MTEF) -> LaTeX, with hard timeouts.

MathType equations live inside the DOCX as OLE objects.  The OLE object carries an
"Equation Native" stream in MTEF (MathType Equation Format) - a binary format that can
be decoded directly, with no MathType installation and no OCR.

Why the timeout machinery: the upstream parser can loop forever on a small number of
malformed or unusual equations (observed once during corpus testing).  A single bad
equation must never hang a 900-equation batch, so every batch runs in a worker process
under a deadline, and on timeout the batch is bisected until the offending equation is
isolated and quarantined.

Vendored parser: pipeline/vendor/mtef_py (Apache-2.0, see vendor/mtef_py_LICENSE.txt).
"""
# ---------------------------------------------------------------------------
# title: MTEF / MathType 转换
# description: MTEF转换与进程超时隔离；严格v5启用规范nudge/字体样式/单边括号兼容，普通路径不变。
# author: 待补充
# version: 0.1.0
# category: 阶段1-预处理
# ---------------------------------------------------------------------------


from __future__ import annotations

import multiprocessing as mp
import re
from io import BytesIO
from pathlib import Path
import sys
import time
import struct

_VENDOR = Path(__file__).resolve().parent / "vendor"
if str(_VENDOR) not in sys.path:
    sys.path.insert(0, str(_VENDOR))

OLE_CB_HDR = 28  # Equation Native stream header length (per the reference tool)

# Status values returned per equation.
OK = "OK"
EMPTY = "EMPTY"          # parsed but produced no visible content
FAIL = "FAIL"            # parser raised
TIMEOUT = "TIMEOUT"      # parser exceeded its deadline

# --- LaTeX 表示规范化（D1 / D2）------------------------------------------- #
# MTEF 解析器会把公式里的中文写成 ``[U+XXXX]`` 转义（如 ``\text{[U+6c34]}``），
# 且整条公式带 ``$…$`` 定界符；而 OMML 路径输出真字符且不带 ``$``。为与题库
# （``bank.latexnorm``）统一，这里在**产出 LaTeX 时即规范化**，避免新导入的数据
# 又带上 ``[U+xxxx]`` 或 ``$``。
_TEXT_UPLUS_RE = re.compile(r"\\text\{\[U\+([0-9a-fA-F]{4})\]\}")
_UPLUS_RE = re.compile(r"\[U\+([0-9a-fA-F]{4})\]")
_LEAD_DOLLAR_RE = re.compile(r"^\$+")
_TRAIL_DOLLAR_RE = re.compile(r"\$+$")


def normalize_latex(latex: str | None) -> str | None:
    """把 MTEF 转义 ``[U+XXXX]`` 还原为真字符，并去掉外层 ``$…$``（幂等）。

    * ``\\text{[U+6c34]}`` → ``\\text{水}``（只在已有 ``\\text{}`` 内替换，不双重包裹）；
    * 裸 ``[U+6c34]`` → ``\\text{水}``；
    * 去掉首尾 ``$`` 定界符。
    """
    if latex is None:
        return None
    s = str(latex)
    s = _TEXT_UPLUS_RE.sub(lambda m: "\\text{" + chr(int(m.group(1), 16)) + "}", s)
    s = _UPLUS_RE.sub(lambda m: "\\text{" + chr(int(m.group(1), 16)) + "}", s)
    s = s.strip()
    s = _LEAD_DOLLAR_RE.sub("", s).strip()
    s = _TRAIL_DOLLAR_RE.sub("", s).strip()
    return s


def _parse(stream: bytes):
    """Try both offsets. Returns (status, latex). Runs inside a worker process."""
    from mtef_py.mtef import MTEF
    import contextlib
    import io as _io
    import re as _re

    last = FAIL
    for off, _label in ((OLE_CB_HDR, "hdr28"), (0, "raw")):
        try:
            eqn = MTEF()
            eqn.reader = BytesIO(stream[off:])
            buf = _io.StringIO()
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                eqn.readRecord()
                eqn.makeAST()
                latex = eqn.Translate()
            if latex and latex.strip("$ ").strip():
                # 规范化：还原 [U+XXXX] 转义、去掉 $ 定界符（与题库表示统一，见 D1/D2）。
                return OK, _re.sub(r"\s+", " ", normalize_latex(latex).strip())
            last = EMPTY
        except Exception:
            continue
    return last, None


def _worker(payload):
    idx, stream = payload
    try:
        status, latex = _parse(stream)
    except Exception:
        status, latex = FAIL, None
    return idx, status, latex


def native_v5_payload(stream: bytes | None) -> bytes | None:
    """只接受长度完整的 Equation Native 头和真实 v5 数据，不按 ProgID 猜格式。"""
    if not stream or len(stream) < OLE_CB_HDR + 7:
        return None
    header, = struct.unpack_from('<H', stream)
    size, = struct.unpack_from('<I', stream, 8)
    if header != OLE_CB_HDR or size != len(stream) - OLE_CB_HDR:
        return None
    payload = stream[OLE_CB_HDR:]
    return payload if payload[0] == 5 else None


def _parse_strict_v5(stream: bytes):
    """旧 ProgID 中的 v5 走严格路径；不回退错误偏移、不接受缺失模板的部分结果。"""
    import contextlib
    import io
    from mtef_py.mtef import MTEF
    payload = native_v5_payload(stream)
    if payload is None:
        return FAIL, None
    eqn = MTEF()
    eqn.strict_compat = True
    eqn.reader = BytesIO(payload)
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            eqn.readRecord()
            eqn.makeAST()
            latex = eqn.Translate()
        if not eqn.Valid or re.search(r'not implement|err:|error:|FUTURE RECORD', buf.getvalue(), re.I):
            return FAIL, None
        latex = re.sub(r'\s+', ' ', normalize_latex(latex or '')).strip()
        return (OK, latex) if latex else (EMPTY, None)
    except Exception:
        return FAIL, None


def _stream_worker(in_q, out_q, strict_v5=False):
    """Convert equations one at a time, reporting each result immediately.

    Reporting per equation is what makes hang recovery cheap: if the parent stops
    hearing results, the equation currently in flight is the culprit, and it can be
    quarantined without any bisection.
    """
    while True:
        item = in_q.get()
        if item is None:
            break
        idx, stream = item
        try:
            status, latex = _parse_strict_v5(stream) if strict_v5 else _parse(stream)
        except Exception:
            status, latex = FAIL, None
        out_q.put((idx, status, latex))


def _terminate(proc):
    try:
        if proc.is_alive():
            proc.terminate()
        proc.join(timeout=3)
    except Exception:
        pass


# Normal conversion is sub-millisecond per equation, so a few seconds is a very
# generous deadline and keeps hang recovery fast.
PER_EQUATION_TIMEOUT = 4.0


def convert_many(streams, per_equation_timeout=PER_EQUATION_TIMEOUT, on_progress=None,
                 chunk_size=None, per_chunk_timeout=None, *, strict_v5=False):
    """Convert Equation Native streams to LaTeX, isolating any equation that hangs.

    Runs one worker process fed by a queue.  Each result is reported as soon as it is
    produced; if no result arrives within `per_equation_timeout`, the equation in flight
    is marked TIMEOUT, the worker is restarted, and conversion resumes from the next one.
    So a hang costs one timeout - not a bisection cascade, and never the whole file.

    Returns (results, elapsed_seconds); results is ordered like `streams`.
    """
    if not streams:
        return [], 0.0

    started = time.perf_counter()
    results: dict[int, tuple] = {}
    ctx = mp.get_context("spawn")
    import queue as _queue

    pending = list(enumerate(streams))
    while pending:
        in_q = ctx.Queue()
        out_q = ctx.Queue()
        proc = ctx.Process(target=_stream_worker, args=(in_q, out_q, strict_v5), daemon=True)
        proc.start()
        for item in pending:
            in_q.put(item)
        in_q.put(None)

        got = 0
        while got < len(pending):
            try:
                idx, status, latex = out_q.get(timeout=per_equation_timeout)
            except _queue.Empty:
                # The worker is stuck on pending[got] - quarantine it and restart.
                stuck_idx = pending[got][0]
                results[stuck_idx] = (TIMEOUT, None)
                got += 1
                break
            results[idx] = (status, latex)
            got += 1
            if on_progress:
                on_progress(len(results), len(streams))

        _terminate(proc)
        try:
            in_q.close()
            out_q.close()
        except Exception:
            pass
        pending = pending[got:]

    elapsed = time.perf_counter() - started
    return [
        {"index": i, "status": results.get(i, (FAIL, None))[0],
         "latex": results.get(i, (FAIL, None))[1]}
        for i in range(len(streams))
    ], round(elapsed, 2)


def convert_one(stream, timeout=PER_EQUATION_TIMEOUT):
    """Convenience single-equation conversion. Returns (status, latex)."""
    res, _ = convert_many([stream], per_equation_timeout=timeout)
    return res[0]["status"], res[0]["latex"]
