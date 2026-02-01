
import json
import time
from pathlib import Path
from typing import Dict, List, Optional
from threading import Lock

from src.core.logger import LoggerMixin


class AuditAction:
    
    TOKEN_CREATE = "token_create"
    TOKEN_REVOKE = "token_revoke"
    TOKEN_LIST = "token_list"
    AUDIT_VIEW = "audit_view"
    ADMIN_LOGIN = "admin_login"
    ADMIN_LOGOUT = "admin_logout"
    CONFIG_VIEW = "config_view"
    CONFIG_UPDATE = "config_update"
    SERVER_RESTART = "server_restart"


class AuditLogger(LoggerMixin):

    MAX_LOGS = 10000

    def __init__(self, storage_path: str = "./data/audit.json"):
        self._logger_context = {'component': 'audit-logger'}
        self.storage_path = Path(storage_path)
        self._lock = Lock()
        self._ensure_storage()

    def _ensure_storage(self) -> None:
        
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.storage_path.exists():
            self._save_logs([])

    def _load_logs(self) -> List[Dict]:
        
        try:
            with open(self.storage_path, 'r') as f:
                return json.load(f)
        except (json.JSONDecodeError, FileNotFoundError):
            return []

    def _save_logs(self, logs: List[Dict]) -> None:
        
        with open(self.storage_path, 'w') as f:
            json.dump(logs, f, indent=2)

    async def log(
        self,
        action: str,
        admin_user: str,
        target_id: Optional[str] = None,
        details: Optional[Dict] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ) -> int:
        with self._lock:
            logs = self._load_logs()

            log_id = len(logs) + 1
            log_entry = {
                'id': log_id,
                'timestamp': int(time.time()),
                'action': action,
                'admin_user': admin_user,
                'target_id': target_id,
                'details': details,
                'ip_address': ip_address,
                'user_agent': user_agent,
            }

            logs.append(log_entry)

            if len(logs) > self.MAX_LOGS:
                logs = logs[-self.MAX_LOGS:]

            self._save_logs(logs)

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
        logs = self._load_logs()
        logs.reverse()
        return logs[offset:offset + limit]

    async def get_logs_by_user(
        self,
        admin_user: str,
        limit: int = 100,
    ) -> List[Dict]:
        
        logs = self._load_logs()
        logs.reverse()
        return [l for l in logs if l['admin_user'] == admin_user][:limit]

    async def get_logs_by_action(
        self,
        action: str,
        limit: int = 100,
    ) -> List[Dict]:
        
        logs = self._load_logs()
        logs.reverse()
        return [l for l in logs if l['action'] == action][:limit]
