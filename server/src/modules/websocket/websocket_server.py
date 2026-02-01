
import asyncio
import json
import time
from collections import defaultdict
from typing import Dict, List, Set, Optional
from datetime import datetime

from fastapi import WebSocket, WebSocketDisconnect

from src.core.logger import LoggerMixin


class ConnectionManager(LoggerMixin):

    def __init__(self, max_clients: int = 100, max_clients_geo: Optional[int] = None,
                 max_connections_per_ip: int = 10, connection_rate_limit: int = 5,
                 connection_rate_window: int = 60):
        self._logger_context = {'component': 'websocket-manager'}
        self.max_clients = max_clients
        self.max_clients_geo = max_clients_geo

        self.max_connections_per_ip = max_connections_per_ip
        self.connection_rate_limit = connection_rate_limit
        self.connection_rate_window = connection_rate_window

        self.all_connections: Set[WebSocket] = set()
        self.watchlist_connections: Set[WebSocket] = set()

        self.geo_connections: Dict[WebSocket, Dict] = {}
        self.geo_watchlist_connections: Dict[WebSocket, Dict] = {}

        self._connection_attempts: Dict[str, List[float]] = defaultdict(list)
        self._ip_connections: Dict[str, Set[WebSocket]] = defaultdict(set)
        self._websocket_ip: Dict[WebSocket, str] = {}

        self.stats = {
            'total_connections': 0,
            'total_watchlist_connections': 0,
            'total_geo_connections': 0,
            'total_geo_watchlist_connections': 0,
            'messages_sent': 0,
            'messages_failed': 0,
            'connections_rate_limited': 0,
        }

    def _check_rate_limit(self, client_ip: str) -> bool:
        current_time = time.time()

        if len(self._ip_connections[client_ip]) >= self.max_connections_per_ip:
            self.logger.warning(
                "Max connections per IP reached",
                client_ip=client_ip,
                current=len(self._ip_connections[client_ip]),
                max=self.max_connections_per_ip,
            )
            self.stats['connections_rate_limited'] += 1
            return False

        self._connection_attempts[client_ip] = [
            ts for ts in self._connection_attempts[client_ip]
            if current_time - ts < self.connection_rate_window
        ]

        if len(self._connection_attempts[client_ip]) >= self.connection_rate_limit:
            self.logger.warning(
                "Connection rate limit exceeded",
                client_ip=client_ip,
                attempts=len(self._connection_attempts[client_ip]),
                window=self.connection_rate_window,
            )
            self.stats['connections_rate_limited'] += 1
            return False

        self._connection_attempts[client_ip].append(current_time)
        return True

    def _track_connection(self, websocket: WebSocket, client_ip: str) -> None:
        
        self._ip_connections[client_ip].add(websocket)
        self._websocket_ip[websocket] = client_ip

    def _untrack_connection(self, websocket: WebSocket) -> None:
        
        client_ip = self._websocket_ip.pop(websocket, None)
        if client_ip and websocket in self._ip_connections[client_ip]:
            self._ip_connections[client_ip].discard(websocket)
            if not self._ip_connections[client_ip]:
                del self._ip_connections[client_ip]

    async def connect(self, websocket: WebSocket, pool: str = 'all', bounding_box: Optional[Dict] = None, client_ip: str = "unknown") -> bool:
        if not self._check_rate_limit(client_ip):
            return False

        if pool == 'all':
            connections = self.all_connections
            max_limit = self.max_clients
        elif pool == 'watchlist':
            connections = self.watchlist_connections
            max_limit = self.max_clients
        elif pool == 'geo':
            connections = self.geo_connections
            max_limit = self.max_clients_geo
        elif pool == 'geo_watchlist':
            connections = self.geo_watchlist_connections
            max_limit = self.max_clients_geo
        else:
            self.logger.error("Invalid pool", pool=pool)
            return False

        if max_limit is not None and len(connections) >= max_limit:
            self.logger.warning(
                "Max clients reached",
                pool=pool,
                max_clients=max_limit,
                current=len(connections),
            )
            return False

        await websocket.accept()

        self._track_connection(websocket, client_ip)

        if pool in ['all', 'watchlist']:
            connections.add(websocket)
        else:
            connections[websocket] = bounding_box

        if pool == 'all':
            self.stats['total_connections'] += 1
        elif pool == 'watchlist':
            self.stats['total_watchlist_connections'] += 1
        elif pool == 'geo':
            self.stats['total_geo_connections'] += 1
        elif pool == 'geo_watchlist':
            self.stats['total_geo_watchlist_connections'] += 1

        self.logger.info(
            "Client connected",
            pool=pool,
            active_connections=len(connections),
            bounding_box=bounding_box if bounding_box else None,
        )

        return True

    def disconnect(self, websocket: WebSocket, pool: str = 'all') -> None:
        if pool == 'all':
            connections = self.all_connections
        elif pool == 'watchlist':
            connections = self.watchlist_connections
        elif pool == 'geo':
            connections = self.geo_connections
        elif pool == 'geo_watchlist':
            connections = self.geo_watchlist_connections
        else:
            return

        if websocket in connections:
            if isinstance(connections, set):
                connections.remove(websocket)
            else:
                del connections[websocket]

        self._untrack_connection(websocket)

        self.logger.info(
            "Client disconnected",
            pool=pool,
            active_connections=len(connections),
        )

    @staticmethod
    def is_point_in_box(lat: float, lon: float, bounding_box: Dict) -> bool:
        if not bounding_box:
            return False

        min_lat = bounding_box.get('min_lat')
        max_lat = bounding_box.get('max_lat')
        min_lon = bounding_box.get('min_lon')
        max_lon = bounding_box.get('max_lon')

        if None in [min_lat, max_lat, min_lon, max_lon]:
            return False

        if not (min_lat <= lat <= max_lat):
            return False

        if min_lon <= max_lon:
            return min_lon <= lon <= max_lon
        else:
            return lon >= min_lon or lon <= max_lon

    async def send_personal(self, message: Dict, websocket: WebSocket) -> None:
        try:
            await websocket.send_json(message)
            self.stats['messages_sent'] += 1
        except Exception as e:
            self.stats['messages_failed'] += 1
            self.logger.debug("Failed to send message", error=str(e))

    async def broadcast(self, message: Dict, pool: str = 'all', lat: Optional[float] = None, lon: Optional[float] = None) -> None:
        if pool == 'all':
            connections = self.all_connections
        elif pool == 'watchlist':
            connections = self.watchlist_connections
        elif pool == 'geo':
            connections = self.geo_connections
        elif pool == 'geo_watchlist':
            connections = self.geo_watchlist_connections
        else:
            return

        if not connections:
            return

        tasks = []

        if pool in ['all', 'watchlist']:
            for connection in connections.copy():
                tasks.append(self._safe_send(connection, message, pool))
        else:
            if lat is None or lon is None:
                return

            for connection, bounding_box in connections.copy().items():
                if self.is_point_in_box(lat, lon, bounding_box):
                    tasks.append(self._safe_send(connection, message, pool))

        await asyncio.gather(*tasks, return_exceptions=True)

    async def _safe_send(self, websocket: WebSocket, message: Dict, pool: str = 'all') -> None:
        try:
            await websocket.send_json(message)
            self.stats['messages_sent'] += 1
        except Exception as e:
            self.stats['messages_failed'] += 1
            self.logger.debug("Broadcast failed", error=str(e))
            self.disconnect(websocket, pool)

    def get_stats(self) -> Dict:
        
        return {
            'clients_connected': len(self.all_connections) + len(self.watchlist_connections) + len(self.geo_connections) + len(self.geo_watchlist_connections),
            'clients_all': len(self.all_connections),
            'clients_watchlist': len(self.watchlist_connections),
            'clients_geo': len(self.geo_connections),
            'clients_geo_watchlist': len(self.geo_watchlist_connections),
            'total_connections': self.stats['total_connections'],
            'total_watchlist_connections': self.stats['total_watchlist_connections'],
            'total_geo_connections': self.stats['total_geo_connections'],
            'total_geo_watchlist_connections': self.stats['total_geo_watchlist_connections'],
            'messages_sent': self.stats['messages_sent'],
            'messages_failed': self.stats['messages_failed'],
        }


class WebSocketServer(LoggerMixin):

    def __init__(self, max_clients: int = 100, max_clients_geo: Optional[int] = None):
        self._logger_context = {'component': 'websocket-server'}
        self.manager = ConnectionManager(max_clients=max_clients, max_clients_geo=max_clients_geo)

    async def handle_client(self, websocket: WebSocket, client_ip: str = "unknown") -> None:
        connected = await self.manager.connect(websocket, pool='all', client_ip=client_ip)

        if not connected:
            await websocket.close(code=1008, reason="Max clients reached")
            return

        try:
            await self.manager.send_personal(
                {
                    "type": "connected",
                    "timestamp": datetime.utcnow().isoformat(),
                    "message": "Connected to DarkFleet server (all messages stream)",
                    "stream": "all",
                },
                websocket,
            )

            while True:
                data = await websocket.receive_text()

                try:
                    message = json.loads(data)
                    message_type = message.get('type')

                    if message_type == 'ping':
                        await self.manager.send_personal(
                            {"type": "pong", "timestamp": datetime.utcnow().isoformat()},
                            websocket,
                        )

                except json.JSONDecodeError:
                    self.logger.debug("Invalid JSON from client", data=data[:100])

        except WebSocketDisconnect:
            self.logger.debug("Client disconnected gracefully")
        except Exception as e:
            self.logger.error("WebSocket error", error=str(e))
        finally:
            self.manager.disconnect(websocket, pool='all')

    async def handle_watchlist_client(self, websocket: WebSocket, client_ip: str = "unknown") -> None:
        connected = await self.manager.connect(websocket, pool='watchlist', client_ip=client_ip)

        if not connected:
            await websocket.close(code=1008, reason="Max clients reached")
            return

        try:
            await self.manager.send_personal(
                {
                    "type": "connected",
                    "timestamp": datetime.utcnow().isoformat(),
                    "message": "Connected to DarkFleet server (watchlist-only stream)",
                    "stream": "watchlist",
                },
                websocket,
            )

            while True:
                data = await websocket.receive_text()

                try:
                    message = json.loads(data)
                    message_type = message.get('type')

                    if message_type == 'ping':
                        await self.manager.send_personal(
                            {"type": "pong", "timestamp": datetime.utcnow().isoformat()},
                            websocket,
                        )

                except json.JSONDecodeError:
                    self.logger.debug("Invalid JSON from client", data=data[:100])

        except WebSocketDisconnect:
            self.logger.debug("Client disconnected gracefully (watchlist)")
        except Exception as e:
            self.logger.error("WebSocket error (watchlist)", error=str(e))
        finally:
            self.manager.disconnect(websocket, pool='watchlist')

    async def handle_geo_client(self, websocket: WebSocket, bounding_box: Dict, client_ip: str = "unknown") -> None:
        connected = await self.manager.connect(websocket, pool='geo', bounding_box=bounding_box, client_ip=client_ip)

        if not connected:
            await websocket.close(code=1008, reason="Max clients reached")
            return

        try:
            await self.manager.send_personal(
                {
                    "type": "connected",
                    "timestamp": datetime.utcnow().isoformat(),
                    "message": "Connected to DarkFleet server (geographic filtered stream)",
                    "stream": "geo",
                    "bounding_box": bounding_box,
                },
                websocket,
            )

            while True:
                data = await websocket.receive_text()

                try:
                    message = json.loads(data)
                    message_type = message.get('type')

                    if message_type == 'ping':
                        await self.manager.send_personal(
                            {"type": "pong", "timestamp": datetime.utcnow().isoformat()},
                            websocket,
                        )

                except json.JSONDecodeError:
                    self.logger.debug("Invalid JSON from client", data=data[:100])

        except WebSocketDisconnect:
            self.logger.debug("Client disconnected gracefully (geo)")
        except Exception as e:
            self.logger.error("WebSocket error (geo)", error=str(e))
        finally:
            self.manager.disconnect(websocket, pool='geo')

    async def handle_geo_watchlist_client(self, websocket: WebSocket, bounding_box: Dict, client_ip: str = "unknown") -> None:
        connected = await self.manager.connect(websocket, pool='geo_watchlist', bounding_box=bounding_box, client_ip=client_ip)

        if not connected:
            await websocket.close(code=1008, reason="Max clients reached")
            return

        try:
            await self.manager.send_personal(
                {
                    "type": "connected",
                    "timestamp": datetime.utcnow().isoformat(),
                    "message": "Connected to DarkFleet server (geographic + watchlist filtered stream)",
                    "stream": "geo_watchlist",
                    "bounding_box": bounding_box,
                },
                websocket,
            )

            while True:
                data = await websocket.receive_text()

                try:
                    message = json.loads(data)
                    message_type = message.get('type')

                    if message_type == 'ping':
                        await self.manager.send_personal(
                            {"type": "pong", "timestamp": datetime.utcnow().isoformat()},
                            websocket,
                        )

                except json.JSONDecodeError:
                    self.logger.debug("Invalid JSON from client", data=data[:100])

        except WebSocketDisconnect:
            self.logger.debug("Client disconnected gracefully (geo_watchlist)")
        except Exception as e:
            self.logger.error("WebSocket error (geo_watchlist)", error=str(e))
        finally:
            self.manager.disconnect(websocket, pool='geo_watchlist')

    async def broadcast_track_update(self, message: Dict, match: Dict = None) -> None:
        track_update = {
            "type": "track_update",
            "timestamp": datetime.utcnow().isoformat(),
            "mmsi": message.get('mmsi'),
            "lat": message.get('lat'),
            "lon": message.get('lon'),
            "speed": message.get('speed'),
            "course": message.get('course'),
            "heading": message.get('heading'),
            "watchlist": match if match else None,
        }

        if 'name' in message:
            track_update['name'] = message['name']
        if 'imo' in message:
            track_update['imo'] = message['imo']
        if 'callsign' in message:
            track_update['callsign'] = message['callsign']
        if 'shiptype' in message:
            track_update['shiptype'] = message['shiptype']

        lat = message.get('lat')
        lon = message.get('lon')

        if self.manager.all_connections:
            await self.manager.broadcast(track_update, pool='all')

        if match and self.manager.watchlist_connections:
            watchlist_update = track_update.copy()
            watchlist_update['list_id'] = match.get('list_id')

            await self.manager.broadcast(watchlist_update, pool='watchlist')

        if self.manager.geo_connections and lat is not None and lon is not None:
            await self.manager.broadcast(track_update, pool='geo', lat=lat, lon=lon)

        if match and self.manager.geo_watchlist_connections and lat is not None and lon is not None:
            geo_watchlist_update = track_update.copy()
            geo_watchlist_update['list_id'] = match.get('list_id')

            await self.manager.broadcast(geo_watchlist_update, pool='geo_watchlist', lat=lat, lon=lon)

    async def broadcast_watchlist_sync(self, stats: Dict) -> None:
        message = {
            "type": "watchlist_sync",
            "timestamp": datetime.utcnow().isoformat(),
            "vessels": stats.get('vessels', 0),
            "lists": stats.get('lists', 0),
            "success": stats.get('success', False),
        }

        await self.manager.broadcast(message)

    async def broadcast_heartbeat(self) -> None:
        
        message = {
            "type": "heartbeat",
            "timestamp": datetime.utcnow().isoformat(),
        }

        await self.manager.broadcast(message)

    def get_stats(self) -> Dict:
        
        return self.manager.get_stats()
