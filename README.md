<p align="center">
  <img src="icon.png" alt="V.E.S.P.A." width="150" />
</p>

<h1 align="center">V.E.S.P.A. for Home Assistant</h1>
<p align="center"><strong>HACS Integration for the V.E.S.P.A. Voice Platform</strong></p>

<p align="center">
  <a href="https://github.com/domuk/vatools/releases"><img src="https://img.shields.io/badge/release-v1.0.0-blue?style=for-the-badge" alt="Release"></a>
  <img src="https://img.shields.io/badge/HACS-Custom-orange?style=for-the-badge" alt="HACS">
  <img src="https://img.shields.io/badge/HA-2024.1+-41BDF5?style=for-the-badge&logo=homeassistant&logoColor=white" alt="Home Assistant">
</p>

<p align="center">
Connect Home Assistant to your <a href="https://github.com/domuk/V.E.S.P.A.">V.E.S.P.A.</a> server — monitor satellites, manage timers and alarms, and view voice interactions directly from your HA dashboard.
</p>

---

## Features

### Sidebar Panel
Live dashboard inside Home Assistant with satellite cards, active timers with live countdowns, alarms with dismiss controls, recent voice interactions, and the ability to create timers and alarms directly.

### Sensors & Binary Sensors
- Per-satellite pipeline state, last transcript, last response
- Server connection status, per-satellite online/offline
- Active timer count

### Lovelace Cards
- **Timer Card** — live countdown of the soonest active timer with dismiss button
- **Alarm Card** — next alarm with dismiss button

### Services
| Service | Description |
|---------|-------------|
| `voice_assistant.dismiss_timer` | Dismiss a firing timer |
| `voice_assistant.dismiss_alarm` | Dismiss a firing alarm |
| `voice_assistant.cancel_timer` | Cancel an active timer |

### Multi-Server Support
Connect to multiple V.E.S.P.A. instances — data from all servers appears together.

---

## Installation

### HACS
1. Open HACS → Integrations → Custom repositories
2. Add `https://github.com/domuk/vatools` as Integration
3. Install "V.E.S.P.A." → Restart HA
4. Settings → Integrations → Add → V.E.S.P.A.
5. Enter server URL and credentials

### Manual
Copy `custom_components/voice_assistant/` to `config/custom_components/` → Restart HA

---

## Lovelace Cards

Add as resources (Settings → Dashboards → Resources):

| Card | URL | Type |
|------|-----|------|
| Timer | `/voice_assistant/frontend/timer-card.js` | JavaScript Module |
| Alarm | `/voice_assistant/frontend/alarm-card.js` | JavaScript Module |

```yaml
type: custom:voice-assistant-timer-card
```

---

## Requirements

- [V.E.S.P.A. server](https://github.com/domuk/V.E.S.P.A.) running and accessible
- Home Assistant 2024.1.0+

## License

Part of [V.E.S.P.A.](https://github.com/domuk/V.E.S.P.A.) — MIT License.
