
import hashlib
import json
import secrets
import time
import uuid
from pathlib import Path
from typing import Dict, List, Optional
import asyncio
from threading import Lock

from src.core.logger import LoggerMixin


class TokenManager(LoggerMixin):

    TOKEN_PREFIX = "clt_"
    TOKEN_BYTES = 32

    def __init__(self, storage_path: str = "./data/tokens.json"):
        self._logger_context = {'component': 'token-manager'}
        self.storage_path = Path(storage_path)
        self._lock = Lock()
        self._ensure_storage()

    def _ensure_storage(self) -> None:
        
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.storage_path.exists():
            self._save_tokens([])

    def _load_tokens(self) -> List[Dict]:
        
        try:
            with open(self.storage_path, 'r') as f:
                return json.load(f)
        except (json.JSONDecodeError, FileNotFoundError):
            return []

    def _save_tokens(self, tokens: List[Dict]) -> None:
        
        with open(self.storage_path, 'w') as f:
            json.dump(tokens, f, indent=2)

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

        token_record = {
            'id': token_id,
            'name': name,
            'description': description,
            'token_hash': token_hash,
            'created_by': created_by,
            'created_at': created_at,
            'last_used_at': None,
            'revoked': False,
            'revoked_at': None,
            'revoked_by': None,
        }

        with self._lock:
            tokens = self._load_tokens()
            tokens.append(token_record)
            self._save_tokens(tokens)

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

        with self._lock:
            tokens = self._load_tokens()

            for t in tokens:
                if t['token_hash'] == token_hash and not t['revoked']:
                    t['last_used_at'] = int(time.time())
                    self._save_tokens(tokens)
                    return t

        return None

    async def revoke_token(self, token_id: str, revoked_by: str) -> bool:
        with self._lock:
            tokens = self._load_tokens()

            for t in tokens:
                if t['id'] == token_id:
                    t['revoked'] = True
                    t['revoked_at'] = int(time.time())
                    t['revoked_by'] = revoked_by
                    self._save_tokens(tokens)

                    self.logger.info(
                        "API token revoked",
                        token_id=token_id,
                        revoked_by=revoked_by,
                    )
                    return True

        return False

    async def list_tokens(self, include_revoked: bool = True) -> List[Dict]:
        tokens = self._load_tokens()

        result = []
        for t in tokens:
            if not include_revoked and t['revoked']:
                continue

            result.append({
                'id': t['id'],
                'name': t['name'],
                'description': t['description'],
                'created_by': t['created_by'],
                'created_at': t['created_at'],
                'last_used_at': t['last_used_at'],
                'revoked': t['revoked'],
                'revoked_at': t['revoked_at'],
                'revoked_by': t['revoked_by'],
            })

        return result

    async def get_token_count(self) -> Dict:
        tokens = self._load_tokens()
        active = sum(1 for t in tokens if not t['revoked'])
        revoked = sum(1 for t in tokens if t['revoked'])

        return {
            'total': len(tokens),
            'active': active,
            'revoked': revoked,
        }
