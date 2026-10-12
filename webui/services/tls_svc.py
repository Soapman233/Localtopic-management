"""自签 TLS 证书（局域网 HTTPS）。

为什么需要
----------
局域网访问默认是 **HTTP 明文**：公司/公共 WiFi 下，同网段的人若知道 WiFi 密码
即可解密流量，拿到链接里的访问令牌 = **完整读写权限**。唯一的根治办法是加密。

设计要点
--------
* **每台机器独立密钥**：证书与私钥在**本机生成**并只存本地（``outputs/webui/tls/``）。
  ⚠️ 绝不能随程序分发同一份私钥——那样嗅探者用公开的私钥就能解密，加密形同虚设。
* **SAN 必须含当前局域网 IP**：手机按 IP 访问，SAN 不含该 IP 时浏览器会额外报
  "证书名称不匹配"（虽仍可跳过，但提示更吓人）。IP 变化时自动重建。
* **自签证书必然有"不受信任"提示**：这是无法避免的（除非在手机上安装根证书，
  对老师过重）。界面需给出**图文指引**，说明"这是正常现象，点继续访问即可"。
* 生成用 ``cryptography``；缺库时**优雅降级**为 HTTP 并明确告警（不静默降级）。
"""
# ---------------------------------------------------------------------------
# title: 自签 TLS 证书服务
# description: 为局域网访问生成/复用自签证书（含局域网 IP 的 SAN），IP 变化自动重建；缺库时明确告警而非静默降级。
# author: 待补充
# version: 0.1.0
# category: Web界面-后端
# ---------------------------------------------------------------------------

from __future__ import annotations

import datetime as _dt
import ipaddress
import logging
from pathlib import Path

from .. import config

_log = logging.getLogger(__name__)

#: 证书与私钥所在目录（相对数据根，随便携目录迁移）。
_SUBDIR = "tls"
_CERT_NAME = "server.crt"
_KEY_NAME = "server.key"
#: 记录生成时包含的 SAN，用于判断是否需要重建。
_SAN_NAME = "san.txt"

#: 有效期（天）。Apple 对**受信任**证书上限 825 天；自签不受限，取 825 即可。
_VALID_DAYS = 825

#: 证书主题。
_COMMON_NAME = "题库本地服务"


def tls_dir() -> Path:
    """证书目录（不存在则创建）。"""
    d = config.WEBUI_DIR / _SUBDIR
    d.mkdir(parents=True, exist_ok=True)
    return d


def cert_paths() -> tuple[Path, Path]:
    """返回 ``(cert, key)`` 路径（不保证已存在）。"""
    d = tls_dir()
    return d / _CERT_NAME, d / _KEY_NAME


def _desired_san(hosts: list[str]) -> tuple[str, ...]:
    """把主机名/IP 归一成排序后的 SAN 列表（用于比对是否需要重建）。"""
    out: set[str] = {"localhost", "127.0.0.1"}
    for h in hosts:
        if h:
            out.add(h.strip())
    return tuple(sorted(out))


def _san_file() -> Path:
    return tls_dir() / _SAN_NAME


def current_san() -> tuple[str, ...] | None:
    """已生成证书所覆盖的 SAN；无证书时返回 ``None``。"""
    f = _san_file()
    if not f.is_file():
        return None
    try:
        return tuple(sorted(x for x in f.read_text(encoding="utf-8").splitlines() if x.strip()))
    except OSError:
        return None


def available() -> bool:
    """是否具备生成证书的能力（``cryptography`` 可用）。"""
    try:
        import cryptography  # noqa: F401
        return True
    except Exception:  # noqa: BLE001
        return False


def ensure_cert(hosts: list[str], *, force: bool = False) -> tuple[Path, Path] | None:
    """确保存在覆盖 ``hosts`` 的自签证书，返回 ``(cert, key)``；不可用时返回 ``None``。

    * 证书已存在且 SAN 已覆盖目标主机 → 直接复用（**不重建**，避免手机端反复信任）；
    * SAN 变化（例如换了网络、局域网 IP 变了）或 ``force=True`` → 重新生成。
    """
    if not available():
        _log.warning("未安装 cryptography，无法生成自签证书；将退回 HTTP（明文）。")
        return None

    cert, key = cert_paths()
    want = _desired_san(hosts)
    have = current_san()
    if not force and cert.is_file() and key.is_file() and have is not None:
        if set(want) <= set(have):
            return cert, key
        _log.info("局域网地址变化，重建自签证书：%s -> %s", have, want)

    try:
        _generate(cert, key, want)
    except Exception as exc:  # noqa: BLE001 - 生成失败不应让服务起不来
        _log.warning("生成自签证书失败：%s；将退回 HTTP（明文）。", exc)
        return None
    _san_file().write_text("\n".join(want), encoding="utf-8")
    return cert, key


def _generate(cert_file: Path, key_file: Path, san: tuple[str, ...]) -> None:
    """生成自签证书（RSA 2048，兼容性最好）并写入磁盘。"""
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    subject = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, _COMMON_NAME),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "题库本地服务（自签）"),
    ])
    alt: list[x509.GeneralName] = []
    for h in san:
        try:
            alt.append(x509.IPAddress(ipaddress.ip_address(h)))
        except ValueError:
            alt.append(x509.DNSName(h))

    now = _dt.datetime.now(_dt.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)                     # 自签：颁发者 = 主体
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - _dt.timedelta(minutes=5))   # 容忍轻微时钟偏差
        .not_valid_after(now + _dt.timedelta(days=_VALID_DAYS))
        .add_extension(x509.SubjectAlternativeName(alt), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )

    cert_file.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_file.write_bytes(key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ))
    try:                                          # 私钥尽量收紧权限（Windows 上为尽力而为）
        key_file.chmod(0o600)
    except OSError:
        pass


def fingerprint() -> str | None:
    """证书指纹（SHA-256，前 16 位十六进制），供界面核对；无证书返回 ``None``。"""
    cert, _ = cert_paths()
    if not cert.is_file():
        return None
    try:
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes
        data = x509.load_pem_x509_certificate(cert.read_bytes())
        return data.fingerprint(hashes.SHA256()).hex()[:16].upper()
    except Exception:  # noqa: BLE001
        return None


__all__ = [
    "tls_dir", "cert_paths", "available", "ensure_cert",
    "current_san", "fingerprint",
]
