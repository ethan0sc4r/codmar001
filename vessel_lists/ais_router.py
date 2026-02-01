
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from ais_websocket import ais_client

router = APIRouter(tags=["AIS"])


class AISConnectRequest(BaseModel):
    
    host: str
    port: int
    path: Optional[str] = "/ws"
    use_ssl: Optional[bool] = False


class AISConfigResponse(BaseModel):
    
    host: str
    port: int
    path: str
    use_ssl: bool
    ws_url: str
    reconnect: bool
    reconnect_interval: float


@router.get("/status")
async def get_ais_status():
    
    stats = ais_client.get_stats()
    config = ais_client.get_config()
    return {
        "config": config,
        "stats": stats
    }


@router.get("/config")
async def get_ais_config():
    
    return ais_client.get_config()


@router.post("/configure")
async def configure_ais(request: AISConnectRequest):
    
    ais_client.configure(
        host=request.host,
        port=request.port,
        path=request.path or "/ws",
        use_ssl=request.use_ssl or False
    )
    return {
        "message": "Configuration updated",
        "config": ais_client.get_config()
    }


@router.post("/connect")
async def connect_ais(request: Optional[AISConnectRequest] = None):
    if request:
        ais_client.configure(
            host=request.host,
            port=request.port,
            path=request.path or "/ws",
            use_ssl=request.use_ssl or False
        )

    if ais_client.stats.connected:
        return {
            "message": "Already connected",
            "config": ais_client.get_config()
        }

    await ais_client.start()

    return {
        "message": "Connection started",
        "config": ais_client.get_config()
    }


@router.post("/disconnect")
async def disconnect_ais():
    
    await ais_client.stop()
    return {
        "message": "Disconnected",
        "stats": ais_client.get_stats()
    }


@router.get("/stats")
async def get_ais_stats():
    
    return ais_client.get_stats()


@router.post("/refresh-cache")
async def refresh_imo_cache():
    
    ais_client.invalidate_cache()
    return {"message": "Cache invalidated, will refresh on next message"}


@router.get("/updates")
async def get_recent_updates():
    
    stats = ais_client.get_stats()
    return {
        "total_updates": stats["vessels_updated"],
        "recent_updates": stats["recent_updates"]
    }
