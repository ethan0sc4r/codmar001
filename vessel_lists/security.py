
import re
import logging
import json
from datetime import datetime
from typing import Optional, Any, Dict
from functools import wraps

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from config import config

audit_logger = logging.getLogger("audit")
audit_logger.setLevel(logging.INFO)

_audit_handler = logging.FileHandler("data/audit.log")
_audit_handler.setFormatter(logging.Formatter(
    '%(asctime)s | %(levelname)s | %(message)s'
))
audit_logger.addHandler(_audit_handler)


def sanitize_filename(filename: str, max_length: int = 100) -> str:
    if not filename:
        return "export"

    filename = filename.replace("/", "").replace("\\", "").replace("..", "")

    safe_chars = config.security.safe_filename_chars
    sanitized = ""
    for char in filename:
        if char in safe_chars:
            sanitized += char
        elif char == " ":
            sanitized += "_"

    sanitized = sanitized.strip("_")[:max_length]

    return sanitized if sanitized else "export"


def audit_log(
    action: str,
    resource_type: str,
    resource_id: Optional[Any] = None,
    details: Optional[Dict] = None,
    request: Optional[Request] = None
) -> None:
    log_entry = {
        "timestamp": datetime.utcnow().isoformat(),
        "action": action,
        "resource_type": resource_type,
        "resource_id": resource_id,
    }

    if details:
        log_entry["details"] = details

    if request:
        log_entry["client_ip"] = get_client_ip(request)
        log_entry["user_agent"] = request.headers.get("user-agent", "unknown")[:200]

    audit_logger.info(json.dumps(log_entry))


def get_client_ip(request: Request) -> str:
    
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()

    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip

    if request.client:
        return request.client.host

    return "unknown"


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)

        response.headers["X-Content-Type-Options"] = "nosniff"

        response.headers["X-Frame-Options"] = "DENY"

        response.headers["X-XSS-Protection"] = "1; mode=block"

        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"

        return response


class RateLimiter:
    

    def __init__(self):
        self._requests: Dict[str, list] = {}

    def is_allowed(self, client_ip: str, max_requests: int = 60, window_seconds: int = 60) -> bool:
        
        if not config.rate_limit.enabled:
            return True

        now = datetime.utcnow()
        window_start = now.timestamp() - window_seconds

        if client_ip not in self._requests:
            self._requests[client_ip] = []

        self._requests[client_ip] = [
            ts for ts in self._requests[client_ip]
            if ts > window_start
        ]

        if len(self._requests[client_ip]) >= max_requests:
            return False

        self._requests[client_ip].append(now.timestamp())
        return True

    def cleanup(self) -> None:
        
        now = datetime.utcnow().timestamp()
        window = 120

        for ip in list(self._requests.keys()):
            self._requests[ip] = [ts for ts in self._requests[ip] if ts > now - window]
            if not self._requests[ip]:
                del self._requests[ip]


rate_limiter = RateLimiter()


def validate_mmsi(mmsi: Optional[str]) -> bool:
    
    if not mmsi:
        return True
    return bool(re.match(r'^\d{9}$', mmsi.strip()))


def validate_imo(imo: Optional[str]) -> bool:
    
    if not imo:
        return True
    imo = imo.strip().upper()
    return bool(re.match(r'^(IMO)?\d{7}$', imo))


def validate_color(color: Optional[str]) -> bool:
    
    if not color:
        return True
    return bool(re.match(r'^


def sanitize_string(value: Optional[str], max_length: int = 500) -> Optional[str]:
    
    if not value:
        return value

    sanitized = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', value)

    return sanitized[:max_length]
