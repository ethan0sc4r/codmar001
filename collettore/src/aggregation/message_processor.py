
import asyncio
from typing import Optional

from src.core.logger import LoggerMixin
from src.output.websocket_server import WebSocketOutputServer
from src.storage.redis_cache import RedisCache


class MessageProcessor(LoggerMixin):

    def __init__(
        self,
        redis_cache: RedisCache,
        output_server: WebSocketOutputServer,
        enable_deduplication: bool = True,
        enable_state_tracking: bool = True,
        dedup_time_window: int = 30,
        dedup_ttl_multiplier: int = 2,
        vessel_expire_after: int = 3600,
    ):
        self._logger_context = {'component': 'message-processor'}
        self.redis = redis_cache
        self.output = output_server
        self.enable_deduplication = enable_deduplication
        self.enable_state_tracking = enable_state_tracking
        self.dedup_time_window = dedup_time_window
        self.dedup_ttl_multiplier = dedup_ttl_multiplier
        self.vessel_expire_after = vessel_expire_after

        self.stats = {
            'total_received': 0,
            'duplicates': 0,
            'unique': 0,
            'broadcast_raw': 0,
            'broadcast_filtered': 0,
        }

    async def process_message(self, message: dict, source: str) -> None:
        self.stats['total_received'] += 1

        await self._broadcast_raw(message, source)

        if self.enable_deduplication:
            is_dup = self.redis.is_duplicate(
                message,
                time_window=self.dedup_time_window,
                ttl_multiplier=self.dedup_ttl_multiplier,
            )

            if is_dup:
                self.stats['duplicates'] += 1
                return

        self.stats['unique'] += 1

        if self.enable_state_tracking:
            self.redis.update_vessel(
                message,
                source=source,
                expire_after=self.vessel_expire_after,
            )

        enriched = await self._enrich_message(message, source)

        await self._broadcast_filtered(enriched)

    async def _broadcast_raw(self, message: dict, source: str) -> None:
        raw_message = {
            **message,
            '_source': source,
            '_stream': 'raw',
        }

        await self.output.broadcast_raw(raw_message)
        self.stats['broadcast_raw'] += 1

    async def _enrich_message(self, message: dict, source: str) -> dict:
        mmsi = message.get('mmsi')

        if not mmsi:
            return message

        vessel_state = self.redis.get_vessel(mmsi)

        if not vessel_state:
            return message

        enriched = {**vessel_state, **message}

        enriched['_aggregated'] = True
        enriched['_primary_source'] = source

        return enriched

    async def _broadcast_filtered(self, message: dict) -> None:
        await self.output.broadcast_filtered(message)
        self.stats['broadcast_filtered'] += 1

    def get_stats(self) -> dict:
        
        return {
            **self.stats,
            'dedup_rate': (
                self.stats['duplicates'] / self.stats['total_received']
                if self.stats['total_received'] > 0
                else 0
            ),
        }

    async def cleanup_task(self, interval: int = 300) -> None:
        while True:
            await asyncio.sleep(interval)

            try:
                cleaned = self.redis.cleanup_expired_vessels()
                if cleaned > 0:
                    self.logger.info("Cleanup completed", vessels_removed=cleaned)
            except Exception as e:
                self.logger.error("Cleanup error", error=str(e))
