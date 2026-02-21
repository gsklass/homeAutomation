/**
 * background.js — Service worker for Bali Blinds Automation.
 *
 * Lifecycle:
 *   onInstalled / onStartup → scheduleToday()
 *   'daily' alarm (midnight) → scheduleToday()
 *   'sunrise' alarm          → openSunriseShades()
 *   'sunset' alarm           → closeAllShades()
 *
 * Settings are read fresh from chrome.storage.local before each action
 * so that changes in the options page take effect without restarting.
 */
'use strict';

importScripts('suncalc.js');

// ─────────────────────────────────────────────────────────────────────────────
// Default settings
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULTS = {
  enabled:           true,
  hub_ip:            '',
  lat:               null,
  lng:               null,
  sunrise_shades:    [],     // array of shade IDs (integers)
  offset_sunrise:    0,      // minutes relative to astronomical sunrise
  offset_sunset:     -15,    // minutes relative to astronomical sunset
};

async function getSettings() {
  return chrome.storage.local.get(DEFAULTS);
}

// ─────────────────────────────────────────────────────────────────────────────
// PowerView hub API
// ─────────────────────────────────────────────────────────────────────────────
async function pvRequest(hubIp, method, path, body) {
  const url = `http://${hubIp}/api/${path}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const resp = await fetch(url, opts);
  if (!resp.ok) throw new Error(`PowerView API ${method} ${path} → HTTP ${resp.status}`);
  return resp.json();
}

async function getAllShades(hubIp) {
  const data = await pvRequest(hubIp, 'GET', 'shades');
  return data.shadeData ?? [];
}

async function setShadePosition(hubIp, shadeId, position) {
  // position: 0 = fully closed, 65535 = fully open
  await pvRequest(hubIp, 'PUT', `shades/${shadeId}`, {
    shade: { positions: { posKind1: 1, position1: position } },
  });
}

async function closeAllShades(hubIp) {
  const shades = await getAllShades(hubIp);
  for (const shade of shades) {
    try {
      await setShadePosition(hubIp, shade.id, 0);
      console.log(`[blinds] Closed: ${shade.id} (${shade.name ?? '?'})`);
    } catch (err) {
      console.error(`[blinds] Failed to close shade ${shade.id}:`, err.message);
    }
  }
}

async function openShades(hubIp, shadeIds) {
  for (const id of shadeIds) {
    try {
      await setShadePosition(hubIp, id, 65535);
      console.log(`[blinds] Opened: ${id}`);
    } catch (err) {
      console.error(`[blinds] Failed to open shade ${id}:`, err.message);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduling
// ─────────────────────────────────────────────────────────────────────────────
async function scheduleToday() {
  const cfg = await getSettings();

  if (!cfg.enabled || !cfg.hub_ip || cfg.lat === null || cfg.lng === null) {
    console.log('[blinds] Not scheduling: disabled or missing config.');
    return;
  }

  const now = new Date();
  const { sunrise, sunset } = SunCalc.getSunTimes(now, cfg.lat, cfg.lng);

  const sunriseMs = sunrise.getTime() + cfg.offset_sunrise * 60_000;
  const sunsetMs  = sunset.getTime()  + cfg.offset_sunset  * 60_000;

  // Clear stale alarms and rebuild
  await chrome.alarms.clearAll();

  // Daily recalculation at 00:01 tomorrow
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 1, 0, 0);
  chrome.alarms.create('daily', { when: tomorrow.getTime() });

  if (sunriseMs > now.getTime()) {
    chrome.alarms.create('sunrise', { when: sunriseMs });
    console.log(`[blinds] Sunrise alarm: ${new Date(sunriseMs).toLocaleTimeString()}`);
  } else {
    console.log('[blinds] Sunrise already passed today — skipping.');
  }

  if (sunsetMs > now.getTime()) {
    chrome.alarms.create('sunset', { when: sunsetMs });
    console.log(`[blinds] Sunset alarm: ${new Date(sunsetMs).toLocaleTimeString()}`);
  } else {
    console.log('[blinds] Sunset already passed today — skipping.');
  }

  // Persist schedule info for the popup
  await chrome.storage.local.set({
    next_sunrise_ms: sunriseMs,
    next_sunset_ms:  sunsetMs,
    scheduled_at:    now.getTime(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Alarm handler
// ─────────────────────────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  const cfg = await getSettings();
  if (!cfg.enabled || !cfg.hub_ip) return;

  const label = new Date().toLocaleTimeString();

  if (alarm.name === 'daily') {
    console.log('[blinds] Daily recalculation…');
    await scheduleToday();

  } else if (alarm.name === 'sunrise') {
    console.log('[blinds] SUNRISE — opening configured shades…');
    try {
      await openShades(cfg.hub_ip, cfg.sunrise_shades);
      await chrome.storage.local.set({ last_action: `Sunrise open at ${label}` });
    } catch (err) {
      console.error('[blinds] Sunrise action failed:', err.message);
      await chrome.storage.local.set({ last_action: `Sunrise FAILED at ${label}: ${err.message}` });
    }

  } else if (alarm.name === 'sunset') {
    console.log('[blinds] SUNSET — closing all shades…');
    try {
      await closeAllShades(cfg.hub_ip);
      await chrome.storage.local.set({ last_action: `Sunset close at ${label}` });
    } catch (err) {
      console.error('[blinds] Sunset action failed:', err.message);
      await chrome.storage.local.set({ last_action: `Sunset FAILED at ${label}: ${err.message}` });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Extension lifecycle
// ─────────────────────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[blinds] Extension installed — scheduling…');
  await scheduleToday();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('[blinds] Chrome started — scheduling…');
  await scheduleToday();
});

// ─────────────────────────────────────────────────────────────────────────────
// Message handler (from popup — immediate manual actions)
// ─────────────────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    const cfg = await getSettings();
    if (!cfg.hub_ip) {
      sendResponse({ ok: false, error: 'Hub IP not configured. Open Settings.' });
      return;
    }
    try {
      if (msg.action === 'closeAll') {
        await closeAllShades(cfg.hub_ip);
        await chrome.storage.local.set({ last_action: `Manual close at ${new Date().toLocaleTimeString()}` });
      } else if (msg.action === 'openSunrise') {
        await openShades(cfg.hub_ip, cfg.sunrise_shades);
        await chrome.storage.local.set({ last_action: `Manual sunrise open at ${new Date().toLocaleTimeString()}` });
      } else if (msg.action === 'reschedule') {
        await scheduleToday();
      }
      sendResponse({ ok: true });
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();
  return true; // keep the message channel open for async response
});
