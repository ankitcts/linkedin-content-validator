// Service-worker entry point (MV3 background, ESM module). Handles Stage-2 deep
// checks requested by the content script: SHA-256-hash the text, check the
// cache, call the provider on a miss, cache and return { score, signals }.
// See PROJECT_CONTEXT.md §4.
//
// Contract: chrome.runtime.sendMessage({ type: 'deep-check', text })
//           -> { score: 0-100, signals: [{ label, detail }] }

import { sha256 } from './hash.js';
import { getCached, setCached } from './cache.js';
import { PROVIDER, mapResponse, NEUTRAL_RESULT } from './providers.js';
import { analyzeCredibility } from './credibility.js';
import { getBackendUrl } from './backend.js';

/**
 * Read the active provider's API key from chrome.storage.local. Returns '' when
 * the provider declares no key slot or none has been set (options page). Keys
 * are never hardcoded in the extension (§7).
 * @param {object} provider
 * @returns {Promise<string>}
 */
async function readApiKey(provider) {
  if (!provider || !provider.apiKeyStorageKey) return '';
  const stored = await chrome.storage.local.get(provider.apiKeyStorageKey);
  const key = stored[provider.apiKeyStorageKey];
  return typeof key === 'string' ? key.trim() : '';
}

/**
 * Run the Stage-2 pipeline for a piece of post text:
 * hash -> cache lookup -> provider call -> map -> cache.
 * Degrades to a neutral result (never throws) when the provider is
 * disabled/unkeyed or the call fails, so the extension works without a key.
 * @param {string} text
 * @returns {Promise<{ score: number, signals: Array<{ label: string, detail: string }> }>}
 */
async function deepCheck(text) {
  const provider = PROVIDER || {};

  // Backend-backed providers (the default hosted proxy) resolve their URL at
  // call time; it's part of the cache key so pointing at a different backend
  // re-checks rather than serving another backend's cached verdict.
  const backendUrl = provider.usesBackend ? await getBackendUrl() : '';

  // Key the cache by provider + model/backend too, so switching detection
  // backends invalidates results scored by a previous model (rather than serving
  // stale verdicts for the same post text).
  const hash = await sha256(`${provider.id || ''}:${provider.model || backendUrl || ''}:${text}`);

  const cached = await getCached(hash);
  if (cached) return cached;

  // No usable provider -> neutral, and don't cache: a later enable/keying
  // should re-check this text rather than resolve to the neutral placeholder.
  if (!PROVIDER || !PROVIDER.enabled) {
    return { ...NEUTRAL_RESULT, unavailable: true };
  }

  // A backend provider needs a URL; a key-based provider needs its key. Either
  // missing -> unavailable, so the card keeps the informative Stage-1 verdict.
  if (provider.usesBackend) {
    if (!backendUrl) return { ...NEUTRAL_RESULT, unavailable: true };
  } else if (PROVIDER.apiKeyStorageKey) {
    const key = await readApiKey(PROVIDER);
    if (!key) return { ...NEUTRAL_RESULT, unavailable: true };
  }

  let result;
  try {
    const apiKey = PROVIDER.apiKeyStorageKey ? await readApiKey(PROVIDER) : '';
    const { url, options } = PROVIDER.buildRequest(text, apiKey, backendUrl);
    const response = await fetch(url, options);
    if (!response.ok) {
      return { ...NEUTRAL_RESULT, unavailable: true };
    }
    const raw = await response.json();
    // A backend can answer 200 with { unavailable } (no server-side key set).
    if (raw && raw.unavailable) {
      return { ...NEUTRAL_RESULT, unavailable: true };
    }
    result = mapResponse(raw);
  } catch {
    return { ...NEUTRAL_RESULT, unavailable: true };
  }

  // Only a genuine provider result is cached (never re-bill the same text §7).
  await setCached(hash, result);
  return result;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return false;

  // Stage-2: AI-generation deep check.
  if (message.type === 'deep-check') {
    const text = typeof message.text === 'string' ? message.text : '';
    deepCheck(text)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ...NEUTRAL_RESULT, unavailable: true }));
    return true; // keep the channel open for the async response
  }

  // Stage-3: on-demand credibility / claim analysis.
  if (message.type === 'credibility-check') {
    const text = typeof message.text === 'string' ? message.text : '';
    analyzeCredibility(text)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ unavailable: true, reason: 'error' }));
    return true; // keep the channel open for the async response
  }

  return false;
});
