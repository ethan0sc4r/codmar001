
import json
from typing import Dict, List, Optional

from src.core.logger import LoggerMixin
from src.modules.database.database_manager import DatabaseManager


class AuditAction:
    
    TOKEN_CREATE = "token_create"
    TOKEN_REVOKE = "token_revoke"
    TOKEN_LIST = "token_list"
    AUDIT_VIEW = "audit_view"
    ADMIN_LOGIN = "admin_login"
    ADMIN_LOGOUT = "admin_logout"
    CONFIG_VIEW = "config_view"
    CONFIG_UPDATE = "config_update"


class AuditLogger(LoggerMixin):

    def __init__(self, db: DatabaseManager):
        self._logger_context = {'component': 'audit-logger'}
        self.db = db

    async def log(
        self,
        action: str,
        admin_user: str,
        target_id: Optional[str] = None,
        details: Optional[Dict] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ) -> int:
        details_str = json.dumps(details) if details else None

        log_id = await self.db.add_audit_log({
            'action': action,
            'admin_user': admin_user,
            'target_id': target_id,
            'details': details_str,
            'ip_address': ip_address,
            'user_agent': user_agent,
        })

        self.logger.info(
            "Audit log entry created",
            action=action,
            admin_user=admin_user,
            target_id=target_id,
            ip=ip_address,
        )

        return log_id

    async def log_token_create(
        self,
        admin_user: str,
        token_id: str,
        token_name: str,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ) -> int:
        
        return await self.log(
            action=AuditAction.TOKEN_CREATE,
            admin_user=admin_user,
            target_id=token_id,
            details={'token_name': token_name},
            ip_address=ip_address,
            user_agent=user_agent,
        )

    async def log_token_revoke(
        self,
        admin_user: str,
        token_id: str,
        token_name: str,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ) -> int:
        
        return await self.log(
            action=AuditAction.TOKEN_REVOKE,
            admin_user=admin_user,
            target_id=token_id,
            details={'token_name': token_name},
            ip_address=ip_address,
            user_agent=user_agent,
        )

    async def log_admin_login(
        self,
        admin_user: str,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ) -> int:
        
        return await self.log(
            action=AuditAction.ADMIN_LOGIN,
            admin_user=admin_user,
            ip_address=ip_address,
            user_agent=user_agent,
        )

    async def get_logs(
        self,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Dict]:
        logs = await self.db.get_audit_logs(limit=limit, offset=offset)

        for log in logs:
            if log.get('details'):
                try:
                    log['details'] = json.loads(log['details'])
                except json.JSONDecodeError:
                    pass

        return logs

    async def get_logs_by_user(
        self,
        admin_user: str,
        limit: int = 100,
    ) -> List[Dict]:
        
        logs = await self.db.get_audit_logs_by_user(admin_user, limit=limit)

        for log in logs:
            if log.get('details'):
                try:
                    log['details'] = json.loads(log['details'])
                except json.JSONDecodeError:
                    pass

        return logs

    async def get_logs_by_action(
        self,
        action: str,
        limit: int = 100,
    ) -> List[Dict]:
        
        logs = await self.db.get_audit_logs_by_action(action, limit=limit)

        for log in logs:
            if log.get('details'):
                try:
                    log['details'] = json.loads(log['details'])
                except json.JSONDecodeError:
                    pass

        return logs
