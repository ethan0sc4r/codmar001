
import asyncio
from pathlib import Path
from typing import Dict, List, Optional

import aiosqlite

from src.core.logger import LoggerMixin


class DatabaseManager(LoggerMixin):

    def __init__(self, db_path: str, **pragma_options):
        self._logger_context = {'component': 'database'}
        self.db_path = db_path
        self.pragma_options = pragma_options
        self.db: Optional[aiosqlite.Connection] = None

    async def connect(self) -> None:
        
        db_file = Path(self.db_path)
        db_file.parent.mkdir(parents=True, exist_ok=True)

        self.db = await aiosqlite.connect(self.db_path)
        self.db.row_factory = aiosqlite.Row

        await self._apply_pragma()

        await self._init_schema()

        self.logger.info(
            "Database connected",
            path=self.db_path,
            pragma=self.pragma_options,
        )

    async def _apply_pragma(self) -> None:
        
        allowed_pragmas = {
            'journal_mode': {
                'pragma_name': 'journal_mode',
                'valid_values': ['WAL', 'DELETE', 'TRUNCATE', 'PERSIST', 'MEMORY', 'OFF'],
                'is_numeric': False,
            },
            'synchronous': {
                'pragma_name': 'synchronous',
                'valid_values': ['OFF', 'NORMAL', 'FULL', 'EXTRA', '0', '1', '2', '3'],
                'is_numeric': False,
            },
            'cache_size': {
                'pragma_name': 'cache_size',
                'valid_values': None,
                'is_numeric': True,
            },
            'mmap_size': {
                'pragma_name': 'mmap_size',
                'valid_values': None,
                'is_numeric': True,
            },
        }

        for key, value in self.pragma_options.items():
            if key not in allowed_pragmas:
                self.logger.warning(f"PRAGMA {key} not in whitelist, skipping")
                continue

            pragma_config = allowed_pragmas[key]
            pragma_name = pragma_config['pragma_name']

            if pragma_config['is_numeric']:
                try:
                    validated_value = int(value)
                except (ValueError, TypeError):
                    self.logger.warning(f"PRAGMA {key} must be numeric, got: {value}")
                    continue
            else:
                validated_value = str(value).upper()
                if validated_value not in pragma_config['valid_values']:
                    self.logger.warning(
                        f"PRAGMA {key} value '{value}' not in allowed values: {pragma_config['valid_values']}"
                    )
                    continue

            await self.db.execute(f"PRAGMA {pragma_name} = {validated_value}")
            self.logger.debug(f"PRAGMA {pragma_name} set", value=validated_value)

    async def _init_schema(self) -> None:
        
        await self.db.executescript("""
            -- Watchlist lists (metadata)
            CREATE TABLE IF NOT EXISTS lists (
                list_id TEXT PRIMARY KEY,
                list_name TEXT,
                color TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER DEFAULT (strftime('%s', 'now'))
            );

            -- Watchlist vessels
            CREATE TABLE IF NOT EXISTS vessels (
                mmsi TEXT PRIMARY KEY,
                imo TEXT,
                vessel_name TEXT,
                list_id TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (list_id) REFERENCES lists(list_id) ON DELETE CASCADE
            );

            -- Detections (last known position and data for each detected vessel)
            CREATE TABLE IF NOT EXISTS detections (
                mmsi TEXT PRIMARY KEY,
                imo TEXT,
                latitude REAL,
                longitude REAL,
                last_detected_at INTEGER,
                raw_data TEXT,
                FOREIGN KEY (mmsi) REFERENCES vessels(mmsi) ON DELETE CASCADE
            );

            -- Index for fast list_id lookups
            CREATE INDEX IF NOT EXISTS idx_vessels_list_id ON vessels(list_id);

            -- Index for IMO lookups
            CREATE INDEX IF NOT EXISTS idx_vessels_imo ON vessels(imo);

            -- Index for detection time lookups
            CREATE INDEX IF NOT EXISTS idx_detections_time ON detections(last_detected_at);

            -- API Tokens (for admin-generated tokens)
            CREATE TABLE IF NOT EXISTS api_tokens (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                token_hash TEXT NOT NULL UNIQUE,
                created_by TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                last_used_at INTEGER,
                revoked INTEGER DEFAULT 0,
                revoked_at INTEGER,
                revoked_by TEXT
            );

            -- Admin Audit Log
            CREATE TABLE IF NOT EXISTS admin_audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                action TEXT NOT NULL,
                admin_user TEXT NOT NULL,
                target_id TEXT,
                details TEXT,
                ip_address TEXT,
                user_agent TEXT
            );

            -- Index for token hash lookups (critical for auth performance)
            CREATE INDEX IF NOT EXISTS idx_tokens_hash ON api_tokens(token_hash);

            -- Index for non-revoked tokens
            CREATE INDEX IF NOT EXISTS idx_tokens_revoked ON api_tokens(revoked);

            -- Index for audit log timestamp
            CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON admin_audit_log(timestamp);

            -- Index for audit log by user
            CREATE INDEX IF NOT EXISTS idx_audit_user ON admin_audit_log(admin_user);
        """)
        await self.db.commit()

    async def close(self) -> None:
        
        if self.db:
            await self.db.close()
            self.logger.info("Database closed")


    async def upsert_lists(self, lists: List[Dict]) -> int:
        if not lists:
            return 0

        query = """
            INSERT INTO lists (list_id, list_name, color, updated_at)
            VALUES (?, ?, ?, strftime('%s', 'now'))
            ON CONFLICT(list_id) DO UPDATE SET
                list_name = excluded.list_name,
                color = excluded.color,
                updated_at = excluded.updated_at
        Insert or update multiple vessels.

        Args:
            vessels: List of dicts with mmsi, imo, list_id, vessel_name (optional)

        Returns:
            Number of vessels upserted

        values = [
            (
                item.get('mmsi'),
                item.get('imo'),
                item.get('vessel_name'),
                item.get('list_id'),
            )
            for item in vessels
        ]

        await self.db.executemany(query, values)
        await self.db.commit()

        self.logger.debug("Vessels upserted", count=len(vessels))
        return len(vessels)

    async def get_all_vessels(self) -> List[Dict]:
        
        async with self.db.execute("SELECT * FROM vessels") as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]

    async def get_vessel_by_mmsi(self, mmsi: str) -> Optional[Dict]:
        
        async with self.db.execute(
            "SELECT * FROM vessels WHERE mmsi = ?", (mmsi,)
        ) as cursor:
            row = await cursor.fetchone()
            return dict(row) if row else None

    async def get_vessel_with_lists(self, mmsi: str) -> Optional[Dict]:
        query = """
            SELECT
                v.*,
                l.list_id as list_list_id,
                l.list_name,
                l.color
            FROM vessels v
            LEFT JOIN lists l ON v.list_id = l.list_id
            WHERE v.mmsi = ?
        Insert or update detection record.
        Replaces existing detection for the same MMSI with latest data.

        Args:
            detection: Dict with keys:
                - mmsi (required)
                - imo (optional)
                - latitude (optional)
                - longitude (optional)
                - last_detected_at (optional, defaults to current time)
                - raw_data (optional, will be JSON stringified)

        raw_data = detection.get('raw_data', {})
        if isinstance(raw_data, dict):
            raw_data = json.dumps(raw_data)

        await self.db.execute(
            query,
            (
                mmsi,
                detection.get('imo'),
                detection.get('latitude'),
                detection.get('longitude'),
                detection.get('last_detected_at', int(time.time())),
                raw_data,
            )
        )
        await self.db.commit()
        return True

    async def get_detection(self, mmsi: str) -> Optional[Dict]:
        
        async with self.db.execute(
            "SELECT * FROM detections WHERE mmsi = ?", (mmsi,)
        ) as cursor:
            row = await cursor.fetchone()
            if not row:
                return None

            detection = dict(row)
            if detection.get('raw_data'):
                import json
                try:
                    detection['raw_data'] = json.loads(detection['raw_data'])
                except json.JSONDecodeError:
                    pass

            return detection

    async def get_all_detections(self) -> List[Dict]:
        
        async with self.db.execute(
            "SELECT * FROM detections ORDER BY last_detected_at DESC"
        ) as cursor:
            rows = await cursor.fetchall()

            detections = []
            for row in rows:
                detection = dict(row)
                if detection.get('raw_data'):
                    import json
                    try:
                        detection['raw_data'] = json.loads(detection['raw_data'])
                    except json.JSONDecodeError:
                        pass
                detections.append(detection)

            return detections

    async def get_recent_detections(self, limit: int = 100) -> List[Dict]:
        
        async with self.db.execute(
            "SELECT * FROM detections ORDER BY last_detected_at DESC LIMIT ?",
            (limit,)
        ) as cursor:
            rows = await cursor.fetchall()

            detections = []
            for row in rows:
                detection = dict(row)
                if detection.get('raw_data'):
                    import json
                    try:
                        detection['raw_data'] = json.loads(detection['raw_data'])
                    except json.JSONDecodeError:
                        pass
                detections.append(detection)

            return detections

    async def delete_detection(self, mmsi: str) -> bool:
        
        await self.db.execute("DELETE FROM detections WHERE mmsi = ?", (mmsi,))
        await self.db.commit()
        return True

    async def clear_all_detections(self) -> int:
        
        cursor = await self.db.execute("DELETE FROM detections")
        await self.db.commit()
        return cursor.rowcount


    async def get_stats(self) -> Dict:
        
        async with self.db.execute("SELECT COUNT(*) as count FROM vessels") as cursor:
            vessels_count = (await cursor.fetchone())['count']

        async with self.db.execute("SELECT COUNT(*) as count FROM lists") as cursor:
            lists_count = (await cursor.fetchone())['count']

        async with self.db.execute("SELECT COUNT(*) as count FROM detections") as cursor:
            detections_count = (await cursor.fetchone())['count']

        return {
            'vessels_count': vessels_count,
            'lists_count': lists_count,
            'detections_count': detections_count,
            'tables_count': 3,
        }


    async def create_api_token(self, token_data: Dict) -> bool:
        query = """
            INSERT INTO api_tokens (id, name, description, token_hash, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        Revoke a token by ID.

        Args:
            token_id: Token ID to revoke
            revoked_by: Admin user who revoked the token
        Add an entry to the admin audit log.

        Args:
            log_entry: Dict with action, admin_user, target_id (optional),
                       details (optional), ip_address (optional), user_agent (optional)

        Returns:
            ID of the created log entry
        cursor = await self.db.execute(
            query,
            (
                int(time.time()),
                log_entry['action'],
                log_entry['admin_user'],
                log_entry.get('target_id'),
                log_entry.get('details'),
                log_entry.get('ip_address'),
                log_entry.get('user_agent'),
            )
        )
        await self.db.commit()
        return cursor.lastrowid

    async def get_audit_logs(self, limit: int = 100, offset: int = 0) -> List[Dict]:
        
        async with self.db.execute(
            "SELECT * FROM admin_audit_log ORDER BY timestamp DESC LIMIT ? OFFSET ?",
            (limit, offset)
        ) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]

    async def get_audit_logs_by_user(self, admin_user: str, limit: int = 100) -> List[Dict]:
        
        async with self.db.execute(
            "SELECT * FROM admin_audit_log WHERE admin_user = ? ORDER BY timestamp DESC LIMIT ?",
            (admin_user, limit)
        ) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]

    async def get_audit_logs_by_action(self, action: str, limit: int = 100) -> List[Dict]:
        
        async with self.db.execute(
            "SELECT * FROM admin_audit_log WHERE action = ? ORDER BY timestamp DESC LIMIT ?",
            (action, limit)
        ) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]
