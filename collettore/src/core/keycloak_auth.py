
import time
import secrets
import ssl
import urllib.parse
from typing import Optional
from functools import lru_cache

import jwt
import httpx
from jwt import PyJWKClient
from fastapi import Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from src.core.config import get_config
from src.core.logger import LoggerMixin


class AdminUser(BaseModel):
    
    sub: str
    preferred_username: str
    email: Optional[str] = None
    roles: list[str] = []


class KeycloakAuthError(Exception):
    
    pass


class KeycloakAuth(LoggerMixin):

    def __init__(self):
        self._logger_context = {'component': 'keycloak-auth'}
        self._jwks_client: Optional[PyJWKClient] = None
        self._jwks_cache_time: float = 0
        self._jwks_cache_duration: int = 3600
        self._sessions: dict[str, dict] = {}
        self._pending_states: dict[str, float] = {}

    def _get_jwks_client(self) -> PyJWKClient:
        
        config = get_config()

        if not hasattr(config, 'keycloak') or not config.keycloak:
            raise KeycloakAuthError("Keycloak not configured")

        current_time = time.time()

        if self._jwks_client is None or (current_time - self._jwks_cache_time) > self._jwks_cache_duration:
            jwks_url = f"{config.keycloak.server_url}/realms/{config.keycloak.realm}/protocol/openid-connect/certs"

            ssl_context = None
            if getattr(config.keycloak, 'skip_ssl_verify', False):
                ssl_context = ssl.create_default_context()
                ssl_context.check_hostname = False
                ssl_context.verify_mode = ssl.CERT_NONE
                self.logger.warning("SSL verification disabled for JWKS client")

            self._jwks_client = PyJWKClient(jwks_url, ssl_context=ssl_context)
            self._jwks_cache_time = current_time
            self.logger.debug("JWKS client initialized", url=jwks_url)

        return self._jwks_client

    def get_authorization_url(self, redirect_uri: str) -> tuple[str, str]:
        config = get_config()

        if not hasattr(config, 'keycloak') or not config.keycloak:
            raise KeycloakAuthError("Keycloak not configured")

        state = secrets.token_urlsafe(32)
        self._pending_states[state] = time.time()

        current_time = time.time()
        self._pending_states = {
            s: t for s, t in self._pending_states.items()
            if current_time - t < 600
        }

        auth_endpoint = f"{config.keycloak.server_url}/realms/{config.keycloak.realm}/protocol/openid-connect/auth"
        params = {
            "client_id": config.keycloak.client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "openid profile email",
            "state": state,
        }

        auth_url = f"{auth_endpoint}?{urllib.parse.urlencode(params)}"
        return auth_url, state

    def validate_state(self, state: str) -> bool:
        
        if state not in self._pending_states:
            return False

        if time.time() - self._pending_states[state] > 600:
            del self._pending_states[state]
            return False

        del self._pending_states[state]
        return True

    async def exchange_code_for_tokens(self, code: str, redirect_uri: str) -> dict:
        config = get_config()

        if not hasattr(config, 'keycloak') or not config.keycloak:
            raise KeycloakAuthError("Keycloak not configured")

        token_endpoint = f"{config.keycloak.server_url}/realms/{config.keycloak.realm}/protocol/openid-connect/token"

        data = {
            "grant_type": "authorization_code",
            "client_id": config.keycloak.client_id,
            "client_secret": config.keycloak.client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
        }

        ssl_verify = not getattr(config.keycloak, 'skip_ssl_verify', False)

        async with httpx.AsyncClient(verify=ssl_verify) as client:
            response = await client.post(
                token_endpoint,
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )

            if response.status_code != 200:
                self.logger.error(
                    "Token exchange failed",
                    status=response.status_code,
                    response=response.text,
                )
                raise KeycloakAuthError(f"Token exchange failed: {response.text}")

            return response.json()

    def create_session(self, access_token: str, refresh_token: str = None) -> str:
        session_id = secrets.token_urlsafe(32)
        self._sessions[session_id] = {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "created_at": time.time(),
        }

        current_time = time.time()
        self._sessions = {
            sid: data for sid, data in self._sessions.items()
            if current_time - data["created_at"] < 28800
        }

        return session_id

    def get_session_token(self, session_id: str) -> Optional[str]:
        
        session = self._sessions.get(session_id)
        if not session:
            return None

        if time.time() - session["created_at"] > 28800:
            del self._sessions[session_id]
            return None

        return session["access_token"]

    def delete_session(self, session_id: str):
        
        if session_id in self._sessions:
            del self._sessions[session_id]

    def validate_token(self, token: str) -> AdminUser:
        config = get_config()

        if not hasattr(config, 'keycloak') or not config.keycloak:
            raise KeycloakAuthError("Keycloak not configured")

        try:
            jwks_client = self._get_jwks_client()
            signing_key = jwks_client.get_signing_key_from_jwt(token)

            issuer = f"{config.keycloak.server_url}/realms/{config.keycloak.realm}"

            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256"],
                audience=["account", config.keycloak.client_id],
                issuer=issuer,
                options={
                    "verify_exp": True,
                    "verify_iat": True,
                    "verify_aud": True,
                    "verify_iss": True,
                }
            )

            roles = []
            if 'realm_access' in payload:
                roles = payload['realm_access'].get('roles', [])

            if 'resource_access' in payload:
                client_access = payload['resource_access'].get(config.keycloak.client_id, {})
                roles.extend(client_access.get('roles', []))

            user = AdminUser(
                sub=payload.get('sub', ''),
                preferred_username=payload.get('preferred_username', payload.get('sub', 'unknown')),
                email=payload.get('email'),
                roles=list(set(roles)),
            )

            self.logger.debug(
                "Token validated",
                user=user.preferred_username,
                roles=user.roles,
            )

            return user

        except jwt.ExpiredSignatureError:
            self.logger.warning("Token expired")
            raise KeycloakAuthError("Token expired")
        except jwt.InvalidAudienceError:
            self.logger.warning("Invalid token audience")
            raise KeycloakAuthError("Invalid token audience")
        except jwt.InvalidIssuerError:
            self.logger.warning("Invalid token issuer")
            raise KeycloakAuthError("Invalid token issuer")
        except jwt.InvalidSignatureError:
            self.logger.warning("Invalid token signature")
            raise KeycloakAuthError("Invalid token signature")
        except jwt.DecodeError as e:
            self.logger.warning("Token decode error", error=str(e))
            raise KeycloakAuthError(f"Token decode error: {e}")
        except Exception as e:
            self.logger.error("Token validation failed", error=str(e))
            raise KeycloakAuthError(f"Token validation failed: {e}")

    def verify_admin_role(self, user: AdminUser) -> bool:
        config = get_config()
        admin_role = config.keycloak.admin_role if hasattr(config, 'keycloak') and config.keycloak else "collettore-admin"

        if admin_role not in user.roles:
            self.logger.warning(
                "User lacks admin role",
                user=user.preferred_username,
                required_role=admin_role,
                user_roles=user.roles,
            )
            return False

        return True


_keycloak_auth: Optional[KeycloakAuth] = None


def get_keycloak_auth() -> KeycloakAuth:
    
    global _keycloak_auth
    if _keycloak_auth is None:
        _keycloak_auth = KeycloakAuth()
    return _keycloak_auth


http_bearer_admin = HTTPBearer(auto_error=False)

SESSION_COOKIE_NAME = "collettore_admin_session"


async def verify_admin_jwt(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(http_bearer_admin)
) -> AdminUser:
    config = get_config()

    if not hasattr(config, 'keycloak') or not config.keycloak or not config.keycloak.enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin authentication not configured",
        )

    keycloak_auth = get_keycloak_auth()
    token = None

    if credentials:
        token = credentials.credentials
    else:
        session_id = request.cookies.get(SESSION_COOKIE_NAME)
        if session_id:
            token = keycloak_auth.get_session_token(session_id)

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        user = keycloak_auth.validate_token(token)

        if not keycloak_auth.verify_admin_role(user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Admin role required",
            )

        return user

    except KeycloakAuthError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
            headers={"WWW-Authenticate": "Bearer"},
        )


def get_client_ip(request: Request) -> str:
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        real_ip = real_ip.strip()
        if real_ip and not real_ip.startswith("unknown"):
            return real_ip

    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        ips = [ip.strip() for ip in forwarded.split(",")]
        if ips:
            return ips[0]

    return request.client.host if request.client else "unknown"
