
import asyncio
from typing import Callable, Dict, List, Optional

from src.core.logger import LoggerMixin
from src.ingestion.websocket_client import SourceWebSocketClient


class SourceManager(LoggerMixin):

    def __init__(self, sources_config: List[dict]):
        self._logger_context = {'component': 'source-manager'}
        self.sources: Dict[str, SourceWebSocketClient] = {}
        self.tasks: Dict[str, asyncio.Task] = {}

        for source_cfg in sources_config:
            if not source_cfg.get('enabled', True):
                continue

            client = SourceWebSocketClient(
                name=source_cfg['name'],
                url=source_cfg['url'],
                reconnect=source_cfg.get('reconnect', True),
                reconnect_interval=source_cfg.get('reconnect_interval', 5000),
                reconnect_max_attempts=source_cfg.get('reconnect_max_attempts', 0),
                token=source_cfg.get('token'),
            )

            self.sources[source_cfg['name']] = client

        self.logger.info("Source manager initialized", sources=len(self.sources))

    def set_message_callback(self, callback: Callable[[dict, str], None]) -> None:
        for client in self.sources.values():
            client.on_message = callback

    async def start_all(self) -> None:
        
        self.logger.info("Starting all sources", count=len(self.sources))

        for name, client in self.sources.items():
            task = asyncio.create_task(client.start())
            self.tasks[name] = task
            self.logger.info("Source started", source=name)

    async def stop_all(self) -> None:
        
        self.logger.info("Stopping all sources")

        for client in self.sources.values():
            await client.stop()

        if self.tasks:
            await asyncio.gather(*self.tasks.values(), return_exceptions=True)

        self.logger.info("All sources stopped")

    def get_stats(self) -> List[dict]:
        
        return [client.get_stats() for client in self.sources.values()]

    def get_source(self, name: str) -> Optional[SourceWebSocketClient]:
        
        return self.sources.get(name)

    def is_any_connected(self) -> bool:
        
        return any(client.connected for client in self.sources.values())
