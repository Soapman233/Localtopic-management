"""Pydantic 请求/响应模型。

字段命名一律 ``snake_case``（与 ``bank`` 及前端类型一致，前后端不做驼峰转换）。
当前环境为 ``pydantic 1.10``，故全部使用 v1 兼容写法。

模型仅用于**请求体校验**与 OpenAPI 文档；响应统一由 :func:`webui.errors.ok` 包装为
``{"code":0,"data":<payload>,"message":"ok"}``，故不强制为每个端点定义响应模型。
"""
# ---------------------------------------------------------------------------
# title: webui 请求/响应模型
# description: 搜索、编辑、难度、试卷、预览/导出、复核、来源元数据、设置等接口的 Pydantic v1 模型。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# --------------------------------------------------------------------------- #
# 通用
# --------------------------------------------------------------------------- #
class HealthOut(BaseModel):
    """``GET /api/health`` 响应。"""

    ok: bool = True
    db: str = ""
    db_exists: bool = False
    schema_version: Optional[int] = None
    degraded: bool = False
    messages: List[str] = Field(default_factory=list)


class PaperRevisionRequest(BaseModel):
    """领域层严格校验并统一返回40007，避免Pydantic强制转换条目id。"""
    title: Any = None
    exclude_item_ids: Any = None
    diagnostic_digest: Any = None
    confirm: Any = False


class ApiResponse(BaseModel):
    """统一响应结构（用于文档/自省）。"""

    code: int = 0
    data: Any = None
    message: str = "ok"


# --------------------------------------------------------------------------- #
# 检索
# --------------------------------------------------------------------------- #
class SearchQuery(BaseModel):
    """``GET /api/search`` 查询参数（仅用于文档/校验参考）。"""

    keyword: Optional[str] = None
    stage: Optional[str] = None
    subject: Optional[str] = None
    grade: Optional[str] = None
    textbook: Optional[str] = None
    chapter: Optional[str] = None
    qtype: Optional[str] = None
    difficulty: Optional[str] = None
    section: Optional[str] = None
    has_answer: Optional[bool] = None
    has_analysis: Optional[bool] = None
    needs_review: Optional[bool] = None
    kp_confirmed_only: bool = False
    limit: int = 20
    offset: int = 0


# --------------------------------------------------------------------------- #
# 编辑
# --------------------------------------------------------------------------- #
class FormulaPatch(BaseModel):
    """单条公式编辑（按 ``fid`` 定位）。"""

    fid: str
    latex: Optional[str] = None


class QuestionPatch(BaseModel):
    """题目编辑补丁（仅传入需要修改的字段）。"""

    text: Optional[str] = None
    answer: Optional[str] = None
    analysis: Optional[str] = None
    qtype: Optional[str] = None
    chapter: Optional[str] = None
    difficulty: Optional[str] = None
    formulas: Optional[List[FormulaPatch]] = None
    labels: Optional[List[str]] = None


class QuestionUpdateRequest(BaseModel):
    """``PUT /api/questions/{id}`` 请求体。"""

    patch: QuestionPatch = Field(default_factory=QuestionPatch)
    force: bool = False


class DifficultyRequest(BaseModel):
    """``POST /api/questions/{id}/difficulty`` 请求体。"""

    level: str


class BatchDifficultyRequest(BaseModel):
    """``POST /api/questions/difficulty/batch`` 请求体。"""

    ids: List[int] = Field(default_factory=list)
    level: str


# --------------------------------------------------------------------------- #
# 试卷
# --------------------------------------------------------------------------- #
class PaperCreate(BaseModel):
    """``POST /api/papers`` 请求体。"""

    title: str
    subject: Optional[str] = None
    stage: Optional[str] = None
    grade: Optional[str] = None
    template: Optional[str] = None
    answer_mode: Optional[str] = None
    status: Optional[str] = None
    meta: Optional[Dict[str, Any]] = None


class PaperUpdate(BaseModel):
    """``PATCH /api/papers/{id}`` 请求体（仅传入需修改字段）。"""

    title: Optional[str] = None
    subject: Optional[str] = None
    stage: Optional[str] = None
    grade: Optional[str] = None
    template: Optional[str] = None
    answer_mode: Optional[str] = None
    status: Optional[str] = None


class AddQuestionsRequest(BaseModel):
    """``POST /api/papers/{id}/questions`` 请求体。"""

    question_ids: List[int] = Field(default_factory=list)
    section: Optional[str] = None
    section_id: Optional[int] = None
    position: Optional[int] = None
    score: Optional[float] = None
    group: bool = False


class HttpsToggle(BaseModel):
    """``POST /api/network/https`` 请求体：是否让局域网走 HTTPS（自签证书）。"""

    enabled: bool


class MoveRequest(BaseModel):
    """``POST .../move`` 请求体（题目条目 / 大题移动）。"""

    position: int


class ScoreRequest(BaseModel):
    """``POST /api/papers/{id}/questions/{item_id}/score`` 请求体。"""

    score: Optional[float] = None


class ScoresRequest(BaseModel):
    """``POST /api/papers/{id}/scores`` 请求体。"""

    mapping: Dict[str, Optional[float]] = Field(default_factory=dict)


class SectionCreate(BaseModel):
    """``POST /api/papers/{id}/sections`` 请求体。"""

    name: str
    position: Optional[int] = None
    description: Optional[str] = None


class SectionRename(BaseModel):
    """``PATCH /api/papers/{id}/sections/{sid}`` 请求体。"""

    name: str


# --------------------------------------------------------------------------- #
# 预览 / 导出
# --------------------------------------------------------------------------- #
class PreviewRequest(BaseModel):
    """``POST /api/papers/{id}/preview`` 请求体。"""

    answer_mode: Optional[str] = None
    template: Optional[str] = None


class ExportRequest(BaseModel):
    """``POST /api/papers/{id}/export`` 请求体。"""

    answer_mode: Optional[str] = None
    template: Optional[str] = None
    formats: List[str] = Field(default_factory=lambda: ["docx", "pdf"])
    out_dir: Optional[str] = None


# --------------------------------------------------------------------------- #
# 复核 / 标签
# --------------------------------------------------------------------------- #
class ReviewResolveRequest(BaseModel):
    """``POST /api/review/{rq_id}/resolve`` 请求体。"""

    resolved: bool = True


class LabelDecisionPreviewRequest(BaseModel):
    """``POST /api/labels/decision/preview`` 请求体。"""

    label_name: str
    decision: str
    question_id: Optional[int] = None


class LabelDecisionRequest(BaseModel):
    """``POST /api/labels/decision`` 请求体。"""

    label_name: str
    decision: str
    question_id: Optional[int] = None
    confirm: bool = False
    force: bool = False


# --------------------------------------------------------------------------- #
# 来源文件
# --------------------------------------------------------------------------- #
class SourceMetadataRequest(BaseModel):
    """``POST /api/sources/{id}/metadata`` 请求体。"""

    grade: Optional[str] = None
    textbook: Optional[str] = None
    confirm: bool = False


# --------------------------------------------------------------------------- #
# 设置
# --------------------------------------------------------------------------- #
class SettingsUpdate(BaseModel):
    """``PUT /api/settings`` 请求体（部分字段）。"""

    db_path: Optional[str] = None
    export_dir: Optional[str] = None
    default_template: Optional[str] = None
    katex: Optional[dict] = None
    theme: Optional[dict] = None


# --------------------------------------------------------------------------- #
# 鉴权 / 用户管理
# --------------------------------------------------------------------------- #
class LoginRequest(BaseModel):
    """``POST /api/auth/login`` 请求体。"""

    username: str
    password: str


class UserCreateRequest(BaseModel):
    """``POST /api/auth/users`` 请求体（仅 admin）。"""

    username: str
    password: str
    role: str = "viewer"
    display_name: Optional[str] = None


class UserUpdateRequest(BaseModel):
    """``PATCH /api/auth/users/{id}`` 请求体（仅 admin；仅传入需修改字段）。"""

    role: Optional[str] = None
    disabled: Optional[bool] = None
    display_name: Optional[str] = None


class UserPasswordRequest(BaseModel):
    """``POST /api/auth/users/{id}/password`` 请求体（仅 admin）。"""

    password: str


__all__ = [
    "HealthOut", "ApiResponse", "SearchQuery",
    "FormulaPatch", "QuestionPatch", "QuestionUpdateRequest",
    "DifficultyRequest", "BatchDifficultyRequest",
    "PaperCreate", "PaperUpdate", "AddQuestionsRequest", "MoveRequest",
    "ScoreRequest", "ScoresRequest", "SectionCreate", "SectionRename",
    "PreviewRequest", "ExportRequest",
    "ReviewResolveRequest", "LabelDecisionPreviewRequest", "LabelDecisionRequest",
    "SourceMetadataRequest", "SettingsUpdate",
    "LoginRequest", "UserCreateRequest", "UserUpdateRequest", "UserPasswordRequest",
]
