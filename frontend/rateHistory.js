/**
 * Rate history chart — Phase 10 (real, Supabase-backed)
 * ==========================================================
 * STATUS: implemented, 22-Aug-2026. Loaded after app.js and auth.js.
 *
 * Through Phase 9, the "Rate history" card (see app.js's renderChart(),
 * now renamed renderSimulatedChart()) only ever drew THIS browser tab's own
 * in-memory `state.history` — real readings while monitoring a real source,
 * but never persisted, and lost the moment the tab closed or reloaded. That
 * was an honest reflection of what existed at the time, not a bug — but it
 * meant the chart could never show real multi-hour/multi-day trends the way
 * the project brief's section 19 mockup describes, even though Phase 8's
 * scheduler has been writing every reading (LIVE or not) to the `rates`
 * table since 22-Aug-2026.
 *
 * This file adds that: for a SIGNED-IN user (the `rates` table's Row-Level
 * Security policy is `to authenticated` — see database/schema.sql — so a
 * signed-out request would simply get nothing back even if this file tried),
 * it queries real rows from `rates` for the currently selected currency,
 * rate type, and money changer(s) — mirroring the exact per-source,
 * per-branch combo model backend/scheduler/comboSelection.js already uses,
 * so "what this chart plots" and "what the scheduler actually checked and
 * wrote" are the same thing — and draws them for whichever range (1h/6h/
 * 24h/7d) is currently selected.
 *
 * Integration: rather than duplicating app.js's canvas-drawing setup or
 * reaching into its closed-over state, this file uses the narrow bridge
 * app.js already exposes for exactly this purpose —
 * window.CKM.renderRealHistory(canvas): set here, called by app.js's own
 * renderChart() dispatcher first; returning true means "I drew something,
 * don't also draw the default chart," false/undefined falls back to
 * app.js's original in-session chart (window.CKM.renderDefaultChart).
 *
 * Like auth.js, this file is entirely additive and fails soft: if Supabase
 * isn't configured, or the Supabase JS library didn't load, this file
 * simply never sets window.CKM.renderRealHistory at all — the dashboard's
 * original Phase 1-9 chart behavior is completely unaffected.
 */

(() => {
  "use strict";

  const RANGE_MS = { "1h": 3600e3, "6h": 6 * 3600e3, "24h": 24 * 3600e3, "7d": 7 * 24 * 3600e3 };
  const RANGE_LABELS = { "1h": "the last hour", "6h": "the last 6 hours", "24h": "the last 24 hours", "7d": "the last 7 days" };

  const SOURCE_LABELS = { mymoneymaster: "My Money Master", tajmuhabath: "Taj Muhabath" };
  const SOURCE_COLORS = { mymoneymaster: "#2f6fed", tajmuhabath: "#c2650f" }; // distinct, both readable on light/dark

  const $ = (id) => document.getElementById(id);

  let sb = null;
  let signedIn = false;
  let currentRange = "1h";
  let cache = { key: null, points: [], loading: false, error: null };

  // -------------------------------------------------------------------------
  // Config / setup (mirrors auth.js's own isConfigured() check exactly)
  // -------------------------------------------------------------------------

  function isConfigured() {
    const url = window.CKM_SUPABASE_URL;
    const key = window.CKM_SUPABASE_ANON_KEY;
    return (
      typeof url === "string" && url && url !== "YOUR_SUPABASE_PROJECT_URL" &&
      typeof key === "string" && key && key !== "YOUR_SUPABASE_ANON_KEY" &&
      typeof window.supabase !== "undefined" && typeof window.supabase.createClient === "function"
    );
  }

  function setModeHint(text) {
    const el = $("historyModeHint");
    if (el) el.textContent = text || "";
  }

  // -------------------------------------------------------------------------
  // Data
  // -------------------------------------------------------------------------

  function currentSelection() {
    if (typeof window.CKM === "undefined" || typeof window.CKM.getState !== "function") return null;
    const state = window.CKM.getState();
    const sourceIds = Object.keys(state.sources || {}).filter((k) => state.sources[k]);
    return { currency: state.currency, rateType: state.rateType, sourceIds, branch: state.branch };
  }

  function cacheKey(sel, range) {
    return `${sel.currency}::${sel.rateType}::${sel.sourceIds.slice().sort().join("+")}::${sel.branch}::${range}`;
  }

  /**
   * One query per selected source, each filtered the same way
   * comboSelection.js's getRequiredCombos() would build a combo for it
   * (branch only applies to a source that actually supports one) — run in
   * parallel, then merged and sorted by time. Only ever plots status =
   * 'LIVE' rows: an EXTRACTION_ERROR/SOURCE_UNAVAILABLE row has no real
   * rate value to plot, and silently charting a null/failed reading as if
   * it were a data point would be exactly the kind of false-freshness bug
   * the project brief's Error Handling section warns against.
   */
  async function fetchHistory(sel, range) {
    const since = new Date(Date.now() - RANGE_MS[range]).toISOString();
    const rateCol = sel.rateType === "SELL" ? "sell_rate" : "buy_rate";

    const queries = sel.sourceIds.map((sourceId) => {
      let q = sb.from("rates")
        .select(`source,branch,${rateCol},created_at`)
        .eq("currency", sel.currency)
        .eq("source", sourceId)
        .eq("status", "LIVE")
        .gte("created_at", since)
        .order("created_at", { ascending: true })
        .limit(1000);
      q = sourceId === "tajmuhabath" && sel.branch ? q.eq("branch", sel.branch) : q.is("branch", null);
      return q;
    });

    const results = await Promise.all(queries);
    const failed = results.find((r) => r.error);
    if (failed) throw failed.error;

    return results
      .flatMap((r) => r.data || [])
      .map((r) => ({ t: new Date(r.created_at), value: Number(r[rateCol]), source: r.source }))
      .filter((p) => Number.isFinite(p.value))
      .sort((a, b) => a.t - b.t);
  }

  // -------------------------------------------------------------------------
  // Drawing (hand-rolled canvas, same tools as app.js's renderSimulatedChart
  // — real timestamps on the x-axis instead of "however many ticks have
  // happened this session", per-source colored series, target line)
  // -------------------------------------------------------------------------

  function draw(canvas, sel, range, points, loading, error) {
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 900, h = 180;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const styles = getComputedStyle(document.body);
    const line = styles.getPropertyValue("--line").trim();
    const inkFaint = styles.getPropertyValue("--ink-faint").trim();
    const down = styles.getPropertyValue("--down").trim();
    const pad = { l: 48, r: 12, t: 12, b: 24 };
    const plotW = w - pad.l - pad.r, plotH = h - pad.t - pad.b;

    ctx.font = "13px 'IBM Plex Sans', sans-serif";
    ctx.fillStyle = inkFaint;

    if (error) {
      ctx.fillText(`⚠ Could not load real history: ${error}`, pad.l, h / 2);
      return;
    }
    if (loading && points.length === 0) {
      ctx.fillText("Loading real history…", pad.l, h / 2);
      return;
    }
    if (points.length < 2) {
      const n = points.length;
      ctx.fillText(
        n === 0
          ? `No recorded history yet for ${RANGE_LABELS[range]} — the scheduled backend check currently runs on manual trigger only, not a recurring schedule yet. Try a wider range, or check back after the next run.`
          : `Only ${n} recorded point in ${RANGE_LABELS[range]} — not enough to draw a line yet.`,
        pad.l, h / 2
      );
      return;
    }

    const target = (typeof window.CKM.getState === "function" ? window.CKM.getState().targetRate : null) || 0;
    const values = points.map((p) => p.value).concat(target ? [target] : []);
    const min = Math.min(...values) - 0.05, max = Math.max(...values) + 0.05;
    const tMin = points[0].t.getTime(), tMax = points[points.length - 1].t.getTime();
    const tSpan = Math.max(tMax - tMin, 1);
    const x = (t) => pad.l + ((t - tMin) / tSpan) * plotW;
    const y = (v) => pad.t + (1 - (v - min) / (max - min)) * plotH;

    // gridlines
    ctx.strokeStyle = line; ctx.lineWidth = 1;
    for (let g = 0; g <= 3; g++) {
      const gy = pad.t + (g / 3) * plotH;
      ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(w - pad.r, gy); ctx.stroke();
    }

    // target line
    if (target) {
      ctx.strokeStyle = down; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(pad.l, y(target)); ctx.lineTo(w - pad.r, y(target)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = down; ctx.font = "11px 'IBM Plex Mono', monospace";
      ctx.fillText("target " + target.toFixed(4).replace(/0+$/, "").replace(/\.$/, ""), pad.l + 4, y(target) - 4);
    }

    // one line + endpoint marker per source actually present in the data
    const bySource = {};
    points.forEach((p) => { (bySource[p.source] = bySource[p.source] || []).push(p); });

    Object.keys(bySource).forEach((sourceId) => {
      const pts = bySource[sourceId];
      const color = SOURCE_COLORS[sourceId] || styles.getPropertyValue("--accent").trim();
      ctx.beginPath();
      pts.forEach((p, i) => { const px = x(p.t.getTime()), py = y(p.value); i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); });
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();

      const last = pts[pts.length - 1];
      ctx.beginPath();
      ctx.arc(x(last.t.getTime()), y(last.value), 4, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
    });

    // legend (only worth showing when more than one source is plotted)
    const sourceIds = Object.keys(bySource);
    if (sourceIds.length > 1) {
      let lx = pad.l;
      ctx.font = "11px 'IBM Plex Sans', sans-serif";
      sourceIds.forEach((sourceId) => {
        const color = SOURCE_COLORS[sourceId] || "#888";
        ctx.fillStyle = color;
        ctx.fillRect(lx, pad.t, 8, 8);
        ctx.fillStyle = inkFaint;
        const label = SOURCE_LABELS[sourceId] || sourceId;
        ctx.fillText(label, lx + 12, pad.t + 8);
        lx += 12 + ctx.measureText(label).width + 14;
      });
    }

    // y-axis labels
    ctx.fillStyle = inkFaint; ctx.font = "11px 'IBM Plex Mono', monospace";
    ctx.fillText(max.toFixed(2), 4, pad.t + 8);
    ctx.fillText(min.toFixed(2), 4, pad.t + plotH);

    // "real data" badge, top-right — the one thing on this chart that must
    // never be ambiguous: this is recorded history, not a live session walk.
    ctx.textAlign = "right";
    ctx.fillStyle = styles.getPropertyValue("--accent").trim();
    ctx.font = "11px 'IBM Plex Mono', monospace";
    ctx.fillText("🟢 REAL — from the scheduled backend job", w - pad.r, pad.t + 8);
    ctx.textAlign = "left";
  }

  // -------------------------------------------------------------------------
  // The bridge function itself
  // -------------------------------------------------------------------------

  function render(canvas) {
    if (!sb || !signedIn) return false;

    const sel = currentSelection();
    if (!sel || sel.sourceIds.length === 0) {
      setModeHint("Select at least one money changer on the left to see its real recorded history.");
      draw(canvas, null, currentRange, [], false, null);
      return true;
    }

    const key = cacheKey(sel, currentRange);
    if (cache.key !== key && !cache.loading) {
      cache = { key, points: cache.key === key ? cache.points : [], loading: true, error: null };
      fetchHistory(sel, currentRange)
        .then((points) => {
          cache = { key, points, loading: false, error: null };
          const c = $("historyChart");
          if (c) draw(c, sel, currentRange, points, false, null);
        })
        .catch((err) => {
          cache = { key, points: [], loading: false, error: err.message };
          const c = $("historyChart");
          if (c) draw(c, sel, currentRange, [], false, err.message);
        });
    }

    setModeHint(`🟢 Showing real recorded history for your signed-in account — ${RANGE_LABELS[currentRange]}.`);
    draw(canvas, sel, currentRange, cache.key === key ? cache.points : [], cache.loading, cache.error);
    return true;
  }

  window.CKM = window.CKM || {};
  window.CKM.renderRealHistory = render;

  // -------------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------------

  function rerenderNow() {
    const canvas = $("historyChart");
    if (!canvas) return;
    if (!render(canvas) && typeof window.CKM.renderDefaultChart === "function") {
      setModeHint(
        signedIn
          ? "" // signed in but nothing selected yet — render() already set its own hint above
          : isConfigured()
            ? "Showing this browser session's readings only. Sign in above to see real history recorded by the scheduled backend job."
            : "Showing this browser session's readings only. Configure Supabase (see SUPABASE_SETUP.md) and sign in to see real recorded history."
      );
      window.CKM.renderDefaultChart(canvas);
    }
  }

  function wireRangeButtons() {
    document.querySelectorAll(".chart-range button").forEach((btn) => {
      btn.addEventListener("click", () => { currentRange = btn.dataset.range; });
    });
  }

  function init() {
    wireRangeButtons();
    setModeHint(
      isConfigured()
        ? "Showing this browser session's readings only. Sign in above to see real history recorded by the scheduled backend job."
        : "Showing this browser session's readings only. Configure Supabase (see SUPABASE_SETUP.md) and sign in to see real recorded history."
    );

    if (!isConfigured()) return; // nothing more to do — app.js's own default chart remains fully in charge

    sb = window.supabase.createClient(window.CKM_SUPABASE_URL, window.CKM_SUPABASE_ANON_KEY);

    sb.auth.onAuthStateChange((_event, session) => {
      signedIn = !!(session && session.user);
      cache = { key: null, points: [], loading: false, error: null };
      rerenderNow();
    });
    sb.auth.getSession().then(({ data }) => {
      signedIn = !!(data && data.session && data.session.user);
      rerenderNow();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
