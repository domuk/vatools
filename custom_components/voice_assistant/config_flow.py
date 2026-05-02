"""Config flow for V.E.S.P.A. integration."""

from __future__ import annotations

import logging
from typing import Any

import aiohttp
import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.core import HomeAssistant

from .const import DOMAIN, CONF_SERVER_URL, CONF_USERNAME, CONF_PASSWORD

_LOGGER = logging.getLogger(__name__)

STEP_USER_DATA_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_SERVER_URL, default="https://your-server:8835"): str,
        vol.Required(CONF_USERNAME): str,
        vol.Required(CONF_PASSWORD): str,
    }
)


async def validate_input(hass: HomeAssistant, data: dict[str, Any]) -> dict[str, Any]:
    """Validate the user input and test connection."""
    url = data[CONF_SERVER_URL].rstrip("/")

    async with aiohttp.ClientSession() as session:
        # Test login
        async with session.post(
            f"{url}/api/auth/login",
            json={"username": data[CONF_USERNAME], "password": data[CONF_PASSWORD]},
            ssl=False,
        ) as resp:
            if resp.status == 401:
                raise InvalidAuth
            if resp.status != 200:
                raise CannotConnect
            # Get cookie for further requests
            cookies = resp.cookies

        # Test API access
        async with session.get(
            f"{url}/api/satellites/",
            cookies=cookies,
            ssl=False,
        ) as resp:
            if resp.status != 200:
                raise CannotConnect

    return {"title": "V.E.S.P.A."}


class VoiceAssistantConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for V.E.S.P.A.."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Handle the initial step."""
        errors: dict[str, str] = {}

        if user_input is not None:
            try:
                info = await validate_input(self.hass, user_input)
            except CannotConnect:
                errors["base"] = "cannot_connect"
            except InvalidAuth:
                errors["base"] = "invalid_auth"
            except Exception:
                _LOGGER.exception("Unexpected exception")
                errors["base"] = "unknown"
            else:
                # Prevent duplicate entries
                await self.async_set_unique_id(user_input[CONF_SERVER_URL])
                self._abort_if_unique_id_configured()

                return self.async_create_entry(title=info["title"], data=user_input)

        return self.async_show_form(
            step_id="user", data_schema=STEP_USER_DATA_SCHEMA, errors=errors
        )


class CannotConnect(Exception):
    """Error to indicate we cannot connect."""


class InvalidAuth(Exception):
    """Error to indicate there is invalid auth."""
