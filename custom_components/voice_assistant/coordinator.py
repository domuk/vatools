"""Data coordinator for V.E.S.P.A. — manages WebSocket connection and state."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import aiohttp

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import DOMAIN, CONF_SERVER_URL, CONF_USERNAME, CONF_PASSWORD

_LOGGER = logging.getLogger(__name__)

RECONNECT_DELAY = 10


class VoiceAssistantCoordinator(DataUpdateCoordinator):
    """Connects to V.E.S.P.A. server via WebSocket for real-time updates."""

    def __init__(self, hass: HomeAssistant, entry_data: dict[str, Any]) -> None:
        super().__init__(hass, _LOGGER, name=DOMAIN, update_interval=None)

        self._server_url = entry_data[CONF_SERVER_URL].rstrip("/")
        self._username = entry_data[CONF_USERNAME]
        self._password = entry_data[CONF_PASSWORD]

        self._ws_task: asyncio.Task | None = None
        self._session: aiohttp.ClientSession | None = None
        self._logged_in = False

        # State data
        self.satellites: list[dict] = []
        self.pipeline_states: dict[int, str] = {}
        self.last_transcripts: dict[int, str] = {}
        self.last_responses: dict[int, str] = {}
        self.active_timer_count: int = 0
        self.active_timers: list[dict] = []
        self.active_alarms: list[dict] = []
        self.connected: bool = False

    async def _async_update_data(self) -> dict:
        """Fetch initial data from REST API."""
        try:
            await self._ensure_logged_in()
            await self._fetch_satellites()
            await self._fetch_timers()
            await self._fetch_alarms()
            self._start_websocket()
        except Exception as e:
            _LOGGER.error("Failed to connect to V.E.S.P.A. server: %s", e)
            raise UpdateFailed(f"Connection failed: {e}") from e
        return self._build_data()

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            jar = aiohttp.CookieJar(unsafe=True)
            self._session = aiohttp.ClientSession(cookie_jar=jar)
            self._logged_in = False
        return self._session

    async def _ensure_logged_in(self) -> None:
        """Login if not already authenticated."""
        if self._logged_in:
            return
        session = await self._get_session()
        _LOGGER.debug("Logging in to %s", self._server_url)
        async with session.post(
            f"{self._server_url}/api/auth/login",
            json={"username": self._username, "password": self._password},
            ssl=False,
        ) as resp:
            if resp.status != 200:
                body = await resp.text()
                _LOGGER.error("Login failed: status=%s body=%s", resp.status, body[:200])
                raise UpdateFailed(f"Login failed: {resp.status}")
            _LOGGER.debug("Login successful")
            self._logged_in = True
            self.connected = True

    async def _api_request(self, method: str, path: str, json_data: dict | None = None) -> Any:
        """Make an authenticated API request, re-login if needed."""
        await self._ensure_logged_in()
        session = await self._get_session()
        url = f"{self._server_url}{path}"
        try:
            async with session.request(method, url, json=json_data, ssl=False) as resp:
                if resp.status == 401:
                    _LOGGER.debug("Got 401, re-authenticating")
                    self._logged_in = False
                    await self._ensure_logged_in()
                    async with session.request(method, url, json=json_data, ssl=False) as retry:
                        if retry.status == 200:
                            return await retry.json()
                        return None
                if resp.status == 200:
                    return await resp.json()
                _LOGGER.warning("API %s %s returned %s", method, path, resp.status)
                return None
        except Exception as e:
            _LOGGER.error("API request failed: %s %s — %s", method, path, e)
            return None

    async def api_get(self, path: str) -> Any:
        return await self._api_request("GET", path)

    async def api_post(self, path: str, data: dict | None = None) -> Any:
        return await self._api_request("POST", path, data)

    async def api_delete(self, path: str) -> Any:
        return await self._api_request("DELETE", path)

    async def api_patch(self, path: str, data: dict | None = None) -> Any:
        return await self._api_request("PATCH", path, data)

    async def _fetch_satellites(self) -> None:
        result = await self.api_get("/api/satellites/")
        if result is not None:
            self.satellites = result
            _LOGGER.info("Fetched %d satellites", len(self.satellites))
        else:
            raise UpdateFailed("Failed to fetch satellites")

    async def refresh_satellites(self) -> None:
        """Refresh satellite list (called by WebSocket API)."""
        try:
            result = await self.api_get("/api/satellites/")
            if result is not None:
                self.satellites = result
        except Exception as e:
            _LOGGER.warning("Failed to refresh satellites: %s", e)

    async def _fetch_timers(self) -> None:
        try:
            result = await self.api_get("/api/timers/")
            if result is not None:
                self.active_timers = result
                self.active_timer_count = len(result)
        except Exception as e:
            _LOGGER.warning("Failed to fetch timers: %s", e)

    async def fetch_timers(self) -> list[dict]:
        """Fetch timers (called by WebSocket API)."""
        result = await self.api_get("/api/timers/")
        return result if result is not None else []

    async def _fetch_alarms(self) -> None:
        try:
            result = await self.api_get("/api/alarms/")
            if result is not None:
                self.active_alarms = result
        except Exception as e:
            _LOGGER.warning("Failed to fetch alarms: %s", e)

    async def fetch_alarms(self) -> list[dict]:
        """Fetch alarms with firing status (called by WebSocket API)."""
        alarms = await self.api_get("/api/alarms/")
        if alarms is None:
            return []
        # Get firing alarm IDs
        firing_result = await self.api_get("/api/alarms/firing")
        firing_ids = set(firing_result.get("firing", [])) if firing_result else set()
        for a in alarms:
            a["firing"] = a.get("id") in firing_ids
        return alarms

    async def fetch_interactions(self, limit: int = 20) -> list[dict]:
        """Fetch recent interactions (called by WebSocket API)."""
        result = await self.api_get(f"/api/logs/interactions?limit={limit}")
        return result if result is not None else []

    def _start_websocket(self) -> None:
        if self._ws_task is None or self._ws_task.done():
            self._ws_task = self.hass.async_create_background_task(
                self._ws_loop(), f"{DOMAIN}_websocket"
            )

    async def _ws_loop(self) -> None:
        ws_url = self._server_url.replace("https://", "wss://").replace("http://", "ws://")
        ws_url = f"{ws_url}/api/ws/events"
        session = await self._get_session()

        while True:
            try:
                _LOGGER.debug("Connecting WebSocket to %s", ws_url)
                async with session.ws_connect(ws_url, ssl=False) as ws:
                    _LOGGER.info("WebSocket connected to V.E.S.P.A.")
                    async for msg in ws:
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            try:
                                event = json.loads(msg.data)
                                self._handle_event(event)
                            except json.JSONDecodeError:
                                pass
                        elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                            break
            except asyncio.CancelledError:
                return
            except Exception as e:
                _LOGGER.warning("WebSocket error: %s", e)

            _LOGGER.info("WebSocket disconnected, reconnecting in %ds", RECONNECT_DELAY)
            await asyncio.sleep(RECONNECT_DELAY)

    @callback
    def _handle_event(self, event: dict) -> None:
        """Handle a real-time event from the server."""
        event_type = event.get("type", "")
        sat_id = event.get("satellite_id")

        if event_type == "pipeline_start":
            if sat_id:
                self.pipeline_states[sat_id] = "listening"
            self._push_update(event)

        elif event_type == "listening":
            if sat_id:
                self.pipeline_states[sat_id] = "listening"
            self._push_update(event)

        elif event_type == "stt_result":
            if sat_id:
                self.pipeline_states[sat_id] = "processing"
                self.last_transcripts[sat_id] = event.get("transcript", "")
            self._push_update(event)

        elif event_type == "intent_result":
            if sat_id:
                self.pipeline_states[sat_id] = "responding"
                self.last_responses[sat_id] = event.get("response", "")
            self._push_update(event)

        elif event_type == "pipeline_end":
            if sat_id:
                self.pipeline_states[sat_id] = "idle"
            self._push_update(event)

        elif event_type == "satellite_status":
            for s in self.satellites:
                if s.get("id") == sat_id or s.get("ip") == event.get("host"):
                    s["online"] = event.get("online", False)
            self._push_update(event)

        elif event_type == "wyoming_state":
            if sat_id:
                state_map = {
                    "detecting": "idle", "listening": "listening",
                    "processing": "processing", "responding": "responding",
                    "connected": "idle", "disconnected": "offline",
                }
                self.pipeline_states[sat_id] = state_map.get(event.get("state", ""), "idle")
            self._push_update(event)

        elif event_type in ("timer_fired", "timer_dismissed", "timer_created", "timer_cancelled"):
            self.hass.async_create_background_task(
                self._refresh_timers_and_update(event), f"{DOMAIN}_timer_refresh"
            )

        elif event_type in ("alarm_fired", "alarm_dismissed"):
            self.hass.async_create_background_task(
                self._refresh_alarms_and_update(event), f"{DOMAIN}_alarm_refresh"
            )

    def _push_update(self, event: dict) -> None:
        """Push state update to entities and fire HA event for panel subscribers."""
        self.async_set_updated_data(self._build_data())
        self.hass.bus.async_fire(f"{DOMAIN}_event", event)

    async def _refresh_timers_and_update(self, event: dict) -> None:
        await self._fetch_timers()
        self._push_update(event)

    async def _refresh_alarms_and_update(self, event: dict) -> None:
        await self._fetch_alarms()
        self._push_update(event)

    def _build_data(self) -> dict:
        return {
            "satellites": self.satellites,
            "pipeline_states": self.pipeline_states,
            "last_transcripts": self.last_transcripts,
            "last_responses": self.last_responses,
            "active_timer_count": self.active_timer_count,
            "connected": self.connected,
        }

    async def async_shutdown(self) -> None:
        if self._ws_task and not self._ws_task.done():
            self._ws_task.cancel()
        if self._session and not self._session.closed:
            await self._session.close()
