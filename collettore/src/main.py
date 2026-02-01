
import asyncio
import os
import signal
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request, WebSocket, WebSocketException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from src.aggregation.message_processor import MessageProcessor
from src.core.config import get_config
from src.core.logger import configure_logging, get_logger
from src.core.security import verify_websocket_token, set_token_manager
from src.admin.token_manager import TokenManager
from src.admin.audit_logger import AuditLogger
from src.admin.admin_api import create_admin_router
from src.ingestion.source_manager import SourceManager
from src.output.websocket_server import WebSocketOutputServer
from src.storage.redis_cache import RedisCache

logger = get_logger(module="main")

_data_dir = Path("./data")
_data_dir.mkdir(parents=True, exist_ok=True)

token_manager = TokenManager(storage_path=str(_data_dir / "tokens.json"))
audit_logger = AuditLogger(storage_path=str(_data_dir / "audit.json"))

set_token_manager(token_manager)


class CollettoreServer:

    def __init__(self):
        
        self.config = None
        self.source_manager: SourceManager = None
        self.redis_cache: RedisCache = None
        self.output_server: WebSocketOutputServer = None
        self.message_processor: MessageProcessor = None

        self.app = FastAPI(title="DarkFleet Collettore", version="1.0.0")

        self.shutdown_requested = False

    async def initialize(self) -> None:
        
        logger.info("Initializing Collettore server")

        self.config = get_config()

        configure_logging(
            level=self.config.logging.level,
            format_type=self.config.logging.format,
        )

        logger.info("Configuration loaded", sources=len(self.config.sources))

        self.redis_cache = RedisCache(
            host=self.config.redis.host,
            port=self.config.redis.port,
            db=self.config.redis.db,
            password=self.config.redis.password,
            max_connections=self.config.redis.max_connections,
        )

        self.output_server = WebSocketOutputServer(
            max_clients=self.config.output.max_clients,
        )

        self.message_processor = MessageProcessor(
            redis_cache=self.redis_cache,
            output_server=self.output_server,
            enable_deduplication=self.config.aggregation.deduplication.enabled,
            enable_state_tracking=self.config.aggregation.state_tracking.enabled,
            dedup_time_window=self.config.aggregation.deduplication.time_window,
            dedup_ttl_multiplier=self.config.aggregation.deduplication.ttl_multiplier,
            vessel_expire_after=self.config.aggregation.state_tracking.expire_after,
        )

        sources_config = [source.dict() for source in self.config.sources]
        self.source_manager = SourceManager(sources_config)

        self.source_manager.set_message_callback(self._on_source_message)

        logger.info("All components initialized")

    def _on_source_message(self, message: dict, source: str) -> None:
        asyncio.create_task(self.message_processor.process_message(message, source))

    async def start(self) -> None:
        
        logger.info("Starting Collettore server")

        await self.source_manager.start_all()

        if self.config.aggregation.state_tracking.enabled:
            asyncio.create_task(self.message_processor.cleanup_task(interval=300))

        if self.config.monitoring.enabled:
            asyncio.create_task(self._stats_loop())

        logger.info("Collettore server started")

    async def _stats_loop(self) -> None:
        
        interval = self.config.monitoring.stats_interval / 1000.0

        while not self.shutdown_requested:
            await asyncio.sleep(interval)

            source_stats = self.source_manager.get_stats()
            processor_stats = self.message_processor.get_stats()
            output_stats = self.output_server.get_stats()
            redis_stats = self.redis_cache.get_stats()

            logger.info(
                "Collettore statistics",
                sources=source_stats,
                processor=processor_stats,
                output=output_stats,
                redis=redis_stats,
            )

    async def shutdown(self) -> None:
        
        logger.info("Shutting down Collettore server")
        self.shutdown_requested = True

        if self.source_manager:
            await self.source_manager.stop_all()

        logger.info("Collettore server stopped")



collettore_server: CollettoreServer = None
admin_api_instance = None


async def lifespan(app: FastAPI):
    
    global collettore_server, admin_api_instance

    config = get_config()
    logger.info(
        "Token management ready",
        api_security_enabled=config.api_security.enabled,
        keycloak_enabled=config.keycloak.enabled if hasattr(config, 'keycloak') else False,
    )

    collettore_server = CollettoreServer()
    await collettore_server.initialize()
    await collettore_server.start()

    if admin_api_instance:
        admin_api_instance.source_manager = collettore_server.source_manager

    yield

    await collettore_server.shutdown()


app = FastAPI(title="DarkFleet Collettore", version="1.0.0", lifespan=lifespan)


def setup_cors_middleware(app: FastAPI) -> None:
    
    config = get_config()

    if not hasattr(config, 'cors') or not config.cors or not config.cors.enabled:
        logger.info("CORS middleware disabled")
        return

    origins_str = config.cors.allowed_origins or ""
    if origins_str == "*":
        allowed_origins = ["*"]
        logger.warning("CORS configured with wildcard '*' - insecure for production")
    else:
        allowed_origins = [origin.strip() for origin in origins_str.split(",") if origin.strip()]

    if not allowed_origins:
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

from src.admin.admin_api import AdminAPIRouter
admin_api_instance = AdminAPIRouter(token_manager, audit_logger)
app.include_router(admin_api_instance.router)


@app.get("/")
async def root():
    
    return {
        "app": "DarkFleet Collettore",
        "version": "1.0.0",
        "status": "running",
        "endpoints": {
            "admin": "/admin (token management & server restart)",
            "dashboard": "/dashboard",
            "health": "/health",
            "stats": "/api/stats",
            "sources": "/api/sources",
            "vessels": "/api/vessels",
            "websocket_raw": "/ws/raw (pre-pruning, for plugins)",
            "websocket_filtered": "/ws (post-pruning, for clients)"
        }
    }


@app.get("/health")
async def health():
    
    if not collettore_server:
        return {"status": "initializing"}

    return {
        "status": "healthy",
        "sources_connected": collettore_server.source_manager.is_any_connected(),
        "redis_connected": True,
    }


@app.get("/api/stats")
async def get_stats():
    
    if not collettore_server:
        return {"error": "Server not initialized"}

    return {
        "sources": collettore_server.source_manager.get_stats(),
        "processor": collettore_server.message_processor.get_stats(),
        "output": collettore_server.output_server.get_stats(),
        "redis": collettore_server.redis_cache.get_stats(),
    }


@app.get("/api/sources")
async def get_sources():
    
    if not collettore_server:
        return {"error": "Server not initialized"}

    return {
        "sources": collettore_server.source_manager.get_stats(),
    }


@app.get("/api/vessels")
async def get_vessels():
    
    if not collettore_server:
        return {"error": "Server not initialized"}

    active_vessels = collettore_server.redis_cache.get_active_vessels()

    return {
        "count": len(active_vessels),
        "vessels": list(active_vessels)[:100],
    }


@app.get("/api/vessels/{mmsi}")
async def get_vessel(mmsi: str):
    
    if not collettore_server:
        return {"error": "Server not initialized"}

    vessel = collettore_server.redis_cache.get_vessel(mmsi)

    if not vessel:
        return {"error": "Vessel not found"}

    return vessel


@app.websocket("/ws/raw")
async def websocket_raw_endpoint(websocket: WebSocket):
    config = get_config()
    if config.api_security.enabled:
        is_valid = await verify_websocket_token(websocket)
        if not is_valid:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid or missing token")
            return

    if collettore_server and collettore_server.output_server:
        if collettore_server.config.output.enable_raw_stream:
            await collettore_server.output_server.handle_raw_client(websocket)
        else:
            await websocket.close(code=1003, reason="RAW stream is disabled")


@app.websocket("/ws")
async def websocket_filtered_endpoint(websocket: WebSocket):
    config = get_config()
    if config.api_security.enabled:
        is_valid = await verify_websocket_token(websocket)
        if not is_valid:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid or missing token")
            return

    if collettore_server and collettore_server.output_server:
        if collettore_server.config.output.enable_filtered_stream:
            await collettore_server.output_server.handle_filtered_client(websocket)
        else:
            await websocket.close(code=1003, reason="Filtered stream is disabled")



static_path = Path(__file__).parent / "config_ui" / "static"
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
    uvicorn.run(
        "src.main:app",
        host=config.output.host,
        port=config.output.port,
        log_level="info",
        access_log=False,
    )


if __name__ == "__main__":
    main()
