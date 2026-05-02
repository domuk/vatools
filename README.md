# V.E.S.P.A. — Home Assistant Integration

<p align="center">
  <img src="icon.png" alt="V.E.S.P.A. Logo" width="128" />
</p>

A custom HACS integration that connects Home Assistant to your [V.E.S.P.A.](https://github.com/domuk/vatools) server — a standalone voice assistant with ESPHome and Wyoming satellite support. Monitor satellites, manage timers and alarms, and view voice interactions directly from your HA dashboard.

## Features

- **Sidebar Panel** — Live dashboard inside Home Assistant showing:
  - Satellite status (online/offline, pipeline state: idle/listening/processing/responding)
  - Active timers with live countdowns and dismiss buttons
  - Alarms with dismiss controls
  - Recent voice interactions feed
- **Sensors** — Per-satellite pipeline state, last transcript, last response
- **Binary Sensors** — Server connection status, per-satellite online/offline
- **Services** — `dismiss_timer`, `dismiss_alarm`, `cancel_timer` (usable in automations)
- **Real-time Updates** — WebSocket connection to the V.E.S.P.A. server pushes live events

## Installation

### HACS (Recommended)
1. Add this repository as a custom repository in HACS
2. Install "V.E.S.P.A."
3. Restart Home Assistant
4. Go to Settings → Integrations → Add Integration → "V.E.S.P.A."
5. Enter your server URL and credentials

### Manual
1. Copy `custom_components/voice_assistant/` to your HA `config/custom_components/` directory
2. Restart Home Assistant
3. Add the integration via Settings → Integrations

## Configuration

- **Server URL** — The URL of your V.E.S.P.A. server (e.g. `https://your-server-ip:8835`)
- **Username** — Your V.E.S.P.A. login username
- **Password** — Your V.E.S.P.A. login password

## Sidebar Panel

After installation, a "V.E.S.P.A." item appears in the HA sidebar. The panel shows:

- **Dashboard** — Satellite cards with live status, active timers, recent activity
- **Timers & Alarms** — All active timers with countdowns, alarm list, dismiss/cancel buttons
- **Activity Log** — Recent voice interactions with transcripts and responses

## Services

| Service | Description |
|---------|-------------|
| `voice_assistant.dismiss_timer` | Dismiss a firing timer by ID |
| `voice_assistant.dismiss_alarm` | Dismiss a firing alarm by ID |
| `voice_assistant.cancel_timer` | Cancel an active timer by ID |

## Requirements

- V.E.S.P.A. server running and accessible from Home Assistant
- Home Assistant 2024.1.0 or newer
