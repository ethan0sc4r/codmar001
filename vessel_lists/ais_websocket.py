
import asyncio
import json
import logging
import ssl
from datetime import datetime
from typing import Optional, Dict, List, Callable
from dataclasses import dataclass, field

import websockets
from websockets.exceptions import ConnectionClosed, WebSocketException

from sqlalchemy.orm import Session
from database import SessionLocal
from config import config as app_config
import models

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ais_websocket")


@dataclass
class AISWebSocketConfig:
    
    host: str = field(default_factory=lambda: app_config.websocket.host)
    port: int = field(default_factory=lambda: app_config.websocket.port)
    path: str = field(default_factory=lambda: app_config.websocket.path)
    use_ssl: bool = field(default_factory=lambda: app_config.websocket.use_ssl)
    reconnect: bool = field(default_factory=lambda: app_config.websocket.reconnect)
    reconnect_interval: float = field(default_factory=lambda: app_config.websocket.reconnect_interval)
    ping_interval: float = field(default_factory=lambda: app_config.websocket.ping_interval)
    ping_timeout: float = field(default_factory=lambda: app_config.websocket.ping_timeout)


@dataclass
class AISWebSocketStats:
    
    connected: bool = False
    messages_received: int = 0
    messages_with_imo: int = 0
    vessels_updated: int = 0
    last_message_time: Optional[datetime] = None
    last_update_time: Optional[datetime] = None
    connection_errors: int = 0
    reconnect_count: int = 0
    updates_log: List[Dict] = field(default_factory=list)

    def to_dict(self) -> Dict:
        return {
            "connected": self.connected,
            "messages_received": self.messages_received,
            "messages_with_imo": self.messages_with_imo,
            "vessels_updated": self.vessels_updated,
            "last_message_time": self.last_message_time.isoformat() if self.last_message_time else None,
            "last_update_time": self.last_update_time.isoformat() if self.last_update_time else None,
            "connection_errors": self.connection_errors,
            "reconnect_count": self.reconnect_count,
            "recent_updates": self.updates_log[-20:],
        }


class AISWebSocketClient:

    def __init__(self, config: Optional[AISWebSocketConfig] = None):
        self.config = config or AISWebSocketConfig()
        self.stats = AISWebSocketStats()
        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._imo_cache: Dict[str, List[int]] = {}
        self._cache_timestamp: Optional[datetime] = None
        self._cache_ttl = 60
        self._on_update_callbacks: List[Callable] = []

    @property
    def ws_url(self) -> str:
        
        protocol = "wss" if self.config.use_ssl else "ws"
        return f"{protocol}://{self.config.host}:{self.config.port}{self.config.path}"

    def _get_ssl_context(self) -> Optional[ssl.SSLContext]:
        
        if not self.config.use_ssl:
            return None
        ssl_context = ssl.create_default_context()
        return ssl_context

    def _get_db(self) -> Session:
        
        return SessionLocal()

    def _refresh_imo_cache(self) -> None:
        
        now = datetime.utcnow()

        if (self._cache_timestamp and
            (now - self._cache_timestamp).total_seconds() < self._cache_ttl):
            return

        db = self._get_db()
        try:
            vessels = db.query(models.Vessel).filter(
                models.Vessel.imo.isnot(None),
                models.Vessel.imo != ""
            ).all()

            self._imo_cache.clear()
            for vessel in vessels:
                imo = vessel.imo.strip()
                if imo:
                    if imo not in self._imo_cache:
                        self._imo_cache[imo] = []
                    self._imo_cache[imo].append(vessel.id)

            self._cache_timestamp = now
            logger.info(f"IMO cache refreshed: {len(self._imo_cache)} unique IMOs tracked")

        finally:
            db.close()

    def _update_vessel_from_ais(self, imo: str, ais_data: Dict) -> int:
        self._refresh_imo_cache()

        vessel_ids = self._imo_cache.get(imo)
        if not vessel_ids:
            return 0

        db = self._get_db()
        updated_count = 0

        try:
            for vessel_id in vessel_ids:
                vessel = db.query(models.Vessel).filter(
                    models.Vessel.id == vessel_id
                ).first()

                if not vessel:
                    continue

                changes = []

                if ais_data.get("mmsi") and ais_data["mmsi"] != vessel.mmsi:
                    old_mmsi = vessel.mmsi
                    vessel.mmsi = str(ais_data["mmsi"])
                    changes.append(f"MMSI: {old_mmsi} → {vessel.mmsi}")

                if ais_data.get("name") and ais_data["name"] != vessel.name:
                    old_name = vessel.name
                    vessel.name = ais_data["name"]
                    changes.append(f"Name: {old_name} → {vessel.name}")

                if ais_data.get("lat") is not None and ais_data.get("lon") is not None:
                    position = json.dumps({
                        "lat": ais_data["lat"],
                        "lon": ais_data["lon"],
                        "speed": ais_data.get("speed"),
                        "course": ais_data.get("course"),
                        "timestamp": datetime.utcnow().isoformat()
                    })
                    vessel.lastposition = position
                    changes.append("Position updated")

                if changes:
                    db.commit()
                    updated_count += 1

                    update_log = {
                        "timestamp": datetime.utcnow().isoformat(),
                        "imo": imo,
                        "mmsi": ais_data.get("mmsi"),
                        "vessel_id": vessel_id,
                        "list_id": vessel.list_id,
                        "changes": changes
                    }
                    self.stats.updates_log.append(update_log)

                    if len(self.stats.updates_log) > 100:
                        self.stats.updates_log = self.stats.updates_log[-100:]

                    logger.info(f"Updated vessel {vessel_id} (IMO: {imo}): {', '.join(changes)}")

                    for callback in self._on_update_callbacks:
                        try:
                            callback(update_log)
                        except Exception as e:
                            logger.error(f"Callback error: {e}")

            return updated_count

        except Exception as e:
            logger.error(f"Error updating vessel: {e}")
            db.rollback()
            return 0
        finally:
            db.close()

    async def _handle_message(self, message: str) -> None:
        
        try:
            data = json.loads(message)
            msg_type = data.get("type")

            if msg_type == "track_update":
                self.stats.messages_received += 1
                self.stats.last_message_time = datetime.utcnow()

                imo = data.get("imo")
                if imo:
                    self.stats.messages_with_imo += 1

                    updated = self._update_vessel_from_ais(str(imo), data)
                    if updated > 0:
                        self.stats.vessels_updated += updated
                        self.stats.last_update_time = datetime.utcnow()

            elif msg_type == "connected":
                logger.info(f"Connected to server: {data.get('message')}")

            elif msg_type == "pong":
                pass

        except json.JSONDecodeError:
            logger.warning(f"Invalid JSON received: {message[:100]}")
        except Exception as e:
            logger.error(f"Error handling message: {e}")

    async def _send_ping(self) -> None:
        
        if self._ws:
            try:
                await self._ws.send(json.dumps({
                    "type": "ping",
                    "timestamp": datetime.utcnow().isoformat()
                }))
            except Exception as e:
                logger.debug(f"Ping failed: {e}")

    async def _connect_loop(self) -> None:
        
        while self._running:
            try:
                logger.info(f"Connecting to {self.ws_url}...")

                ssl_context = self._get_ssl_context()

                async with websockets.connect(
                    self.ws_url,
                    ping_interval=self.config.ping_interval,
                    ping_timeout=self.config.ping_timeout,
                    ssl=ssl_context,
                ) as ws:
                    self._ws = ws
                    self.stats.connected = True
                    logger.info("WebSocket connected!")

                    self._refresh_imo_cache()

                    async for message in ws:
                        if not self._running:
                            break
                        await self._handle_message(message)

            except ConnectionClosed as e:
                logger.warning(f"Connection closed: {e}")
            except WebSocketException as e:
                logger.error(f"WebSocket error: {e}")
                self.stats.connection_errors += 1
            except Exception as e:
                logger.error(f"Connection error: {e}")
                self.stats.connection_errors += 1
            finally:
                self._ws = None
                self.stats.connected = False

            if self._running and self.config.reconnect:
                self.stats.reconnect_count += 1
                logger.info(f"Reconnecting in {self.config.reconnect_interval}s...")
                await asyncio.sleep(self.config.reconnect_interval)
            else:
                break

    async def start(self) -> None:
        
        if self._running:
            logger.warning("Client already running")
            return

        self._running = True
        self._task = asyncio.create_task(self._connect_loop())
        logger.info("AIS WebSocket client started")

    async def stop(self) -> None:
        
        self._running = False

        if self._ws:
            await self._ws.close()

        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

        self.stats.connected = False
        logger.info("AIS WebSocket client stopped")

    def configure(self, host: str, port: int, path: str = "/ws", use_ssl: bool = False) -> None:
        
        self.config.host = host
        self.config.port = port
        self.config.path = path
        self.config.use_ssl = use_ssl
        logger.info(f"Configuration updated: {self.ws_url} (SSL: {use_ssl})")

    def get_config(self) -> Dict:
        
        return {
            "host": self.config.host,
            "port": self.config.port,
            "path": self.config.path,
            "use_ssl": self.config.use_ssl,
            "ws_url": self.ws_url,
            "reconnect": self.config.reconnect,
            "reconnect_interval": self.config.reconnect_interval,
        }

    def get_stats(self) -> Dict:
        
        return self.stats.to_dict()

    def on_update(self, callback: Callable) -> None:
        
        self._on_update_callbacks.append(callback)

    def invalidate_cache(self) -> None:
        
        self._cache_timestamp = None


ais_client = AISWebSocketClient()
