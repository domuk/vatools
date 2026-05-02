/**
 * V.E.S.P.A. — Home Assistant Sidebar Panel v0.3.0
 * Live dashboard showing satellites, timers, alarms, and recent interactions.
 */

const DOMAIN = "voice_assistant";

class VoiceAssistantPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._satellites = [];
    this._timers = [];
    this._alarms = [];
    this._interactions = [];
    this._activeTab = "dashboard";
    this._eventSubscriptionId = null;
    this._timerInterval = null;
    this._connected = false;
    this._showCreateTimer = false;
    this._showCreateAlarm = false;
    this._renderTimeout = null;
    // Form state preservation
    this._formTimerSatId = null;
    this._formTimerHours = "0";
    this._formTimerMinutes = "0";
    this._formTimerSeconds = "0";
    this._formTimerName = "";
    this._formAlarmTime = "07:00";
    this._formAlarmSatId = "";
    this._formAlarmName = "";
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._connected) {
      this._connected = true;
      this._init();
    }
  }

  _scheduleRender() {
    // Don't re-render while a form is open — it destroys input state
    if (this._showCreateTimer || this._showCreateAlarm) return;
    if (this._renderTimeout) return;
    this._renderTimeout = setTimeout(() => {
      this._renderTimeout = null;
      this._render();
    }, 200);
  }

  async _init() {
    this._render();
    await this._loadData();
    this._subscribeEvents();
    this._timerInterval = setInterval(() => this._updateTimerCountdowns(), 1000);
  }

  disconnectedCallback() {
    if (this._timerInterval) clearInterval(this._timerInterval);
  }

  async _loadData() {
    try {
      const [satResult, timerResult, alarmResult, interResult] = await Promise.all([
        this._hass.callWS({ type: `${DOMAIN}/list_satellites` }),
        this._hass.callWS({ type: `${DOMAIN}/list_timers` }),
        this._hass.callWS({ type: `${DOMAIN}/list_alarms` }),
        this._hass.callWS({ type: `${DOMAIN}/recent_interactions`, limit: 20 }),
      ]);
      this._satellites = satResult.satellites || [];
      this._timers = timerResult.timers || [];
      this._alarms = alarmResult.alarms || [];
      this._interactions = interResult.interactions || [];
    } catch (e) {
      console.error("V.E.S.P.A.: Failed to load data", e);
    }
    this._render();
  }

  async _subscribeEvents() {
    try {
      this._eventSubscriptionId = await this._hass.connection.subscribeMessage(
        (event) => this._handleEvent(event),
        { type: `${DOMAIN}/subscribe_events` }
      );
    } catch (e) {
      console.error("V.E.S.P.A.: Failed to subscribe to events", e);
    }
  }

  _handleEvent(event) {
    const type = event.type || "";
    if (type === "satellite_status" || type === "pipeline_start" || type === "pipeline_end" ||
        type === "listening" || type === "stt_result" || type === "intent_result" || type === "wyoming_state") {
      this._hass.callWS({ type: `${DOMAIN}/list_satellites` }).then((r) => {
        this._satellites = r.satellites || [];
        this._scheduleRender();
      });
    }
    if (type.startsWith("timer_") || type.startsWith("alarm_")) {
      Promise.all([
        this._hass.callWS({ type: `${DOMAIN}/list_timers` }),
        this._hass.callWS({ type: `${DOMAIN}/list_alarms` }),
      ]).then(([t, a]) => {
        this._timers = t.timers || [];
        this._alarms = a.alarms || [];
        this._scheduleRender();
      });
    }
    if (type === "intent_result" || type === "pipeline_end") {
      this._hass.callWS({ type: `${DOMAIN}/recent_interactions`, limit: 20 }).then((r) => {
        this._interactions = r.interactions || [];
        this._scheduleRender();
      });
    }
  }

  _updateTimerCountdowns() {
    const els = this.shadowRoot.querySelectorAll("[data-countdown]");
    els.forEach((el) => {
      let remaining = parseInt(el.dataset.countdown, 10);
      if (remaining > 0) {
        remaining--;
        el.dataset.countdown = remaining;
        el.textContent = this._formatDuration(remaining);
      }
    });
  }

  _formatDuration(seconds) {
    if (seconds <= 0) return "Firing!";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  _setTab(tab) {
    this._activeTab = tab;
    this._showCreateTimer = false;
    this._showCreateAlarm = false;
    this._render();
  }

  async _dismissTimer(id) {
    try {
      await this._hass.callWS({ type: `${DOMAIN}/dismiss_timer`, timer_id: id });
      this._timers = this._timers.filter((t) => t.id !== id);
      this._render();
    } catch (e) { console.error("Failed to dismiss timer", e); }
  }

  async _cancelTimer(id) {
    try {
      await this._hass.callWS({ type: `${DOMAIN}/cancel_timer`, timer_id: id });
      this._timers = this._timers.filter((t) => t.id !== id);
      this._render();
    } catch (e) { console.error("Failed to cancel timer", e); }
  }

  async _dismissAlarm(id) {
    try {
      await this._hass.callWS({ type: `${DOMAIN}/dismiss_alarm`, alarm_id: id });
      await this._loadData();
    } catch (e) { console.error("Failed to dismiss alarm", e); }
  }

  async _toggleAlarm(id, active) {
    try {
      await this._hass.callWS({ type: `${DOMAIN}/toggle_alarm`, alarm_id: id, active: active });
      this._alarms = this._alarms.map((a) => a.id === id ? { ...a, active: active } : a);
      this._render();
    } catch (e) { console.error("Failed to toggle alarm", e); }
  }

  async _deleteAlarm(id) {
    try {
      await this._hass.callWS({ type: `${DOMAIN}/delete_alarm`, alarm_id: id });
      this._alarms = this._alarms.filter((a) => a.id !== id);
      this._render();
    } catch (e) { console.error("Failed to delete alarm", e); }
  }

  async _createTimer() {
    const root = this.shadowRoot;
    const satId = parseInt(root.querySelector("#ct-satellite").value, 10);
    const hours = parseInt(root.querySelector("#ct-hours").value || "0", 10);
    const minutes = parseInt(root.querySelector("#ct-minutes").value || "0", 10);
    const seconds = parseInt(root.querySelector("#ct-seconds").value || "0", 10);
    const name = root.querySelector("#ct-name").value || "";
    const duration = hours * 3600 + minutes * 60 + seconds;
    if (duration <= 0 || !satId) return;
    try {
      await this._hass.callWS({
        type: `${DOMAIN}/create_timer`,
        satellite_id: satId,
        duration_seconds: duration,
        name: name,
      });
      this._showCreateTimer = false;
      this._formTimerHours = "0";
      this._formTimerMinutes = "0";
      this._formTimerSeconds = "0";
      this._formTimerName = "";
      this._formTimerSatId = null;
      await this._loadData();
    } catch (e) { console.error("Failed to create timer", e); }
  }

  async _createAlarm() {
    const root = this.shadowRoot;
    const time = root.querySelector("#ca-time").value;
    const name = root.querySelector("#ca-name").value || "";
    const satVal = root.querySelector("#ca-satellite").value;
    const satId = satVal ? parseInt(satVal, 10) : null;
    if (!time) return;
    try {
      const payload = { type: `${DOMAIN}/create_alarm`, time: time };
      if (satId) payload.satellite_id = satId;
      if (name) payload.name = name;
      await this._hass.callWS(payload);
      this._showCreateAlarm = false;
      this._formAlarmTime = "07:00";
      this._formAlarmSatId = "";
      this._formAlarmName = "";
      await this._loadData();
    } catch (e) { console.error("Failed to create alarm", e); }
  }

  _getSatName(satId) {
    const sat = this._satellites.find((s) => s.id === satId);
    return sat ? sat.name : (satId ? `Satellite #${satId}` : "All devices");
  }

  _render() {
    const tabs = [
      { id: "dashboard", label: "Dashboard", icon: "🏠" },
      { id: "timers", label: "Timers & Alarms", icon: "⏱️" },
      { id: "log", label: "Activity Log", icon: "📋" },
    ];

    let content = "";
    if (this._activeTab === "dashboard") content = this._renderDashboard();
    else if (this._activeTab === "timers") content = this._renderTimers();
    else if (this._activeTab === "log") content = this._renderLog();

    this.shadowRoot.innerHTML = `
      <style>${this._getStyles()}</style>
      <div class="panel">
        <div class="header">
          <div class="header-top">
            <h1>V.E.S.P.A.</h1>
            <button class="btn btn-icon" id="refresh-btn" title="Refresh">🔄</button>
          </div>
          <div class="tabs">
            ${tabs.map((t) => `
              <button class="tab ${this._activeTab === t.id ? "active" : ""}"
                      data-tab="${t.id}">${t.icon} ${t.label}</button>
            `).join("")}
          </div>
        </div>
        <div class="content">${content}</div>
      </div>
    `;

    this._bindEvents();
  }

  _bindEvents() {
    const root = this.shadowRoot;

    // Refresh button
    const refreshBtn = root.querySelector("#refresh-btn");
    if (refreshBtn) refreshBtn.addEventListener("click", () => this._loadData());

    // Tab clicks
    root.querySelectorAll(".tab").forEach((btn) => {
      btn.addEventListener("click", () => this._setTab(btn.dataset.tab));
    });

    // Timer actions
    root.querySelectorAll("[data-dismiss-timer]").forEach((btn) => {
      btn.addEventListener("click", () => this._dismissTimer(parseInt(btn.dataset.dismissTimer)));
    });
    root.querySelectorAll("[data-cancel-timer]").forEach((btn) => {
      btn.addEventListener("click", () => this._cancelTimer(parseInt(btn.dataset.cancelTimer)));
    });

    // Alarm actions
    root.querySelectorAll("[data-dismiss-alarm]").forEach((btn) => {
      btn.addEventListener("click", () => this._dismissAlarm(parseInt(btn.dataset.dismissAlarm)));
    });
    root.querySelectorAll("[data-toggle-alarm]").forEach((btn) => {
      const id = parseInt(btn.dataset.toggleAlarm);
      const active = btn.dataset.toggleTo === "true";
      btn.addEventListener("click", () => this._toggleAlarm(id, active));
    });
    root.querySelectorAll("[data-delete-alarm]").forEach((btn) => {
      btn.addEventListener("click", () => this._deleteAlarm(parseInt(btn.dataset.deleteAlarm)));
    });

    // Create forms
    const showTimerBtn = root.querySelector("#show-create-timer");
    if (showTimerBtn) showTimerBtn.addEventListener("click", () => {
      this._showCreateTimer = !this._showCreateTimer;
      this._render();
    });
    const showAlarmBtn = root.querySelector("#show-create-alarm");
    if (showAlarmBtn) showAlarmBtn.addEventListener("click", () => {
      this._showCreateAlarm = !this._showCreateAlarm;
      this._render();
    });
    const createTimerBtn = root.querySelector("#create-timer-btn");
    if (createTimerBtn) createTimerBtn.addEventListener("click", () => this._createTimer());
    const createAlarmBtn = root.querySelector("#create-alarm-btn");
    if (createAlarmBtn) createAlarmBtn.addEventListener("click", () => this._createAlarm());
    const cancelTimerForm = root.querySelector("#cancel-timer-form");
    if (cancelTimerForm) cancelTimerForm.addEventListener("click", () => {
      this._showCreateTimer = false; this._render();
    });
    const cancelAlarmForm = root.querySelector("#cancel-alarm-form");
    if (cancelAlarmForm) cancelAlarmForm.addEventListener("click", () => {
      this._showCreateAlarm = false; this._render();
    });

    // Preserve form state on input changes
    const ctSat = root.querySelector("#ct-satellite");
    if (ctSat) ctSat.addEventListener("change", (e) => { this._formTimerSatId = parseInt(e.target.value) || null; });
    const ctH = root.querySelector("#ct-hours");
    if (ctH) ctH.addEventListener("input", (e) => { this._formTimerHours = e.target.value; });
    const ctM = root.querySelector("#ct-minutes");
    if (ctM) ctM.addEventListener("input", (e) => { this._formTimerMinutes = e.target.value; });
    const ctS = root.querySelector("#ct-seconds");
    if (ctS) ctS.addEventListener("input", (e) => { this._formTimerSeconds = e.target.value; });
    const ctN = root.querySelector("#ct-name");
    if (ctN) ctN.addEventListener("input", (e) => { this._formTimerName = e.target.value; });
    const caT = root.querySelector("#ca-time");
    if (caT) caT.addEventListener("input", (e) => { this._formAlarmTime = e.target.value; });
    const caSat = root.querySelector("#ca-satellite");
    if (caSat) caSat.addEventListener("change", (e) => { this._formAlarmSatId = e.target.value; });
    const caN = root.querySelector("#ca-name");
    if (caN) caN.addEventListener("input", (e) => { this._formAlarmName = e.target.value; });
  }

  _renderDashboard() {
    const onlineCount = this._satellites.filter((s) => s.online).length;
    const totalSats = this._satellites.length;
    const activeTimers = this._timers.length;
    const firingTimers = this._timers.filter((t) => t.firing).length;
    const alarmCount = this._alarms.length;

    return `
      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-value">${onlineCount}/${totalSats}</div>
          <div class="stat-label">Satellites Online</div>
        </div>
        <div class="stat-card ${firingTimers > 0 ? "firing" : ""}">
          <div class="stat-value">${activeTimers}</div>
          <div class="stat-label">Active Timers${firingTimers > 0 ? ` (${firingTimers} firing!)` : ""}</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${alarmCount}</div>
          <div class="stat-label">Alarms</div>
        </div>
      </div>

      <h2>Satellites</h2>
      <div class="card-grid">
        ${this._satellites.map((s) => this._renderSatelliteCard(s)).join("")}
        ${this._satellites.length === 0 ? '<div class="empty">No satellites found</div>' : ""}
      </div>

      ${this._timers.length > 0 ? `
        <h2>Active Timers</h2>
        <div class="timer-list">
          ${this._timers.map((t) => this._renderTimerCard(t)).join("")}
        </div>
      ` : ""}

      ${this._interactions.length > 0 ? `
        <h2>Recent Activity</h2>
        <div class="interaction-list">
          ${this._interactions.slice(0, 5).map((i) => this._renderInteraction(i)).join("")}
        </div>
      ` : ""}
    `;
  }

  _renderSatelliteCard(sat) {
    const state = sat.pipeline_state || "idle";
    const stateColors = {
      idle: "#6b7280", listening: "#3b82f6", processing: "#f59e0b",
      responding: "#10b981", offline: "#ef4444",
    };
    const stateColor = stateColors[state] || "#6b7280";
    const online = sat.online;
    const deviceType = sat.device_type || "esphome";

    return `
      <div class="sat-card ${online ? "" : "offline"}">
        <div class="sat-header">
          <span class="sat-indicator" style="background:${online ? "#10b981" : "#ef4444"}"></span>
          <span class="sat-name">${sat.name || "Unknown"}</span>
          <span class="sat-type">${deviceType}</span>
        </div>
        <div class="sat-state" style="color:${stateColor}">
          ${state.charAt(0).toUpperCase() + state.slice(1)}
        </div>
        ${sat.last_transcript ? `<div class="sat-transcript">"${sat.last_transcript}"</div>` : ""}
        ${sat.last_response ? `<div class="sat-response">→ ${sat.last_response}</div>` : ""}
        <div class="sat-meta">${sat.ip || ""} ${sat.room ? `· ${sat.room}` : ""}</div>
      </div>
    `;
  }

  _renderTimerCard(timer) {
    const firing = timer.firing;
    const remaining = timer.remaining_seconds || 0;
    const name = timer.name || "Timer";
    const progress = timer.duration_seconds > 0
      ? Math.max(0, Math.min(100, ((timer.duration_seconds - remaining) / timer.duration_seconds) * 100))
      : 100;

    return `
      <div class="timer-card ${firing ? "firing" : ""}">
        <div class="timer-info">
          <span class="timer-name">${name}</span>
          <span class="timer-countdown" data-countdown="${remaining}">
            ${firing ? "🔔 Firing!" : this._formatDuration(remaining)}
          </span>
        </div>
        <div class="timer-meta">${this._getSatName(timer.satellite_id)}</div>
        ${!firing ? `
          <div class="timer-progress">
            <div class="timer-bar" style="width:${progress}%"></div>
          </div>
        ` : ""}
        <div class="timer-actions">
          ${firing
            ? `<button class="btn btn-danger" data-dismiss-timer="${timer.id}">Dismiss</button>`
            : `<button class="btn btn-secondary" data-cancel-timer="${timer.id}">Cancel</button>`
          }
        </div>
      </div>
    `;
  }

  _renderTimers() {
    const firingTimers = this._timers.filter((t) => t.firing);
    const runningTimers = this._timers.filter((t) => !t.firing);
    const firingAlarms = this._alarms.filter((a) => a.firing);
    const activeAlarms = this._alarms.filter((a) => !a.firing);

    const satOptions = this._satellites.map((s) =>
      `<option value="${s.id}">${s.name || "Satellite #" + s.id}</option>`
    ).join("");

    return `
      <div class="section-actions">
        <button class="btn btn-primary" id="show-create-timer">+ New Timer</button>
        <button class="btn btn-primary" id="show-create-alarm">+ New Alarm</button>
      </div>

      ${this._showCreateTimer ? `
        <div class="create-form">
          <h3>Create Timer</h3>
          <div class="form-row">
            <label>Satellite</label>
            <select id="ct-satellite">
              ${this._satellites.map((s) => `<option value="${s.id}" ${s.id === this._formTimerSatId ? "selected" : ""}>${s.name || "Satellite #" + s.id}</option>`).join("")}
            </select>
          </div>
          <div class="form-row">
            <label>Duration</label>
            <div class="duration-inputs">
              <input type="number" id="ct-hours" min="0" max="23" value="${this._formTimerHours}" placeholder="H" />
              <span>h</span>
              <input type="number" id="ct-minutes" min="0" max="59" value="${this._formTimerMinutes}" placeholder="M" />
              <span>m</span>
              <input type="number" id="ct-seconds" min="0" max="59" value="${this._formTimerSeconds}" placeholder="S" />
              <span>s</span>
            </div>
          </div>
          <div class="form-row">
            <label>Name (optional)</label>
            <input type="text" id="ct-name" value="${this._formTimerName}" placeholder="Kitchen timer" />
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" id="create-timer-btn">Create</button>
            <button class="btn btn-secondary" id="cancel-timer-form">Cancel</button>
          </div>
        </div>
      ` : ""}

      ${this._showCreateAlarm ? `
        <div class="create-form">
          <h3>Create Alarm</h3>
          <div class="form-row">
            <label>Time</label>
            <input type="time" id="ca-time" value="${this._formAlarmTime}" />
          </div>
          <div class="form-row">
            <label>Satellite (optional)</label>
            <select id="ca-satellite">
              <option value="" ${!this._formAlarmSatId ? "selected" : ""}>All devices</option>
              ${this._satellites.map((s) => `<option value="${s.id}" ${String(s.id) === this._formAlarmSatId ? "selected" : ""}>${s.name || "Satellite #" + s.id}</option>`).join("")}
            </select>
          </div>
          <div class="form-row">
            <label>Name (optional)</label>
            <input type="text" id="ca-name" value="${this._formAlarmName}" placeholder="Morning alarm" />
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" id="create-alarm-btn">Create</button>
            <button class="btn btn-secondary" id="cancel-alarm-form">Cancel</button>
          </div>
        </div>
      ` : ""}

      ${firingTimers.length > 0 ? `
        <h2 class="section-firing">🔔 Firing Timers</h2>
        <div class="timer-list">
          ${firingTimers.map((t) => this._renderTimerCard(t)).join("")}
        </div>
      ` : ""}

      ${firingAlarms.length > 0 ? `
        <h2 class="section-firing">🔔 Firing Alarms</h2>
        <div class="timer-list">
          ${firingAlarms.map((a) => `
            <div class="timer-card firing">
              <div class="timer-info">
                <span class="timer-name">${a.name || "Alarm"}</span>
                <span class="timer-countdown">🔔 Firing!</span>
              </div>
              <div class="timer-actions">
                <button class="btn btn-danger" data-dismiss-alarm="${a.id}">Dismiss</button>
              </div>
            </div>
          `).join("")}
        </div>
      ` : ""}

      <h2>Active Timers (${runningTimers.length})</h2>
      ${runningTimers.length > 0 ? `
        <div class="timer-list">
          ${runningTimers.map((t) => this._renderTimerCard(t)).join("")}
        </div>
      ` : '<div class="empty">No active timers</div>'}

      <h2>Alarms (${activeAlarms.length})</h2>
      ${activeAlarms.length > 0 ? `
        <div class="timer-list">
          ${activeAlarms.map((a) => `
            <div class="timer-card ${a.active ? "" : "disabled"}">
              <div class="timer-info">
                <span class="timer-name">${a.name || "Alarm"}</span>
                <span class="timer-time">⏰ ${a.time}${a.repeat_days && a.repeat_days.length ? " · Repeats" : ""}</span>
              </div>
              <div class="timer-meta">
                ${this._getSatName(a.satellite_id)}
                ${a.snooze_enabled ? " · Snooze on" : ""}
              </div>
              <div class="timer-actions">
                <button class="btn ${a.active ? "btn-secondary" : "btn-primary"}"
                        data-toggle-alarm="${a.id}"
                        data-toggle-to="${!a.active}">
                  ${a.active ? "Disable" : "Enable"}
                </button>
                <button class="btn btn-danger-outline" data-delete-alarm="${a.id}">Delete</button>
              </div>
            </div>
          `).join("")}
        </div>
      ` : '<div class="empty">No alarms configured</div>'}
    `;
  }

  _renderLog() {
    if (this._interactions.length === 0) {
      return '<div class="empty">No recent interactions</div>';
    }
    return `
      <div class="interaction-list">
        ${this._interactions.map((i) => this._renderInteraction(i)).join("")}
      </div>
    `;
  }

  _renderInteraction(interaction) {
    const time = new Date(interaction.timestamp).toLocaleTimeString();
    const date = new Date(interaction.timestamp).toLocaleDateString();
    const hasError = !!interaction.error;

    return `
      <div class="interaction-card ${hasError ? "error" : ""}">
        <div class="interaction-header">
          <span class="interaction-time">${date} ${time}</span>
          ${interaction.satellite_id ? `<span class="interaction-sat">${this._getSatName(interaction.satellite_id)}</span>` : ""}
          ${interaction.llm_provider ? `<span class="interaction-provider">${interaction.llm_provider}</span>` : ""}
          ${interaction.latency_ms ? `<span class="interaction-latency">${interaction.latency_ms}ms</span>` : ""}
        </div>
        ${interaction.transcript ? `<div class="interaction-transcript">"${interaction.transcript}"</div>` : ""}
        ${interaction.llm_response ? `<div class="interaction-response">→ ${interaction.llm_response}</div>` : ""}
        ${interaction.tools_called ? `<div class="interaction-tools">🔧 ${interaction.tools_called}</div>` : ""}
        ${interaction.ha_actions ? `<div class="interaction-actions">🏠 ${interaction.ha_actions}</div>` : ""}
        ${interaction.error ? `<div class="interaction-error">❌ ${interaction.error}</div>` : ""}
      </div>
    `;
  }

  _getStyles() {
    return `
      :host { display: block; }
      * { box-sizing: border-box; margin: 0; padding: 0; }

      .panel {
        font-family: var(--paper-font-body1_-_font-family, "Roboto", sans-serif);
        color: var(--primary-text-color, #333);
        background: var(--primary-background-color, #fafafa);
        min-height: 100vh;
      }

      .header {
        background: var(--card-background-color, #fff);
        border-bottom: 1px solid var(--divider-color, #e0e0e0);
        padding: 16px 24px;
        position: sticky;
        top: 0;
        z-index: 10;
      }

      .header-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }

      .header h1 {
        font-size: 20px;
        font-weight: 500;
        color: var(--primary-text-color);
      }

      .btn-icon {
        background: none;
        border: none;
        font-size: 18px;
        cursor: pointer;
        padding: 6px;
        border-radius: 50%;
        transition: background 0.2s;
      }
      .btn-icon:hover { background: var(--secondary-background-color, #f0f0f0); }

      .tabs { display: flex; gap: 4px; }

      .tab {
        padding: 8px 16px;
        border: none;
        background: transparent;
        color: var(--secondary-text-color, #666);
        cursor: pointer;
        border-radius: 8px;
        font-size: 14px;
        transition: all 0.2s;
      }
      .tab:hover { background: var(--secondary-background-color, #f0f0f0); }
      .tab.active { background: var(--primary-color, #03a9f4); color: #fff; }

      .content { padding: 24px; max-width: 1200px; }

      h2 {
        font-size: 16px;
        font-weight: 500;
        margin: 24px 0 12px;
        color: var(--primary-text-color);
      }
      h2:first-child { margin-top: 0; }
      h3 { font-size: 15px; font-weight: 500; margin-bottom: 12px; }

      .section-firing { color: var(--error-color, #db4437); }

      .section-actions {
        display: flex;
        gap: 8px;
        margin-bottom: 16px;
      }

      .stats-row {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 12px;
        margin-bottom: 8px;
      }

      .stat-card {
        background: var(--card-background-color, #fff);
        border-radius: 12px;
        padding: 16px;
        text-align: center;
        border: 1px solid var(--divider-color, #e0e0e0);
      }
      .stat-card.firing { border-color: var(--error-color, #db4437); animation: pulse 1s infinite; }
      .stat-value { font-size: 28px; font-weight: 700; color: var(--primary-color, #03a9f4); }
      .stat-card.firing .stat-value { color: var(--error-color, #db4437); }
      .stat-label { font-size: 12px; color: var(--secondary-text-color, #666); margin-top: 4px; }

      .card-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 12px;
      }

      .sat-card {
        background: var(--card-background-color, #fff);
        border-radius: 12px;
        padding: 16px;
        border: 1px solid var(--divider-color, #e0e0e0);
      }
      .sat-card.offline { opacity: 0.6; }

      .sat-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
      .sat-indicator { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
      .sat-name { font-weight: 500; font-size: 15px; flex: 1; }
      .sat-type {
        font-size: 11px; padding: 2px 6px; border-radius: 4px;
        background: var(--secondary-background-color, #f0f0f0);
        color: var(--secondary-text-color); text-transform: uppercase;
      }
      .sat-state { font-size: 13px; font-weight: 500; margin-bottom: 6px; }
      .sat-transcript, .sat-response {
        font-size: 12px; color: var(--secondary-text-color);
        margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .sat-transcript { font-style: italic; }
      .sat-meta { font-size: 11px; color: var(--disabled-text-color, #999); margin-top: 6px; }

      .timer-list { display: flex; flex-direction: column; gap: 8px; }

      .timer-card {
        background: var(--card-background-color, #fff);
        border-radius: 12px;
        padding: 14px 16px;
        border: 1px solid var(--divider-color, #e0e0e0);
      }
      .timer-card.firing { border-color: var(--error-color, #db4437); animation: pulse 1s infinite; }
      .timer-card.disabled { opacity: 0.5; }

      .timer-info { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
      .timer-name { font-weight: 500; font-size: 14px; }
      .timer-countdown {
        font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums;
        color: var(--primary-color, #03a9f4);
      }
      .timer-card.firing .timer-countdown { color: var(--error-color, #db4437); }
      .timer-time { font-size: 14px; color: var(--secondary-text-color); }
      .timer-meta { font-size: 11px; color: var(--disabled-text-color, #999); margin-bottom: 6px; }

      .timer-progress {
        height: 4px; background: var(--divider-color, #e0e0e0);
        border-radius: 2px; margin-bottom: 8px; overflow: hidden;
      }
      .timer-bar {
        height: 100%; background: var(--primary-color, #03a9f4);
        border-radius: 2px; transition: width 1s linear;
      }

      .timer-actions { display: flex; gap: 8px; justify-content: flex-end; }

      .btn {
        padding: 6px 14px; border: none; border-radius: 8px;
        cursor: pointer; font-size: 13px; font-weight: 500; transition: opacity 0.2s;
      }
      .btn:hover { opacity: 0.85; }
      .btn-primary { background: var(--primary-color, #03a9f4); color: #fff; }
      .btn-danger { background: var(--error-color, #db4437); color: #fff; }
      .btn-danger-outline {
        background: transparent; color: var(--error-color, #db4437);
        border: 1px solid var(--error-color, #db4437);
      }
      .btn-secondary { background: var(--secondary-background-color, #e0e0e0); color: var(--primary-text-color); }

      .create-form {
        background: var(--card-background-color, #fff);
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: 12px;
        padding: 16px;
        margin-bottom: 16px;
      }

      .form-row {
        margin-bottom: 12px;
      }
      .form-row label {
        display: block;
        font-size: 12px;
        font-weight: 500;
        color: var(--secondary-text-color);
        margin-bottom: 4px;
      }
      .form-row input, .form-row select {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: 8px;
        font-size: 14px;
        background: var(--primary-background-color, #fafafa);
        color: var(--primary-text-color);
      }

      .duration-inputs {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .duration-inputs input {
        width: 60px;
        text-align: center;
      }
      .duration-inputs span {
        font-size: 13px;
        color: var(--secondary-text-color);
      }

      .form-actions {
        display: flex;
        gap: 8px;
        margin-top: 12px;
      }

      .interaction-list { display: flex; flex-direction: column; gap: 8px; }

      .interaction-card {
        background: var(--card-background-color, #fff);
        border-radius: 12px;
        padding: 12px 16px;
        border: 1px solid var(--divider-color, #e0e0e0);
      }
      .interaction-card.error { border-left: 3px solid var(--error-color, #db4437); }

      .interaction-header { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; }
      .interaction-time { font-size: 11px; color: var(--disabled-text-color, #999); }
      .interaction-sat, .interaction-provider, .interaction-latency {
        font-size: 10px; padding: 1px 6px; border-radius: 4px;
        background: var(--secondary-background-color, #f0f0f0); color: var(--secondary-text-color);
      }
      .interaction-transcript { font-size: 13px; font-style: italic; margin-bottom: 2px; }
      .interaction-response { font-size: 13px; color: var(--primary-text-color); }
      .interaction-tools, .interaction-actions { font-size: 11px; color: var(--secondary-text-color); margin-top: 4px; }
      .interaction-error { font-size: 12px; color: var(--error-color, #db4437); margin-top: 4px; }

      .empty { text-align: center; padding: 32px; color: var(--secondary-text-color, #666); font-size: 14px; }

      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }

      @media (max-width: 600px) {
        .content { padding: 12px; }
        .stats-row { grid-template-columns: 1fr; }
        .card-grid { grid-template-columns: 1fr; }
        .tabs { flex-wrap: wrap; }
      }
    `;
  }
}

customElements.define("voice-assistant-panel", VoiceAssistantPanel);
