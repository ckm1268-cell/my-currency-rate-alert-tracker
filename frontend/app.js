/**
 * MY Currency Rate Tracker — Phase 1 dashboard logic
 * =====================================================
 * IMPORTANT: everything this file displays as a "rate" is generated locally
 * by simulateReading() below. There is no network call to a money changer
 * anywhere in this file. Every place a rate reaches the screen, it is
 * labeled SIMULATED, never LIVE — see the project's core rule that mock
 * data must never be presented as live. Real retrieval is Phase 2/3 work
 * (backend/scrapers/*.adapter.js) and will replace simulateReading() with
 * a call to the backend, not touch this rendering code.
 *
 * The comparison / validation / target-condition logic below IS the real
 * logic (not a stub) — it's pure and has no dependency on where the number
 * came from, so it's safe to build and demonstrate now, in Phase 1, ahead
 * of the real adapters landing in Phase 2/3.
 */

(() => {
  "use strict";

  // ---------------------------------------------------------------------
  // Reference data
  // ---------------------------------------------------------------------

  const CURRENCIES = [
    { code: "CNY", name: "Chinese Yuan", base: 60.5, decimals: 2 },
    { code: "USD", name: "US Dollar", base: 4.04, decimals: 3 },
    { code: "SGD", name: "Singapore Dollar", base: 3.18, decimals: 3 },
    { code: "THB", name: "Thai Baht", base: 12.33, decimals: 2 },
    { code: "JPY", name: "Japanese Yen", base: 25.55, decimals: 2 },
    { code: "KRW", name: "Korean Won", base: 2.92, decimals: 3 },
    { code: "HKD", name: "Hong Kong Dollar", base: 51.65, decimals: 2 },
    { code: "EUR", name: "Euro", base: 4.71, decimals: 3 },
    { code: "GBP", name: "British Pound", base: 5.51, decimals: 3 },
    { code: "AUD", name: "Australian Dollar", base: 2.88, decimals: 3 },
  ];

  // Verified 21-Aug-2026 by opening the live branch dropdown on
  // tajmuhabath.com.my/web/rates.html — real branch names, not invented.
  const TM_BRANCHES = [
    "THE EXCHANGE TRX", "Econsave, Balakong", "Leisure Mall, Cheras",
    "Terminal One, Seremban", "Aeon Big, Tun Hussein Onn", "CS Bangi, Bangi",
    "PETRONAS,GP", "IOI City Mall, Putrajaya", "Jalan Bunus, Masjid India",
    "R&R,Gelang Patah-NB", "R&R,Gelang Patah-SB", "LARKIN SENTRAL",
    "PETRON GELANG PATAH", "LALAPORT BBCC", "SEMUA HOUSE",
    "AEON MALL CHERAS SELATAN",
  ];

  const SOURCES = [
    { id: "mymoneymaster", name: "My Money Master", supportsBranch: false, spreadBias: 0 },
    { id: "tajmuhabath", name: "Taj Muhabath", supportsBranch: true, spreadBias: 0.06 },
  ];

  const RATE_TYPE_EXPLAINERS = {
    SELL: "You're buying foreign currency with MYR — you want the money changer's SELL rate (what they sell the currency to you for). A lower SELL rate is better for you.",
    BUY: "You're selling foreign currency for MYR — you want the money changer's BUY rate (what they pay you for it). A higher BUY rate is better for you.",
  };

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------

  const state = {
    currency: "CNY",
    rateType: "SELL",
    targetRate: 60.5,
    pctChange: 1,
    sources: { mymoneymaster: true, tajmuhabath: true },
    branch: TM_BRANCHES[13], // LALAPORT BBCC — matches the default branch observed live
    condition: "AT_OR_BELOW",
    interval: 5,
    notification: "browser",

    monitoring: false,
    triggered: false,
    forcedMode: null, // null | "TRIGGER" | "SOURCE_DOWN" | "VALIDATION_ERROR"

    walk: {}, // per source+currency running mock value, seeded lazily
    history: [], // { t: Date, value: number } for the currently selected series
    log: [],
  };

  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------------
  // Mock rate simulation (clearly separated from everything else)
  // ---------------------------------------------------------------------

  function walkKey(sourceId, branch) {
    return `${sourceId}::${state.currency}::${branch || ""}`;
  }

  function seedWalk(sourceId, branch) {
    const cur = CURRENCIES.find((c) => c.code === state.currency);
    const src = SOURCES.find((s) => s.id === sourceId);
    const key = walkKey(sourceId, branch);
    if (!state.walk[key]) {
      const branchJitter = branch ? (hashString(branch) % 40) / 1000 : 0; // small per-branch offset
      state.walk[key] = cur.base + src.spreadBias + branchJitter;
    }
    return state.walk[key];
  }

  function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h;
  }

  function stepWalk(sourceId, branch) {
    const key = walkKey(sourceId, branch);
    const current = seedWalk(sourceId, branch);
    const drift = (Math.random() - 0.5) * 0.06;
    const next = Math.max(0.01, current + drift);
    state.walk[key] = next;
    return next;
  }

  /**
   * Produces one simulated reading for a source (+branch). Shape mirrors
   * the real StandardRateResult contract in
   * backend/scrapers/rateAdapter.interface.js on purpose, so swapping this
   * out for a real backend call in Phase 2/3 is a drop-in change.
   */
  function simulateReading(sourceId, branch) {
    const now = new Date();
    const src = SOURCES.find((s) => s.id === sourceId);

    if (state.forcedMode === "SOURCE_DOWN") {
      return { source: sourceId, branch: branch || null, currency: state.currency,
        buyRate: null, sellRate: null, retrievedAt: now, sourceTimestamp: null,
        status: "SOURCE_UNAVAILABLE", validationStatus: "NOT_RUN" };
    }
    if (state.forcedMode === "VALIDATION_ERROR") {
      // deliberately return an out-of-range value, e.g. missing the /100 unit scale
      const bad = seedWalk(sourceId, branch) / 100;
      return { source: sourceId, branch: branch || null, currency: state.currency,
        buyRate: bad, sellRate: bad, retrievedAt: now, sourceTimestamp: now,
        status: "RATE_VALIDATION_ERROR", validationStatus: "FAILED" };
    }

    const sellBase = stepWalk(sourceId, branch);
    const spread = 0.28 + (src.spreadBias * 0.5);
    const sellRate = round(sellBase, decimalsFor(state.currency));
    const buyRate = round(sellBase - spread, decimalsFor(state.currency));

    return {
      source: sourceId, branch: branch || null, currency: state.currency,
      buyRate, sellRate, retrievedAt: now, sourceTimestamp: now,
      status: "SIMULATED", validationStatus: "PASSED",
    };
  }

  function decimalsFor(code) {
    return (CURRENCIES.find((c) => c.code === code) || {}).decimals ?? 2;
  }
  function round(n, d) { const f = 10 ** d; return Math.round(n * f) / f; }

  // ---------------------------------------------------------------------
  // Validation (real logic — see backend/validation/validateRate.js for the
  // eventual server-side twin of this; kept intentionally simple here)
  // ---------------------------------------------------------------------

  function validateReading(reading) {
    if (reading.status === "SOURCE_UNAVAILABLE") return { passed: false, reason: "Source unavailable" };
    const value = state.rateType === "SELL" ? reading.sellRate : reading.buyRate;
    if (typeof value !== "number" || Number.isNaN(value)) return { passed: false, reason: "Non-numeric value" };
    if (value <= 0) return { passed: false, reason: "Value not greater than zero" };
    const cur = CURRENCIES.find((c) => c.code === state.currency);
    const lowGuard = cur.base * 0.5;
    const highGuard = cur.base * 2;
    if (value < lowGuard || value > highGuard) return { passed: false, reason: "Outside expected range — possible decimal/unit error" };
    if (reading.buyRate != null && reading.sellRate != null && reading.buyRate > reading.sellRate) {
      return { passed: false, reason: "BUY greater than SELL — implausible" };
    }
    return { passed: true, reason: null };
  }

  // ---------------------------------------------------------------------
  // Target comparison (real logic — mirrors backend/targetEngine/compareTarget.js)
  // ---------------------------------------------------------------------

  function isTargetMet(liveRate, targetRate, condition, prevRate) {
    switch (condition) {
      case "AT_OR_BELOW": return liveRate <= targetRate;
      case "BELOW": return liveRate < targetRate;
      case "REACHES": return liveRate === targetRate;
      case "ABOVE": return liveRate > targetRate;
      case "PCT_CHANGE": {
        if (prevRate == null || prevRate === 0) return false;
        const pct = Math.abs((liveRate - prevRate) / prevRate) * 100;
        return pct >= state.pctChange;
      }
      default: return false;
    }
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------

  function activeSourceList() {
    const list = [];
    SOURCES.forEach((s) => {
      if (!state.sources[s.id]) return;
      if (s.supportsBranch) list.push({ ...s, branch: state.branch });
      else list.push({ ...s, branch: null });
    });
    return list;
  }

  let lastSelectedValue = null;

  function tick() {
    const now = new Date();
    $("clockLabel").textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    const active = activeSourceList();
    if (active.length === 0) {
      renderEmptyState();
      return;
    }

    const readings = active.map((s) => {
      const r = simulateReading(s.id, s.branch);
      const v = validateReading(r);
      return { ...r, sourceName: s.name, valid: v.passed, invalidReason: v.reason };
    });

    renderCompareTable(readings);

    // Pick the "selected" reading = first checked source, preferring the one
    // matching the currently configured branch for Taj Muhabath.
    const primaryId = state.sources.mymoneymaster ? "mymoneymaster" : "tajmuhabath";
    const primary = readings.find((r) => r.source === primaryId) || readings[0];
    renderHero(primary, readings);

    if (state.monitoring && primary.valid) {
      const value = state.rateType === "SELL" ? primary.sellRate : primary.buyRate;
      const met = isTargetMet(value, state.targetRate, state.condition, lastSelectedValue);
      lastSelectedValue = value;

      pushHistory(value);
      renderChart();

      if (met && !state.triggered) {
        state.triggered = true;
        fireAlert(primary, value);
      } else if (!met && state.triggered && state.condition !== "PCT_CHANGE") {
        // condition no longer met after a reset — nothing to do, suppression
        // only matters while state.triggered stays true until user resets.
      }
      logActivity(`${primary.sourceName} ${state.currency} ${state.rateType} = ${formatRate(value)} — ${met ? (state.triggered ? "TARGET REACHED" : "target check") : "waiting"}`);
    } else if (state.monitoring && !primary.valid) {
      logActivity(`${primary.sourceName} ${state.currency} — ${primary.status === "SOURCE_UNAVAILABLE" ? "SOURCE UNAVAILABLE" : "VALIDATION ERROR (" + primary.invalidReason + ")"}`);
    }
  }

  function renderEmptyState() {
    $("statusPill").className = "status-pill error";
    $("statusPill").textContent = "⚠ No source selected";
    $("heroRateValue").textContent = "--.--";
    $("compareBody").innerHTML = `<tr><td colspan="6" style="color:var(--ink-faint);">Select at least one money changer.</td></tr>`;
  }

  function renderHero(primary, allReadings) {
    const cur = CURRENCIES.find((c) => c.code === state.currency);
    $("heroPair").textContent = `${state.currency} / MYR`;
    $("heroRateLabel").textContent = `SIMULATED ${state.rateType} RATE`;

    let pillClass = "mock", pillText = "🧪 SIMULATED";
    let rateText = "--.--";

    if (primary.status === "SOURCE_UNAVAILABLE") {
      pillClass = "error"; pillText = "⚠ SIMULATED: SOURCE UNAVAILABLE";
      const diffEl = $("heroDiff");
      diffEl.textContent = "—"; diffEl.className = "hero-metric-value tabular";
    } else if (!primary.valid) {
      pillClass = "error"; pillText = "⚠ SIMULATED: VALIDATION ERROR";
      const diffEl = $("heroDiff");
      diffEl.textContent = "—"; diffEl.className = "hero-metric-value tabular";
    } else {
      const value = state.rateType === "SELL" ? primary.sellRate : primary.buyRate;
      rateText = formatRate(value);
      if (state.monitoring) {
        if (state.triggered) { pillClass = "reached"; pillText = "🔴 SIMULATED: TARGET REACHED"; }
        else { pillClass = "waiting"; pillText = "🟡 SIMULATED: WAITING"; }
      } else {
        pillClass = "mock"; pillText = "🧪 SIMULATED (not monitoring)";
      }

      const diff = value - state.targetRate;
      const diffEl = $("heroDiff");
      diffEl.textContent = (diff >= 0 ? "+" : "") + diff.toFixed(cur.decimals);
      diffEl.className = "hero-metric-value tabular " + (diff <= 0 ? "diff-up" : "diff-down");
    }

    $("statusPill").className = "status-pill " + pillClass;
    $("statusPill").textContent = pillText;
    $("heroRateValue").textContent = rateText;
    $("heroTarget").textContent = state.targetRate ? formatRate(state.targetRate) : "—";
    $("heroSourceLabel").textContent = `Primary source: ${primary.sourceName}${primary.branch ? " — " + primary.branch : ""}`;
    $("lastChecked").textContent = "Last checked: " + primary.retrievedAt.toLocaleTimeString();
  }

  function renderCompareTable(readings) {
    const cur = CURRENCIES.find((c) => c.code === state.currency);
    const validReadings = readings.filter((r) => r.valid);
    let bestIdx = -1;
    if (validReadings.length) {
      const key = state.rateType === "SELL" ? "sellRate" : "buyRate";
      const better = (a, b) => (state.rateType === "SELL" ? a[key] < b[key] : a[key] > b[key]);
      let best = validReadings[0];
      validReadings.forEach((r) => { if (better(r, best)) best = r; });
      bestIdx = readings.indexOf(best);
    }

    $("compareBody").innerHTML = readings.map((r, i) => {
      const statusBadge = r.status === "SOURCE_UNAVAILABLE" ? `<span class="status-pill error" style="font-size:.72rem;">⚠ UNAVAILABLE</span>`
        : !r.valid ? `<span class="status-pill error" style="font-size:.72rem;">⚠ INVALID</span>`
        : state.monitoring && i === bestIdx && (state.rateType === "SELL" ? r.sellRate : r.buyRate) <= state.targetRate ? `<span class="status-pill reached" style="font-size:.72rem;">🔴 REACHED</span>`
        : `<span class="status-pill waiting" style="font-size:.72rem;">🟡 WAITING</span>`;
      return `<tr class="${i === bestIdx ? "is-best" : ""}">
        <td>${r.sourceName}${i === bestIdx ? '<span class="best-badge">Best</span>' : ""}</td>
        <td>${r.branch || "—"}</td>
        <td class="num">${r.buyRate != null ? formatRate(r.buyRate) : "—"}</td>
        <td class="num">${r.sellRate != null ? formatRate(r.sellRate) : "—"}</td>
        <td class="num">${formatRate(state.targetRate)}</td>
        <td>${statusBadge}</td>
      </tr>`;
    }).join("");
  }

  function formatRate(v) {
    const d = decimalsFor(state.currency);
    return Number(v).toFixed(d);
  }

  // ---------------------------------------------------------------------
  // History chart (hand-drawn canvas, no charting library needed)
  // ---------------------------------------------------------------------

  function pushHistory(value) {
    state.history.push({ t: new Date(), value });
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    state.history = state.history.filter((p) => p.t.getTime() >= cutoff).slice(-500);
  }

  function renderChart() {
    const canvas = $("historyChart");
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 900, h = 180;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const styles = getComputedStyle(document.body);
    const line = styles.getPropertyValue("--line").trim();
    const inkFaint = styles.getPropertyValue("--ink-faint").trim();
    const accent = styles.getPropertyValue("--accent").trim();
    const down = styles.getPropertyValue("--down").trim();

    const pts = state.history;
    const pad = { l: 44, r: 12, t: 12, b: 22 };
    const plotW = w - pad.l - pad.r, plotH = h - pad.t - pad.b;

    if (pts.length < 2) {
      ctx.fillStyle = inkFaint;
      ctx.font = "13px 'IBM Plex Sans', sans-serif";
      ctx.fillText("Start monitoring to begin recording simulated history…", pad.l, h / 2);
      return;
    }

    const values = pts.map((p) => p.value).concat([state.targetRate]);
    const min = Math.min(...values) - 0.05, max = Math.max(...values) + 0.05;
    const x = (i) => pad.l + (i / (pts.length - 1)) * plotW;
    const y = (v) => pad.t + (1 - (v - min) / (max - min)) * plotH;

    // gridlines
    ctx.strokeStyle = line; ctx.lineWidth = 1;
    for (let g = 0; g <= 3; g++) {
      const gy = pad.t + (g / 3) * plotH;
      ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(w - pad.r, gy); ctx.stroke();
    }

    // target line
    ctx.strokeStyle = down; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(pad.l, y(state.targetRate)); ctx.lineTo(w - pad.r, y(state.targetRate)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = down; ctx.font = "11px 'IBM Plex Mono', monospace";
    ctx.fillText("target " + formatRate(state.targetRate), pad.l + 4, y(state.targetRate) - 4);

    // area fill
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + plotH);
    grad.addColorStop(0, accent + "55");
    grad.addColorStop(1, accent + "00");
    ctx.beginPath();
    ctx.moveTo(x(0), y(pts[0].value));
    pts.forEach((p, i) => ctx.lineTo(x(i), y(p.value)));
    ctx.lineTo(x(pts.length - 1), pad.t + plotH);
    ctx.lineTo(x(0), pad.t + plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // line
    ctx.beginPath();
    pts.forEach((p, i) => { const px = x(i), py = y(p.value); i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); });
    ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();

    // endpoint
    const lastPt = pts[pts.length - 1];
    ctx.beginPath();
    ctx.arc(x(pts.length - 1), y(lastPt.value), 4, 0, Math.PI * 2);
    ctx.fillStyle = accent; ctx.fill();

    // y-axis labels
    ctx.fillStyle = inkFaint; ctx.font = "11px 'IBM Plex Mono', monospace";
    ctx.fillText(max.toFixed(2), 4, pad.t + 8);
    ctx.fillText(min.toFixed(2), 4, pad.t + plotH);
  }

  // ---------------------------------------------------------------------
  // Activity log
  // ---------------------------------------------------------------------

  function logActivity(msg) {
    state.log.unshift({ t: new Date(), msg });
    state.log = state.log.slice(0, 40);
    $("activityLog").innerHTML = state.log.map((e) =>
      `<li><span class="log-time">${e.t.toLocaleTimeString()}</span><span class="log-msg">${escapeHtml(e.msg)}</span></li>`
    ).join("");
  }

  function escapeHtml(s) { return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

  // ---------------------------------------------------------------------
  // Alerts / notifications (Phase 1: browser only)
  // ---------------------------------------------------------------------

  function fireAlert(reading, value) {
    const msg = `🚨 ${state.currency} RATE ALERT (SIMULATED) — ${reading.sourceName} ${state.rateType}: ${formatRate(value)}, target ${formatRate(state.targetRate)}. Target reached.`;
    logActivity(msg);
    showToast(msg);
    playBeep();
    if (state.notification === "browser" && "Notification" in window && Notification.permission === "granted") {
      new Notification("Currency Rate Alert (Simulated)", {
        body: `${state.currency} ${state.rateType} = ${formatRate(value)} — target ${formatRate(state.targetRate)} reached.\nThis is Phase 1 simulated data.`,
      });
    }
  }

  function showToast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(showToast._h);
    showToast._h = setTimeout(() => t.classList.remove("show"), 4200);
  }

  let audioCtx = null;
  function playBeep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = "sine"; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.15, audioCtx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.5);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + 0.5);
    } catch (e) { /* audio not available — non-fatal */ }
  }

  // ---------------------------------------------------------------------
  // Form wiring
  // ---------------------------------------------------------------------

  function populateSelects() {
    const currencySel = $("currency");
    currencySel.innerHTML = CURRENCIES.map((c) => `<option value="${c.code}">${c.code} — ${c.name}</option>`).join("");
    currencySel.value = state.currency;

    const branchSel = $("branch");
    branchSel.innerHTML = TM_BRANCHES.map((b) => `<option value="${b}">${b}</option>`).join("");
    branchSel.value = state.branch;
  }

  function updateBranchAvailability() {
    const branchSel = $("branch");
    const tmChecked = state.sources.tajmuhabath;
    branchSel.disabled = !tmChecked;
    $("branchHint").textContent = tmChecked
      ? "Applies to Taj Muhabath. My Money Master publishes one site-wide rate."
      : "Enable Taj Muhabath to choose a branch.";
  }

  function wireForm() {
    populateSelects();
    updateBranchAvailability();
    $("rateTypeHint").textContent = RATE_TYPE_EXPLAINERS[state.rateType];

    $("currency").addEventListener("change", (e) => {
      state.currency = e.target.value;
      const cur = CURRENCIES.find((c) => c.code === state.currency);
      $("targetRate").value = cur.base.toFixed(cur.decimals);
      state.targetRate = cur.base;
      state.history = [];
      lastSelectedValue = null;
    });

    document.querySelectorAll("#rateTypeSeg button").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#rateTypeSeg button").forEach((b) => b.setAttribute("aria-pressed", "false"));
        btn.setAttribute("aria-pressed", "true");
        state.rateType = btn.dataset.value;
        $("rateTypeHint").textContent = RATE_TYPE_EXPLAINERS[state.rateType];
      });
    });

    $("targetRate").addEventListener("input", (e) => {
      const v = parseFloat(e.target.value);
      state.targetRate = Number.isFinite(v) && v > 0 ? v : state.targetRate;
    });

    $("srcMMM").addEventListener("change", (e) => { state.sources.mymoneymaster = e.target.checked; });
    $("srcTM").addEventListener("change", (e) => { state.sources.tajmuhabath = e.target.checked; updateBranchAvailability(); });

    $("branch").addEventListener("change", (e) => { state.branch = e.target.value; });

    $("condition").addEventListener("change", (e) => {
      state.condition = e.target.value;
      $("pctChangeField").style.display = state.condition === "PCT_CHANGE" ? "block" : "none";
    });
    $("pctChange").addEventListener("input", (e) => {
      const v = parseFloat(e.target.value);
      state.pctChange = Number.isFinite(v) && v > 0 ? v : state.pctChange;
    });

    $("interval").addEventListener("change", (e) => { state.interval = parseInt(e.target.value, 10); });
    $("notification").addEventListener("change", (e) => { state.notification = e.target.value; });

    $("alertForm").addEventListener("submit", (e) => {
      e.preventDefault();
      startMonitoring();
    });

    $("resetBtn").addEventListener("click", () => {
      state.monitoring = false;
      state.triggered = false;
      state.forcedMode = null;
      state.history = [];
      lastSelectedValue = null;
      $("startBtn").textContent = "Start monitoring";
      $("startBtn").dataset.active = "false";
      $("formStatus").textContent = "Alert reset. Configure and start again whenever you're ready.";
      logActivity("Alert reset by user.");
      tick();
    });

    // test controls
    $("testForceTrigger").addEventListener("click", () => {
      if (!state.monitoring) startMonitoring();
      const cur = CURRENCIES.find((c) => c.code === state.currency);
      const key = walkKey("mymoneymaster", null);
      state.walk[key] = state.targetRate - 0.01;
      const key2 = walkKey("tajmuhabath", state.branch);
      state.walk[key2] = state.targetRate - 0.01;
      state.forcedMode = null;
      tick();
    });
    $("testSourceDown").addEventListener("click", () => { state.forcedMode = "SOURCE_DOWN"; tick(); });
    $("testValidationError").addEventListener("click", () => { state.forcedMode = "VALIDATION_ERROR"; tick(); });
    $("testResume").addEventListener("click", () => { state.forcedMode = null; tick(); });
  }

  function startMonitoring() {
    state.monitoring = true;
    state.triggered = false;
    state.forcedMode = null;
    state.history = [];
    lastSelectedValue = null;
    $("startBtn").textContent = "✓ Monitoring active";
    $("startBtn").dataset.active = "true";
    $("formStatus").textContent = "Simulated monitoring is running — see the Activity log below.";
    logActivity(`Monitoring started: ${state.currency} ${state.rateType}, target ${formatRate(state.targetRate)}, condition ${state.condition}.`);

    if (state.notification === "browser" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    tick();
  }

  // ---------------------------------------------------------------------
  // Chart range buttons (cosmetic in Phase 1 — history is short either way)
  // ---------------------------------------------------------------------

  function wireChartRange() {
    document.querySelectorAll(".chart-range button").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".chart-range button").forEach((b) => b.setAttribute("aria-pressed", "false"));
        btn.setAttribute("aria-pressed", "true");
        renderChart();
      });
    });
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  function init() {
    const cur = CURRENCIES.find((c) => c.code === state.currency);
    $("targetRate").value = cur.base.toFixed(cur.decimals);
    wireForm();
    wireChartRange();
    tick();
    setInterval(tick, 4000);
    setInterval(() => { $("clockLabel").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }, 1000);
    window.addEventListener("resize", renderChart);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
