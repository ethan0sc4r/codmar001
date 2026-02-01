
import asyncio
import os
import secrets
import signal
import time
from pathlib import Path
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel, Field
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

from src.core.config import get_config
from src.core.keycloak_auth import (
    AdminUser,
    verify_admin_jwt,
    get_client_ip,
    get_keycloak_auth,
    KeycloakAuthError,
    SESSION_COOKIE_NAME,
)
from src.core.logger import LoggerMixin


class TokenCreateRequest(BaseModel):
    
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    csrf_token: str = Field(..., min_length=1)


class TokenCreateResponse(BaseModel):
    
    id: str
    name: str
    description: Optional[str]
    token: str
    created_by: str
    created_at: int


class TokenListItem(BaseModel):
    
    id: str
    name: str
    description: Optional[str]
    created_by: str
    created_at: int
    last_used_at: Optional[int]
    revoked: bool
    revoked_at: Optional[int]
    revoked_by: Optional[str]


class TokenRevokeRequest(BaseModel):
    
    csrf_token: str = Field(..., min_length=1)


class AuditLogEntry(BaseModel):
    
    id: int
    timestamp: int
    action: str
    admin_user: str
    target_id: Optional[str]
    details: Optional[dict]
    ip_address: Optional[str]
    user_agent: Optional[str]


class AdminAPIRouter(LoggerMixin):

    def __init__(self, token_manager, audit_logger, source_manager=None):
        self._logger_context = {'component': 'admin-api'}
        self.token_manager = token_manager
        self.audit_logger = audit_logger
        self.source_manager = source_manager
        self.router = APIRouter(prefix="/admin", tags=["admin"])
        self._csrf_serializer = None
        self._setup_routes()

    def _get_csrf_serializer(self) -> URLSafeTimedSerializer:
        
        if self._csrf_serializer is None:
            config = get_config()
            if hasattr(config, 'api_security') and config.api_security and config.api_security.bearer_token:
                secret = config.api_security.bearer_token
            else:
                secret = secrets.token_hex(32)
                self.logger.warning("Using auto-generated CSRF secret")
            self._csrf_serializer = URLSafeTimedSerializer(secret)
        return self._csrf_serializer

    def _generate_csrf_token(self, user_id: str) -> str:
        
        serializer = self._get_csrf_serializer()
        return serializer.dumps({'user': user_id, 'time': time.time()})

    def _validate_csrf_token(self, token: str, user_id: str, max_age: int = 3600) -> bool:
        
        try:
            serializer = self._get_csrf_serializer()
            data = serializer.loads(token, max_age=max_age)
            return data.get('user') == user_id
        except (BadSignature, SignatureExpired):
            return False

    def _get_callback_url(self, request: Request) -> str:
        
        scheme = request.headers.get("X-Forwarded-Proto", request.url.scheme)
        host = request.headers.get("X-Forwarded-Host", request.url.netloc)
        return f"{scheme}://{host}/admin/callback"

    def _setup_routes(self):
        

        @self.router.get("/login")
        async def admin_login(request: Request):
            
            config = get_config()

            if not hasattr(config, 'keycloak') or not config.keycloak or not config.keycloak.enabled:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Admin authentication not configured",
                )

            keycloak_auth = get_keycloak_auth()
            callback_url = self._get_callback_url(request)

            auth_url, state = keycloak_auth.get_authorization_url(callback_url)

            self.logger.info("Redirecting to Keycloak login", callback_url=callback_url)

            response = RedirectResponse(url=auth_url, status_code=status.HTTP_302_FOUND)
            response.set_cookie(
                key="oauth_state",
                value=state,
                httponly=True,
                secure=True,
                samesite="lax",
                max_age=600,
            )
            return response

        @self.router.get("/callback")
        async def admin_callback(
            request: Request,
            code: Optional[str] = None,
            state: Optional[str] = None,
            error: Optional[str] = None,
            error_description: Optional[str] = None,
        ):
            
            config = get_config()

            if not hasattr(config, 'keycloak') or not config.keycloak or not config.keycloak.enabled:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Admin authentication not configured",
                )

            if error:
                self.logger.warning("OAuth error from Keycloak", error=error, description=error_description)
                return HTMLResponse(
                    content="""
                    <html>
                    <head><title>Login Error</title></head>
                    <body>
                        <h1>Login Failed</h1>
                        <p>Authentication failed. Please try again or contact your administrator.</p>
                        <p><a href="/admin/login">Try again</a></p>
                    </body>
                    </html>
                    """,
                    status_code=status.HTTP_400_BAD_REQUEST,
                )

            if not code or not state:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Missing code or state parameter",
                )

            keycloak_auth = get_keycloak_auth()
            stored_state = request.cookies.get("oauth_state")

            if not stored_state or stored_state != state:
                self.logger.warning("State mismatch in OAuth callback")
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid state parameter",
                )

            try:
                callback_url = self._get_callback_url(request)
                tokens = await keycloak_auth.exchange_code_for_tokens(code, callback_url)

                access_token = tokens.get("access_token")
                refresh_token = tokens.get("refresh_token")

                if not access_token:
                    raise KeycloakAuthError("No access token in response")

                user = keycloak_auth.validate_token(access_token)

                if not keycloak_auth.verify_admin_role(user):
                    self.logger.warning(
                        "User authenticated but lacks admin role",
                        user=user.preferred_username,
                        roles=user.roles,
                    )
                    return HTMLResponse(
                        content=f"""
                        <html>
                        <head><title>Access Denied</title></head>
                        <body>
                            <h1>Access Denied</h1>
                            <p>User <strong>{user.preferred_username}</strong> does not have the required admin role.</p>
                            <p>Required role: <code>collettore-admin</code></p>
                            <p>Your roles: <code>{', '.join(user.roles) or 'none'}</code></p>
                            <p>Contact your administrator to get access.</p>
                            <p><a href="/admin/logout">Logout</a></p>
                        </body>
                        </html>
                        """,
                        status_code=status.HTTP_403_FORBIDDEN,
                    )

                session_id = keycloak_auth.create_session(access_token, refresh_token)

                self.logger.info("Admin user authenticated", user=user.preferred_username)

                await self.audit_logger.log(
                    action="admin_login",
                    admin_user=user.preferred_username,
                    ip_address=get_client_ip(request),
                    user_agent=request.headers.get("User-Agent"),
                )

                response = RedirectResponse(url="/admin", status_code=status.HTTP_302_FOUND)
                response.set_cookie(
                    key=SESSION_COOKIE_NAME,
                    value=session_id,
                    httponly=True,
                    secure=True,
                    samesite="lax",
                    max_age=28800,
                )
                response.delete_cookie(key="oauth_state")
                return response

            except KeycloakAuthError as e:
                self.logger.error("Token exchange failed", error=str(e))
                return HTMLResponse(
                    content="""
                    <html>
                    <head><title>Authentication Error</title></head>
                    <body>
                        <h1>Authentication Failed</h1>
                        <p>Unable to complete authentication. Please try again or contact your administrator.</p>
                        <p><a href="/admin/login">Try again</a></p>
                    </body>
                    </html>
                    """,
                    status_code=status.HTTP_401_UNAUTHORIZED,
                )

        @self.router.get("/logout")
        async def admin_logout(request: Request):
            
            keycloak_auth = get_keycloak_auth()

            session_id = request.cookies.get(SESSION_COOKIE_NAME)
            if session_id:
                keycloak_auth.delete_session(session_id)

            self.logger.info("Admin user logged out")

            response = RedirectResponse(url="/", status_code=status.HTTP_302_FOUND)
            response.delete_cookie(key=SESSION_COOKIE_NAME)
            return response

        @self.router.get("", response_class=HTMLResponse)
        async def admin_ui(request: Request):
            
            config = get_config()

            if not hasattr(config, 'keycloak') or not config.keycloak or not config.keycloak.enabled:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Admin authentication not configured",
                )

            keycloak_auth = get_keycloak_auth()
            session_id = request.cookies.get(SESSION_COOKIE_NAME)

            if not session_id:
                return RedirectResponse(url="/admin/login", status_code=status.HTTP_302_FOUND)

            token = keycloak_auth.get_session_token(session_id)
            if not token:
                response = RedirectResponse(url="/admin/login", status_code=status.HTTP_302_FOUND)
                response.delete_cookie(key=SESSION_COOKIE_NAME)
                return response

            try:
                admin = keycloak_auth.validate_token(token)

                if not keycloak_auth.verify_admin_role(admin):
                    return HTMLResponse(
                        content="""
                        <html>
                        <head><title>Access Denied</title></head>
                        <body>
                            <h1>Access Denied</h1>
                            <p>You do not have the required admin role.</p>
                            <p><a href="/admin/logout">Logout</a></p>
                        </body>
                        </html>
                        """,
                        status_code=status.HTTP_403_FORBIDDEN,
                    )

            except KeycloakAuthError:
                response = RedirectResponse(url="/admin/login", status_code=status.HTTP_302_FOUND)
                response.delete_cookie(key=SESSION_COOKIE_NAME)
                return response

            csrf_token = self._generate_csrf_token(admin.sub)

            await self.audit_logger.log(
                action="admin_access",
                admin_user=admin.preferred_username,
                ip_address=get_client_ip(request),
                user_agent=request.headers.get("User-Agent"),
            )

            html_path = Path(__file__).parent / "static" / "admin.html"
            if not html_path.exists():
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Admin UI not found",
                )

            html_content = html_path.read_text()
            html_content = html_content.replace("{{CSRF_TOKEN}}", csrf_token)
            html_content = html_content.replace("{{ADMIN_USER}}", admin.preferred_username)

            return HTMLResponse(content=html_content)

        @self.router.get("/api/csrf-token")
        async def get_csrf_token(admin: AdminUser = Depends(verify_admin_jwt)):
            
            csrf_token = self._generate_csrf_token(admin.sub)
            return {"csrf_token": csrf_token}

        @self.router.get("/api/tokens", response_model=list[TokenListItem])
        async def list_tokens(
            request: Request,
            include_revoked: bool = True,
            admin: AdminUser = Depends(verify_admin_jwt),
        ):
            
            tokens = await self.token_manager.list_tokens(include_revoked=include_revoked)

            await self.audit_logger.log(
                action="token_list",
                admin_user=admin.preferred_username,
                ip_address=get_client_ip(request),
                user_agent=request.headers.get("User-Agent"),
            )

            return [
                TokenListItem(
                    id=t['id'],
                    name=t['name'],
                    description=t.get('description'),
                    created_by=t['created_by'],
                    created_at=t['created_at'],
                    last_used_at=t.get('last_used_at'),
                    revoked=bool(t.get('revoked', 0)),
                    revoked_at=t.get('revoked_at'),
                    revoked_by=t.get('revoked_by'),
                )
                for t in tokens
            ]

        @self.router.post("/api/tokens", response_model=TokenCreateResponse)
        async def create_token(
            request: Request,
            body: TokenCreateRequest,
            admin: AdminUser = Depends(verify_admin_jwt),
        ):
            
            if not self._validate_csrf_token(body.csrf_token, admin.sub):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Invalid CSRF token",
                )

            token_data = await self.token_manager.create_token(
                name=body.name,
                description=body.description,
                created_by=admin.preferred_username,
            )

            await self.audit_logger.log_token_create(
                admin_user=admin.preferred_username,
                token_id=token_data['id'],
                token_name=body.name,
                ip_address=get_client_ip(request),
                user_agent=request.headers.get("User-Agent"),
            )

            self.logger.info(
                "Token created via admin API",
                token_id=token_data['id'],
                name=body.name,
                created_by=admin.preferred_username,
            )

            return TokenCreateResponse(**token_data)

        @self.router.delete("/api/tokens/{token_id}")
        async def revoke_token(
            request: Request,
            token_id: str,
            body: TokenRevokeRequest,
            admin: AdminUser = Depends(verify_admin_jwt),
        ):
            
            if not self._validate_csrf_token(body.csrf_token, admin.sub):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Invalid CSRF token",
                )

            tokens = await self.token_manager.list_tokens()
            token = next((t for t in tokens if t['id'] == token_id), None)

            if not token:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Token not found",
                )

            if token.get('revoked'):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Token already revoked",
                )

            await self.token_manager.revoke_token(token_id, admin.preferred_username)

            await self.audit_logger.log_token_revoke(
                admin_user=admin.preferred_username,
                token_id=token_id,
                token_name=token['name'],
                ip_address=get_client_ip(request),
                user_agent=request.headers.get("User-Agent"),
            )

            self.logger.info(
                "Token revoked via admin API",
                token_id=token_id,
                revoked_by=admin.preferred_username,
            )

            return {"status": "revoked", "token_id": token_id}

        @self.router.get("/api/tokens/stats")
        async def token_stats(admin: AdminUser = Depends(verify_admin_jwt)):
            
            return await self.token_manager.get_token_count()

        @self.router.get("/api/sources")
        async def list_sources(
            request: Request,
            admin: AdminUser = Depends(verify_admin_jwt),
        ):
            
            config = get_config()
            sources = []

            for source in config.sources:
                source_data = {
                    'name': source.name,
                    'url': source.url,
                    'enabled': source.enabled,
                    'priority': source.priority,
                    'reconnect': source.reconnect,
                    'reconnect_interval': source.reconnect_interval,
                    'reconnect_max_attempts': source.reconnect_max_attempts,
                    'has_token': bool(source.token),
                    'connected': False,
                    'stats': None,
                }

                if self.source_manager:
                    client = self.source_manager.get_source(source.name)
                    if client:
                        source_data['connected'] = client.connected
                        source_data['stats'] = client.get_stats()

                sources.append(source_data)

            await self.audit_logger.log(
                action="source_list",
                admin_user=admin.preferred_username,
                ip_address=get_client_ip(request),
                user_agent=request.headers.get("User-Agent"),
            )

            return {"sources": sources, "count": len(sources)}

        @self.router.get("/api/audit", response_model=list[AuditLogEntry])
        async def get_audit_logs(
            request: Request,
            limit: int = 100,
            offset: int = 0,
            admin: AdminUser = Depends(verify_admin_jwt),
        ):
            
            logs = await self.audit_logger.get_logs(limit=limit, offset=offset)

            await self.audit_logger.log(
                action="audit_view",
                admin_user=admin.preferred_username,
                ip_address=get_client_ip(request),
                user_agent=request.headers.get("User-Agent"),
            )

            return [
                AuditLogEntry(
                    id=log['id'],
                    timestamp=log['timestamp'],
                    action=log['action'],
                    admin_user=log['admin_user'],
                    target_id=log.get('target_id'),
                    details=log.get('details'),
                    ip_address=log.get('ip_address'),
                    user_agent=log.get('user_agent'),
                )
                for log in logs
            ]

        @self.router.post("/api/server/restart")
        async def restart_server(
            request: Request,
            admin: AdminUser = Depends(verify_admin_jwt),
        ):
            
            try:
                self.logger.info(
                    "Server restart requested via admin API",
                    requested_by=admin.preferred_username,
                )

                await self.audit_logger.log(
                    action="server_restart",
                    admin_user=admin.preferred_username,
                    ip_address=get_client_ip(request),
                    user_agent=request.headers.get("User-Agent"),
                )

                async def delayed_shutdown():
                    await asyncio.sleep(1)
                    self.logger.info("Initiating graceful shutdown for restart...")
                    os.kill(os.getpid(), signal.SIGTERM)

                asyncio.create_task(delayed_shutdown())

                return {
                    "success": True,
                    "message": "Server shutdown initiated. Process manager will restart the service.",
                    "requested_by": admin.preferred_username,
                }
            except Exception as e:
                self.logger.error("Failed to initiate server restart", error=str(e))
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to initiate restart",
                )


def create_admin_router(token_manager, audit_logger, source_manager=None) -> APIRouter:
    admin_api = AdminAPIRouter(token_manager, audit_logger, source_manager)
    return admin_api.router
