let tickerInterval = null;

// Format milliseconds remaining into "h:mm:ss".
function formatMs(ms) {
  if (ms <= 0) return '0:00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function loadAndRender() {
  const { blockedSites = [], pendingRemovals = {} } =
    await chrome.storage.local.get(['blockedSites', 'pendingRemovals']);

  const list = document.getElementById('site-list');
  list.innerHTML = '';

  // Sort: pending-removal hosts first, then alphabetical.
  const sorted = [...blockedSites].sort((a, b) => {
    const aPending = pendingRemovals[a] !== undefined;
    const bPending = pendingRemovals[b] !== undefined;
    if (aPending && !bPending) return -1;
    if (!aPending && bPending) return 1;
    return a.localeCompare(b);
  });

  for (const host of sorted) {
    const isPending = pendingRemovals[host] !== undefined;
    const expiresAt = pendingRemovals[host];

    const row = document.createElement('div');
    row.className = 'site-row';
    row.dataset.host = host;

    const nameEl = document.createElement('span');
    nameEl.className = 'site-name';
    nameEl.textContent = host;
    row.appendChild(nameEl);

    if (isPending) {
      const badge = document.createElement('span');
      badge.className = 'countdown-badge';
      badge.dataset.expires = expiresAt;
      badge.textContent = formatMs(expiresAt - Date.now());
      row.appendChild(badge);

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn-action cancel';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => handleCancelRemove(host));
      row.appendChild(cancelBtn);
    } else {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-action';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => handleRemove(host));
      row.appendChild(removeBtn);
    }

    list.appendChild(row);
  }

  startTicker();
}

function startTicker() {
  if (tickerInterval) clearInterval(tickerInterval);

  tickerInterval = setInterval(() => {
    const badges = document.querySelectorAll('.countdown-badge[data-expires]');
    if (badges.length === 0) {
      clearInterval(tickerInterval);
      tickerInterval = null;
      return;
    }

    let anyExpired = false;
    for (const badge of badges) {
      const remaining = Number(badge.dataset.expires) - Date.now();
      if (remaining <= 0) {
        anyExpired = true;
      } else {
        badge.textContent = formatMs(remaining);
      }
    }

    if (anyExpired) {
      clearInterval(tickerInterval);
      tickerInterval = null;
      loadAndRender();
    }
  }, 1000);
}

async function handleAdd(rawInput) {
  const errorEl = document.getElementById('error-msg');
  errorEl.textContent = '';

  const raw = rawInput.trim();
  if (!raw) {
    errorEl.textContent = 'Please enter a site.';
    return;
  }

  const resp = await chrome.runtime.sendMessage({ type: 'ADD_SITE', host: raw });
  if (resp && resp.ok) {
    document.getElementById('site-input').value = '';
    await loadAndRender();
  } else {
    errorEl.textContent = (resp && resp.error) || 'Could not add site.';
  }
}

async function handleRemove(host) {
  const resp = await chrome.runtime.sendMessage({ type: 'REQUEST_REMOVE_SITE', host });
  if (resp && resp.ok) {
    await loadAndRender();
  }
}

async function handleCancelRemove(host) {
  const resp = await chrome.runtime.sendMessage({ type: 'CANCEL_REMOVE_SITE', host });
  if (resp && resp.ok) {
    await loadAndRender();
  }
}

// --- Wire up the add form ---
document.getElementById('btn-block').addEventListener('click', () => {
  handleAdd(document.getElementById('site-input').value);
});

document.getElementById('site-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleAdd(e.target.value);
});

// Initial render.
loadAndRender();
