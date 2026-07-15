// Options page script. Loads and persists settings via chrome.storage.sync so
// they are shared with the popup, content script, and service worker:
//   - sensitivity: minimum AI-likelihood (0-100) before a card is surfaced
//   - apiKey: Stage-2 detection provider key (kept in storage, never in code)
//   - scanMode: 'auto' (score as you scroll) vs 'on-demand' (popup-triggered)
// Settings auto-save on change (see PROJECT_CONTEXT.md §6, §7).

const DEFAULTS = { sensitivity: 45, apiKey: '', scanMode: 'auto' };

const sensitivityEl = document.getElementById('sensitivity');
const sensitivityValueEl = document.getElementById('sensitivityValue');
const apiKeyEl = document.getElementById('apiKey');
const onDemandEl = document.getElementById('onDemand');
const statusEl = document.getElementById('status');

let statusTimer;
function flashStatus(message) {
  statusEl.textContent = message;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusEl.textContent = '';
  }, 1500);
}

function save(partial) {
  chrome.storage.sync.set(partial).then(() => flashStatus('Saved'));
}

chrome.storage.sync.get(DEFAULTS).then((stored) => {
  sensitivityEl.value = String(stored.sensitivity);
  sensitivityValueEl.textContent = String(stored.sensitivity);
  apiKeyEl.value = stored.apiKey || '';
  onDemandEl.checked = stored.scanMode === 'on-demand';
});

// Live-update the readout as the slider moves; persist when it settles.
sensitivityEl.addEventListener('input', () => {
  sensitivityValueEl.textContent = sensitivityEl.value;
});
sensitivityEl.addEventListener('change', () => {
  save({ sensitivity: Number(sensitivityEl.value) });
});

apiKeyEl.addEventListener('change', () => {
  save({ apiKey: apiKeyEl.value.trim() });
});

onDemandEl.addEventListener('change', () => {
  save({ scanMode: onDemandEl.checked ? 'on-demand' : 'auto' });
});
