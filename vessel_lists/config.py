
import os
from typing import List
from dataclasses import dataclass, field


def get_env_list(key: str, default: str = "") -> List[str]:
    
    value = os.getenv(key, default)
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


@dataclass
class DatabaseConfig:
    
    url: str = field(default_factory=lambda: os.getenv(
        "DATABASE_URL",
        "sqlite:///./data/vessel_lists.db"
    ))
    echo: bool = field(default_factory=lambda: os.getenv("DATABASE_ECHO", "false").lower() == "true")


@dataclass
class CORSConfig:
    

    @property
    def allowed_origins(self) -> List[str]:
        env_value = os.getenv("CORS_ALLOWED_ORIGINS", "")
        if not env_value or env_value.strip() == "*":
            return ["*"]
        return [item.strip() for item in env_value.split(",") if item.strip()]

    allow_credentials: bool = True
    allowed_methods: List[str] = field(default_factory=lambda: ["GET", "POST", "PUT", "DELETE", "OPTIONS"])
    allowed_headers: List[str] = field(default_factory=lambda: ["*"])


@dataclass
class ServerConfig:
    
    host: str = field(default_factory=lambda: os.getenv("SERVER_HOST", "0.0.0.0"))
    port: int = field(default_factory=lambda: int(os.getenv("SERVER_PORT", "8001")))
    debug: bool = field(default_factory=lambda: os.getenv("DEBUG", "false").lower() == "true")


@dataclass
class WebSocketConfig:
    
    host: str = field(default_factory=lambda: os.getenv("AIS_WS_HOST", "localhost"))
    port: int = field(default_factory=lambda: int(os.getenv("AIS_WS_PORT", "3000")))
    path: str = field(default_factory=lambda: os.getenv("AIS_WS_PATH", "/ws"))
    use_ssl: bool = field(default_factory=lambda: os.getenv("AIS_WS_SSL", "false").lower() == "true")
    reconnect: bool = True
    reconnect_interval: float = 5.0
    ping_interval: float = 30.0
    ping_timeout: float = 10.0


@dataclass
class RateLimitConfig:
    
    enabled: bool = field(default_factory=lambda: os.getenv("RATE_LIMIT_ENABLED", "true").lower() == "true")
    requests_per_minute: int = field(default_factory=lambda: int(os.getenv("RATE_LIMIT_RPM", "60")))


@dataclass
class SecurityConfig:
    
    safe_filename_chars: str = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"


@dataclass
class AppConfig:
    
    database: DatabaseConfig = field(default_factory=DatabaseConfig)
    cors: CORSConfig = field(default_factory=CORSConfig)
    server: ServerConfig = field(default_factory=ServerConfig)
    websocket: WebSocketConfig = field(default_factory=WebSocketConfig)
    rate_limit: RateLimitConfig = field(default_factory=RateLimitConfig)
    security: SecurityConfig = field(default_factory=SecurityConfig)


config = AppConfig()
