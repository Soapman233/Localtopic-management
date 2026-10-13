"""便携客户端启动（`editions/local/portable_main.py`）单元测试。

🔴 回归背景（**打包版曾因此完全不可用**）
-----------------------------------------
打包用 ``console=False``，exe 的 PE 子系统是 ``WINDOWS_GUI``——
**任何启动方式都不会分配控制台**，因此 ``sys.stdout`` / ``sys.stderr`` 为 ``None``。

而 uvicorn 在配置日志时会执行 ``sys.stdout.isatty()``：

    AttributeError: 'NoneType' object has no attribute 'isatty'
    -> ValueError: Unable to configure formatter 'default'

→ **进程直接崩溃**（用户双击后什么都没发生）。

⚠️ **为什么之前的验证没发现**：从 shell / 后台任务启动时，进程**继承了有效的
输出句柄**，``sys.stdout`` 不为 ``None``，于是测试全绿。
**这是验证方法上的盲区——必须在「无 stdout」条件下验证**，本测试即为此。
"""
from __future__ import annotations

import ctypes
import importlib.util
import shutil
import sys
import tempfile
import unittest
import unittest.mock  # noqa: F401 - 供 unittest.mock.patch.object 使用
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load_portable_main():
    """按路径加载 portable_main（不在包内，无法用常规 import）。"""
    spec = importlib.util.spec_from_file_location(
        "_portable_main_under_test", ROOT / "editions" / "local" / "portable_main.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _close_managed_streams() -> None:
    """关闭测试期间被接管的日志文件句柄。

    ``_ensure_streams`` 打开的句柄在进程生命周期内**必须保持打开**（设计如此），
    但测试不关掉的话，Windows 上删临时目录会因文件被占用而失败。
    """
    for stream in (sys.stdout, sys.stderr):
        name = getattr(stream, "name", "")
        if name and str(name).endswith("start.log"):
            try:
                stream.close()
            except Exception:  # noqa: BLE001
                pass


class _NoConsoleBase(unittest.TestCase):
    """在**无 stdout/stderr** 条件下测试，并保证句柄与临时目录被正确清理。"""

    def setUp(self):
        self.mod = _load_portable_main()
        self.saved = (sys.stdout, sys.stderr)
        self.tmp = Path(tempfile.mkdtemp(prefix="qb-portable-test-"))

    def tearDown(self):
        _close_managed_streams()          # ① 先关句柄
        sys.stdout, sys.stderr = self.saved
        shutil.rmtree(self.tmp, ignore_errors=True)   # ② 再删目录

    def _patch_root(self):
        return unittest.mock.patch.object(self.mod, "_data_root", return_value=self.tmp)

    def _drop_streams(self):
        sys.stdout = None
        sys.stderr = None


class TestNoConsoleReproduction(_NoConsoleBase):
    """反证：无 stdout 时 uvicorn 配日志**确实会崩**——证明修复不是多余的。"""

    def test_uvicorn_logging_crashes_without_stdout(self):
        import logging.config
        import uvicorn.config as uc

        self._drop_streams()
        with self.assertRaises(Exception) as ctx:
            logging.config.dictConfig(uc.LOGGING_CONFIG)
        msg = f"{type(ctx.exception).__name__}: {ctx.exception}"
        self.assertTrue("isatty" in msg or "formatter" in msg.lower(),
                        f"期望复现 isatty/formatter 崩溃，实际：{msg}")


class TestEnsureStreams(_NoConsoleBase):
    """正证：`_ensure_streams()` 之后 uvicorn 配日志不再崩。"""

    def test_noop_when_streams_ok(self):
        """有正常流时不应接管（返回 None）。"""
        self.assertIsNone(self.mod._ensure_streams())

    def test_takes_over_and_uvicorn_logging_ok(self):
        """stdout/stderr 为 None 时接管到日志文件，且**不再崩**。"""
        import logging.config
        import uvicorn.config as uc

        with self._patch_root():
            self._drop_streams()
            target = self.mod._ensure_streams()

        self.assertIsNotNone(target, "应返回日志路径")
        self.assertIsNotNone(sys.stdout, "stdout 必须被接管")
        self.assertIsNotNone(sys.stderr, "stderr 必须被接管")
        try:
            logging.config.dictConfig(uc.LOGGING_CONFIG)
        except Exception as exc:  # noqa: BLE001
            self.fail(f"接管后仍崩溃：{type(exc).__name__}: {exc}")

    def test_only_stdout_none(self):
        """只有 stdout 为 None 时也要接管。"""
        with self._patch_root():
            sys.stdout = None
            target = self.mod._ensure_streams()
        self.assertIsNotNone(target)
        self.assertIsNotNone(sys.stdout)

    def test_log_file_actually_written(self):
        """日志文件确实被创建，且写入可见。"""
        with self._patch_root():
            self._drop_streams()
            target = self.mod._ensure_streams()
            print("hello-from-portable", file=sys.stdout)
        self.assertTrue(target.is_file(), "日志文件应存在")
        self.assertIn("hello-from-portable", target.read_text(encoding="utf-8"))

    def test_log_path_under_data_root(self):
        p = self.mod.log_path()
        self.assertEqual(p.name, "start.log")
        self.assertEqual(p.parent.name, "webui")


class TestFatalShowsSomething(_NoConsoleBase):
    """无控制台时出错必须**让用户看得见**（弹窗），而不是静默退出。"""

    def test_fatal_does_not_raise(self):
        """`_fatal` 不抛异常，且**确实请求过弹窗**（带正确标题/正文/图标）。

        🔴 为什么必须打桩 `MessageBoxW`（2026-10-13 实测踩坑）
        ----------------------------------------------------
        `MessageBoxW` 是**阻塞式模态弹窗**：不点掉就永远不返回。
        此前本用例直接调用 `_fatal` 而不打桩，于是：
          - 整条测试套件**卡死在这一条上**（实测 11 分钟无进展；正常 1 分 41 秒）；
          - 桌面上留下一个**没人点的对话框**，等待人工点击才能继续。
        也就是说，这条测试过去是「靠有人恰好点掉弹窗」才通过的 ——
        **测试不得依赖人去点对话框**。

        打桩后不仅不再卡，还能**断言弹窗内容**——比原来的「不抛异常」强得多。
        """
        with self._patch_root():
            self._drop_streams()
            self.mod._ensure_streams()             # 接管到日志

            calls: list[tuple[str, str, int]] = []

            def _fake_message_box(_hwnd, text, title, flags):  # noqa: ANN001
                calls.append((text, title, flags))
                return 1  # IDOK

            with unittest.mock.patch.object(
                ctypes.windll.user32, "MessageBoxW", side_effect=_fake_message_box
            ):
                self.mod._fatal("测试", "这是测试错误")   # 不应抛异常

            self.assertEqual(len(calls), 1, "应恰好请求一次弹窗")
            text, title, flags = calls[0]
            self.assertEqual(title, "测试", "标题应原样传递")
            self.assertIn("这是测试错误", text, "正文应包含错误信息")
            self.assertIn("日志", text, "正文应告诉用户日志在哪")
            self.assertEqual(flags, 0x10, "应使用 MB_ICONERROR")


if __name__ == "__main__":
    unittest.main()
