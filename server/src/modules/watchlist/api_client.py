
import asyncio
from typing import Dict, List, Optional, Tuple

import aiohttp
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
)

from src.core.logger import LoggerMixin


class WatchlistAPIClient(LoggerMixin):

    def __init__(
        self,
        base_url: str,
        vessels_endpoint: str = "/api/vessels",
        lists_endpoint: str = "/api/lists",
        auth_type: str = "none",
        auth_token: Optional[str] = None,
        timeout: int = 10000,
        retry_attempts: int = 3,
        retry_delay: int = 1000,
    ):
        self._logger_context = {'component': 'watchlist-api'}
        self.base_url = base_url.rstrip('/')
        self.vessels_endpoint = vessels_endpoint
        self.lists_endpoint = lists_endpoint
        self.auth_type = auth_type.lower()
        self.auth_token = auth_token
        self.timeout = aiohttp.ClientTimeout(total=timeout / 1000.0)
        self.retry_attempts = retry_attempts
        self.retry_delay = retry_delay / 1000.0

        self.session: Optional[aiohttp.ClientSession] = None

    def _get_headers(self) -> Dict[str, str]:
        
        headers = {
            'User-Agent': 'DarkFleet/1.0',
            'Accept': 'application/json',
        }

        if self.auth_type == 'bearer' and self.auth_token:
            headers['Authorization'] = f'Bearer {self.auth_token}'
        elif self.auth_type == 'apikey' and self.auth_token:
            headers['X-API-Key'] = self.auth_token
        elif self.auth_type == 'basic' and self.auth_token:
            headers['Authorization'] = f'Basic {self.auth_token}'

        return headers

    async def _ensure_session(self) -> None:
        
        if self.session is None or self.session.closed:
            self.session = aiohttp.ClientSession(
                timeout=self.timeout,
                headers=self._get_headers(),
            )

    async def close(self) -> None:
        
        if self.session and not self.session.closed:
            await self.session.close()

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        retry=retry_if_exception_type((aiohttp.ClientError, asyncio.TimeoutError)),
        reraise=True,
    )
    async def _fetch_endpoint(self, endpoint: str) -> List[Dict]:
        await self._ensure_session()

        url = f"{self.base_url}{endpoint}"

        self.logger.debug("Fetching API endpoint", url=url)

        async with self.session.get(url) as response:
            response.raise_for_status()

            data = await response.json()

            if not isinstance(data, list):
                raise ValueError(f"Expected list response, got {type(data)}")

            self.logger.info(
                "API endpoint fetched",
                url=url,
                status=response.status,
                count=len(data),
            )

            return data

    async def fetch_vessels(self) -> List[Dict]:
        try:
            vessels = await self._fetch_endpoint(self.vessels_endpoint)
            self.logger.info("Vessels fetched", count=len(vessels))
            return vessels
        except Exception as e:
            self.logger.error("Failed to fetch vessels", error=str(e))
            raise

    async def fetch_lists(self) -> List[Dict]:
        try:
            lists = await self._fetch_endpoint(self.lists_endpoint)
            self.logger.info("Lists fetched", count=len(lists))
            return lists
        except Exception as e:
            self.logger.error("Failed to fetch lists", error=str(e))
            raise

    async def fetch_all(self) -> Tuple[List[Dict], List[Dict]]:
        self.logger.info("Fetching watchlist data")

        try:
            vessels, lists = await asyncio.gather(
                self.fetch_vessels(),
                self.fetch_lists(),
            )

            self.logger.info(
                "Watchlist data fetched",
                vessels=len(vessels),
                lists=len(lists),
            )

            return vessels, lists

        except Exception as e:
            self.logger.error("Failed to fetch watchlist data", error=str(e))
            raise

    async def update_vessel_by_imo(self, imo: str, data: Dict) -> Dict:
        await self._ensure_session()

        url = f"{self.base_url}/vessels/update-by-imo/{imo}"

        try:
            async with self.session.put(url, json=data) as response:
                if response.status == 200:
                    result = await response.json()
                    self.logger.info(
                        "Vessel updated by IMO",
                        imo=imo,
                        updated=result.get('updated', 0),
                    )
                    return {"success": True, **result}
                else:
                    error_text = await response.text()
                    self.logger.warning(
                        "Vessel update failed",
                        imo=imo,
                        status=response.status,
                        error=error_text,
                    )
                    return {"success": False, "error": error_text}

        except Exception as e:
            self.logger.error("Failed to update vessel by IMO", imo=imo, error=str(e))
            return {"success": False, "error": str(e)}

    async def test_connection(self) -> Dict:
        result = {
            "success": False,
            "vessels": {},
            "lists": {},
        }

        try:
            await self._ensure_session()

            vessels_url = f"{self.base_url}{self.vessels_endpoint}"
            async with self.session.get(vessels_url) as resp:
                result["vessels"]["status"] = resp.status
                if resp.status == 200:
                    data = await resp.json()
                    result["vessels"]["count"] = len(data) if isinstance(data, list) else 0

            lists_url = f"{self.base_url}{self.lists_endpoint}"
            async with self.session.get(lists_url) as resp:
                result["lists"]["status"] = resp.status
                if resp.status == 200:
                    data = await resp.json()
                    result["lists"]["count"] = len(data) if isinstance(data, list) else 0

            result["success"] = (
                result["vessels"].get("status") == 200
                and result["lists"].get("status") == 200
            )

        except Exception as e:
            result["error"] = str(e)
            self.logger.error("Connection test failed", error=str(e))

        return result
