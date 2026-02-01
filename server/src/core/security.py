
import hashlib
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from src.core.config import get_config
from src.core.logger import get_logger

logger = get_logger(module="security")

http_bearer = HTTPBearer(auto_error=False)

_token_manager = None


def set_token_manager(token_manager) -> None:
    
    global _token_manager
    _token_manager = token_manager


def get_token_manager():
    
    return _token_manager


def _hash_token(token: str) -> str:
    
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def get_api_token() -> Optional[str]:
    
    config = get_config()
    if hasattr(config, 'api_security') and config.api_security.enabled:
        return config.api_security.bearer_token
    return None


async def _validate_token(token: str) -> bool:
    config = get_config()

    if hasattr(config, 'api_security') and config.api_security.bearer_token:
        if token == config.api_security.bearer_token:
            return True

    if _token_manager is not None:
        if token.startswith('df_'):
            db_token = await _token_manager.validate_token(token)
            if db_token:
                return True

    return False


async def verify_token(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(http_bearer)
) -> str:
    config = get_config()

    if not hasattr(config, 'api_security') or not config.api_security.enabled:
        return "security_disabled"

    static_token = config.api_security.bearer_token
    has_token_manager = _token_manager is not None

    if not static_token and not has_token_manager:
        logger.warning("API security enabled but no token source configured")
        return "no_token_configured"

    if not credentials:
        logger.warning("Missing authentication credentials")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    is_valid = await _validate_token(credentials.credentials)

    if not is_valid:
        logger.warning("Invalid authentication token")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return credentials.credentials


async def verify_websocket_token_from_header(websocket) -> str:
    config = get_config()

    if not hasattr(config, 'api_security') or not config.api_security.enabled:
        return "security_disabled"

    static_token = config.api_security.bearer_token
    has_token_manager = _token_manager is not None

    if not static_token and not has_token_manager:
        return "no_token_configured"

    token = None

    auth_header = websocket.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        token = auth_header[7:]

    if not token:
        logger.warning("WebSocket connection rejected: missing Authorization header")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header (use: Authorization: Bearer <token>)",
        )

    is_valid = await _validate_token(token)

    if not is_valid:
        logger.warning("WebSocket connection rejected: invalid token")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )

    return token


class SecurityError(Exception):
    
    pass
