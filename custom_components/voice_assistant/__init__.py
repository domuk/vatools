"""The V.E.S.P.A. integration — supports multiple server entries."""

from __future__ import annotations

import logging
from pathlib import Path

import voluptuous as vol

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv

from .const import DOMAIN, PLATFORMS, PANEL_URL, PANEL_TITLE, PANEL_ICON
from .coordinator import VoiceAssistantCoordinator

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

type VoiceAssistantConfigEntry = ConfigEntry[VoiceAssistantCoordinator]


def _get_coordinators(hass: HomeAssistant) -> list[VoiceAssistantCoordinator]:
    """Get all active coordinators across all config entries."""
    return list(hass.data.get(DOMAIN, {}).values())


def _get_first_coordinator(hass: HomeAssistant) -> VoiceAssistantCoordinator | None:
    """Get the first active coordinator (for actions that target a specific server)."""
    coords = _get_coordinators(hass)
    return coords[0] if coords else None


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up integration-wide resources (once, not per entry)."""
    hass.data.setdefault(DOMAIN, {})

    # Register sidebar panel and static paths
    await _register_panel(hass)

    # Register WebSocket API commands (aggregate across all entries)
    _register_websocket_commands(hass)

    # Register HA services
    _register_services(hass)

    return True


async def async_setup_entry(hass: HomeAssistant, entry: VoiceAssistantConfigEntry) -> bool:
    """Set up a V.E.S.P.A. server connection from a config entry."""
    coordinator = VoiceAssistantCoordinator(hass, entry.data)
    await coordinator.async_config_entry_first_refresh()

    entry.runtime_data = coordinator
    hass.data[DOMAIN][entry.entry_id] = coordinator

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(coordinator.async_shutdown)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: VoiceAssistantConfigEntry) -> bool:
    """Unload a config entry."""
    result = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if result:
        hass.data[DOMAIN].pop(entry.entry_id, None)
        if not hass.data[DOMAIN]:
            frontend.async_remove_panel(hass, PANEL_URL)
    return result


async def _register_panel(hass: HomeAssistant) -> None:
    """Register the sidebar panel and serve static JS."""
    panel_dir = Path(__file__).parent / "frontend"
    try:
        await hass.http.async_register_static_paths([
            StaticPathConfig(f"/{DOMAIN}/frontend", str(panel_dir), cache_headers=False)
        ])
    except Exception:
        pass  # Already registered from a previous load

    try:
        await panel_custom.async_register_panel(
            hass,
            webcomponent_name="voice-assistant-panel",
            frontend_url_path=PANEL_URL,
            sidebar_title=PANEL_TITLE,
            sidebar_icon=PANEL_ICON,
            module_url=f"/{DOMAIN}/frontend/panel.js",
            require_admin=False,
            config={"_panel_custom": {"name": "voice-assistant-panel"}},
        )
    except Exception:
        pass  # Panel already registered

    _LOGGER.info(
        "V.E.S.P.A. Lovelace cards available — add as resources:\n"
        "  Timer: /%s/frontend/timer-card.js (module)\n"
        "  Alarm: /%s/frontend/alarm-card.js (module)",
        DOMAIN, DOMAIN,
    )


def _register_websocket_commands(hass: HomeAssistant) -> None:
    """Register WebSocket API commands — aggregate data from all coordinators."""

    @websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/list_satellites"})
    @websocket_api.async_response
    async def ws_list_satellites(hass, connection, msg):
        all_satellites = []
        for coord in _get_coordinators(hass):
            await coord.refresh_satellites()
            for sat in coord.satellites:
                sat_id = sat.get("id")
                all_satellites.append({
                    **sat,
                    "pipeline_state": coord.pipeline_states.get(sat_id, "idle"),
                    "last_transcript": coord.last_transcripts.get(sat_id, ""),
                    "last_response": coord.last_responses.get(sat_id, ""),
                    "_server": coord._server_url,
                })
        connection.send_result(msg["id"], {"satellites": all_satellites})

    @websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/list_timers"})
    @websocket_api.async_response
    async def ws_list_timers(hass, connection, msg):
        all_timers = []
        for coord in _get_coordinators(hass):
            timers = await coord.fetch_timers()
            for t in timers:
                t["_server"] = coord._server_url
            all_timers.extend(timers)
        connection.send_result(msg["id"], {"timers": all_timers})

    @websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/list_alarms"})
    @websocket_api.async_response
    async def ws_list_alarms(hass, connection, msg):
        all_alarms = []
        for coord in _get_coordinators(hass):
            alarms = await coord.fetch_alarms()
            for a in alarms:
                a["_server"] = coord._server_url
            all_alarms.extend(alarms)
        connection.send_result(msg["id"], {"alarms": all_alarms})

    @websocket_api.websocket_command({
        vol.Required("type"): f"{DOMAIN}/dismiss_timer",
        vol.Required("timer_id"): int,
    })
    @websocket_api.async_response
    async def ws_dismiss_timer(hass, connection, msg):
        for coord in _get_coordinators(hass):
            result = await coord.api_post(f"/api/timers/{msg['timer_id']}/dismiss")
            if result and result.get("ok"):
                connection.send_result(msg["id"], result)
                return
        connection.send_result(msg["id"], {"ok": False})

    @websocket_api.websocket_command({
        vol.Required("type"): f"{DOMAIN}/dismiss_alarm",
        vol.Required("alarm_id"): int,
    })
    @websocket_api.async_response
    async def ws_dismiss_alarm(hass, connection, msg):
        for coord in _get_coordinators(hass):
            result = await coord.api_post(f"/api/alarms/{msg['alarm_id']}/dismiss")
            if result and result.get("ok"):
                connection.send_result(msg["id"], result)
                return
        connection.send_result(msg["id"], {"ok": False})

    @websocket_api.websocket_command({
        vol.Required("type"): f"{DOMAIN}/cancel_timer",
        vol.Required("timer_id"): int,
    })
    @websocket_api.async_response
    async def ws_cancel_timer(hass, connection, msg):
        for coord in _get_coordinators(hass):
            result = await coord.api_delete(f"/api/timers/{msg['timer_id']}")
            if result and result.get("ok"):
                connection.send_result(msg["id"], result)
                return
        connection.send_result(msg["id"], {"ok": False})

    @websocket_api.websocket_command({
        vol.Required("type"): f"{DOMAIN}/recent_interactions",
        vol.Optional("limit", default=20): int,
    })
    @websocket_api.async_response
    async def ws_recent_interactions(hass, connection, msg):
        all_interactions = []
        for coord in _get_coordinators(hass):
            interactions = await coord.fetch_interactions(msg.get("limit", 20))
            all_interactions.extend(interactions)
        # Sort by timestamp descending, limit
        all_interactions.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
        connection.send_result(msg["id"], {"interactions": all_interactions[:msg.get("limit", 20)]})

    @websocket_api.websocket_command({
        vol.Required("type"): f"{DOMAIN}/create_timer",
        vol.Required("satellite_id"): int,
        vol.Required("duration_seconds"): int,
        vol.Optional("name", default=""): str,
    })
    @websocket_api.async_response
    async def ws_create_timer(hass, connection, msg):
        coord = _get_first_coordinator(hass)
        if not coord:
            connection.send_result(msg["id"], {"ok": False, "error": "No server connected"})
            return
        payload = {"satellite_id": msg["satellite_id"], "duration_seconds": msg["duration_seconds"]}
        if msg.get("name"):
            payload["name"] = msg["name"]
        result = await coord.api_post("/api/timers/", payload)
        connection.send_result(msg["id"], result or {"ok": True})

    @websocket_api.websocket_command({
        vol.Required("type"): f"{DOMAIN}/create_alarm",
        vol.Required("time"): str,
        vol.Optional("satellite_id"): vol.Any(int, None),
        vol.Optional("name", default=""): str,
        vol.Optional("repeat_days"): vol.Any(list, None),
    })
    @websocket_api.async_response
    async def ws_create_alarm(hass, connection, msg):
        coord = _get_first_coordinator(hass)
        if not coord:
            connection.send_result(msg["id"], {"ok": False, "error": "No server connected"})
            return
        payload = {"time": msg["time"]}
        if msg.get("satellite_id"):
            payload["satellite_id"] = msg["satellite_id"]
        if msg.get("name"):
            payload["name"] = msg["name"]
        if msg.get("repeat_days"):
            payload["repeat_days"] = msg["repeat_days"]
        result = await coord.api_post("/api/alarms/", payload)
        connection.send_result(msg["id"], result or {"ok": True})

    @websocket_api.websocket_command({
        vol.Required("type"): f"{DOMAIN}/toggle_alarm",
        vol.Required("alarm_id"): int,
        vol.Required("active"): bool,
    })
    @websocket_api.async_response
    async def ws_toggle_alarm(hass, connection, msg):
        for coord in _get_coordinators(hass):
            result = await coord.api_patch(f"/api/alarms/{msg['alarm_id']}", {"active": msg["active"]})
            if result and result.get("ok"):
                connection.send_result(msg["id"], result)
                return
        connection.send_result(msg["id"], {"ok": False})

    @websocket_api.websocket_command({
        vol.Required("type"): f"{DOMAIN}/delete_alarm",
        vol.Required("alarm_id"): int,
    })
    @websocket_api.async_response
    async def ws_delete_alarm(hass, connection, msg):
        for coord in _get_coordinators(hass):
            result = await coord.api_delete(f"/api/alarms/{msg['alarm_id']}")
            if result and result.get("ok"):
                connection.send_result(msg["id"], result)
                return
        connection.send_result(msg["id"], {"ok": False})

    @websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/subscribe_events"})
    @websocket_api.async_response
    async def ws_subscribe_events(hass, connection, msg):
        def forward_event(event):
            connection.send_message(websocket_api.event_message(msg["id"], event.data))
        unsub = hass.bus.async_listen(f"{DOMAIN}_event", forward_event)
        connection.subscriptions[msg["id"]] = unsub
        connection.send_result(msg["id"])

    for cmd in [ws_list_satellites, ws_list_timers, ws_list_alarms,
                ws_dismiss_timer, ws_dismiss_alarm, ws_cancel_timer,
                ws_recent_interactions, ws_create_timer, ws_create_alarm,
                ws_toggle_alarm, ws_delete_alarm, ws_subscribe_events]:
        websocket_api.async_register_command(hass, cmd)


def _register_services(hass: HomeAssistant) -> None:
    """Register HA services (once, aggregate across coordinators)."""

    async def handle_dismiss_timer(call):
        timer_id = call.data["timer_id"]
        for coord in _get_coordinators(hass):
            result = await coord.api_post(f"/api/timers/{timer_id}/dismiss")
            if result and result.get("ok"):
                return

    async def handle_dismiss_alarm(call):
        alarm_id = call.data["alarm_id"]
        for coord in _get_coordinators(hass):
            result = await coord.api_post(f"/api/alarms/{alarm_id}/dismiss")
            if result and result.get("ok"):
                return

    async def handle_cancel_timer(call):
        timer_id = call.data["timer_id"]
        for coord in _get_coordinators(hass):
            result = await coord.api_delete(f"/api/timers/{timer_id}")
            if result and result.get("ok"):
                return

    hass.services.async_register(
        DOMAIN, "dismiss_timer", handle_dismiss_timer,
        schema=vol.Schema({vol.Required("timer_id"): vol.Coerce(int)}),
    )
    hass.services.async_register(
        DOMAIN, "dismiss_alarm", handle_dismiss_alarm,
        schema=vol.Schema({vol.Required("alarm_id"): vol.Coerce(int)}),
    )
    hass.services.async_register(
        DOMAIN, "cancel_timer", handle_cancel_timer,
        schema=vol.Schema({vol.Required("timer_id"): vol.Coerce(int)}),
    )
