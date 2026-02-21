'use strict';

function fmtTime(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const now = Date.now();
  const diffDays = Math.floor((ms - now) / 86_400_000);
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays < 0) return `${timeStr} (passed)`;
  if (diffDays === 0) return `Today ${timeStr}`;
  if (diffDays === 1) return `Tomorrow ${timeStr}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${timeStr}`;
}

async function render() {
  const items = await chrome.storage.local.get([
    'hub_ip', 'enabled', 'sunrise_shades',
    'next_sunrise_ms', 'next_sunset_ms', 'last_action',
  ]);

  const badge = document.getElementById('badge');
  const card  = document.getElementById('statusCard');

  // Badge
  const enabled = items.enabled !== false;
  badge.textContent = enabled ? 'Active' : 'Disabled';
  badge.className   = 'badge' + (enabled ? '' : ' disabled');

  if (!items.hub_ip) {
    card.innerHTML = '<span class="unconfigured">Hub not configured.<br>Open Settings to get started.</span>';
    return;
  }

  const sunriseCount = (items.sunrise_shades ?? []).length;

  card.innerHTML = `
    <div class="event-row">
      <span class="event-label">🌅 Sunrise open</span>
      <span class="event-time">${fmtTime(items.next_sunrise_ms)}</span>
    </div>
    <div class="event-row">
      <span class="event-label">🌇 Sunset close</span>
      <span class="event-time">${fmtTime(items.next_sunset_ms)}</span>
    </div>
    <hr class="divider">
    <div class="event-row">
      <span class="event-label">Sunrise shades</span>
      <span class="event-time">${sunriseCount} configured</span>
    </div>
    ${items.last_action ? `<hr class="divider"><div class="last-action">${items.last_action}</div>` : ''}
  `;
}

async function sendAction(action) {
  return chrome.runtime.sendMessage({ action });
}

function withButton(btn, label, fn) {
  btn.addEventListener('click', async () => {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Working…';
    try {
      const resp = await fn();
      btn.textContent = resp.ok ? '✓ Done' : '✗ Error';
      if (!resp.ok) console.error(resp.error);
    } catch (err) {
      btn.textContent = '✗ Error';
      console.error(err);
    }
    setTimeout(() => {
      btn.textContent = original;
      btn.disabled = false;
      render();
    }, 1800);
  });
}

withButton(document.getElementById('btnCloseAll'),    'Close All Now', () => sendAction('closeAll'));
withButton(document.getElementById('btnOpenSunrise'), 'Open Sunrise',  () => sendAction('openSunrise'));

document.getElementById('rescheduleLink').addEventListener('click', async (e) => {
  e.preventDefault();
  await sendAction('reschedule');
  await render();
});

document.getElementById('settingsLink').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

render();
