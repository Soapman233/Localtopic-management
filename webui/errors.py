"""统一错误类型与异常处理器。

统一响应结构（架构设计 §3.4 / §8.1）
------------------------------------
* 成功：``{"code": 0, "data": <payload>, "message": "ok"}``
* 失败：``{"code": <非0>, "data": null|{...}, "message": "<可读原因>"}``，并设对应 HTTP 状态码。

错误码约定（``code`` 前 3 位 = HTTP 状态语义）
--------------------------------------------
* ``400xx`` 参数/校验错误（占位符缺失、非法难度、非法模板、非法分值、CSV 非法、设置非法）
* ``401xx`` 未授权（共享令牌缺失/错误、会话缺失/过期、凭据错误、账号禁用）
* ``403xx`` 禁止访问（已认证但权限不足）
* ``404xx`` 资源不存在（题/试卷/条目/图片/作业/标签/复核项/来源文件/用户）
* ``409xx`` 冲突（内容哈希重复、非空需 force、批量未确认、用户已存在）
* ``500xx`` 后端内部错误（含 editor_sdk 不可达、COM/PDF 失败）
"""
# ---------------------------------------------------------------------------
# title: webui 统一错误处理
# description: ApiError 体系与异常处理器；把 bank 的 ValueError/冲突/桥接错误映射为统一响应。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

import logging
import sqlite3
from typing import Any

#: 模块日志器（把内部异常细节写进**服务端日志**，而非回显给客户端——安全审计 F6）。
_log = logging.getLogger("webui.errors")


# --------------------------------------------------------------------------- #
# 异常类型
# --------------------------------------------------------------------------- #
class ApiError(Exception):
    """API 层统一异常基类（携带错误码、HTTP 状态与可选附加数据）。"""

    code: int = 50001
    http_status: int = 500

    def __init__(self, message: str, *, code: int | None = None,
                 http_status: int | None = None, data: Any = None):
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        if http_status is not None:
            self.http_status = http_status
        self.data = data


class ValidationError(ApiError):
    """参数/校验错误（400）。"""

    code = 40000
    http_status = 400


class NotFoundError(ApiError):
    """资源不存在（404）。"""

    code = 40400
    http_status = 404


class ConflictError(ApiError):
    """冲突（409）。"""

    code = 40900
    http_status = 409


class UnauthorizedError(ApiError):
    """未授权（401）：缺少/错误的令牌、会话失效、凭据错误、账号禁用。"""

    code = 40100
    http_status = 401


class ForbiddenError(ApiError):
    """禁止访问（403）：已认证但权限不足。"""

    code = 40301
    http_status = 403


# 常用具体错误码（与架构设计 §3.4 对齐）
class PlaceholderMissing(ValidationError):
    """题干占位符缺少对应公式（40001）。"""

    code = 40001


class InvalidDifficulty(ValidationError):
    """非法难度档位（40002）。"""

    code = 40002


class InvalidTemplate(ValidationError):
    """非法模板/答案模式（40003）。"""

    code = 40003


class InvalidScore(ValidationError):
    """非法分值（40004）。"""

    code = 40004


class MissingUpload(ValidationError):
    """未提供上传文件 / 文件为空（40010）。"""

    code = 40010


class InvalidUpload(ValidationError):
    """上传文件非法：格式不支持 / 超过大小上限 / 导入功能已关闭（40011）。"""

    code = 40011


class ContentConflict(ConflictError):
    """内容哈希重复（40901）。"""

    code = 40901


class ConfirmationRequired(ConflictError):
    """批量操作需二次确认（40903）。"""

    code = 40903


class BridgeUnavailable(ApiError):
    """editor_sdk / COM 等外部依赖不可用（50001）。"""

    code = 50001
    http_status = 500


# --------------------------------------------------------------------------- #
# 具体错误码常量（与架构设计 §3.4 对齐）
# --------------------------------------------------------------------------- #
#: 参数/校验错误（400）。
CODE_PLACEHOLDER_MISSING = 40001   # 题干占位符缺失对应公式
CODE_INVALID_DIFFICULTY = 40002     # 非法难度档位
CODE_INVALID_TEMPLATE = 40003       # 非法模板 / 答案模式 / 试卷状态
CODE_INVALID_SCORE = 40004          # 非法分值
CODE_INVALID_CSV = 40005            # CSV 非法
CODE_INVALID_SETTINGS = 40006       # 非法设置
CODE_INVALID_REVISION = 40007
CODE_AUTH_DISABLED = 40008          # 当前未启用用户体系（无用户 / 非线上版）
CODE_INVALID_ROLE = 40009           # 非法角色
CODE_MISSING_UPLOAD = 40010         # 未提供上传文件 / 文件为空
CODE_INVALID_UPLOAD = 40011         # 上传文件非法（格式 / 大小 / 功能关闭）

#: 未授权（401）。
CODE_UNAUTHORIZED_TOKEN = 40101     # 缺少 / 错误的共享访问令牌（历史行为）
CODE_UNAUTHORIZED_SESSION = 40102   # 会话缺失或已过期
#: 用户名或密码错误；**账号被禁用也复用此码**——不向未认证请求方暴露账号状态（防枚举）。
CODE_INVALID_CREDENTIALS = 40103

#: 禁止访问（403）。
CODE_FORBIDDEN = 40301              # 已认证但权限不足

#: 资源不存在（404）。
CODE_QUESTION_NOT_FOUND = 40401     # 题不存在
CODE_PAPER_NOT_FOUND = 40402        # 试卷不存在
CODE_ITEM_NOT_FOUND = 40403         # 试卷条目 / 题目不存在
CODE_IMAGE_NOT_FOUND = 40404        # 图片缺失
CODE_JOB_NOT_FOUND = 40405          # 作业不存在
CODE_LABEL_NOT_FOUND = 40406        # 标签不存在
CODE_REVIEW_NOT_FOUND = 40407       # 复核项不存在
CODE_SOURCE_NOT_FOUND = 40408       # 来源文件不存在
CODE_USER_NOT_FOUND = 40409         # 用户不存在

#: 冲突（409）。
CODE_CONTENT_CONFLICT = 40901       # 内容哈希重复
CODE_NEED_FORCE = 40902             # 非空需 force
CODE_NEED_CONFIRM = 40903           # 批量 / 文件级操作未确认
CODE_EXPORT_CONTENT_BLOCKED = 40904
CODE_EXPORT_EVIDENCE_STALE = 40905
CODE_USER_EXISTS = 40906            # 用户名已存在

#: 后端内部错误（500）。
CODE_INTERNAL = 50001               # 含 editor_sdk 不可达、COM/PDF 失败

#: 服务不可用（503）——线上版鉴权不可用（**fail-closed**，安全审计 F1/F2）。
#: 语义：不是「你没登录」（401），而是「服务没配好」——运维需去建号或去修库。
CODE_AUTH_UNINITIALIZED = 50301     # 鉴权未初始化（线上版尚未创建首个管理员）
CODE_AUTH_STORE_ERROR = 50302       # 鉴权数据库不可用（损坏 / 权限不足）


# --------------------------------------------------------------------------- #
# 构造辅助（供 service / router 抛出带正确 code+HTTP 状态的错误）
# --------------------------------------------------------------------------- #
def bad_request(code: int, message: str, data: Any = None) -> ApiError:
    """构造 400 类错误（``code`` 应为 400xx）。"""
    return ApiError(message, code=int(code), http_status=400, data=data)


def not_found(code: int, message: str, data: Any = None) -> ApiError:
    """构造 404 类错误（``code`` 应为 404xx）。"""
    return ApiError(message, code=int(code), http_status=404, data=data)


def conflict(code: int, message: str, data: Any = None) -> ApiError:
    """构造 409 类错误（``code`` 应为 409xx）。"""
    return ApiError(message, code=int(code), http_status=409, data=data)


def unauthorized(code: int, message: str, data: Any = None) -> ApiError:
    """构造 401 类错误（``code`` 应为 401xx）。"""
    return ApiError(message, code=int(code), http_status=401, data=data)


def forbidden(code: int, message: str, data: Any = None) -> ApiError:
    """构造 403 类错误（``code`` 应为 403xx）。"""
    return ApiError(message, code=int(code), http_status=403, data=data)


def bridge_error(message: str, data: Any = None) -> ApiError:
    """构造 50001 错误（editor_sdk / COM / PDF 等外部依赖不可用）。"""
    return ApiError(message, code=CODE_INTERNAL, http_status=500, data=data)


#: 由异常消息关键词推断错误码（bank 的 ``ValueError`` 兜底映射）。
_KEYWORD_CODE: tuple[tuple[tuple[str, ...], int], ...] = (
    (("占位符",), CODE_PLACEHOLDER_MISSING),
    (("难度",), CODE_INVALID_DIFFICULTY),
    (("模板", "answer_mode", "答案模式", "status 取值"), CODE_INVALID_TEMPLATE),
    (("分值", "分数"), CODE_INVALID_SCORE),
    (("不存在",), CODE_QUESTION_NOT_FOUND),
)


def map_value_error(exc: ValueError, *, default_code: int = 40000) -> ApiError:
    """把 ``bank`` 抛出的 ``ValueError`` 按消息关键词映射为带 code 的 :class:`ApiError`。

    这是「兜底」：service 层应尽量显式抛出带正确 code 的错误（如资源不存在用
    :func:`not_found`）；本函数保证**任何**漏网的 ``ValueError`` 也能返回可读 code，
    而不是笼统的 40000。
    """
    text = str(exc)
    for keywords, code in _KEYWORD_CODE:
        if any(k in text for k in keywords):
            if 40401 <= code <= 40408:
                return not_found(code, text)
            return bad_request(code, text)
    return bad_request(default_code, text)


# --------------------------------------------------------------------------- #
# 响应构造
# --------------------------------------------------------------------------- #
def ok(data: Any = None, message: str = "ok") -> dict:
    """构造成功响应体。"""
    return {"code": 0, "data": data, "message": message}


def error_body(code: int, message: str, data: Any = None) -> dict:
    """构造失败响应体。"""
    return {"code": int(code), "data": data, "message": message}


def to_api_error(exc: Exception) -> ApiError:
    """把任意异常映射为 :class:`ApiError`（供异常处理器调用）。

    * :class:`ApiError` 原样返回；
    * ``bank.edit.ContentConflict`` → 40901（内容重复）；
    * ``bank.edit.ConfirmationRequired`` → 40903（批量未确认）；
    * ``bank.export.BridgeUnreachable`` / ``bank.export.ExportError`` → 50001；
    * 其它 ``ValueError`` → 40000；
    * 其余 → 50001（内部错误）。
    """
    if isinstance(exc, ApiError):
        return exc
    # 数据存储异常（sqlite3）：绝不回显原始错误（可能含文件路径 / 内部细节），
    # 统一返回通用文案，细节只进服务端日志（安全审计 F6）。
    if isinstance(exc, sqlite3.Error):
        _log.exception("数据存储异常：%s", exc)
        return ApiError("服务暂不可用：数据存储异常，请稍后重试或联系管理员。",
                        code=CODE_INTERNAL, http_status=500)
    from bank.export_content import ExportContentError, ExportEvidenceStale
    if isinstance(exc, ExportContentError):
        return conflict(CODE_EXPORT_CONTENT_BLOCKED, str(exc), exc.diagnostics)
    if isinstance(exc, ExportEvidenceStale):
        return conflict(CODE_EXPORT_EVIDENCE_STALE, str(exc), exc.diagnostics)

    # 延迟导入，避免 webui.errors 强依赖 bank（便于单测）。
    try:
        from bank import edit as _edit  # noqa: WPS433
        if isinstance(exc, _edit.ContentConflict):
            return ContentConflict(str(exc), data=getattr(exc, "conflict", None))
        if isinstance(exc, _edit.ConfirmationRequired):
            return ConfirmationRequired(str(exc), data={"affected": getattr(exc, "affected", 0)})
    except Exception:  # noqa: BLE001 - bank 不可用时忽略
        pass

    try:
        from bank import export as _export  # noqa: WPS433
        if isinstance(exc, (_export.BridgeUnreachable, _export.ExportError)):
            return BridgeUnavailable(str(exc))
    except Exception:  # noqa: BLE001
        pass

    # 鉴权领域错误（webui.auth 只依赖标准库，不会与本模块成环）。
    try:
        from . import auth as _auth  # noqa: WPS433
        if isinstance(exc, _auth.UserExistsError):
            return conflict(CODE_USER_EXISTS, str(exc))
        if isinstance(exc, _auth.UserNotFoundError):
            return not_found(CODE_USER_NOT_FOUND, str(exc))
        if isinstance(exc, _auth.InvalidCredentials):
            return unauthorized(CODE_INVALID_CREDENTIALS, str(exc))
        if isinstance(exc, _auth.AuthNotEnabled):
            return bad_request(CODE_AUTH_DISABLED, str(exc))
        if isinstance(exc, _auth.InvalidRole):
            return bad_request(CODE_INVALID_ROLE, str(exc))
        if isinstance(exc, _auth.PasswordInvalid):
            return bad_request(40000, str(exc))
        if isinstance(exc, _auth.AuthError):
            return bad_request(40000, str(exc))
    except Exception:  # noqa: BLE001 - auth 不可用时忽略
        pass

    if isinstance(exc, ValueError):
        return map_value_error(exc)
    if isinstance(exc, FileNotFoundError):
        # ⚠️ **有意保留**：``str(exc)`` 可能含文件路径。这是**面向用户的定位信息**
        # （如「导出的模板文件被挪走了」），帮助老师找到缺失文件，故不回退为通用文案。
        # 安全性：线上模式下**未认证请求在中间件即被拦截**，根本到不了此处；仅在已认证
        # 请求下可达。请勿当作「路径泄漏」误改（对照 F6：未认证客户端不得拿到文件系统布局）。
        return NotFoundError(str(exc))
    # 兜底：**不**回显原始异常字符串（可能含文件路径 / SQL / 内部细节）。具体原因由
    # 异常处理器写入服务端日志（见 :func:`register_exception_handlers`），客户端只拿通用文案。
    return ApiError("服务内部错误：请稍后重试或联系管理员。",
                    code=CODE_INTERNAL, http_status=500)


def register_exception_handlers(app) -> None:
    """给 FastAPI 应用注册异常处理器（不泄漏 traceback）。"""
    from fastapi import Request
    from fastapi.responses import JSONResponse

    @app.exception_handler(ApiError)
    async def _api_error_handler(_request: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(status_code=exc.http_status,
                            content=error_body(exc.code, exc.message, exc.data))

    # 鉴权领域错误（webui.auth.AuthError 及其子类）：显式注册，
    # 避免落入通用 Exception 处理器（Starlette 会对其重新抛出，导致 500/测试报错）。
    from . import auth as _auth  # noqa: WPS433

    @app.exception_handler(_auth.AuthError)
    async def _auth_error_handler(_request: Request, exc) -> JSONResponse:
        mapped = to_api_error(exc)
        return JSONResponse(status_code=mapped.http_status,
                            content=error_body(mapped.code, mapped.message, mapped.data))

    @app.exception_handler(sqlite3.Error)
    async def _sqlite_error_handler(_request: Request, exc: sqlite3.Error) -> JSONResponse:
        """数据存储异常：回显**通用文案**，内部细节只进服务端日志（安全审计 F6）。

        显式注册（而非依赖通用 ``Exception`` 处理器）——后者在 Starlette 下会重新抛出，
        导致 TestClient 报错；同时确保任何 ``sqlite3.Error`` 都不会把 SQL / 路径回显给客户端。
        """
        _log.exception("数据存储异常：%s", exc)
        return JSONResponse(status_code=500, content=error_body(
            CODE_INTERNAL, "服务暂不可用：数据存储异常，请稍后重试或联系管理员。"))

    @app.exception_handler(ValueError)
    async def _value_error_handler(_request: Request, exc: ValueError) -> JSONResponse:
        mapped = to_api_error(exc)
        return JSONResponse(status_code=mapped.http_status,
                            content=error_body(mapped.code, mapped.message, mapped.data))

    @app.exception_handler(Exception)
    async def _unhandled_handler(_request: Request, exc: Exception) -> JSONResponse:
        mapped = to_api_error(exc)
        # 仅对真正的服务端错误（5xx）记录堆栈细节；已映射为 4xx 的业务错误不刷日志。
        if mapped.http_status >= 500:
            _log.exception("未处理的服务端异常：%s", exc)
        return JSONResponse(status_code=mapped.http_status,
                            content=error_body(mapped.code, mapped.message, mapped.data))


__all__ = [
    "ApiError", "ValidationError", "NotFoundError", "ConflictError",
    "UnauthorizedError", "ForbiddenError",
    "PlaceholderMissing", "InvalidDifficulty", "InvalidTemplate", "InvalidScore",
    "ContentConflict", "ConfirmationRequired", "BridgeUnavailable",
    "CODE_PLACEHOLDER_MISSING", "CODE_INVALID_DIFFICULTY", "CODE_INVALID_TEMPLATE",
    "CODE_INVALID_SCORE", "CODE_INVALID_CSV", "CODE_INVALID_SETTINGS",
    "CODE_AUTH_DISABLED", "CODE_INVALID_ROLE",
    "CODE_UNAUTHORIZED_TOKEN", "CODE_UNAUTHORIZED_SESSION",
    "CODE_INVALID_CREDENTIALS", "CODE_FORBIDDEN",
    "CODE_QUESTION_NOT_FOUND", "CODE_PAPER_NOT_FOUND", "CODE_ITEM_NOT_FOUND",
    "CODE_IMAGE_NOT_FOUND", "CODE_JOB_NOT_FOUND", "CODE_LABEL_NOT_FOUND",
    "CODE_REVIEW_NOT_FOUND", "CODE_SOURCE_NOT_FOUND", "CODE_USER_NOT_FOUND",
    "CODE_CONTENT_CONFLICT", "CODE_NEED_FORCE", "CODE_NEED_CONFIRM",
    "CODE_USER_EXISTS", "CODE_INTERNAL",
    "CODE_AUTH_UNINITIALIZED", "CODE_AUTH_STORE_ERROR",
    "bad_request", "not_found", "conflict", "unauthorized", "forbidden",
    "bridge_error", "map_value_error",
    "ok", "error_body", "to_api_error", "register_exception_handlers",
]
