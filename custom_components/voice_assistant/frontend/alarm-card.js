/**
 * voice-assistant-alarm-card
 * Dashboard card — shows the next upcoming alarm with countdown, dismiss button.
 * Registered automatically by the V.E.S.P.A. integration.
 *
 * Usage:
 *   type: custom:voice-assistant-alarm-card
 */
const DOMAIN_ALARM = "voice_assistant";

class VoiceAssistantAlarmCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._alarm = null;
    this._tickInterval = null;
    this._eventUnsub = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._initialized) {
      this._initialized = true;
      this._subscribe();
      this._load();
      this._tickInterval = setInterval(() => this._tick(), 1000);
    }
  }

  async _subscribe() {
    try {
      this._eventUnsub = await this._hass.connection.subscribeMessage(
        (event) => {
          const type = event.type || "";
          if (type.startsWith("alarm_")) this._load();
        },
        { type: `${DOMAIN_ALARM}/subscribe_events` }
      );
    } catch (e) {
      setInterval(() => this._load(), 5000);
    }
  }

  async _load() {
    try {
      const r = await this._hass.callWS({ type: `${DOMAIN_ALARM}/list_alarms` });
      const alarms = r.alarms || [];
      const active = alarms.filter(a => a.active || a.firing);
      if (!active.length) {
        this._alarm = null;
      } else {
        // Firing takes priority
        const firing = active.find(a => a.firing);
        if (firing) {
          this._alarm = firing;
        } else {
          // Pick the one with the earliest time today
          this._alarm = active[0];
        }
      }
    } catch (e) {
      this._alarm = null;
    }
    this._render();
  }

  _render() {
    const a = this._alarm;
    const firing = a?.firing;
    const name = a ? (a.name || "Alarm") : "";

    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>
      <div class="card ${firing ? "alerting" : ""} ${!a ? "idle" : ""}">
        ${a ? `
          <div class="label">${this._esc(name)}</div>
          <div class="countdown" id="countdown">
            ${firing ? "🔔 RINGING" : `⏰ ${a.time || ""}`}
          </div>
          <div class="meta">
            ${a.repeat_days && a.repeat_days.length ? "Repeats" : "One-shot"}
            ${a.snooze_enabled ? " · Snooze on" : ""}
          </div>
          <button class="dismiss-btn" id="dismiss">
            ${firing ? "Dismiss" : "Delete"}
          </button>
        ` : `
          <div class="idle-icon">🔔</div>
          <div class="idle-text">No Alarm</div>
        `}
      </div>
    `;

    if (a) {
      this.shadowRoot.getElementById("dismiss").addEventListener("click", () => this._action());
    }
  }

  _tick() {
    // Alarms don't need per-second countdown — they show the target time
  }

  async _action() {
    const a = this._alarm;
    if (!a) return;
    try {
      if (a.firing) {
        await this._hass.callWS({ type: `${DOMAIN_ALARM}/dismiss_alarm`, alarm_id: a.id });
      } else {
        await this._hass.callWS({ type: `${DOMAIN_ALARM}/delete_alarm`, alarm_id: a.id });
      }
    } catch (e) { console.error("Alarm action failed", e); }
    await this._load();
  }

  _esc(str) {
    const el = document.createElement("span");
    el.textContent = str || "";
    return el.innerHTML;
  }

  _styles() {
    return `
      :host { display: block; height: 100%; }
      .card {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        min-height: 80px;
        padding: 12px 16px;
        box-sizing: border-box;
        gap: 4px;
        background: var(--card-background-color, #1c1c1e);
        border-radius: var(--ha-card-border-radius, 12px);
      }
      .card.alerting { animation: pulse 1s infinite alternate; }
      @keyframes pulse { from { opacity: 1; } to { opacity: 0.65; } }
      .label {
        font-size: 0.8em;
        color: var(--secondary-text-color, #888);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .countdown {
        font-size: 2.4em;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        color: var(--primary-text-color, #fff);
        line-height: 1;
      }
      .card.alerting .countdown { color: var(--warning-color, #ff9800); }
      .meta {
        font-size: 0.75em;
        color: var(--secondary-text-color, #888);
      }
      .dismiss-btn {
        margin-top: 6px;
        padding: 5px 24px;
        border: none;
        border-radius: 20px;
        background: var(--error-color, #db4437);
        color: #fff;
        font-size: 0.85em;
        font-weight: 600;
        cursor: pointer;
        letter-spacing: 0.03em;
      }
      .dismiss-btn:active { opacity: 0.8; }
      .idle-icon { font-size: 1.8em; opacity: 0.25; }
      .idle-text { font-size: 0.85em; color: var(--secondary-text-color, #888); opacity: 0.5; }
    `;
  }

  disconnectedCallback() {
    if (this._tickInterval) clearInterval(this._tickInterval);
  }

  static getConfigElement() { return document.createElement("div"); }
  static getStubConfig() { return {}; }
  setConfig(config) { this._config = config; }
  getCardSize() { return 2; }
}

customElements.define("voice-assistant-alarm-card", VoiceAssistantAlarmCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "voice-assistant-alarm-card",
  name: "V.E.S.P.A. Alarm",
  description: "Shows the next upcoming alarm with dismiss button.",
});
