"""Sensor entities for V.E.S.P.A. integration."""

from __future__ import annotations

import logging

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import VoiceAssistantCoordinator

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up sensor entities."""
    coordinator: VoiceAssistantCoordinator = entry.runtime_data

    entities: list[SensorEntity] = [
        VoiceAssistantTimerSensor(coordinator, entry),
    ]

    for sat in coordinator.satellites:
        entities.append(SatellitePipelineSensor(coordinator, entry, sat))
        entities.append(SatelliteLastTranscriptSensor(coordinator, entry, sat))
        entities.append(SatelliteLastResponseSensor(coordinator, entry, sat))

    async_add_entities(entities)


class VoiceAssistantTimerSensor(CoordinatorEntity, SensorEntity):
    """Sensor showing active timer count."""

    def __init__(self, coordinator: VoiceAssistantCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_active_timers"
        self._attr_name = "V.E.S.P.A. Active Timers"
        self._attr_icon = "mdi:timer-outline"

    @property
    def native_value(self) -> int:
        return self.coordinator.data.get("active_timer_count", 0)


class SatellitePipelineSensor(CoordinatorEntity, SensorEntity):
    """Sensor showing pipeline state for a satellite."""

    def __init__(self, coordinator: VoiceAssistantCoordinator, entry: ConfigEntry, sat: dict) -> None:
        super().__init__(coordinator)
        self._sat_id = sat["id"]
        self._sat_name = sat.get("name", f"Satellite {sat['id']}")
        self._attr_unique_id = f"{entry.entry_id}_pipeline_{self._sat_id}"
        self._attr_name = f"VA {self._sat_name} Pipeline"
        self._attr_icon = "mdi:microphone-message"

    @property
    def native_value(self) -> str:
        states = self.coordinator.data.get("pipeline_states", {})
        return states.get(self._sat_id, "idle")

    @property
    def extra_state_attributes(self) -> dict:
        return {"satellite_id": self._sat_id, "satellite_name": self._sat_name}


class SatelliteLastTranscriptSensor(CoordinatorEntity, SensorEntity):
    """Sensor showing last transcript for a satellite."""

    def __init__(self, coordinator: VoiceAssistantCoordinator, entry: ConfigEntry, sat: dict) -> None:
        super().__init__(coordinator)
        self._sat_id = sat["id"]
        self._sat_name = sat.get("name", f"Satellite {sat['id']}")
        self._attr_unique_id = f"{entry.entry_id}_transcript_{self._sat_id}"
        self._attr_name = f"VA {self._sat_name} Last Transcript"
        self._attr_icon = "mdi:text-box-outline"

    @property
    def native_value(self) -> str:
        transcripts = self.coordinator.data.get("last_transcripts", {})
        return transcripts.get(self._sat_id, "")


class SatelliteLastResponseSensor(CoordinatorEntity, SensorEntity):
    """Sensor showing last response for a satellite."""

    def __init__(self, coordinator: VoiceAssistantCoordinator, entry: ConfigEntry, sat: dict) -> None:
        super().__init__(coordinator)
        self._sat_id = sat["id"]
        self._sat_name = sat.get("name", f"Satellite {sat['id']}")
        self._attr_unique_id = f"{entry.entry_id}_response_{self._sat_id}"
        self._attr_name = f"VA {self._sat_name} Last Response"
        self._attr_icon = "mdi:message-reply-text-outline"

    @property
    def native_value(self) -> str:
        responses = self.coordinator.data.get("last_responses", {})
        return responses.get(self._sat_id, "")
