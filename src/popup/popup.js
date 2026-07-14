// Popup script. Toolbar UI shown when the extension icon is clicked:
//   - enable/disable the in-feed analysis (persisted to chrome.storage.sync)
//   - trigger an on-demand scan of the active LinkedIn tab
//   - open the options page
// Settings are shared with the content script and options page via storage.

const DEFAULTS = { enabled: true };

const enabledEl = document.getElementById('enabled');
const scanBtn = document.getElementById('scan');
const optionsBtn = document.getElementById('options');

function reflect(enabled) {
  enabledEl.checked = enabled;
  scanBtn.disabled = !enabled;
}

chrome.storage.sync.get(DEFAULTS).then(({ enabled }) => {
  reflect(enabled);
});

enabledEl.addEventListener('change', () => {
  const enabled = enabledEl.checked;
  reflect(enabled);
  chrome.storage.sync.set({ enabled });
});

scanBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'lcv-scan' }, () => {
    // Swallow "no receiving end" when the tab isn't a LinkedIn feed page.
    void chrome.runtime.lastError;
  });
  window.close();
});

optionsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});
