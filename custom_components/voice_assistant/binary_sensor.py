"""Binary sensor entities for V.E.S.P.A. integration."""

from __future__ import annotations

import logging

from homeassistant.components.binary_sensor import BinarySensorEntity, BinarySensorDeviceClass
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
    """Set up binary sensor entities."""
    coordinator: VoiceAssistantCoordinator = entry.runtime_data

    entities: list[BinarySensorEntity] = [
        VoiceAssistantServerSensor(coordinator, entry),
    ]

    for sat in coordinator.satellites:
        entities.append(SatelliteOnlineSensor(coordinator, entry, sat))

    async_add_entities(entities)


class VoiceAssistantServerSensor(CoordinatorEntity, BinarySensorEntity):
    """Binary sensor showing server connection status."""

    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY

    def __init__(self, coordinator: VoiceAssistantCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_server_connected"
        self._attr_name = "VA Server Connected"

    @property
    def is_on(self) -> bool:
        return self.coordinator.data.get("connected", False)


class SatelliteOnlineSensor(CoordinatorEntity, BinarySensorEntity):
    """Binary sensor showing satellite online status."""

    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY

    def __init__(self, coordinator: VoiceAssistantCoordinator, entry: ConfigEntry, sat: dict) -> None:
        super().__init__(coordinator)
        self._sat_id = sat["id"]
        self._sat_name = sat.get("name", f"Satellite {sat['id']}")
        self._attr_unique_id = f"{entry.entry_id}_online_{self._sat_id}"
        self._attr_name = f"VA {self._sat_name} Online"

    @property
    def is_on(self) -> bool:
        for s in self.coordinator.data.get("satellites", []):
            if s.get("id") == self._sat_id:
                return s.get("online", False)
        return False

    @property
    def extra_state_attributes(self) -> dict:
        for s in self.coordinator.data.get("satellites", []):
            if s.get("id") == self._sat_id:
                return {
                    "ip": s.get("ip"),
                    "device_type": s.get("device_type"),
                    "firmware": s.get("firmware_version"),
                    "last_seen": s.get("last_seen"),
                }
        return {}
