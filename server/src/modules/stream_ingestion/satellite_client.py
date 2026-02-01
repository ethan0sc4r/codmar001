
import asyncio
from typing import Callable, Optional

from src.core.logger import LoggerMixin


class SatelliteClient(LoggerMixin):

    def __init__(
        self,
        host: str,
        port: int,
        reconnect: bool = True,
        reconnect_interval: int = 5000,
        reconnect_max_attempts: int = 0,
    ):
        self._logger_context = {'component': 'satellite-client'}
        self.host = host
        self.port = port
        self.reconnect = reconnect
        self.reconnect_interval = reconnect_interval / 1000.0
        self.reconnect_max_attempts = reconnect_max_attempts

        self.reader: Optional[asyncio.StreamReader] = None
        self.writer: Optional[asyncio.StreamWriter] = None
        self.connected = False
        self.running = False
        self.reconnect_attempts = 0

        self.on_message: Optional[Callable[[str], None]] = None

        self.stats = {
            'messages_received': 0,
            'bytes_received': 0,
            'reconnect_count': 0,
            'connection_count': 0,
        }

    async def connect(self) -> bool:
        try:
            self.logger.info("Connecting to satellite", host=self.host, port=self.port)

            self.reader, self.writer = await asyncio.open_connection(self.host, self.port)

            self.connected = True
            self.reconnect_attempts = 0
            self.stats['connection_count'] += 1

            self.logger.info("Connected to satellite", host=self.host, port=self.port)
            return True

        except Exception as e:
            self.logger.error("Connection failed", error=str(e), host=self.host, port=self.port)
            return False

    async def disconnect(self) -> None:
        
        self.connected = False

        if self.writer:
            try:
                self.writer.close()
                await self.writer.wait_closed()
            except Exception as e:
                self.logger.debug("Error closing connection", error=str(e))

        self.reader = None
        self.writer = None

        self.logger.info("Disconnected from satellite")

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
        
        if not self.reader:
            return

        self.logger.info("Receive loop started")

        while self.running and self.connected:
            try:
                line = await asyncio.wait_for(self.reader.readline(), timeout=30.0)

                if not line:
                    self.logger.warning("Connection closed by remote")
                    self.connected = False
                    break

                decoded = line.decode('ascii', errors='ignore')

                messages = decoded.replace('\r', '\n').split('\n')

                for message in messages:
                    message = message.strip()

                    if not message:
                        continue

                    self.stats['messages_received'] += 1
                    self.stats['bytes_received'] += len(message.encode('ascii'))

                    if self.on_message:
                        self.on_message(message)

            except asyncio.TimeoutError:
                self.logger.debug("Read timeout, connection might be dead")
                self.connected = False
                break

            except UnicodeDecodeError as e:
                self.logger.debug("Decode error", error=str(e))
                continue

            except Exception as e:
                self.logger.error("Read error", error=str(e))
                self.connected = False
                break

    async def stop(self) -> None:
        
        self.running = False
        await self.disconnect()
        self.logger.info("Satellite client stopped")

    def get_stats(self) -> dict:
        
        return {
            'connected': self.connected,
            'messages_received': self.stats['messages_received'],
            'bytes_received': self.stats['bytes_received'],
            'reconnect_count': self.stats['reconnect_count'],
            'reconnect_attempts': self.reconnect_attempts,
            'connection_count': self.stats['connection_count'],
        }
