
import asyncio
import json
from datetime import datetime
from typing import Dict, Set

from fastapi import WebSocket, WebSocketDisconnect

from src.core.logger import LoggerMixin


class ConnectionManager(LoggerMixin):

    def __init__(self, max_clients: int = 500):
        self._logger_context = {'component': 'ws-manager'}
        self.max_clients = max_clients

        self.raw_connections: Set[WebSocket] = set()
        self.filtered_connections: Set[WebSocket] = set()

        self.stats = {
            'total_raw_connections': 0,
            'total_filtered_connections': 0,
            'messages_sent_raw': 0,
            'messages_sent_filtered': 0,
            'messages_failed': 0,
        }

    async def connect(self, websocket: WebSocket, stream: str = 'filtered') -> bool:
        connections = self.raw_connections if stream == 'raw' else self.filtered_connections

        if len(connections) >= self.max_clients:
            self.logger.warning(
                "Max clients reached",
                stream=stream,
                max_clients=self.max_clients,
            )
            return False

        await websocket.accept()
        connections.add(websocket)

        if stream == 'raw':
            self.stats['total_raw_connections'] += 1
        else:
            self.stats['total_filtered_connections'] += 1

        self.logger.info(
            "Client connected",
            stream=stream,
            active_connections=len(connections),
        )

        return True

    def disconnect(self, websocket: WebSocket, stream: str = 'filtered') -> None:
        connections = self.raw_connections if stream == 'raw' else self.filtered_connections

        if websocket in connections:
            connections.remove(websocket)

        self.logger.info(
            "Client disconnected",
            stream=stream,
            active_connections=len(connections),
        )

    async def broadcast(self, message: Dict, stream: str = 'filtered') -> None:
        connections = self.raw_connections if stream == 'raw' else self.filtered_connections

        if not connections:
            return

        stat_key = 'messages_sent_raw' if stream == 'raw' else 'messages_sent_filtered'

        tasks = []
        for connection in connections.copy():
            tasks.append(self._safe_send(connection, message, stream, stat_key))

        await asyncio.gather(*tasks, return_exceptions=True)

    async def _safe_send(
        self,
        websocket: WebSocket,
        message: Dict,
        stream: str,
        stat_key: str,
    ) -> None:
        try:
            await websocket.send_json(message)
            self.stats[stat_key] += 1
        except Exception as e:
            self.stats['messages_failed'] += 1
            self.logger.debug("Broadcast failed", error=str(e), stream=stream)
            self.disconnect(websocket, stream)

    def get_stats(self) -> Dict:
        
        return {
            'clients_raw': len(self.raw_connections),
            'clients_filtered': len(self.filtered_connections),
            'total_raw_connections': self.stats['total_raw_connections'],
            'total_filtered_connections': self.stats['total_filtered_connections'],
            'messages_sent_raw': self.stats['messages_sent_raw'],
            'messages_sent_filtered': self.stats['messages_sent_filtered'],
            'messages_failed': self.stats['messages_failed'],
        }


class WebSocketOutputServer(LoggerMixin):

    def __init__(self, max_clients: int = 500):
        self._logger_context = {'component': 'ws-output'}
        self.manager = ConnectionManager(max_clients=max_clients)

    async def handle_raw_client(self, websocket: WebSocket) -> None:
        connected = await self.manager.connect(websocket, stream='raw')

        if not connected:
            await websocket.close(code=1008, reason="Max clients reached")
            return

        try:
            await websocket.send_json({
                "type": "connected",
                "timestamp": datetime.utcnow().isoformat(),
                "message": "Connected to Collettore RAW stream (pre-pruning)",
                "stream": "raw",
            })

            while True:
                data = await websocket.receive_text()

                try:
                    message = json.loads(data)
                    if message.get('type') == 'ping':
                        await websocket.send_json({
                            "type": "pong",
                            "timestamp": datetime.utcnow().isoformat(),
                        })
                except json.JSONDecodeError:
                    pass

        except WebSocketDisconnect:
            self.logger.debug("RAW client disconnected gracefully")
        except Exception as e:
            self.logger.error("RAW WebSocket error", error=str(e))
        finally:
            self.manager.disconnect(websocket, stream='raw')

    async def handle_filtered_client(self, websocket: WebSocket) -> None:
        connected = await self.manager.connect(websocket, stream='filtered')

        if not connected:
            await websocket.close(code=1008, reason="Max clients reached")
            return

        try:
            await websocket.send_json({
                "type": "connected",
                "timestamp": datetime.utcnow().isoformat(),
                "message": "Connected to Collettore filtered stream (post-pruning)",
                "stream": "filtered",
            })

            while True:
                data = await websocket.receive_text()

                try:
                    message = json.loads(data)
                    if message.get('type') == 'ping':
                        await websocket.send_json({
                            "type": "pong",
                            "timestamp": datetime.utcnow().isoformat(),
                        })
                except json.JSONDecodeError:
                    pass

        except WebSocketDisconnect:
            self.logger.debug("Filtered client disconnected gracefully")
        except Exception as e:
            self.logger.error("Filtered WebSocket error", error=str(e))
        finally:
            self.manager.disconnect(websocket, stream='filtered')

    async def broadcast_raw(self, message: dict) -> None:
        await self.manager.broadcast(message, stream='raw')

    async def broadcast_filtered(self, message: dict) -> None:
        await self.manager.broadcast(message, stream='filtered')

    def get_stats(self) -> Dict:
        
        return self.manager.get_stats()
