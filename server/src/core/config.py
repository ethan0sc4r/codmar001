
import os
import re
from pathlib import Path
from typing import Any, Dict, Optional

import yaml
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings


class SatelliteConfig(BaseModel):
    
    host: str = Field(..., description="Satellite provider hostname")
    port: int = Field(..., ge=1, le=65535, description="TCP port")
    reconnect: bool = Field(True, description="Enable auto-reconnect")
    reconnect_interval: int = Field(5000, description="Reconnect interval (ms)")
    reconnect_max_attempts: int = Field(0, description="Max reconnect attempts (0=infinite)")


class WatchlistAuthConfig(BaseModel):
    
    type: str = Field("none", description="Auth type: none, bearer, apikey, basic")
    token: Optional[str] = Field(None, description="Auth token/key")


class WatchlistAPIConfig(BaseModel):
    
    base_url: str = Field(..., description="Base URL of watchlist API")
    vessels_endpoint: str = Field("/api/vessels", description="Vessels endpoint")
    lists_endpoint: str = Field("/api/lists", description="Lists endpoint")
    auth: WatchlistAuthConfig = Field(default_factory=WatchlistAuthConfig)
    timeout: int = Field(10000, description="Request timeout (ms)")
    retry_attempts: int = Field(3, description="Number of retry attempts")
    retry_delay: int = Field(1000, description="Delay between retries (ms)")


class WatchlistConfig(BaseModel):
    
    enabled: bool = Field(True)
    api: WatchlistAPIConfig
    sync_mode: str = Field("manual", description="manual or scheduled")
    sync_interval: int = Field(3600000, description="Sync interval (ms)")


class WebSocketSSLConfig(BaseModel):
    
    enabled: bool = Field(False)
    cert: Optional[str] = Field(None, description="SSL certificate path")
    key: Optional[str] = Field(None, description="SSL private key path")


class WebSocketConfig(BaseModel):
    
    host: str = Field("0.0.0.0")
    port: int = Field(8080, ge=1, le=65535)
    ssl: WebSocketSSLConfig = Field(default_factory=WebSocketSSLConfig)
    max_clients: int = Field(100)
    max_clients_geo: Optional[int] = Field(None, description="Max clients for geo pools (None = unlimited)")
    compression: bool = Field(True)
    heartbeat_interval: int = Field(30000, description="Heartbeat interval (ms)")
    heartbeat_timeout: int = Field(60000, description="Heartbeat timeout (ms)")
    enable_all_stream: bool = Field(True, description="Enable /ws endpoint (all messages)")
    enable_watchlist_stream: bool = Field(True, description="Enable /ws/watchlist endpoint (only matches)")
    enable_geo_stream: bool = Field(True, description="Enable /ws/geo endpoint (geographic filtering)")
    enable_geo_watchlist_stream: bool = Field(True, description="Enable /ws/geo/watchlist endpoint (geo + watchlist)")


class DatabaseConfig(BaseModel):
    
    path: str = Field("./data/darkfleet.db")
    journal_mode: str = Field("WAL")
    synchronous: str = Field("NORMAL")
    cache_size: int = Field(-64000, description="Cache size in KB (negative)")
    mmap_size: int = Field(268435456, description="Memory-mapped I/O size")


class LoggingConfig(BaseModel):
    
    level: str = Field("INFO", description="Log level: TRACE, DEBUG, INFO, WARN, ERROR")
    format: str = Field("json", description="Log format: json or pretty")


class MonitoringConfig(BaseModel):
    
    enabled: bool = Field(True)
    health_check: bool = Field(True)
    stats_interval: int = Field(30000, description="Stats logging interval (ms)")


class APISecurityConfig(BaseModel):
    
    enabled: bool = Field(True, description="Enable Bearer token authentication")
    bearer_token: Optional[str] = Field(None, description="Bearer token for API access")


class RateLimitConfig(BaseModel):
    
    enabled: bool = Field(True, description="Enable rate limiting")
    default_limit: str = Field("100/minute", description="Default rate limit")
    restart_limit: str = Field("1/minute", description="Rate limit for server restart")
    sync_limit: str = Field("10/minute", description="Rate limit for watchlist sync")


class CorsConfig(BaseModel):
    
    enabled: bool = Field(True, description="Enable CORS middleware")
    allowed_origins: str = Field("*", description="Comma-separated list of allowed origins (use * for all - set specific origins in production)")
    allow_credentials: bool = Field(True, description="Allow credentials (cookies, authorization headers)")
    allow_methods: str = Field("GET,POST,DELETE", description="Comma-separated list of allowed HTTP methods")
    allow_headers: str = Field("Authorization,Content-Type", description="Comma-separated list of allowed headers")
    max_age: int = Field(600, description="Max age in seconds for preflight cache")


class KeycloakConfig(BaseModel):
    
    enabled: bool = Field(False, description="Enable Keycloak authentication for admin")
    server_url: Optional[str] = Field(None, description="Keycloak server URL (e.g., https://keycloak.example.com)")
    realm: str = Field("darkfleet", description="Keycloak realm name")
    client_id: str = Field("darkfleet-admin", description="Keycloak client ID")
    client_secret: Optional[str] = Field(None, description="Keycloak client secret (for confidential clients)")
    admin_role: str = Field("darkfleet-admin", description="Required role for admin access")
    skip_ssl_verify: bool = Field(False, description="Skip SSL certificate verification (not recommended for production)")


class AppConfig(BaseModel):
    
    satellite: SatelliteConfig
    watchlist: WatchlistConfig
    websocket: WebSocketConfig
    database: DatabaseConfig
    logging: LoggingConfig
    monitoring: MonitoringConfig
    api_security: APISecurityConfig = Field(default_factory=APISecurityConfig)
    rate_limiting: RateLimitConfig = Field(default_factory=RateLimitConfig)
    cors: Optional[CorsConfig] = Field(default_factory=CorsConfig, description="CORS configuration")
    keycloak: Optional[KeycloakConfig] = Field(default=None, description="Keycloak admin authentication config")


class ConfigManager:

    _instance: Optional['ConfigManager'] = None
    _config: Optional[AppConfig] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if self._config is None:
            self.load()

    def load(self, config_path: Optional[str] = None) -> None:
        
        if config_path is None:
            config_path = os.getenv('CONFIG_PATH')
            if config_path is None:
                project_root = Path(__file__).parent.parent.parent
                config_path = str(project_root / "config" / "config.yml")

        config_file = Path(config_path)

        if config_file.exists():
            with open(config_file, 'r', encoding='utf-8') as f:
                raw_config = yaml.safe_load(f)

            raw_config = self._interpolate_env_vars(raw_config)

            self._config = AppConfig(**raw_config)
        else:
            print(f"Config file not found at {config_path}, using environment variables")
            self._config = self._load_from_env()

    def _load_from_env(self) -> AppConfig:
        
        return AppConfig(
            satellite=SatelliteConfig(
                host=os.getenv('SATELLITE_HOST', 'localhost'),
                port=int(os.getenv('SATELLITE_PORT', '5631')),
                reconnect=os.getenv('SATELLITE_RECONNECT', 'false').lower() == 'true',
                reconnect_interval=int(os.getenv('SATELLITE_RECONNECT_INTERVAL', '5000')),
                reconnect_max_attempts=int(os.getenv('SATELLITE_RECONNECT_MAX_ATTEMPTS', '10'))
            ),
            watchlist=WatchlistConfig(
                enabled=os.getenv('WATCHLIST_ENABLED', 'true').lower() == 'true',
                api=WatchlistAPIConfig(
                    base_url=os.getenv('WATCHLIST_API_BASE_URL', 'http://localhost:8081'),
                    vessels_endpoint=os.getenv('WATCHLIST_API_VESSELS_ENDPOINT', '/vessels'),
                    lists_endpoint=os.getenv('WATCHLIST_API_LISTS_ENDPOINT', '/lists'),
                    auth=WatchlistAuthConfig(
                        type=os.getenv('WATCHLIST_AUTH_TYPE', 'none'),
                        token=os.getenv('WATCHLIST_AUTH_TOKEN')
                    ),
                    timeout=int(os.getenv('WATCHLIST_API_TIMEOUT', '10000')),
                    retry_attempts=int(os.getenv('WATCHLIST_API_RETRY_ATTEMPTS', '3')),
                    retry_delay=int(os.getenv('WATCHLIST_API_RETRY_DELAY', '1000'))
                ),
                sync_mode=os.getenv('WATCHLIST_SYNC_MODE', 'manual'),
                sync_interval=int(os.getenv('WATCHLIST_SYNC_INTERVAL', '3600000'))
            ),
            websocket=WebSocketConfig(
                host=os.getenv('WEBSOCKET_HOST', '0.0.0.0'),
                port=int(os.getenv('WEBSOCKET_PORT', '8080')),
                ssl=WebSocketSSLConfig(
                    enabled=os.getenv('WEBSOCKET_SSL_ENABLED', 'false').lower() == 'true',
                    cert=os.getenv('WEBSOCKET_SSL_CERT'),
                    key=os.getenv('WEBSOCKET_SSL_KEY')
                ),
                max_clients=int(os.getenv('WEBSOCKET_MAX_CLIENTS', '1000')),
                compression=os.getenv('WEBSOCKET_COMPRESSION', 'true').lower() == 'true',
                heartbeat_interval=int(os.getenv('WEBSOCKET_HEARTBEAT_INTERVAL', '30000')),
                heartbeat_timeout=int(os.getenv('WEBSOCKET_HEARTBEAT_TIMEOUT', '5000')),
                enable_all_stream=os.getenv('WEBSOCKET_ENABLE_ALL_STREAM', 'true').lower() == 'true',
                enable_watchlist_stream=os.getenv('WEBSOCKET_ENABLE_WATCHLIST_STREAM', 'true').lower() == 'true'
            ),
            database=DatabaseConfig(
                path=os.getenv('DATABASE_PATH', './data/darkfleet.db'),
                journal_mode=os.getenv('DATABASE_JOURNAL_MODE', 'WAL'),
                synchronous=os.getenv('DATABASE_SYNCHRONOUS', 'OFF'),
                cache_size=int(os.getenv('DATABASE_CACHE_SIZE', '-64000')),
                mmap_size=int(os.getenv('DATABASE_MMAP_SIZE', '268435456'))
            ),
            logging=LoggingConfig(
                level=os.getenv('LOG_LEVEL', 'info').upper(),
                format=os.getenv('LOG_FORMAT', 'json')
            ),
            monitoring=MonitoringConfig(
                enabled=os.getenv('MONITORING_ENABLED', 'true').lower() == 'true',
                health_check=os.getenv('MONITORING_HEALTH_CHECK', 'false').lower() == 'true',
                stats_interval=int(os.getenv('MONITORING_STATS_INTERVAL', '30000'))
            ),
            api_security=APISecurityConfig(
                enabled=os.getenv('API_SECURITY_ENABLED', 'true').lower() == 'true',
                bearer_token=os.getenv('API_BEARER_TOKEN')
            ),
            rate_limiting=RateLimitConfig(
                enabled=os.getenv('RATE_LIMITING_ENABLED', 'true').lower() == 'true',
                default_limit=os.getenv('RATE_LIMITING_DEFAULT', '100/minute'),
                restart_limit=os.getenv('RATE_LIMITING_RESTART', '1/minute'),
                sync_limit=os.getenv('RATE_LIMITING_SYNC', '10/minute')
            ),
            cors=CorsConfig(
                enabled=os.getenv('CORS_ENABLED', 'true').lower() == 'true',
                allowed_origins=os.getenv('CORS_ALLOWED_ORIGINS', '*'),
                allow_credentials=os.getenv('CORS_ALLOW_CREDENTIALS', 'true').lower() == 'true',
                allow_methods=os.getenv('CORS_ALLOW_METHODS', 'GET,POST,DELETE'),
                allow_headers=os.getenv('CORS_ALLOW_HEADERS', 'Authorization,Content-Type'),
                max_age=int(os.getenv('CORS_MAX_AGE', '600'))
            ),
            keycloak=KeycloakConfig(
                enabled=os.getenv('KEYCLOAK_ENABLED', 'false').lower() == 'true',
                server_url=os.getenv('KEYCLOAK_SERVER_URL'),
                realm=os.getenv('KEYCLOAK_REALM', 'darkfleet'),
                client_id=os.getenv('KEYCLOAK_CLIENT_ID', 'darkfleet-admin'),
                client_secret=os.getenv('KEYCLOAK_CLIENT_SECRET'),
                admin_role=os.getenv('KEYCLOAK_ADMIN_ROLE', 'darkfleet-admin'),
                skip_ssl_verify=os.getenv('KEYCLOAK_SKIP_SSL_VERIFY', 'false').lower() == 'true'
            ) if os.getenv('KEYCLOAK_ENABLED', 'false').lower() == 'true' else None
        )

    def _interpolate_env_vars(self, config: Any) -> Any:
        if isinstance(config, dict):
            return {k: self._interpolate_env_vars(v) for k, v in config.items()}
        elif isinstance(config, list):
            return [self._interpolate_env_vars(item) for item in config]
        elif isinstance(config, str):
            pattern = r'\$\{([A-Z_][A-Z0-9_]*)(?::-([^}]*))?\}'

            def replace_var(match):
                var_name = match.group(1)
                default_value = match.group(2)
                env_value = os.getenv(var_name)
                if env_value is not None:
                    return env_value
                elif default_value is not None:
                    return default_value
                else:
                    return match.group(0)

            return re.sub(pattern, replace_var, config)
        else:
            return config

    @property
    def config(self) -> AppConfig:
        
        if self._config is None:
            self.load()
        return self._config

    def reload(self) -> None:
        
        self.load()

    def to_dict(self) -> Dict[str, Any]:
        
        return self.config.model_dump()

    def sanitize_for_ui(self) -> Dict[str, Any]:
        config_dict = self.to_dict()

        if 'watchlist' in config_dict and 'api' in config_dict['watchlist']:
            auth = config_dict['watchlist']['api'].get('auth', {})
            if auth.get('token'):
                config_dict['watchlist']['api']['auth']['token'] = '***HIDDEN***'

        if 'api_security' in config_dict:
            if config_dict['api_security'].get('bearer_token'):
                config_dict['api_security']['bearer_token'] = '***HIDDEN***'

        if 'keycloak' in config_dict and config_dict['keycloak']:
            if config_dict['keycloak'].get('client_secret'):
                config_dict['keycloak']['client_secret'] = '***HIDDEN***'

        return config_dict


config_manager = ConfigManager()


def get_config() -> AppConfig:
    
    return config_manager.config
