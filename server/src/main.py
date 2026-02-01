
import asyncio
from pathlib import Path

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from src.core.config import get_config
from src.core.logger import configure_logging, get_logger
from src.core.security import verify_token, verify_websocket_token_from_header, set_token_manager
from src.core.keycloak_auth import get_client_ip
from src.modules.ais_parser import NMEAParser
from src.modules.database import DatabaseManager
from src.modules.stream_ingestion import SatelliteClient
from src.modules.watchlist import WatchlistAPIClient, WatchlistManager
from src.modules.websocket import WebSocketServer
from src.modules.admin.token_manager import TokenManager
from src.modules.admin.audit_logger import AuditLogger
from src.modules.admin.admin_api import create_admin_router

load_dotenv()

logger = get_logger(module="main")


class DarkFleetServer:

    def __init__(self):
        
        self.config = None
        self.db_manager: DatabaseManager = None
        self.nmea_parser: NMEAParser = None
        self.satellite_client: SatelliteClient = None
        self.watchlist_api_client: WatchlistAPIClient = None
        self.watchlist_manager: WatchlistManager = None
        self.websocket_server: WebSocketServer = None
        self.token_manager: TokenManager = None
        self.audit_logger: AuditLogger = None

        self.app = FastAPI(title="DarkFleet Server", version="1.0.0")

        self.stats = {
            'messages_processed': 0,
            'messages_matched': 0,
            'unique_vessels_matched': set(),
        }

        self.shutdown_requested = False

    async def initialize(self) -> None:
        
        logger.info("Initializing DarkFleet server")

        self.config = get_config()

        configure_logging(
            level=self.config.logging.level,
            format_type=self.config.logging.format,
        )

        logger.info("Configuration loaded")

        self.db_manager = DatabaseManager(
            db_path=self.config.database.path,
            journal_mode=self.config.database.journal_mode,
            synchronous=self.config.database.synchronous,
            cache_size=self.config.database.cache_size,
            mmap_size=self.config.database.mmap_size,
        )
        await self.db_manager.connect()

        self.token_manager = TokenManager(self.db_manager)
        self.audit_logger = AuditLogger(self.db_manager)

        set_token_manager(self.token_manager)

        self.nmea_parser = NMEAParser()

        if self.config.watchlist.enabled:
            self.watchlist_api_client = WatchlistAPIClient(
                base_url=self.config.watchlist.api.base_url,
                vessels_endpoint=self.config.watchlist.api.vessels_endpoint,
                lists_endpoint=self.config.watchlist.api.lists_endpoint,
                auth_type=self.config.watchlist.api.auth.type,
                auth_token=self.config.watchlist.api.auth.token,
                timeout=self.config.watchlist.api.timeout,
                retry_attempts=self.config.watchlist.api.retry_attempts,
                retry_delay=self.config.watchlist.api.retry_delay,
            )

            self.watchlist_manager = WatchlistManager(
                api_client=self.watchlist_api_client,
                db_manager=self.db_manager,
                sync_mode=self.config.watchlist.sync_mode,
                sync_interval=self.config.watchlist.sync_interval,
            )

            await self.watchlist_manager.load_from_database()

            stats = self.watchlist_manager.get_stats()
            if stats['vessels_count'] == 0:
                logger.info("Watchlist cache empty, syncing from API")
                await self.watchlist_manager.sync_from_api()

            if self.config.watchlist.sync_mode == "scheduled":
                await self.watchlist_manager.start_scheduled_sync()

        self.websocket_server = WebSocketServer(
            max_clients=self.config.websocket.max_clients,
            max_clients_geo=self.config.websocket.max_clients_geo,
        )

        self.satellite_client = SatelliteClient(
            host=self.config.satellite.host,
            port=self.config.satellite.port,
            reconnect=self.config.satellite.reconnect,
            reconnect_interval=self.config.satellite.reconnect_interval,
            reconnect_max_attempts=self.config.satellite.reconnect_max_attempts,
        )

        self.satellite_client.on_message = self._on_satellite_message

        logger.info("All components initialized")

    def _on_satellite_message(self, nmea_sentence: str) -> None:
        message = self.nmea_parser.parse(nmea_sentence)

        if not message:
            return

        asyncio.create_task(self._process_message(message))

    async def _process_message(self, message: dict) -> None:
        self.stats['messages_processed'] += 1

        match = None
        if self.watchlist_manager:
            match = self.watchlist_manager.check_message(message)

            if match:
                self.stats['messages_matched'] += 1
                mmsi = message.get('mmsi')
                if mmsi:
                    self.stats['unique_vessels_matched'].add(mmsi)

                await self._save_detection(message, match)

        await self.websocket_server.broadcast_track_update(message, match)

    async def _save_detection(self, message: dict, match: dict) -> None:
        try:
            detection = {
                'mmsi': message.get('mmsi'),
                'imo': message.get('imo'),
                'latitude': message.get('latitude'),
                'longitude': message.get('longitude'),
                'raw_data': message,
            }

            await self.db_manager.upsert_detection(detection)
        except Exception as e:
            logger.warning("Failed to save detection", error=str(e), mmsi=message.get('mmsi'))

    async def start(self) -> None:
        
        logger.info("Starting DarkFleet server")

        asyncio.create_task(self.satellite_client.start())

        if self.config.monitoring.enabled:
            asyncio.create_task(self._stats_loop())

        logger.info("DarkFleet server started")

    async def _stats_loop(self) -> None:
        
        interval = self.config.monitoring.stats_interval / 1000.0

        while not self.shutdown_requested:
            await asyncio.sleep(interval)

            sat_stats = self.satellite_client.get_stats()
            parser_stats = self.nmea_parser.get_stats()
            ws_stats = self.websocket_server.get_stats()
            db_stats = await self.db_manager.get_stats()

            wl_stats = {}
            if self.watchlist_manager:
                wl_stats = self.watchlist_manager.get_stats()

            logger.info(
                "Server statistics",
                satellite=sat_stats,
                parser=parser_stats,
                watchlist=wl_stats,
                websocket=ws_stats,
                database=db_stats,
                processing=self.stats,
            )

    async def shutdown(self) -> None:
        
        logger.info("Shutting down DarkFleet server")
        self.shutdown_requested = True

        if self.satellite_client:
            await self.satellite_client.stop()

        if self.watchlist_manager:
            await self.watchlist_manager.stop_scheduled_sync()

        if self.watchlist_api_client:
            await self.watchlist_api_client.close()

        if self.db_manager:
            await self.db_manager.close()

        logger.info("DarkFleet server stopped")



darkfleet_server: DarkFleetServer = None


async def lifespan(app: FastAPI):
    
    global darkfleet_server

    darkfleet_server = DarkFleetServer()
    await darkfleet_server.initialize()
    await darkfleet_server.start()

    if darkfleet_server.config.keycloak and darkfleet_server.config.keycloak.enabled:
        admin_router = create_admin_router(
            darkfleet_server.token_manager,
            darkfleet_server.audit_logger,
        )
        app.include_router(admin_router)
        logger.info("Admin panel enabled with Keycloak authentication")

    yield

    await darkfleet_server.shutdown()


app = FastAPI(title="DarkFleet Server", version="1.0.0", lifespan=lifespan)


def setup_cors_middleware(app: FastAPI) -> None:
    config = get_config()

    if not hasattr(config, 'cors') or not config.cors or not config.cors.enabled:
        logger.info("CORS middleware disabled")
        return

    origins_str = config.cors.allowed_origins or ""
    if origins_str == "*":
        allowed_origins = ["*"]
        logger.warning("CORS configured with wildcard '*' - this is insecure for production!")
    else:
        allowed_origins = [origin.strip() for origin in origins_str.split(",") if origin.strip()]

    if not allowed_origins:
        logger.warning("No CORS origins configured, skipping CORS middleware")
        return

    methods_str = getattr(config.cors, 'allow_methods', "GET,POST,DELETE")
    headers_str = getattr(config.cors, 'allow_headers', "Authorization,Content-Type")

    allow_methods = [m.strip() for m in methods_str.split(",") if m.strip()]
    allow_headers = [h.strip() for h in headers_str.split(",") if h.strip()]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=getattr(config.cors, 'allow_credentials', True),
        allow_methods=allow_methods,
        allow_headers=allow_headers,
        max_age=getattr(config.cors, 'max_age', 600),
    )

    logger.info("CORS middleware configured", origins=allowed_origins)


setup_cors_middleware(app)

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)



@app.get("/")
async def root():
    
    config = get_config()
    endpoints = {
        "dashboard": "/dashboard",
        "health": "/health",
        "stats": "/api/stats",
        "watchlist_sync": "/api/watchlist/sync (POST)",
        "websocket_all": "/ws (all AIS messages)",
        "websocket_watchlist": "/ws/watchlist (only watchlist matches)"
    }

    if config.keycloak and config.keycloak.enabled:
        endpoints["admin"] = "/admin (Keycloak protected - token management & server restart)"

    return {
        "app": "DarkFleet Server",
        "version": "1.0.0",
        "status": "running",
        "endpoints": endpoints
    }


@app.get("/health")
async def health():
    
    return {
        "status": "healthy",
        "satellite": darkfleet_server.satellite_client.get_stats() if darkfleet_server else {},
        "websocket": darkfleet_server.websocket_server.get_stats() if darkfleet_server else {},
    }


async def _get_stats_data():
    
    if not darkfleet_server:
        return {"error": "Server not initialized"}

    satellite_stats = darkfleet_server.satellite_client.get_stats() if darkfleet_server.satellite_client else {}
    parser_stats = darkfleet_server.nmea_parser.get_stats() if darkfleet_server.nmea_parser else {}
    websocket_stats = darkfleet_server.websocket_server.get_stats() if darkfleet_server.websocket_server else {}
    db_stats = await darkfleet_server.db_manager.get_stats() if darkfleet_server.db_manager else {}

    watchlist_stats = {}
    if darkfleet_server.watchlist_manager:
        watchlist_stats = darkfleet_server.watchlist_manager.get_stats()

    processing_stats = {
        'messages_processed': darkfleet_server.stats['messages_processed'],
        'messages_matched': darkfleet_server.stats['messages_matched'],
        'unique_vessels_matched': len(darkfleet_server.stats['unique_vessels_matched']),
    }

    return {
        "timestamp": asyncio.get_event_loop().time(),
        "processing": processing_stats,
        "satellite": satellite_stats,
        "parser": parser_stats,
        "websocket": websocket_stats,
        "database": db_stats,
        "watchlist": watchlist_stats,
    }


@app.get("/api/stats")
async def get_stats(_: str = Depends(verify_token)):
    
    return await _get_stats_data()


@app.get("/internal/stats")
@limiter.limit("60/minute")
async def get_internal_stats(request: Request):
    return await _get_stats_data()


@app.post("/internal/watchlist/sync")
@limiter.limit("10/minute")
async def internal_sync_watchlist(request: Request):
    if not darkfleet_server:
        return {"error": "Server not initialized", "success": False}

    if not darkfleet_server.watchlist_manager:
        return {"error": "Watchlist manager not enabled", "success": False}

    try:
        result = await darkfleet_server.watchlist_manager.sync_from_api()
        return {
            "success": True,
            "message": "Watchlist synced successfully",
            "vessels": result.get("vessels", 0),
            "lists": result.get("lists", 0)
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


@app.post("/api/satellite/reconnect")
@limiter.limit("10/minute")
async def reconnect_satellite(request: Request, _: str = Depends(verify_token)):
    
    if not darkfleet_server or not darkfleet_server.satellite_client:
        return {"error": "Satellite client not initialized"}

    try:
        await darkfleet_server.satellite_client.disconnect()
        darkfleet_server.satellite_client.reconnect_attempts = 0
        return {"status": "reconnecting", "message": "Satellite reconnection triggered"}
    except Exception as e:
        return {"error": str(e)}


@app.post("/api/watchlist/sync")
@limiter.limit("10/minute")
async def sync_watchlist(request: Request, _: str = Depends(verify_token)):
    
    if not darkfleet_server:
        return {"error": "Server not initialized", "success": False}

    if not darkfleet_server.watchlist_manager:
        return {"error": "Watchlist manager not enabled", "success": False}

    try:
        result = await darkfleet_server.watchlist_manager.sync_from_api()
        return {
            "success": True,
            "message": "Watchlist synced successfully",
            "vessels": result.get("vessels", 0),
            "lists": result.get("lists", 0)
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


@app.get("/api/detections")
async def get_detections(limit: int = 100, _: str = Depends(verify_token)):
    
    if not darkfleet_server or not darkfleet_server.db_manager:
        return {"error": "Server not initialized"}

    try:
        detections = await darkfleet_server.db_manager.get_recent_detections(limit=limit)
        return {
            "detections": detections,
            "count": len(detections)
        }
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/detections/{mmsi}")
async def get_detection_by_mmsi(mmsi: str, _: str = Depends(verify_token)):
    
    if not darkfleet_server or not darkfleet_server.db_manager:
        return {"error": "Server not initialized"}

    try:
        detection = await darkfleet_server.db_manager.get_detection(mmsi)
        if not detection:
            return {"error": "Detection not found"}
        return detection
    except Exception as e:
        return {"error": str(e)}




@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    
    try:
        await verify_websocket_token_from_header(websocket)
    except HTTPException:
        await websocket.close(code=1008, reason="Unauthorized")
        return

    client_ip = websocket.client.host if websocket.client else "unknown"

    if darkfleet_server and darkfleet_server.websocket_server:
        if darkfleet_server.config.websocket.enable_all_stream:
            await darkfleet_server.websocket_server.handle_client(websocket, client_ip=client_ip)
        else:
            await websocket.close(code=1003, reason="All messages stream is disabled")


@app.websocket("/ws/watchlist")
async def websocket_watchlist_endpoint(websocket: WebSocket):
    
    try:
        await verify_websocket_token_from_header(websocket)
    except HTTPException:
        await websocket.close(code=1008, reason="Unauthorized")
        return

    client_ip = websocket.client.host if websocket.client else "unknown"

    if darkfleet_server and darkfleet_server.websocket_server:
        if darkfleet_server.config.websocket.enable_watchlist_stream:
            await darkfleet_server.websocket_server.handle_watchlist_client(websocket, client_ip=client_ip)
        else:
            await websocket.close(code=1003, reason="Watchlist stream is disabled")


@app.websocket("/ws/geo")
async def websocket_geo_endpoint(
    websocket: WebSocket,
    min_lat: float = Query(..., ge=-90, le=90, description="Minimum latitude"),
    max_lat: float = Query(..., ge=-90, le=90, description="Maximum latitude"),
    min_lon: float = Query(..., ge=-180, le=180, description="Minimum longitude"),
    max_lon: float = Query(..., ge=-180, le=180, description="Maximum longitude"),
):
    try:
        await verify_websocket_token_from_header(websocket)
    except HTTPException:
        await websocket.close(code=1008, reason="Unauthorized")
        return

    if darkfleet_server and darkfleet_server.websocket_server:
        if not darkfleet_server.config.websocket.enable_geo_stream:
            await websocket.close(code=1003, reason="Geographic stream is disabled")
            return

        if min_lat >= max_lat:
            await websocket.close(code=1008, reason="Invalid bounding box: min_lat must be < max_lat")
            return


        client_ip = websocket.client.host if websocket.client else "unknown"

        bounding_box = {
            'min_lat': min_lat,
            'max_lat': max_lat,
            'min_lon': min_lon,
            'max_lon': max_lon,
        }

        await darkfleet_server.websocket_server.handle_geo_client(websocket, bounding_box, client_ip=client_ip)


@app.websocket("/ws/geo/watchlist")
async def websocket_geo_watchlist_endpoint(
    websocket: WebSocket,
    min_lat: float = Query(..., ge=-90, le=90, description="Minimum latitude"),
    max_lat: float = Query(..., ge=-90, le=90, description="Maximum latitude"),
    min_lon: float = Query(..., ge=-180, le=180, description="Minimum longitude"),
    max_lon: float = Query(..., ge=-180, le=180, description="Maximum longitude"),
):
    try:
        await verify_websocket_token_from_header(websocket)
    except HTTPException:
        await websocket.close(code=1008, reason="Unauthorized")
        return

    if darkfleet_server and darkfleet_server.websocket_server:
        if not darkfleet_server.config.websocket.enable_geo_watchlist_stream:
            await websocket.close(code=1003, reason="Geographic + watchlist stream is disabled")
            return

        if min_lat >= max_lat:
            await websocket.close(code=1008, reason="Invalid bounding box: min_lat must be < max_lat")
            return


        client_ip = websocket.client.host if websocket.client else "unknown"

        bounding_box = {
            'min_lat': min_lat,
            'max_lat': max_lat,
            'min_lon': min_lon,
            'max_lon': max_lon,
        }

        await darkfleet_server.websocket_server.handle_geo_watchlist_client(websocket, bounding_box, client_ip=client_ip)


static_path = Path(__file__).parent / "modules" / "config_ui" / "static"
if static_path.exists():
    app.mount("/static", StaticFiles(directory=str(static_path)), name="static")




@app.get("/dashboard")
async def dashboard():
    
    html_path = static_path / "dashboard.html"
    if html_path.exists():
        return FileResponse(html_path)
    return {"error": "Dashboard not found"}



def main():
    
    config = get_config()
    ssl_config = config.websocket.ssl

    uvicorn_kwargs = {
        "host": config.websocket.host,
        "port": config.websocket.port,
        "log_level": "info",
        "access_log": False,
    }

    if ssl_config.enabled and ssl_config.cert and ssl_config.key:
        uvicorn_kwargs["ssl_keyfile"] = ssl_config.key
        uvicorn_kwargs["ssl_certfile"] = ssl_config.cert
        logger.info("SSL enabled", cert=ssl_config.cert, key=ssl_config.key)

    uvicorn.run("src.main:app", **uvicorn_kwargs)


if __name__ == "__main__":
    main()
