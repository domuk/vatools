/**
 * voice-assistant-timer-card
 * Dashboard card — shows the soonest active timer with a live countdown and dismiss/cancel button.
 * Registered automatically by the V.E.S.P.A. integration.
 *
 * Usage:
 *   type: custom:voice-assistant-timer-card
 */
const DOMAIN = "voice_assistant";

class VoiceAssistantTimerCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._timer = null;
    this._allTimers = [];
    this._tickInterval = null;
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
      await this._hass.connection.subscribeMessage(
        (event) => {
          const type = event.type || "";
          if (type.startsWith("timer_")) this._load();
        },
        { type: `${DOMAIN}/subscribe_events` }
      );
    } catch (e) {
      // Fallback: poll every 5s if subscription fails
      setInterval(() => this._load(), 5000);
    }
  }

  async _load() {
    try {
      const r = await this._hass.callWS({ type: `${DOMAIN}/list_timers` });
      this._allTimers = r.timers || [];
      if (!this._allTimers.length) {
        this._timer = null;
      } else {
        // Firing takes priority, otherwise pick soonest by fires_at
        const firing = this._allTimers.find(t => t.firing);
        this._timer = firing || [...this._allTimers].sort((a, b) =>
          new Date(a.fires_at) - new Date(b.fires_at)
        )[0];
      }
    } catch (e) {
      // Don't null out timer on transient errors — keep showing last known
    }
    this._render();
  }

  _render() {
    const t = this._timer;
    const firing = t?.firing;
    const name = t ? (t.name || "Timer") : "";

    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>
      <div class="card ${firing ? "alerting" : ""} ${!t ? "idle" : ""}">
        ${t ? `
          <div class="label">${this._esc(name)}</div>
          <div class="countdown" id="countdown">
            ${firing ? "⏰ RINGING" : this._calcCountdown(t.fires_at)}
          </div>
          <button class="dismiss-btn" id="action">
            ${firing ? "Dismiss" : "Cancel"}
          </button>
        ` : `
          <div class="idle-icon">⏱</div>
          <div class="idle-text">No Timer</div>
        `}
      </div>
    `;

    if (t) {
      this.shadowRoot.getElementById("action").addEventListener("click", () => this._action());
    }
  }

  _tick() {
    const t = this._timer;
    if (!t || t.firing) return;
    const el = this.shadowRoot.getElementById("countdown");
    if (el) {
      const text = this._calcCountdown(t.fires_at);
      el.textContent = text;
      // Auto-refresh when timer should have fired
      if (text === "0:00") this._load();
    }
  }

  _calcCountdown(firesAt) {
    if (!firesAt) return "0:00";
    const diff = Math.max(0, Math.floor((new Date(firesAt) - Date.now()) / 1000));
    if (diff <= 0) return "0:00";
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const s = diff % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
  }

  async _action() {
    const t = this._timer;
    if (!t) return;
    try {
      if (t.firing) {
        await this._hass.callWS({ type: `${DOMAIN}/dismiss_timer`, timer_id: t.id });
      } else {
        await this._hass.callWS({ type: `${DOMAIN}/cancel_timer`, timer_id: t.id });
      }
    } catch (e) { console.error("Timer action failed", e); }
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
      .card.alerting .countdown { color: var(--error-color, #db4437); }
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

customElements.define("voice-assistant-timer-card", VoiceAssistantTimerCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "voice-assistant-timer-card",
  name: "V.E.S.P.A. Timer",
  description: "Shows the soonest active timer with countdown and dismiss button.",
});
