
import asyncio
from typing import Dict, List, Optional, Callable

from src.core.logger import LoggerMixin
from src.modules.database import DatabaseManager
from src.modules.watchlist.api_client import WatchlistAPIClient


class WatchlistManager(LoggerMixin):

    def __init__(
        self,
        api_client: WatchlistAPIClient,
        db_manager: DatabaseManager,
        sync_mode: str = "manual",
        sync_interval: int = 3600000,
    ):
        self._logger_context = {'component': 'watchlist-manager'}
        self.api_client = api_client
        self.db_manager = db_manager
        self.sync_mode = sync_mode
        self.sync_interval = sync_interval / 1000.0

        self.mmsi_cache: Dict[str, str] = {}

        self.imo_cache: Dict[str, str] = {}

        self.lists_cache: Dict[str, Dict] = {}

        self.sync_task: Optional[asyncio.Task] = None

        self.last_sync_time: Optional[float] = None

        self.on_match: Optional[Callable[[Dict], None]] = None

        self.push_updates_enabled: bool = True

    async def load_from_database(self) -> None:
        
        try:
            vessels = await self.db_manager.get_all_vessels()

            self.mmsi_cache = {
                v['mmsi']: v['list_id']
                for v in vessels
                if v.get('mmsi') and v.get('list_id')
            }

            self.imo_cache = {
                v['imo']: v['list_id']
                for v in vessels
                if v.get('imo') and v.get('list_id')
            }

            lists = await self.db_manager.get_all_lists()
            self.lists_cache = {
                l['list_id']: {
                    'list_name': l.get('list_name'),
                    'color': l.get('color'),
                }
                for l in lists
            }

            self.logger.info(
                "Watchlist loaded from database",
                mmsi_entries=len(self.mmsi_cache),
                imo_entries=len(self.imo_cache),
                lists=len(self.lists_cache),
            )

        except Exception as e:
            self.logger.error("Failed to load watchlist from database", error=str(e))
            raise

    async def sync_from_api(self) -> Dict:
        try:
            self.logger.info("Syncing watchlist from API")

            vessels, lists = await self.api_client.fetch_all()

            normalized_vessels = []
            for v in vessels:
                normalized = {
                    'mmsi': v.get('mmsi'),
                    'imo': v.get('imo'),
                    'list_id': v.get('list_id') or v.get('listId'),
                }
                normalized_vessels.append(normalized)

            normalized_lists = []
            for l in lists:
                list_id = l.get('list_id') or l.get('listId') or l.get('id')
                normalized = {
                    'list_id': list_id,
                    'list_name': l.get('list_name') or l.get('listName') or l.get('name'),
                    'color': l.get('color'),
                }
                normalized_lists.append(normalized)

            await self.db_manager.upsert_lists(normalized_lists)
            await self.db_manager.upsert_vessels(normalized_vessels)

            self.mmsi_cache = {
                v['mmsi']: v['list_id']
                for v in normalized_vessels
                if v.get('mmsi') and v.get('list_id')
            }

            self.imo_cache = {
                v['imo']: v['list_id']
                for v in normalized_vessels
                if v.get('imo') and v.get('list_id')
            }

            self.lists_cache = {
                l['list_id']: {
                    'list_name': l.get('list_name'),
                    'color': l.get('color'),
                }
                for l in normalized_lists
                if l.get('list_id')
            }

            import time
            self.last_sync_time = time.time()

            self.logger.info(
                "Watchlist synced",
                vessels=len(vessels),
                lists=len(lists),
            )

            return {
                "vessels": len(vessels),
                "lists": len(lists),
                "success": True,
            }

        except Exception as e:
            self.logger.error("Watchlist sync failed", error=str(e))
            return {
                "vessels": 0,
                "lists": 0,
                "success": False,
                "error": str(e),
            }

    async def start_scheduled_sync(self) -> None:
        
        if self.sync_mode != "scheduled":
            return

        self.logger.info("Starting scheduled sync", interval_seconds=self.sync_interval)

        async def sync_loop():
            while True:
                await asyncio.sleep(self.sync_interval)
                await self.sync_from_api()

        self.sync_task = asyncio.create_task(sync_loop())

    async def stop_scheduled_sync(self) -> None:
        
        if self.sync_task:
            self.sync_task.cancel()
            try:
                await self.sync_task
            except asyncio.CancelledError:
                pass
            self.sync_task = None

    def is_watchlisted(self, mmsi: str = None, imo: str = None) -> bool:
        if mmsi and mmsi in self.mmsi_cache:
            return True
        if imo and imo in self.imo_cache:
            return True
        return False

    def get_match(self, mmsi: str) -> Optional[Dict]:
        list_id = self.mmsi_cache.get(mmsi)

        if not list_id:
            return None

        list_info = self.lists_cache.get(list_id, {})

        return {
            "mmsi": mmsi,
            "list_id": list_id,
            "list_name": list_info.get('list_name'),
            "color": list_info.get('color'),
            "matched_by": "mmsi",
        }

    def get_match_by_imo(self, imo: str) -> Optional[Dict]:
        list_id = self.imo_cache.get(imo)

        if not list_id:
            return None

        list_info = self.lists_cache.get(list_id, {})

        return {
            "imo": imo,
            "list_id": list_id,
            "list_name": list_info.get('list_name'),
            "color": list_info.get('color'),
            "matched_by": "imo",
        }

    def check_message(self, message: Dict) -> Optional[Dict]:
        mmsi = message.get('mmsi')
        imo = message.get('imo')

        match = None

        if mmsi:
            match = self.get_match(mmsi)

        if not match and imo:
            match = self.get_match_by_imo(imo)
            if match and mmsi:
                match['mmsi'] = mmsi

            if match and self.push_updates_enabled:
                self._schedule_vessel_update(imo, message)

        if match and self.on_match:
            match_event = {
                **match,
                'message': message,
            }
            self.on_match(match_event)

        return match

    def _schedule_vessel_update(self, imo: str, message: Dict) -> None:
        update_data = {}

        if message.get('mmsi'):
            update_data['mmsi'] = str(message['mmsi'])
        if message.get('name') or message.get('shipname'):
            update_data['name'] = message.get('name') or message.get('shipname')
        if message.get('callsign'):
            update_data['callsign'] = message.get('callsign')
        if message.get('flag') or message.get('country'):
            update_data['flag'] = message.get('flag') or message.get('country')
        if message.get('lat') is not None and message.get('lon') is not None:
            import json
            position_data = {
                'lat': message.get('lat'),
                'lon': message.get('lon'),
                'timestamp': message.get('timestamp'),
            }
            if message.get('speed') is not None:
                position_data['speed'] = message.get('speed')
            if message.get('course') is not None:
                position_data['course'] = message.get('course')
            if message.get('heading') is not None:
                position_data['heading'] = message.get('heading')
            if message.get('shiptype') is not None:
                position_data['shiptype'] = message.get('shiptype')
            if message.get('destination'):
                position_data['destination'] = message.get('destination')
            if message.get('eta'):
                position_data['eta'] = message.get('eta')
            if message.get('draught') is not None:
                position_data['draught'] = message.get('draught')
            if message.get('dim_a') is not None:
                position_data['dim_a'] = message.get('dim_a')
            if message.get('dim_b') is not None:
                position_data['dim_b'] = message.get('dim_b')
            if message.get('dim_c') is not None:
                position_data['dim_c'] = message.get('dim_c')
            if message.get('dim_d') is not None:
                position_data['dim_d'] = message.get('dim_d')
            if message.get('status') is not None:
                position_data['status'] = message.get('status')

            update_data['lastposition'] = json.dumps(position_data)

        if update_data:
            try:
                asyncio.create_task(self._push_vessel_update(imo, update_data))
            except RuntimeError:
                self.logger.debug("Cannot schedule vessel update - no event loop")

    async def _push_vessel_update(self, imo: str, data: Dict) -> None:
        try:
            result = await self.api_client.update_vessel_by_imo(imo, data)
            if result.get('success'):
                self.logger.debug(
                    "Vessel update pushed",
                    imo=imo,
                    updated=result.get('updated', 0),
                )
        except Exception as e:
            self.logger.warning("Failed to push vessel update", imo=imo, error=str(e))

    def get_stats(self) -> Dict:
        
        return {
            'mmsi_entries': len(self.mmsi_cache),
            'imo_entries': len(self.imo_cache),
            'vessels_count': len(self.mmsi_cache),
            'lists_count': len(self.lists_cache),
            'sync_mode': self.sync_mode,
            'last_sync_time': self.last_sync_time,
        }

    async def clear(self) -> None:
        
        self.mmsi_cache.clear()
        self.imo_cache.clear()
        self.lists_cache.clear()
        await self.db_manager.clear_all_vessels()
        await self.db_manager.clear_all_lists()
        self.logger.info("Watchlist cleared")
