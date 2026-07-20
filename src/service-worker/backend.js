// Hosted-backend configuration + client. The backend (proxy/, deployed to
// Vercel) holds the provider API keys server-side, so the published extension
// works with NO user key. See proxy/README.md.
//
// The URL defaults to DEFAULT_BACKEND_URL and can be overridden per-install via
// the options page (chrome.storage.local['backendUrl']) — e.g. to point at a
// self-hosted deployment or a preview URL.

// Default production backend (Vercel project "linkedin-content-validator").
// Override in the options page if your deployment uses a different URL.
export const DEFAULT_BACKEND_URL = 'https://linkedin-content-validator.vercel.app';

/**
 * Resolve the backend base URL: the user override if set, else the default.
 * Trailing slashes are stripped. Returns '' when the backend is explicitly
 * disabled (BYO-key mode only).
 * @returns {Promise<string>}
 */
export async function getBackendUrl() {
  try {
    const { backendUrl, backendDisabled } = await chrome.storage.local.get([
      'backendUrl',
      'backendDisabled',
    ]);
    if (backendDisabled) return '';
    const trimmed = typeof backendUrl === 'string' ? backendUrl.trim().replace(/\/+$/, '') : '';
    return trimmed || DEFAULT_BACKEND_URL;
  } catch {
    // storage unavailable; fall through to default
    return DEFAULT_BACKEND_URL;
  }
}

/**
 * Stage-3 credibility via the hosted backend.
 * @param {string} backendUrl base URL (no trailing slash)
 * @param {string} text
 * @returns {Promise<object>} credibility result or { unavailable, reason }
 */
export async function backendCredibility(backendUrl, text) {
  try {
    const res = await fetch(`${backendUrl}/api/credibility`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: String(text).slice(0, 8000) }),
    });
    if (!res.ok) return { unavailable: true, reason: `http-${res.status}` };
    const data = await res.json();
    if (!data || data.unavailable) {
      return { unavailable: true, reason: (data && data.reason) || 'unavailable' };
    }
    return data;
  } catch {
    return { unavailable: true, reason: 'network' };
  }
}
