'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function showStatus(msg, type = 'success') {
  const bar = document.getElementById('statusBar');
  bar.textContent = msg;
  bar.className = `status-bar ${type}`;
  setTimeout(() => { bar.className = 'status-bar'; }, 4000);
}

function getHubIp() {
  return document.getElementById('hubIp').value.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Load saved settings into the form
// ─────────────────────────────────────────────────────────────────────────────
async function loadSettings() {
  const cfg = await chrome.storage.local.get({
    hub_ip:         '',
    lat:            null,
    lng:            null,
    offset_sunrise: 0,
    offset_sunset:  -15,
    sunrise_shades: [],
    enabled:        true,
    _discovered_shades: [],   // cached shade list from last discovery
  });

  document.getElementById('hubIp').value        = cfg.hub_ip         ?? '';
  document.getElementById('lat').value          = cfg.lat            ?? '';
  document.getElementById('lng').value          = cfg.lng            ?? '';
  document.getElementById('offsetSunrise').value = cfg.offset_sunrise ?? 0;
  document.getElementById('offsetSunset').value  = cfg.offset_sunset  ?? -15;
  document.getElementById('enabled').checked    = cfg.enabled !== false;

  if (cfg._discovered_shades?.length) {
    renderShadeList(cfg._discovered_shades, cfg.sunrise_shades);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shade list rendering
// ─────────────────────────────────────────────────────────────────────────────
function renderShadeList(shades, selectedIds = []) {
  const container = document.getElementById('shadeList');
  const hint      = document.getElementById('shadeHint');

  if (!shades.length) {
    container.innerHTML = '';
    hint.textContent = 'No shades found. Make sure the hub IP is correct.';
    return;
  }

  const selectedSet = new Set(selectedIds.map(Number));

  const rows = shades
    .slice()
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    .map((shade) => {
      const pos = shade.positions?.position1;
      const pct = typeof pos === 'number' ? `${Math.round(pos / 65535 * 100)}%` : '?';
      const checked = selectedSet.has(Number(shade.id)) ? 'checked' : '';
      return `
        <label class="shade-item" style="cursor:pointer;">
          <input type="checkbox" data-id="${shade.id}" ${checked}
                 style="width:16px;height:16px;cursor:pointer;flex-shrink:0;">
          <span class="shade-id">#${shade.id}</span>
          <span class="shade-name">${shade.name ?? '(unnamed)'}</span>
          <span class="shade-pos">${pct}</span>
        </label>
      `;
    });

  container.innerHTML = `<div class="shade-list">${rows.join('')}</div>`;
  hint.textContent = `${shades.length} shade(s) found. Check the ones that should open at sunrise.`;
}

function getSelectedShadeIds() {
  return [...document.querySelectorAll('#shadeList input[data-id]:checked')]
    .map((cb) => parseInt(cb.dataset.id, 10));
}

// ─────────────────────────────────────────────────────────────────────────────
// Discover shades from hub
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('btnDiscover').addEventListener('click', async () => {
  const btn   = document.getElementById('btnDiscover');
  const hubIp = getHubIp();

  if (!hubIp) { showStatus('Enter the hub IP address first.', 'error'); return; }

  btn.disabled    = true;
  btn.textContent = 'Discovering…';

  try {
    const resp = await fetch(`http://${hubIp}/api/shades`, {
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data   = await resp.json();
    const shades = data.shadeData ?? [];

    // Cache discovered shades for future loads
    await chrome.storage.local.set({ _discovered_shades: shades });

    const currentSelected = getSelectedShadeIds();
    const saved = await chrome.storage.local.get({ sunrise_shades: [] });
    renderShadeList(shades, currentSelected.length ? currentSelected : saved.sunrise_shades);

    showStatus(`Found ${shades.length} shade(s).`, 'success');
  } catch (err) {
    showStatus(`Discovery failed: ${err.message}`, 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Discover Shades from Hub';
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Test hub connection
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('btnTestHub').addEventListener('click', async () => {
  const btn   = document.getElementById('btnTestHub');
  const hubIp = getHubIp();

  if (!hubIp) { showStatus('Enter the hub IP first.', 'error'); return; }

  btn.disabled    = true;
  btn.textContent = '…';

  try {
    const resp = await fetch(`http://${hubIp}/api/shades`, {
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    showStatus(`✓ Connected! ${(data.shadeData ?? []).length} shade(s) found.`, 'success');
  } catch (err) {
    showStatus(`✗ Cannot reach hub: ${err.message}`, 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Test';
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Geolocation
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('btnGeolocate').addEventListener('click', (e) => {
  e.preventDefault();
  if (!navigator.geolocation) {
    showStatus('Geolocation not available in this browser.', 'error');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      document.getElementById('lat').value = pos.coords.latitude.toFixed(5);
      document.getElementById('lng').value = pos.coords.longitude.toFixed(5);
      showStatus('Location set from browser GPS.', 'success');
    },
    (err) => {
      showStatus(`Geolocation error: ${err.message}`, 'error');
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Save
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('btnSave').addEventListener('click', async () => {
  const btn = document.getElementById('btnSave');

  const hub_ip  = document.getElementById('hubIp').value.trim();
  const latStr  = document.getElementById('lat').value.trim();
  const lngStr  = document.getElementById('lng').value.trim();
  const lat     = latStr ? parseFloat(latStr) : null;
  const lng     = lngStr ? parseFloat(lngStr) : null;

  if (hub_ip && (lat === null || lng === null)) {
    showStatus('Please enter latitude and longitude (or use "Use my current location").', 'error');
    return;
  }

  const settings = {
    hub_ip,
    lat,
    lng,
    offset_sunrise:  parseInt(document.getElementById('offsetSunrise').value, 10) || 0,
    offset_sunset:   parseInt(document.getElementById('offsetSunset').value, 10)  || 0,
    sunrise_shades:  getSelectedShadeIds(),
    enabled:         document.getElementById('enabled').checked,
  };

  btn.disabled    = true;
  btn.textContent = 'Saving…';

  try {
    await chrome.storage.local.set(settings);
    // Tell the background service worker to reschedule with new settings
    await chrome.runtime.sendMessage({ action: 'reschedule' });
    showStatus('Settings saved and schedule updated.', 'success');
  } catch (err) {
    showStatus(`Save failed: ${err.message}`, 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Save & Reschedule';
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────
loadSettings();
