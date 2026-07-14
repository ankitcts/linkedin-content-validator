// Content-hash cache backed by chrome.storage.local. Keyed by the SHA-256 of the
// post text so viral posts resolve instantly and the provider is never re-billed
// for text it has already scored. See PROJECT_CONTEXT.md §4, §7.

/**
 * @param {string} hash SHA-256 of the post text.
 * @returns {Promise<object|null>} the cached { score, signals } result, or null.
 */
export async function getCached(hash) {
  const stored = await chrome.storage.local.get(hash);
  return stored[hash] ?? null;
}

/**
 * @param {string} hash SHA-256 of the post text.
 * @param {object} result the { score, signals } result to cache.
 */
export async function setCached(hash, result) {
  await chrome.storage.local.set({ [hash]: result });
}
