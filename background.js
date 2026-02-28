// Strips www. and normalises input to a bare hostname.
// Accepts "reddit.com", "www.reddit.com", "https://reddit.com/foo", etc.
function normaliseHost(input) {
  let raw = input.trim();
  if (!raw) return null;
  // If it looks like a URL, parse it; otherwise prepend a scheme so URL() works.
  if (!raw.includes('://')) raw = 'https://' + raw;
  try {
    const { hostname } = new URL(raw);
    return hostname.replace(/^www\./, '');
  } catch (_) {
    return null;
  }
}

// Returns the canonical blocked host for a URL, or null if not blocked.
async function getBlockedHost(url) {
  try {
    const { hostname } = new URL(url);
    const { blockedSites = [] } = await chrome.storage.local.get('blockedSites');
    for (const h of blockedSites) {
      if (hostname === h || hostname.endsWith('.' + h)) return h;
    }
  } catch (_) {}
  return null;
}

// --- Allowlist via chrome.storage.session ---
// Structure: { allowed: { "<tabId>": ["youtube.com", ...] } }

async function isAllowed(tabId, host) {
  const { allowed = {} } = await chrome.storage.session.get('allowed');
  return Array.isArray(allowed[tabId]) && allowed[tabId].includes(host);
}

async function setAllowed(tabId, host) {
  const { allowed = {} } = await chrome.storage.session.get('allowed');
  if (!Array.isArray(allowed[tabId])) allowed[tabId] = [];
  if (!allowed[tabId].includes(host)) allowed[tabId].push(host);
  await chrome.storage.session.set({ allowed });
}

// Clean up stale entries when a tab closes.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { allowed = {} } = await chrome.storage.session.get('allowed');
  if (allowed[tabId]) {
    delete allowed[tabId];
    await chrome.storage.session.set({ allowed });
  }
});

// --- Install defaults ---
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install') return;
  const existing = await chrome.storage.local.get('blockedSites');
  if (!existing.blockedSites) {
    await chrome.storage.local.set({
      blockedSites: ['instagram.com', 'youtube.com'],
      pendingRemovals: {},
    });
  }
});

// --- Alarm handler: finalize a pending removal ---
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith('remove:')) return;
  const host = alarm.name.slice('remove:'.length);

  const { blockedSites = [], pendingRemovals = {} } = await chrome.storage.local.get([
    'blockedSites',
    'pendingRemovals',
  ]);

  const updated = blockedSites.filter((s) => s !== host);
  delete pendingRemovals[host];

  await chrome.storage.local.set({ blockedSites: updated, pendingRemovals });
});

// --- Message handlers ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'ALLOW_AND_NAVIGATE': {
        if (!sender.tab) break;
        const host = await getBlockedHost(msg.url);
        if (!host) break;
        await setAllowed(sender.tab.id, host);
        chrome.tabs.update(sender.tab.id, { url: msg.url });
        break;
      }

      case 'ADD_SITE': {
        const host = normaliseHost(msg.host);
        if (!host) {
          sendResponse({ ok: false, error: 'Invalid hostname.' });
          return;
        }
        const { blockedSites = [], pendingRemovals = {} } = await chrome.storage.local.get([
          'blockedSites',
          'pendingRemovals',
        ]);
        if (!blockedSites.includes(host)) {
          blockedSites.push(host);
        }
        // Cancel any pending removal for this host.
        if (pendingRemovals[host] !== undefined) {
          delete pendingRemovals[host];
          await chrome.alarms.clear('remove:' + host);
        }
        await chrome.storage.local.set({ blockedSites, pendingRemovals });
        sendResponse({ ok: true });
        return;
      }

      case 'REQUEST_REMOVE_SITE': {
        const host = normaliseHost(msg.host);
        if (!host) {
          sendResponse({ ok: false, error: 'Invalid hostname.' });
          return;
        }
        const expiresAt = Date.now() + 3_600_000; // 1 hour
        const { pendingRemovals = {} } = await chrome.storage.local.get('pendingRemovals');
        pendingRemovals[host] = expiresAt;
        await chrome.storage.local.set({ pendingRemovals });
        await chrome.alarms.create('remove:' + host, { when: expiresAt });
        sendResponse({ ok: true, expiresAt });
        return;
      }

      case 'CANCEL_REMOVE_SITE': {
        const host = normaliseHost(msg.host);
        if (!host) {
          sendResponse({ ok: false, error: 'Invalid hostname.' });
          return;
        }
        const { pendingRemovals = {} } = await chrome.storage.local.get('pendingRemovals');
        delete pendingRemovals[host];
        await chrome.storage.local.set({ pendingRemovals });
        await chrome.alarms.clear('remove:' + host);
        sendResponse({ ok: true });
        return;
      }
    }
  })();
  // Return true to keep the message channel open for async sendResponse.
  return true;
});

// --- Navigation interception ---
chrome.webNavigation.onBeforeNavigate.addListener(
  async (details) => {
    if (details.frameId !== 0) return;

    const host = await getBlockedHost(details.url);
    if (!host) return;

    if (await isAllowed(details.tabId, host)) return;

    const blockedPage =
      chrome.runtime.getURL('blocked.html') +
      '?site=' +
      encodeURIComponent(details.url);

    chrome.tabs.update(details.tabId, { url: blockedPage });
  },
  { url: [{ schemes: ['http', 'https'] }] }
);
