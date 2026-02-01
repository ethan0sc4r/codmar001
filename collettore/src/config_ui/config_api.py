
from pathlib import Path
from typing import Any, Dict, List

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.core.logger import get_logger

logger = get_logger(module="config-api")

router = APIRouter(prefix="/api/config", tags=["config"])



class SourceConfigUpdate(BaseModel):
    
    name: str
    url: str
    enabled: bool = True
    priority: int = 1
    reconnect: bool = True
    reconnect_interval: int = 5000
    reconnect_max_attempts: int = 0


class RedisConfigUpdate(BaseModel):
    
    host: str = "localhost"
    port: int = 6379
    db: int = 0
    password: str | None = None


class StreamControlUpdate(BaseModel):
    
    enable_raw_stream: bool = True
    enable_filtered_stream: bool = True


class ConfigUpdate(BaseModel):
    
    sources: List[SourceConfigUpdate] | None = None
    redis: RedisConfigUpdate | None = None
    stream_control: StreamControlUpdate | None = None



def get_config_path() -> Path:
    
    return Path(__file__).parent.parent.parent / "config" / "config.yml"


def load_config_file() -> Dict[str, Any]:
    
    config_path = get_config_path()

    if not config_path.exists():
        raise HTTPException(status_code=500, detail="Configuration file not found")

    with open(config_path, "r") as f:
        return yaml.safe_load(f)


def save_config_file(config: Dict[str, Any]) -> None:
    
    config_path = get_config_path()

    with open(config_path, "w") as f:
        yaml.safe_dump(config, f, default_flow_style=False, sort_keys=False)

    logger.info("Configuration saved", path=str(config_path))


def sanitize_config(config: Dict[str, Any]) -> Dict[str, Any]:
    
    sanitized = config.copy()

    if "redis" in sanitized and "password" in sanitized["redis"]:
        if sanitized["redis"]["password"]:
            sanitized["redis"]["password"] = "********"

    return sanitized



@router.get("")
async def get_config():
    
    try:
        config = load_config_file()
        return {"success": True, "config": sanitize_config(config)}

    except Exception as e:
        logger.error("Failed to load config", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("")
async def update_config(update: ConfigUpdate):
    
    try:
        config = load_config_file()

        if update.sources is not None:
            config["sources"] = [source.dict() for source in update.sources]
            logger.info("Sources updated", count=len(update.sources))

        if update.redis is not None:
            config["redis"] = update.redis.dict()
            logger.info("Redis config updated")

        if update.stream_control is not None:
            if "output" not in config:
                config["output"] = {}

            config["output"]["enable_raw_stream"] = update.stream_control.enable_raw_stream
            config["output"]["enable_filtered_stream"] = update.stream_control.enable_filtered_stream
            logger.info("Stream control updated")

        save_config_file(config)

        return {
            "success": True,
            "message": "Configuration updated successfully. Restart required.",
            "config": sanitize_config(config),
        }

    except Exception as e:
        logger.error("Failed to update config", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sources/add")
async def add_source(source: SourceConfigUpdate):
    
    try:
        config = load_config_file()

        existing_names = [s["name"] for s in config.get("sources", [])]
        if source.name in existing_names:
            raise HTTPException(status_code=400, detail=f"Source '{source.name}' already exists")

        if "sources" not in config:
            config["sources"] = []

        config["sources"].append(source.dict())

        save_config_file(config)

        return {
            "success": True,
            "message": f"Source '{source.name}' added successfully",
            "source": source.dict(),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to add source", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/sources/{source_name}")
async def remove_source(source_name: str):
    
    try:
        config = load_config_file()

        sources = config.get("sources", [])
        original_count = len(sources)

        sources = [s for s in sources if s["name"] != source_name]

        if len(sources) == original_count:
            raise HTTPException(status_code=404, detail=f"Source '{source_name}' not found")

        config["sources"] = sources

        save_config_file(config)

        return {
            "success": True,
            "message": f"Source '{source_name}' removed successfully",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to remove source", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sources/{source_name}/toggle")
async def toggle_source(source_name: str):
    
    try:
        config = load_config_file()

        sources = config.get("sources", [])
        found = False

        for source in sources:
            if source["name"] == source_name:
                source["enabled"] = not source.get("enabled", True)
                found = True
                break

        if not found:
            raise HTTPException(status_code=404, detail=f"Source '{source_name}' not found")

        config["sources"] = sources

        save_config_file(config)

        return {
            "success": True,
            "message": f"Source '{source_name}' toggled",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to toggle source", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/test-redis")
async def test_redis_connection(redis_config: RedisConfigUpdate):
    
    try:
        import redis

        r = redis.Redis(
            host=redis_config.host,
            port=redis_config.port,
            db=redis_config.db,
            password=redis_config.password,
            socket_connect_timeout=5,
        )

        r.ping()

        return {
            "success": True,
            "message": "Redis connection successful",
            "host": redis_config.host,
            "port": redis_config.port,
        }

    except Exception as e:
        logger.error("Redis test failed", error=str(e))
        return {
            "success": False,
            "error": str(e),
        }


@router.post("/restart")
async def restart_server():
    
    import os
    import sys
    import asyncio

    try:
        logger.info("Server restart requested via API")

        async def delayed_restart():
            await asyncio.sleep(1)
            logger.info("Restarting server...")
            os.execv(sys.executable, ['python'] + sys.argv)

        asyncio.create_task(delayed_restart())

        return {
            "success": True,
            "message": "Server restart initiated. Reconnecting in a few seconds...",
        }

    except Exception as e:
        logger.error("Failed to restart server", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))
