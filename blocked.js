const params = new URLSearchParams(location.search);
const siteParam = params.get('site') || '';

// Parse hostname for display
let displayName = siteParam;
try {
  const url = new URL(siteParam);
  displayName = url.hostname.replace(/^www\./, '');
} catch (_) {}

const prettyName = displayName.charAt(0).toUpperCase() + displayName.slice(1);

document.getElementById('site-name').textContent = prettyName;
document.getElementById('site-url').textContent = siteParam;

const proceedBtn = document.getElementById('btn-proceed');
const countdownEl = document.getElementById('countdown');

// Intercept the click — send a message to background.js so it can whitelist
// this tab before navigating, preventing an immediate re-block.
proceedBtn.addEventListener('click', (e) => {
  e.preventDefault();
  if (!proceedBtn.classList.contains('unlocked')) return;
  chrome.runtime.sendMessage({ type: 'ALLOW_AND_NAVIGATE', url: siteParam });
});

// Unlock "Proceed anyway" after 10-second countdown
let remaining = 10;

const tick = setInterval(() => {
  remaining -= 1;
  if (remaining <= 0) {
    clearInterval(tick);
    proceedBtn.textContent = 'Proceed anyway';
    proceedBtn.classList.add('unlocked');
  } else {
    countdownEl.textContent = remaining;
  }
}, 1000);

document.getElementById('btn-back').addEventListener('click', () => {
  window.close();
});
