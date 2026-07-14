// SHA-256 content hashing via the Web Crypto API. Used to key the Stage-2 cache
// so identical post text is never re-billed to the detection provider (§4, §7).

/**
 * @param {string} text
 * @returns {Promise<string>} lowercase hex SHA-256 digest of the input.
 */
export async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
