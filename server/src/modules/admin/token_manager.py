
import hashlib
import secrets
import time
import uuid
from typing import Dict, List, Optional

from src.core.logger import LoggerMixin
from src.modules.database.database_manager import DatabaseManager


class TokenManager(LoggerMixin):

    TOKEN_PREFIX = "df_"
    TOKEN_BYTES = 32

    def __init__(self, db: DatabaseManager):
        self._logger_context = {'component': 'token-manager'}
        self.db = db

    @staticmethod
    def _generate_token() -> str:
        random_bytes = secrets.token_hex(TokenManager.TOKEN_BYTES)
        return f"{TokenManager.TOKEN_PREFIX}{random_bytes}"

    @staticmethod
    def _hash_token(token: str) -> str:
        return hashlib.sha256(token.encode('utf-8')).hexdigest()

    async def create_token(
        self,
        name: str,
        description: Optional[str],
        created_by: str,
    ) -> Dict:
        token_id = str(uuid.uuid4())
        plain_token = self._generate_token()
        token_hash = self._hash_token(plain_token)
        created_at = int(time.time())

        await self.db.create_api_token({
            'id': token_id,
            'name': name,
            'description': description,
            'token_hash': token_hash,
            'created_by': created_by,
            'created_at': created_at,
        })

        self.logger.info(
            "API token created",
            token_id=token_id,
            name=name,
            created_by=created_by,
        )

        return {
            'id': token_id,
            'name': name,
            'description': description,
            'token': plain_token,
            'created_by': created_by,
            'created_at': created_at,
        }

    async def validate_token(self, token: str) -> Optional[Dict]:
        if not token or not token.startswith(self.TOKEN_PREFIX):
            return None

        token_hash = self._hash_token(token)
        token_record = await self.db.get_token_by_hash(token_hash)

        if token_record:
            await self.db.update_token_last_used(token_hash)
            return token_record

        return None

    async def revoke_token(self, token_id: str, revoked_by: str) -> bool:
        await self.db.revoke_token(token_id, revoked_by)

        self.logger.info(
            "API token revoked",
            token_id=token_id,
            revoked_by=revoked_by,
        )

        return True

    async def list_tokens(self, include_revoked: bool = True) -> List[Dict]:
        if include_revoked:
            return await self.db.get_all_tokens()
        else:
            return await self.db.get_active_tokens()

    async def get_token_count(self) -> Dict:
        all_tokens = await self.db.get_all_tokens()
        active = sum(1 for t in all_tokens if not t.get('revoked'))
        revoked = sum(1 for t in all_tokens if t.get('revoked'))

        return {
            'total': len(all_tokens),
            'active': active,
            'revoked': revoked,
        }
