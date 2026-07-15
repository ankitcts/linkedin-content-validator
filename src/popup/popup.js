// Popup script. Toolbar UI shown when the extension icon is clicked:
//   - enable/disable the in-feed analysis (persisted to chrome.storage.sync)
//   - theme (auto / light / dark), shared with the in-feed cards
//   - trigger an on-demand scan of the active LinkedIn tab
//   - open the options page
// Settings are shared with the content script and options page via storage.

const DEFAULTS = { enabled: true, theme: 'auto' };

const enabledEl = document.getElementById('enabled');
const scanBtn = document.getElementById('scan');
const optionsBtn = document.getElementById('options');
const themeGroup = document.getElementById('theme');

function prefersDark() {
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function resolveTheme(theme) {
  if (theme === 'light' || theme === 'dark') return theme;
  return prefersDark() ? 'dark' : 'light';
}

function reflectEnabled(enabled) {
  enabledEl.checked = enabled;
  scanBtn.disabled = !enabled;
}

function reflectTheme(theme) {
  document.documentElement.dataset.theme = resolveTheme(theme);
  themeGroup.querySelectorAll('.popup__seg-btn').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.theme === theme));
  });
}

chrome.storage.sync.get(DEFAULTS).then(({ enabled, theme }) => {
  reflectEnabled(enabled);
  reflectTheme(theme || 'auto');
});

enabledEl.addEventListener('change', () => {
  const enabled = enabledEl.checked;
  reflectEnabled(enabled);
  chrome.storage.sync.set({ enabled });
});

themeGroup.addEventListener('click', (event) => {
  const btn = event.target.closest('.popup__seg-btn');
  if (!btn) return;
  const theme = btn.dataset.theme;
  reflectTheme(theme);
  chrome.storage.sync.set({ theme });
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
