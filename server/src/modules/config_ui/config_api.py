
from pathlib import Path
from typing import Dict

import yaml
from fastapi import APIRouter, Depends, HTTPException

from src.core.logger import get_logger
from src.core.security import verify_token

logger = get_logger(module="config-api")



router = APIRouter(prefix="/api")


@router.get("/config")
async def get_config(_: str = Depends(verify_token)) -> Dict:
    try:
        config_path = Path("./config/config.yml")

        if not config_path.exists():
            raise HTTPException(status_code=404, detail="Configuration file not found")

        with open(config_path, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f)

        if 'watchlist' in config and 'api' in config['watchlist']:
            auth = config['watchlist']['api'].get('auth', {})
            if auth.get('token'):
                config['watchlist']['api']['auth']['token'] = '***HIDDEN***'

        return config

    except Exception as e:
        logger.error("Failed to get config", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/config")
async def update_config(config: Dict, _: str = Depends(verify_token)) -> Dict:
    try:
        config_path = Path("./config/config.yml")

        config = _transform_config_to_python(config)

        _validate_config(config)

        with open(config_path, 'w', encoding='utf-8') as f:
            yaml.safe_dump(config, f, default_flow_style=False, sort_keys=False)

        logger.info("Configuration updated")

        return {
            "success": True,
            "message": "Configuration updated successfully",
        }

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Failed to update config", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))



def _transform_config_to_python(config: Dict) -> Dict:
    transformed = {}

    if 'satellite' in config:
        sat = config['satellite']
        transformed['satellite'] = {
            'host': sat.get('host', ''),
            'port': sat.get('port', 5000),
        }

        if 'reconnect' in sat:
            if isinstance(sat['reconnect'], dict):
                transformed['satellite']['reconnect'] = sat['reconnect'].get('enabled', True)
                transformed['satellite']['reconnect_interval'] = sat['reconnect'].get('interval_ms', 5000)
                transformed['satellite']['reconnect_max_attempts'] = sat['reconnect'].get('max_attempts', 10)
            else:
                transformed['satellite']['reconnect'] = sat.get('reconnect', True)
                transformed['satellite']['reconnect_interval'] = sat.get('reconnect_interval', 5000)
                transformed['satellite']['reconnect_max_attempts'] = sat.get('reconnect_max_attempts', 10)

    if 'watchlist' in config:
        wl = config['watchlist']
        transformed['watchlist'] = {
            'enabled': wl.get('enabled', True) if 'enabled' in wl else True,
            'api': {},
            'sync_mode': 'manual',
            'sync_interval': 3600000,
        }

        if 'api' in wl:
            api = wl['api']
            transformed['watchlist']['api'] = {
                'base_url': api.get('base_url', ''),
                'vessels_endpoint': api.get('endpoints', {}).get('vessels', '/api/vessels') if 'endpoints' in api else api.get('vessels_endpoint', '/api/vessels'),
                'lists_endpoint': api.get('endpoints', {}).get('lists', '/api/lists') if 'endpoints' in api else api.get('lists_endpoint', '/api/lists'),
                'auth': {
                    'type': api.get('auth', {}).get('type', 'none'),
                    'token': api.get('auth', {}).get('token'),
                },
                'timeout': api.get('timeout_ms', 10000),
                'retry_attempts': api.get('retry', {}).get('max_retries', 3) if 'retry' in api else api.get('retry_attempts', 3),
                'retry_delay': api.get('retry', {}).get('delay_ms', 1000) if 'retry' in api else api.get('retry_delay', 1000),
            }

        if 'sync' in wl:
            transformed['watchlist']['sync_mode'] = wl['sync'].get('mode', 'manual')

    if 'websocket' in config:
        ws = config['websocket']
        transformed['websocket'] = {
            'host': ws.get('host', '0.0.0.0'),
            'port': ws.get('port', 8080),
            'ssl': {
                'enabled': ws.get('ssl', {}).get('enabled', False) if 'ssl' in ws else False,
                'cert': ws.get('ssl', {}).get('cert_path', '') if 'ssl' in ws else ws.get('cert', ''),
                'key': ws.get('ssl', {}).get('key_path', '') if 'ssl' in ws else ws.get('key', ''),
            },
            'max_clients': ws.get('max_clients', 1000),
            'compression': ws.get('compression', True),
            'heartbeat_interval': ws.get('heartbeat', {}).get('interval_ms', 30000) if 'heartbeat' in ws else ws.get('heartbeat_interval', 30000),
            'heartbeat_timeout': ws.get('heartbeat', {}).get('timeout_ms', 60000) if 'heartbeat' in ws else ws.get('heartbeat_timeout', 60000),
            'enable_all_stream': ws.get('enable_all_stream', True),
            'enable_watchlist_stream': ws.get('enable_watchlist_stream', True),
        }

    if 'database' in config:
        db = config['database']
        pragmas = db.get('pragmas', {})
        transformed['database'] = {
            'path': db.get('path', './data/darkfleet.db'),
            'journal_mode': pragmas.get('journal_mode', 'WAL'),
            'synchronous': pragmas.get('synchronous', 'NORMAL'),
            'cache_size': pragmas.get('cache_size', -64000),
            'mmap_size': pragmas.get('mmap_size', 268435456),
        }

    if 'logging' in config:
        log = config['logging']
        transformed['logging'] = {
            'level': log.get('level', 'INFO') or 'INFO',
            'format': log.get('format', 'json'),
        }

    if 'monitoring' in config:
        mon = config['monitoring']
        transformed['monitoring'] = {
            'enabled': mon.get('enabled', True),
            'health_check': mon.get('health_check', {}).get('enabled', True) if isinstance(mon.get('health_check'), dict) else mon.get('health_check', True),
            'stats_interval': 30000,
        }

    return transformed



def _validate_config(config: Dict) -> None:
    if 'satellite' not in config:
        raise ValueError("Satellite configuration is required")

    sat = config['satellite']
    if not sat.get('host'):
        raise ValueError("Satellite host is required")
    if not sat.get('port'):
        raise ValueError("Satellite port is required")
    if sat['port'] < 1 or sat['port'] > 65535:
        raise ValueError("Satellite port must be between 1 and 65535")

    if 'watchlist' in config and config['watchlist'].get('enabled'):
        wl = config['watchlist']
        if 'api' not in wl:
            raise ValueError("Watchlist API configuration is required")

        api = wl['api']
        if not api.get('base_url'):
            raise ValueError("Watchlist API base URL is required")

    if 'websocket' in config:
        ws = config['websocket']
        if ws.get('port'):
            if ws['port'] < 1 or ws['port'] > 65535:
                raise ValueError("WebSocket port must be between 1 and 65535")
