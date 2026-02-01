
import hashlib
import json
from typing import Dict, Optional, Set

import redis

from src.core.logger import LoggerMixin


class RedisCache(LoggerMixin):

    def __init__(
        self,
        host: str = "localhost",
        port: int = 6379,
        db: int = 0,
        password: Optional[str] = None,
        max_connections: int = 50,
    ):
        self._logger_context = {'component': 'redis-cache'}

        pool = redis.ConnectionPool(
            host=host,
            port=port,
            db=db,
            password=password,
            max_connections=max_connections,
            decode_responses=True,
        )

        self.redis = redis.Redis(connection_pool=pool)

        try:
            self.redis.ping()
            self.logger.info("Redis connected", host=host, port=port, db=db)
        except Exception as e:
            self.logger.error("Redis connection failed", error=str(e))
            raise


    def is_duplicate(
        self,
        message: dict,
        time_window: int = 30,
        ttl_multiplier: int = 2,
    ) -> bool:
        import time
        ts = message.get('timestamp', time.time())

        if isinstance(ts, str):
            from datetime import datetime
            ts = datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp()

        ts_rounded = int(ts // time_window) * time_window

        mmsi = message.get('mmsi', '')
        lat = message.get('lat', 0)
        lon = message.get('lon', 0)

        msg_str = f"{mmsi}-{ts_rounded}-{lat:.4f}-{lon:.4f}"
        msg_hash = hashlib.md5(msg_str.encode()).hexdigest()

        key = f"dedup:{msg_hash}"

        if self.redis.exists(key):
            self.redis.incr("stats:duplicates")
            return True

        ttl = time_window * ttl_multiplier
        self.redis.setex(key, ttl, '1')

        self.redis.incr("stats:unique")
        return False

    def get_dedup_stats(self) -> dict:
        
        return {
            'unique': int(self.redis.get('stats:unique') or 0),
            'duplicates': int(self.redis.get('stats:duplicates') or 0),
        }


    def update_vessel(self, message: dict, source: str, expire_after: int = 3600) -> None:
        mmsi = message.get('mmsi')
        if not mmsi:
            return

        key = f"vessel:{mmsi}"

        current = self.redis.hgetall(key)

        updates = {}

        if 'lat' in message:
            updates['lat'] = str(message['lat'])
        if 'lon' in message:
            updates['lon'] = str(message['lon'])
        if 'speed' in message:
            updates['speed'] = str(message['speed'])
        if 'course' in message:
            updates['course'] = str(message['course'])
        if 'heading' in message:
            updates['heading'] = str(message['heading'])

        for field in ['name', 'imo', 'callsign', 'shiptype']:
            if field in message and message[field]:
                updates[field] = str(message[field])
            elif field in current:
                updates[field] = current[field]

        updates['mmsi'] = str(mmsi)
        updates['last_update'] = message.get('timestamp', '')

        if source:
            sources_key = f"vessel:{mmsi}:sources"
            self.redis.sadd(sources_key, source)
            self.redis.expire(sources_key, expire_after)

        count_key = f"vessel:{mmsi}:count"
        self.redis.incr(count_key)
        self.redis.expire(count_key, expire_after)
        updates['message_count'] = str(self.redis.get(count_key))

        if updates:
            self.redis.hset(key, mapping=updates)
            self.redis.expire(key, expire_after)

        self.redis.sadd('active_vessels', mmsi)

    def get_vessel(self, mmsi: str) -> Optional[dict]:
        key = f"vessel:{mmsi}"
        data = self.redis.hgetall(key)

        if not data:
            return None

        sources_key = f"vessel:{mmsi}:sources"
        sources = self.redis.smembers(sources_key)

        data['sources'] = list(sources)
        return data

    def get_active_vessels(self) -> Set[str]:
        return self.redis.smembers('active_vessels')

    def cleanup_expired_vessels(self) -> int:
        active = self.redis.smembers('active_vessels')
        cleaned = 0

        for mmsi in active:
            key = f"vessel:{mmsi}"
            if not self.redis.exists(key):
                self.redis.srem('active_vessels', mmsi)
                cleaned += 1

        if cleaned > 0:
            self.logger.info("Cleaned up expired vessels", count=cleaned)

        return cleaned


    def get_stats(self) -> dict:
        
        return {
            'active_vessels': self.redis.scard('active_vessels'),
            'deduplication': self.get_dedup_stats(),
        }

    def clear_all(self) -> None:
        
        self.redis.flushdb()
        self.logger.warning("Redis cache cleared")
