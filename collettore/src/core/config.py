
import os
from pathlib import Path
from typing import List, Optional

import yaml
from pydantic import BaseModel, Field


class SourceConfig(BaseModel):
    

    name: str
    url: str
    enabled: bool = True
    priority: int = 1
    reconnect: bool = True
    reconnect_interval: int = 5000
    reconnect_max_attempts: int = 0
    token: Optional[str] = None


class DeduplicationConfig(BaseModel):
    

    enabled: bool = True
    time_window: int = 30
    cache_size: int = 10000
    ttl_multiplier: int = 2


class StateTrackingConfig(BaseModel):
    

    enabled: bool = True
    expire_after: int = 3600
    track_history: bool = False
    max_history_points: int = 100


class AggregationConfig(BaseModel):
    

    deduplication: DeduplicationConfig = DeduplicationConfig()
    state_tracking: StateTrackingConfig = StateTrackingConfig()


class WebSocketOutputConfig(BaseModel):
    

    host: str = "0.0.0.0"
    port: int = 8090
    max_clients: int = 500
    compression: bool = True
    enable_raw_stream: bool = True
    enable_filtered_stream: bool = True


class RedisConfig(BaseModel):
    

    host: str = "localhost"
    port: int = 6379
    db: int = 0
    password: Optional[str] = None
    max_connections: int = 50


class DatabaseConfig(BaseModel):
    

    enabled: bool = False
    path: str = "./data/collettore.db"


class LoggingConfig(BaseModel):
    

    level: str = "info"
    format: str = "json"


class MonitoringConfig(BaseModel):
    

    enabled: bool = True
    stats_interval: int = 30000


class ApiSecurityConfig(BaseModel):
    

    enabled: bool = False
    bearer_token: Optional[str] = None


class RateLimitingConfig(BaseModel):
    

    enabled: bool = True
    default_limit: str = "100/minute"


class CorsConfig(BaseModel):
    

    enabled: bool = True
    allowed_origins: str = "*"
    allow_credentials: bool = True
    allow_methods: str = "GET,POST,DELETE"
    allow_headers: str = "Authorization,Content-Type"
    max_age: int = 600


class KeycloakConfig(BaseModel):
    

    enabled: bool = False
    server_url: str = ""
    realm: str = "collettore"
    client_id: str = "collettore-admin"
    client_secret: Optional[str] = None
    admin_role: str = "collettore-admin"
    skip_ssl_verify: bool = False


class CollettoreConfig(BaseModel):
    

    sources: List[SourceConfig]
    aggregation: AggregationConfig = AggregationConfig()
    output: WebSocketOutputConfig = WebSocketOutputConfig()
    redis: RedisConfig = RedisConfig()
    database: DatabaseConfig = DatabaseConfig()
    logging: LoggingConfig = LoggingConfig()
    monitoring: MonitoringConfig = MonitoringConfig()
    api_security: ApiSecurityConfig = ApiSecurityConfig()
    rate_limiting: RateLimitingConfig = RateLimitingConfig()
    cors: CorsConfig = CorsConfig()
    keycloak: KeycloakConfig = KeycloakConfig()


_config: Optional[CollettoreConfig] = None


def load_config(config_path: str = None) -> CollettoreConfig:
    global _config

    if config_path is None:
        config_path = Path(__file__).parent.parent.parent / "config" / "config.yml"

    with open(config_path, "r") as f:
        config_dict = yaml.safe_load(f)

    config_str = yaml.dump(config_dict)
    config_str = os.path.expandvars(config_str)
    config_dict = yaml.safe_load(config_str)

    _config = CollettoreConfig(**config_dict)
    return _config


def get_config() -> CollettoreConfig:
    global _config

    if _config is None:
        _config = load_config()

    return _config
