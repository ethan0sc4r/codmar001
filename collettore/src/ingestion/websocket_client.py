
import asyncio
import json
from typing import Callable, Optional

import websockets
from websockets.client import WebSocketClientProtocol

from src.core.logger import LoggerMixin


class SourceWebSocketClient(LoggerMixin):

    def __init__(
        self,
        name: str,
        url: str,
        reconnect: bool = True,
        reconnect_interval: int = 5000,
        reconnect_max_attempts: int = 0,
        token: Optional[str] = None,
    ):
        self._logger_context = {'component': 'ws-client', 'source': name}
        self.name = name
        self.url = url
        self.reconnect = reconnect
        self.reconnect_interval = reconnect_interval / 1000.0
        self.reconnect_max_attempts = reconnect_max_attempts
        self.token = token

        self.websocket: Optional[WebSocketClientProtocol] = None
        self.connected = False
        self.running = False
        self.reconnect_attempts = 0

        self.on_message: Optional[Callable[[dict, str], None]] = None

        self.stats = {
            'messages_received': 0,
            'connection_count': 0,
            'reconnect_count': 0,
        }

    def _get_connection_headers(self) -> dict:
        
        headers = {}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    async def connect(self) -> bool:
        try:
            extra_headers = self._get_connection_headers()
            self.logger.info("Connecting to source", url=self.url, has_token=bool(self.token))

            self.websocket = await websockets.connect(
                self.url,
                extra_headers=extra_headers if extra_headers else None
            )
            self.connected = True
            self.reconnect_attempts = 0
            self.stats['connection_count'] += 1

            self.logger.info("Connected to source", url=self.url)
            return True

        except Exception as e:
            self.logger.error("Connection failed", error=str(e), url=self.url)
            return False

    async def disconnect(self) -> None:
        
        self.connected = False

        if self.websocket:
            try:
                await self.websocket.close()
            except Exception as e:
                self.logger.debug("Error closing connection", error=str(e))

        self.websocket = None
        self.logger.info("Disconnected from source")

    async def start(self) -> None:
        
        self.running = True

        while self.running:
            if not self.connected:
                connected = await self.connect()

                if not connected:
                    if not self.reconnect:
                        self.logger.error("Connection failed, auto-reconnect disabled")
                        break

                    if (
                        self.reconnect_max_attempts > 0
                        and self.reconnect_attempts >= self.reconnect_max_attempts
                    ):
                        self.logger.error(
                            "Max reconnect attempts reached",
                            attempts=self.reconnect_attempts,
                        )
                        break

                    wait_time = min(self.reconnect_interval * (2 ** self.reconnect_attempts), 60)
                    self.reconnect_attempts += 1

                    self.logger.info(
                        "Reconnecting...",
                        attempt=self.reconnect_attempts,
                        wait_seconds=wait_time,
                    )

                    await asyncio.sleep(wait_time)
                    continue

            try:
                await self._receive_loop()
            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error("Receive loop error", error=str(e))
                await self.disconnect()

                if self.reconnect:
                    self.stats['reconnect_count'] += 1
                    await asyncio.sleep(self.reconnect_interval)
                else:
                    break

    async def _receive_loop(self) -> None:
        
        if not self.websocket:
            return

        self.logger.info("Receive loop started")

        async for message in self.websocket:
            if not self.running:
                break

            try:
                data = json.loads(message)

                self.stats['messages_received'] += 1

                if self.on_message:
                    self.on_message(data, self.name)

            except json.JSONDecodeError as e:
                self.logger.debug("JSON decode error", error=str(e))
                continue
            except Exception as e:
                self.logger.error("Message processing error", error=str(e))
                continue

    async def stop(self) -> None:
        
        self.running = False
        await self.disconnect()
        self.logger.info("Source client stopped")

    def get_stats(self) -> dict:
        
        return {
            'name': self.name,
            'connected': self.connected,
            'messages_received': self.stats['messages_received'],
            'connection_count': self.stats['connection_count'],
            'reconnect_count': self.stats['reconnect_count'],
            'reconnect_attempts': self.reconnect_attempts,
        }
