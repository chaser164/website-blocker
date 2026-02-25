const BLOCKED_HOSTS = ['instagram.com', 'youtube.com'];

// Returns the canonical blocked host for a URL, or null if not blocked.
function getBaseHost(url) {
  try {
    const { hostname } = new URL(url);
    for (const h of BLOCKED_HOSTS) {
      if (hostname === h || hostname.endsWith('.' + h)) return h;
    }
  } catch (_) {}
  return null;
}

// --- Allowlist via chrome.storage.session ---
// Structure: { allowed: { "<tabId>": ["youtube.com", ...] } }
// Persists across service-worker sleeps; cleared when the browser closes.

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

// blocked.js sends this when the user clicks "Proceed anyway".
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== 'ALLOW_AND_NAVIGATE' || !sender.tab) return;
  const host = getBaseHost(msg.url);
  if (!host) return;
  // Whitelist tab, then navigate — doing it in this order prevents a race.
  setAllowed(sender.tab.id, host).then(() => {
    chrome.tabs.update(sender.tab.id, { url: msg.url });
  });
});

chrome.webNavigation.onBeforeNavigate.addListener(
  async (details) => {
    if (details.frameId !== 0) return;

    const host = getBaseHost(details.url);
    if (!host) return;

    // Let through if the user already chose to proceed in this tab.
    if (await isAllowed(details.tabId, host)) return;

    const blockedPage =
      chrome.runtime.getURL('blocked.html') +
      '?site=' +
      encodeURIComponent(details.url);

    chrome.tabs.update(details.tabId, { url: blockedPage });
  },
  {
    url: BLOCKED_HOSTS.flatMap((host) => [
      { hostEquals: host },
      { hostSuffix: '.' + host },
    ]),
  }
);
