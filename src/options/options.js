// Options page script.
//
// Preferences (sensitivity, scanMode) live in chrome.storage.sync so they are
// shared with the popup and content script and roam across devices.
//
// The Hugging Face access token is different: the Stage-2 service worker reads
// it from chrome.storage.LOCAL under the active provider's key ('hfToken'), and
// a credential shouldn't sync across devices — so it's stored locally only and
// never hardcoded (see PROJECT_CONTEXT.md §7).
const PREF_DEFAULTS = { sensitivity: 45, scanMode: 'auto' };
const TOKEN_KEY = 'hfToken';
const LLM_MODEL_KEY = 'llmModel';
const BACKEND_URL_KEY = 'backendUrl';
const BACKEND_DISABLED_KEY = 'backendDisabled';

const sensitivityEl = document.getElementById('sensitivity');
const sensitivityValueEl = document.getElementById('sensitivityValue');
const backendUrlEl = document.getElementById('backendUrl');
const backendDisabledEl = document.getElementById('backendDisabled');
const apiKeyEl = document.getElementById('apiKey');
const llmModelEl = document.getElementById('llmModel');
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

function savePref(partial) {
  chrome.storage.sync.set(partial).then(() => flashStatus('Saved'));
}

// Load preferences (sync) and the token (local).
chrome.storage.sync.get(PREF_DEFAULTS).then((stored) => {
  sensitivityEl.value = String(stored.sensitivity);
  sensitivityValueEl.textContent = String(stored.sensitivity);
  onDemandEl.checked = stored.scanMode === 'on-demand';
});
chrome.storage.local
  .get({
    [TOKEN_KEY]: '',
    [LLM_MODEL_KEY]: '',
    [BACKEND_URL_KEY]: '',
    [BACKEND_DISABLED_KEY]: false,
  })
  .then((stored) => {
    apiKeyEl.value = stored[TOKEN_KEY] || '';
    llmModelEl.value = stored[LLM_MODEL_KEY] || '';
    backendUrlEl.value = stored[BACKEND_URL_KEY] || '';
    backendDisabledEl.checked = Boolean(stored[BACKEND_DISABLED_KEY]);
  });

// Live-update the readout as the slider moves; persist when it settles.
sensitivityEl.addEventListener('input', () => {
  sensitivityValueEl.textContent = sensitivityEl.value;
});
sensitivityEl.addEventListener('change', () => {
  savePref({ sensitivity: Number(sensitivityEl.value) });
});

backendUrlEl.addEventListener('change', () => {
  chrome.storage.local
    .set({ [BACKEND_URL_KEY]: backendUrlEl.value.trim() })
    .then(() => flashStatus('Saved'));
});

backendDisabledEl.addEventListener('change', () => {
  chrome.storage.local
    .set({ [BACKEND_DISABLED_KEY]: backendDisabledEl.checked })
    .then(() => flashStatus('Saved'));
});

apiKeyEl.addEventListener('change', () => {
  chrome.storage.local.set({ [TOKEN_KEY]: apiKeyEl.value.trim() }).then(() => flashStatus('Saved'));
});

llmModelEl.addEventListener('change', () => {
  chrome.storage.local
    .set({ [LLM_MODEL_KEY]: llmModelEl.value.trim() })
    .then(() => flashStatus('Saved'));
});

onDemandEl.addEventListener('change', () => {
  savePref({ scanMode: onDemandEl.checked ? 'on-demand' : 'auto' });
});
