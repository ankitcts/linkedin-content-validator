// Pluggable Stage-2 detection provider: config + response mapping.
// API keys NEVER live here — they are read from chrome.storage (set via the
// options page). See PROJECT_CONTEXT.md §4, §7 and the roadmap (§6).

// Default (disabled) provider config. The options page fills url/headers/key.
export const PROVIDER = {
  enabled: false,
  url: '',
  // Header template; the API key is merged in at call time from storage.
  headers: {},
};

/**
 * Normalises a raw provider API response into the app's shape.
 * @returns {{ score: number, signals: Array<{ label: string, detail: string }> }}
 */
export function mapResponse() {
  // TODO(raw): map the chosen provider's response (e.g. Pangram) into
  // { score, signals }. Implemented per-provider when Stage-2 is wired.
  return { score: 0, signals: [] };
}
